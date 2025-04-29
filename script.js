async function zaladujGalerie() {
  const galeria = document.getElementById('galeria');
  galeria.innerHTML = '';

  const jezioro = document.getElementById('jezioro')?.value || 'sniardwy';

  for (let rok = 1990; rok <= 2024; rok++) {
    try {
      const response = await fetch(`http://127.0.0.1:5000/obrazek?rok=${rok}&jezioro=${jezioro}`);
      const data = await response.json();

      if (data && data.url) {
        const div = document.createElement('div');
        div.classList.add('obrazek-container');

        const img = document.createElement('img');
        img.src = data.url;
        img.alt = `Zdjęcie z roku ${rok}`;
        img.style.width = '200px';
        img.style.height = 'auto';
        img.style.borderRadius = '5px';

        const podpis = document.createElement('div');
        podpis.innerText = rok;
        podpis.style.color = 'white';
        podpis.style.marginTop = '5px';

        div.appendChild(img);
        div.appendChild(podpis);
        galeria.appendChild(div);
      } else {
        console.error(`Brak zdjęcia dla roku ${rok}`);
      }
    } catch (error) {
      console.error(`Błąd ładowania dla roku ${rok}:`, error);
    }
  }
}

window.onload = zaladujGalerie;
