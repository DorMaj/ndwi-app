const PIERWSZY_ROK = 2022;
const OSTATNI_ROK = 2024;
const GRANULACJA = 7;

let ndwiDane = [];
let lataPobrane = [];
let ndwiChart = null;

function dayOfYear(dateStr) {
    const date = new Date(dateStr);
    const start = new Date(date.getFullYear(), 0, 0);
    return Math.floor((date - start) / 86400000);
}
// Dostosowanie formy pod uczenie tensor flow
function getInputs(d) {
    const dYear = dayOfYear(d.data);
    const sinDay = Math.sin(2 * Math.PI * dYear / 365);
    const cosDay = Math.cos(2 * Math.PI * dYear / 365);
    const yearNorm = (new Date(d.data).getFullYear() - 2022) / 3.0;
    return [sinDay, cosDay, yearNorm];
}

async function pobierzNDWI() {
  const jezioro = document.getElementById('jezioro').value;
  ndwiDane = [];
  lataPobrane = [];

  document.querySelector("h1").innerText =
    `NDWI jeziora ${jezioro.charAt(0).toUpperCase() + jezioro.slice(1)} (z AI predykcją)`;

  const lata = Array.from({ length: OSTATNI_ROK - PIERWSZY_ROK + 1 }, (_, i) => PIERWSZY_ROK + i);

  document.getElementById('loadingChart').style.display = 'block';
  document.getElementById('loadingChart').innerText = `Ładowanie wykresu... 0/${lata.length}`;

  let allData = [];
  for (let i = 0; i < lata.length; i++) {
    const rok = lata[i];
    try {
      const url = `http://127.0.0.1:5000/ndwi_range?jezioro=${jezioro}&start=${rok}-04-01&end=${rok}-10-31&granulacja=${GRANULACJA}`;
      const res = await fetch(url);
      const data = await res.json();
      if (Array.isArray(data)) {
        allData = allData.concat(data.filter(p => p.ndwi !== null));
        lataPobrane.push(rok);
      }
    } catch (e) {
      console.error(`Błąd dla roku ${rok}:`, e);
    }
    document.getElementById('loadingChart').innerText = `Ładowanie wykresu... ${lataPobrane.length}/${lata.length}`;
    await new Promise(res => setTimeout(res, 80));
  }
  ndwiDane = allData;
  document.getElementById('loadingChart').style.display = 'none';
  wyswietlWykres();
}

function wyswietlWykres() {
  ndwiDane.sort((a, b) => new Date(a.data) - new Date(b.data));
  document.getElementById('wykres').style.display = 'block';
  document.getElementById('legend').style.display = 'flex';

  if (!ndwiDane.length) {
    document.getElementById('wykres').style.display = 'none';
    document.getElementById('legend').innerText = "Brak danych do wyświetlenia.";
    return;
  }

  const inputs = ndwiDane.map(getInputs);
  const outputs = ndwiDane.map(d => d.ndwi);

  const xs = tf.tensor2d(inputs, [inputs.length, 3]);
  const ys = tf.tensor2d(outputs, [outputs.length, 1]);
  const model = tf.sequential();
  model.add(tf.layers.dense({ inputShape: [3], units: 16, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 1 }));
  model.compile({ optimizer: 'adam', loss: 'meanSquaredError' });

  // Przedział dat
  const pred_start = new Date("2025-04-01");
  const pred_end = new Date("2025-10-31");
  let pred_points = [];
  let predDate = new Date(pred_start);
  while (predDate <= pred_end) {
    pred_points.push({
      data: predDate.toISOString().slice(0, 10),
      ...getInputs({data: predDate.toISOString().slice(0,10)})
    });
    predDate = new Date(predDate.getTime() + GRANULACJA * 24 * 60 * 60 * 1000);
  }
  const predInputs = tf.tensor2d(pred_points.map(d => [d[0], d[1], d[2]]), [pred_points.length, 3]);

  model.fit(xs, ys, { epochs: 200, verbose: 0 }).then(async () => {
    let preds = await model.predict(predInputs).array();
    let predykcje = preds.map(p => p[0]);

    // Przedział sezonu
    let grupy = {};
    ndwiDane.forEach(d => {
      let dt = new Date(d.data);
      let month = dt.getMonth() + 1;
      if (month >= 4 && month <= 10) {
        let dYear = dayOfYear(d.data);
        let okres = Math.floor((dYear - 90) / GRANULACJA);
        if (!grupy[okres]) grupy[okres] = [];
        grupy[okres].push(d.ndwi);
      }
    });
    let sredniaSezonowa = Object.values(grupy).map(gr => gr.reduce((a, b) => a + b, 0) / gr.length);

    // Start sezonu
    let base_labels = [];
    let baseDate = new Date("2025-04-01");
    for (let i = 0; i < sredniaSezonowa.length; i++) {
      base_labels.push(baseDate.toISOString().slice(0, 10));
      baseDate = new Date(baseDate.getTime() + GRANULACJA * 24 * 60 * 60 * 1000);
    }

    // Utworzenie wykresu
    const ctx = document.getElementById('wykres').getContext('2d');
    if (ndwiChart) ndwiChart.destroy();
    ndwiChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [
          ...ndwiDane.map(d => d.data),
          ...pred_points.map(f => f.data)
        ],
        datasets: [
          {
            label: 'Średnie NDWI (rzeczywiste)',
            data: ndwiDane.map(d => d.ndwi),
            borderColor: 'lightgreen',
            backgroundColor: 'lightgreen',
            borderWidth: 2,
            fill: false,
          },
          {
            label: 'Predykcja NDWI (AI, 2025)',
            data: Array(ndwiDane.length).fill(null).concat(predykcje),
            borderColor: 'yellow',
            borderDash: [5, 5],
            borderWidth: 2,
            fill: false,
          },
          {
            label: 'Średnia sezonowa (baseline)',
            data: Array(ndwiDane.length).fill(null)
              .concat(
                pred_points.map((p, idx) => {
                  let found = base_labels.indexOf(p.data);
                  return found !== -1 ? sredniaSezonowa[found] : null;
                })
              ),
            borderColor: '#4444ff',
            borderDash: [2, 2],
            borderWidth: 2,
            fill: false,
            pointRadius: 2,
            spanGaps: true
          },
        ],
      },
      options: {
        scales: {
          x: {
            type: 'time',
            time: {
              unit: 'month',
              tooltipFormat: 'yyyy-MM-dd',
              displayFormats: { month: 'yyyy-MM' }
            }
          },
          y: { beginAtZero: false }
        },
      },
    });

    document.getElementById('legend').innerHTML = `
      <div class="legend-item">
        <div class="legend-color legend-green"></div> Dane rzeczywiste (${ndwiDane[0].data.slice(0, 4)}–${ndwiDane[ndwiDane.length - 1].data.slice(0, 4)})
      </div>
      <div class="legend-item">
        <div class="legend-color legend-yellow"></div> Predykcja AI (2025, IV–X)
      </div>
      <div class="legend-item">
        <div class="legend-color" style="background:#4444ff;border:1px solid #7a90f3"></div> Średnia sezonowa (IV–X, 2022–2024)
      </div>
    `;
  });
}

// Galeria ze skrolowaniem
async function pobierzGalerie() {
  const jezioro = document.getElementById('jezioro').value;
  const dzisiaj = new Date();
  const OSTATNI_ROK = dzisiaj.getFullYear() - 1;
  const PIERWSZY_ROK = OSTATNI_ROK - 2;

  let loadingBox = document.getElementById('loadingChart');
  loadingBox.style.display = "block";
  loadingBox.innerText = "Ładowanie galerii zdjęć...";

  let allDates = [];
  for (let rok = PIERWSZY_ROK; rok <= OSTATNI_ROK; rok++) {
    for (let miesiac = 4; miesiac <= 10; miesiac++) {
      allDates.push({ rok, miesiac });
    }
  }

  let galeria = document.getElementById('galeria');
  galeria.innerHTML = "";
  for (let i = 0; i < allDates.length; i++) {
    let { rok, miesiac } = allDates[i];
    loadingBox.innerText = `Ładowanie galerii: ${rok}-${String(miesiac).padStart(2, "0")}...`;

    let res = await fetch(
      `http://127.0.0.1:5000/obrazek?rok=${rok}&miesiac=${miesiac}&jezioro=${jezioro}`
    );
    let data = await res.json();
    if (data.url) {
      let item = document.createElement("div");
      item.className = "gal-imgbox";

      let img = document.createElement("img");
      img.src = data.url;
      item.appendChild(img);

      let opis = document.createElement("div");
      opis.className = "gal-desc";
      opis.innerText =
        `${rok}-${String(miesiac).padStart(2, "0")}` +
        (data.img_date ? `\nData: ${data.img_date}` : "") +
        (data.cloud_cover !== null ? `\nChmury: ${Math.round(data.cloud_cover)}%` : "");
      item.appendChild(opis);

      galeria.appendChild(item);
    }
  }
  loadingBox.style.display = "none";
}
