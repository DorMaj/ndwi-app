from flask import Flask, request, jsonify
from flask_cors import CORS
import ee

# Inicjalizacja GEE
ee.Initialize(project='ndwi-mazury-412312')

app = Flask(__name__)
CORS(app)

def maskLandsatClouds(image):
    qa = image.select('QA_PIXEL')
    cloud = qa.bitwiseAnd(1 << 3).eq(0)
    cloud_shadow = qa.bitwiseAnd(1 << 4).eq(0)
    return image.updateMask(cloud.And(cloud_shadow))

@app.route('/ndwi')
def ndwi():
    year = int(request.args.get('rok'))
    region = ee.Geometry.Rectangle([21.65, 53.70, 21.85, 53.80])
    start = ee.Date.fromYMD(year, 5, 1)
    end = ee.Date.fromYMD(year, 9, 30)

    try:
        if year >= 2013:
            collection = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2') \
                .filterBounds(region).filterDate(start, end) \
                .map(maskLandsatClouds) \
                .select(['SR_B3', 'SR_B5'])
            image = collection.median()
            ndwi = image.normalizedDifference(['SR_B3', 'SR_B5']).rename('NDWI')

        elif year >= 1999:
            collection = ee.ImageCollection('LANDSAT/LE07/C02/T1_L2') \
                .filterBounds(region).filterDate(start, end) \
                .map(maskLandsatClouds) \
                .select(['SR_B2', 'SR_B4'])
            image = collection.median()
            ndwi = image.normalizedDifference(['SR_B2', 'SR_B4']).rename('NDWI')

        elif year >= 1984:
            collection = ee.ImageCollection('LANDSAT/LT05/C02/T1_L2') \
                .filterBounds(region).filterDate(start, end) \
                .map(maskLandsatClouds) \
                .select(['SR_B2', 'SR_B4'])
            image = collection.median()
            ndwi = image.normalizedDifference(['SR_B2', 'SR_B4']).rename('NDWI')

        else:
            return jsonify({'rok': year, 'srednie_ndwi': None})

        mean = ndwi.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=region,
            scale=30,
            maxPixels=1e9
        )
        result = mean.getInfo()
        return jsonify({'rok': year, 'srednie_ndwi': result.get('NDWI')})

    except Exception as e:
        print(f"NDWI Błąd {year}: {e}")
        return jsonify({'rok': year, 'srednie_ndwi': None})

@app.route('/obrazek')
def obrazek():
    year = int(request.args.get('rok'))
    region = ee.Geometry.Rectangle([21.65, 53.70, 21.85, 53.80])
    start = ee.Date.fromYMD(year, 7, 1)
    end = ee.Date.fromYMD(year, 8, 31)

    try:
        if year >= 2013:
            collection = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2') \
                .filterBounds(region).filterDate(start, end) \
                .map(maskLandsatClouds) \
                .select(['SR_B4', 'SR_B3', 'SR_B2'])
            vis_params = {
                'bands': ['SR_B4', 'SR_B3', 'SR_B2'],
                'min': 5000, 'max': 15000,
                'gamma': 1.0
            }

        elif year >= 1999:
            collection = ee.ImageCollection('LANDSAT/LE07/C02/T1_L2') \
                .filterBounds(region).filterDate(start, end) \
                .map(maskLandsatClouds) \
                .select(['SR_B3', 'SR_B2', 'SR_B1'])
            vis_params = {
                'bands': ['SR_B3', 'SR_B2', 'SR_B1'],
                'min': 5000, 'max': 15000,
                'gamma': 1.0
            }

        elif year >= 1984:
            collection = ee.ImageCollection('LANDSAT/LT05/C02/T1_L2') \
                .filterBounds(region).filterDate(start, end) \
                .map(maskLandsatClouds) \
                .select(['SR_B3', 'SR_B2', 'SR_B1'])
            vis_params = {
                'bands': ['SR_B3', 'SR_B2', 'SR_B1'],
                'min': 5000, 'max': 15000,
                'gamma': 1.0
            }

        else:
            return jsonify({'rok': year, 'url': None})

        image = collection.median()

        # Rozjaśnianie delikatne
        image = image.multiply(1.05)  # Bardzo lekkie (5%)

        visualized = image.visualize(**vis_params)

        thumb_url = visualized.getThumbURL({
            'region': region,
            'dimensions': 512,
            'format': 'jpg'
        })

        return jsonify({'rok': year, 'url': thumb_url})

    except Exception as e:
        print(f"Obrazek Błąd {year}: {e}")
        return jsonify({'rok': year, 'url': None})

if __name__ == '__main__':
    app.run(debug=True)
