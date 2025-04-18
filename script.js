async function pobierzNDWI() {
  const lata = Array.from({ length: 2024 - 1990 + 1 }, (_, i) => 1990 + i);
  const dane = [];

  for (const rok of lata) {
    try {
      const res = await fetch(`http://127.0.0.1:5000/ndwi?rok=${rok}`);
      const json = await res.json();
      if (json.srednie_ndwi !== null) {
        dane.push(json);
      }

      // Ustawienie obrazka
      if (rok === 2024) {
        const imgRes = await fetch(`http://127.0.0.1:5000/obrazek?rok=${rok}`);
        const imgJson = await imgRes.json();
        if (imgJson.url) {
          document.getElementById("obrazek").src = imgJson.url;
        }
      }
    } catch (e) {
      console.warn(`Błąd dla roku ${rok}: ${e}`);
    }
  }

  // Wykres
  const ctx = document.getElementById('wykres').getContext('2d');
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: dane.map(e => e.rok),
      datasets: [{
        label: 'NDWI',
        data: dane.map(e => e.srednie_ndwi),
        fill: false,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      scales: {
        x: { title: { display: true, text: 'Rok' } },
        y: { title: { display: true, text: 'NDWI' } }
      }
    }
  });
}

// 🖼️ Galeria
let galeriaObrazy = [];
let galeriaIndex = 0;

async function zaladujGalerie() {
  const lata = Array.from({ length: 2024 - 1990 + 1 }, (_, i) => 1990 + i);
  galeriaObrazy = [];

  for (const rok of lata) {
    try {
      const res = await fetch(`http://127.0.0.1:5000/obrazek?rok=${rok}`);
      const dane = await res.json();
      if (dane.url) {
        galeriaObrazy.push({ rok, url: dane.url });
      }
    } catch (e) {
      console.warn(`Brak zdjęcia z roku ${rok}`);
    }
  }

  if (galeriaObrazy.length > 0) {
    galeriaIndex = 0;
    pokazGalerie();
  }
}

function pokazGalerie() {
  const img = document.getElementById("galeria-obrazek");
  const rokLabel = document.getElementById("galeria-rok");
  const obecne = galeriaObrazy[galeriaIndex];
  img.src = obecne.url;
  rokLabel.textContent = `Rok: ${obecne.rok}`;
}

function poprzednieZdjecie() {
  galeriaIndex = (galeriaIndex - 1 + galeriaObrazy.length) % galeriaObrazy.length;
  pokazGalerie();
}

function nastepneZdjecie() {
  galeriaIndex = (galeriaIndex + 1) % galeriaObrazy.length;
  pokazGalerie();
}

// 🔁 Start
zaladujGalerie();
