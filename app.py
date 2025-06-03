from flask import Flask, request, jsonify
from flask_cors import CORS
import ee
from datetime import datetime, timedelta
import concurrent.futures

ee.Initialize(project='ndwi-mazury-412312')

app = Flask(__name__)
CORS(app)

JEZIORA = {
    "sniardwy": ee.Geometry.Rectangle([21.65, 53.70, 21.85, 53.80]),
    "niegocin": ee.Geometry.Rectangle([21.73, 54.00, 21.85, 54.10]),
    "mamry": ee.Geometry.Rectangle([21.70, 54.12, 21.84, 54.25])
}

TIMEOUT = 8

def maskSentinelClouds(image):
    qa = image.select('QA60')
    cloud = qa.bitwiseAnd(1 << 10).eq(0).And(qa.bitwiseAnd(1 << 11).eq(0))
    return image.updateMask(cloud)

def get_with_timeout(func, timeout, *args, **kwargs):
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(func, *args, **kwargs)
        try:
            return future.result(timeout=timeout)
        except concurrent.futures.TimeoutError:
            return 'timeout'
        except Exception as e:
            print(f"[NDWI] Wyjątek w wątku: {e}")
            return None

def try_with_retry(func, timeout, retries=1, *args, **kwargs):
    for i in range(retries + 1):
        result = get_with_timeout(func, timeout, *args, **kwargs)
        if result != 'timeout':
            return result
    return 'timeout'

@app.route('/ndwi_range')
def ndwi_range():
    jezioro = request.args.get('jezioro', 'sniardwy')
    region = JEZIORA.get(jezioro, JEZIORA['sniardwy'])

    start_str = request.args.get('start', '2021-04-01')
    end_str = request.args.get('end', '2023-10-31')
    granulacja = int(request.args.get('granulacja', 7))
    start_date = datetime.strptime(start_str, "%Y-%m-%d")
    end_date = datetime.strptime(end_str, "%Y-%m-%d")

    results = []

    try:
        okres_start = start_date
        window_nr = 1
        while okres_start < end_date:
            okres_koniec = min(okres_start + timedelta(days=granulacja-1), end_date)
            print(f"\n[NDWI] Okno {window_nr}: {okres_start.strftime('%Y-%m-%d')} - {okres_koniec.strftime('%Y-%m-%d')}")
            ee_start = ee.Date.fromYMD(okres_start.year, okres_start.month, okres_start.day)
            ee_end = ee.Date.fromYMD(okres_koniec.year, okres_koniec.month, okres_koniec.day)

            # System filtrowania wedlug chmur
            collection = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED') \
                .filterBounds(region) \
                .filterDate(ee_start, ee_end) \
                .map(maskSentinelClouds) \
                .select(['B3', 'B8']) \
                .sort('CLOUDY_PIXEL_PERCENTAGE')

            def get_collection_count():
                return collection.size().getInfo()

            count = try_with_retry(get_collection_count, TIMEOUT, retries=1)
            if count == 'timeout':
                print(f"[NDWI] TIMEOUT na .size() (pomijam okno)")
                ndwi_val = None
                cloud_cover_value = None
                img_date = None
            elif count == 0 or count is None:
                print(f"[NDWI] Brak obrazów w kolekcji lub błąd.")
                ndwi_val = None
                cloud_cover_value = None
                img_date = None
            else:
                ndwi_val = None
                cloud_cover_value = None
                img_date = None
                try:
                    best_img = collection.first()
                    info = best_img.getInfo() if best_img is not None else None
                    if info:
                        cloud_cover = info['properties'].get('CLOUDY_PIXEL_PERCENTAGE')
                        img_date = info['properties'].get('DATE_ACQUIRED') or info['properties'].get('system:time_start')
                        if cloud_cover is not None and cloud_cover <= 40:
                            def compute_ndwi():
                                image = ee.Image(best_img)
                                ndwi = image.normalizedDifference(['B3', 'B8']).rename('NDWI')
                                mean = ndwi.reduceRegion(
                                    reducer=ee.Reducer.mean(),
                                    geometry=region,
                                    scale=10,
                                    maxPixels=1e9
                                )
                                result = mean.getInfo()
                                return result.get('NDWI') if result else None
                            ndwi_val = try_with_retry(compute_ndwi, TIMEOUT, retries=1)
                            print(f"[NDWI] NDWI (najlepsze Sentinel-2 <40% chmur): {ndwi_val} (CLOUDY_PIXEL_PERCENTAGE={cloud_cover})")
                            cloud_cover_value = cloud_cover
                        else:
                            print(f"[NDWI] Najlepsze zdjęcie ma za dużo chmur ({cloud_cover}%) lub brak info.")
                except Exception as e:
                    print(f"[NDWI] Błąd podczas liczenia NDWI: {e}")
                    ndwi_val = None
                    cloud_cover_value = None
                    img_date = None

            results.append({
                'data': okres_start.strftime('%Y-%m-%d'),
                'ndwi': ndwi_val,
                'cloud_cover': cloud_cover_value,
                'img_date': img_date
            })

            print(f"[NDWI] Przechodzę do następnego okna\n")
            okres_start += timedelta(days=granulacja)
            window_nr += 1

        print(f"[NDWI] Łącznie okien: {window_nr-1}. Zwracam {len(results)} wyników.\n")
        return jsonify(results)

    except Exception as e:
        print(f"NDWI Błąd range: {e}")
        return jsonify([])

@app.route('/obrazek')
def obrazek():
    year = int(request.args.get('rok'))
    month = int(request.args.get('miesiac', 7))
    jezioro = request.args.get('jezioro', 'sniardwy')
    region = JEZIORA.get(jezioro, JEZIORA['sniardwy'])
    # Zakres roku
    start = ee.Date.fromYMD(year, month, 1)
    if month == 12:
        end = ee.Date.fromYMD(year + 1, 1, 1).advance(-1, 'day')
    else:
        end = ee.Date.fromYMD(year, month + 1, 1).advance(-1, 'day')

    try:
        collection = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED') \
            .filterBounds(region).filterDate(start, end) \
            .map(maskSentinelClouds) \
            .select(['B4', 'B3', 'B2']) \
            .sort('CLOUDY_PIXEL_PERCENTAGE')

        best_img = collection.first()
        cloud_cover = None
        img_date = None
        url = None

        info = best_img.getInfo() if best_img is not None else None
        if info:
            cloud_cover = info['properties'].get('CLOUDY_PIXEL_PERCENTAGE')
            img_date = info['properties'].get('DATE_ACQUIRED') or info['properties'].get('system:time_start')
            vis_params = {
                'bands': ['B4', 'B3', 'B2'],
                'min': 0, 'max': 3000,
                'gamma': 1.0
            }
            visualized = ee.Image(best_img).visualize(**vis_params)
            thumb_url = visualized.getThumbURL({
                'region': region,
                'dimensions': 512,
                'format': 'jpg'
            })
            url = thumb_url

        return jsonify({
            'rok': year,
            'miesiac': month,
            'url': url,
            'cloud_cover': cloud_cover,
            'img_date': img_date
        })

    except Exception as e:
        print(f"Obrazek Błąd {year}-{month}: {e}")
        return jsonify({'rok': year, 'miesiac': month, 'url': None, 'cloud_cover': None, 'img_date': None})

if __name__ == '__main__':
    app.run(debug=True)
