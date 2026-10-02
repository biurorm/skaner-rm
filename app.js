// RM NIERUCHOMOŚCI, Skaner
// Zdjęcia stron dokumentu -> automatyczny kadr, prostowanie, poprawa jakości -> zaznaczone strony
// w jeden PDF (opcjonalnie z hasłem AES-256) albo jako numerowane JPG.
// Wszystko w pamięci telefonu. Żadnego serwera, żadnego zapisu zdjęć na stałe.
'use strict';

// numer wersji widoczny w zielonym pasku; podbijać razem z ?v= w index.html i CACHE w sw.js
const WERSJA = 4;

const $ = (s) => document.querySelector(s);
document.querySelectorAll('[data-wersja]').forEach((el) => { el.textContent = 'v' + WERSJA; });

const TRYBY = [
  { k: 'kolor', n: 'Kolor' },
  { k: 'szary', n: 'Szarość' },
  { k: 'czb', n: 'Czarno-białe' },
  { k: 'oryginal', n: 'Oryginał' }
];

const stan = {
  strony: [],      // { id, zrodlo: Blob, rogi, wykryto, tryb, obrot, wynik: Blob, w, h, mini: url, wybrana }
  tryb: 'kolor',
  format: 'pdf',   // 'pdf' = zaznaczone strony w jeden plik, 'jpg' = każda strona osobno, numerowana
  pliki: null,     // gotowe pliki (File[]) z ostatniego zapisu
  zapisano: true,  // czy obecny stan stron trafił już do pliku (ostrzeżenie przed zamknięciem)
  ed: null         // edytowana strona: { s, rogi, tryb, obrot, obraz: canvas }
};

const wybrane = () => stan.strony.filter((s) => s.wybrana);
const nr2 = (n) => String(n).padStart(2, '0');

// coś się zmieniło w stronach: gotowe pliki są nieaktualne
function zmiana() {
  stan.pliki = null; stan.zapisano = !stan.strony.length;
  const g = $('#z-gotowe'); if (g) g.hidden = true;
}
try { const t = localStorage.getItem('rm-skaner-tryb'); if (TRYBY.some((x) => x.k === t)) stan.tryb = t; } catch (e) {}

let licznikId = 0;

// ---------- POMOCNICZE ----------

function pokaz(ekran) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'ekran-' + ekran));
  $('#dol').hidden = ekran !== 'lista';
  window.scrollTo(0, 0);
}

let toastT = null;
function toast(t, ms = 2200) {
  const el = $('#toast'); el.textContent = t; el.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, ms);
}

function zaslona(t) {
  $('#zaslona').hidden = !t;
  if (t) $('#zaslona-tekst').textContent = t;
}

const oddech = () => new Promise((r) => setTimeout(r, 30)); // daj ekranowi się odrysować
const zwolnij = (c) => { if (c) { c.width = 0; c.height = 0; } };

function chipsy(kontener, wybrany, naKlik) {
  kontener.innerHTML = '';
  for (const t of TRYBY) {
    const b = document.createElement('button');
    b.className = 'chip' + (t.k === wybrany ? ' on' : '');
    b.textContent = t.n;
    b.addEventListener('click', () => naKlik(t.k));
    kontener.appendChild(b);
  }
}

// ---------- OBRÓBKA STRONY ----------

async function przelicz(s, zrodloCanvas) {
  const zr = zrodloCanvas || await Skan.wczytaj(s.zrodlo);
  const wynik = Skan.przetworz(zr, s.rogi, s.tryb, s.obrot);
  if (!zrodloCanvas) zwolnij(zr);
  s.wynik = await Skan.doBloba(wynik, 'image/jpeg', s.tryb === 'czb' ? 0.8 : 0.85);
  s.w = wynik.width; s.h = wynik.height;
  const m = Skan.miniatura(wynik);
  if (s.mini) URL.revokeObjectURL(s.mini);
  s.mini = URL.createObjectURL(await Skan.doBloba(m, 'image/jpeg', 0.8));
  zwolnij(wynik); zwolnij(m);
}

// nowa strona z płótna zdjęcia; hint = rogi z podglądu na żywo (to, co Rafał widział na ekranie)
async function dodajStrone(zr, hint) {
  // z podglądu: ramka już znaleziona, tylko dociągamy ją do krawędzi w pełnej rozdzielczości (szybko)
  const rogi = hint ? Skan.dociagnij(zr, hint) : Skan.wykryj(zr);
  const s = {
    id: ++licznikId, zrodlo: await Skan.doBloba(zr, 'image/jpeg', 0.92),
    rogi: rogi || Skan.PELNY, wykryto: !!rogi, tryb: stan.tryb, obrot: 0, wybrana: true
  };
  await przelicz(s, zr);
  stan.strony.push(s);
  zmiana();
  return s;
}

async function dodajPliki(pliki) {
  pliki = Array.from(pliki || []).filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name));
  if (!pliki.length) return;
  let nieudane = 0;
  for (let i = 0; i < pliki.length; i++) {
    zaslona(pliki.length > 1 ? `Przetwarzam stronę ${i + 1} z ${pliki.length}…` : 'Kadruję i poprawiam…');
    await oddech();
    try {
      const zr = await Skan.wczytaj(pliki[i]);
      await dodajStrone(zr);
      zwolnij(zr);
    } catch (e) {
      nieudane++;
    }
  }
  zaslona(null);
  zmiana();
  rysujListe();
  if (nieudane) toast(`Nie udało się wczytać ${nieudane} zdjęć`);
  else toast(pliki.length > 1 ? `Dodano ${pliki.length} stron` : `Strona ${stan.strony.length} dodana`);
}

// ---------- LISTA ----------

function rysujListe() {
  const n = stan.strony.length, k = wybrane().length;
  $('#pusto').hidden = n > 0;
  $('#btn-pdf').disabled = k === 0;
  $('#btn-jpg').disabled = k === 0;
  $('#btn-pdf').textContent = n ? `📄 PDF ${k}` : '📄 PDF';
  $('#btn-jpg').textContent = n ? `🖼 JPG ${k}` : '🖼 JPG';
  $('#tryb-wszystkie').hidden = n === 0;
  $('#wybor').hidden = n === 0;
  $('#wybor-hint').hidden = n === 0;
  $('#wybor-tekst').textContent = k === n ? `Zaznaczone wszystkie strony: ${n}` : `Zaznaczone: ${k} z ${n}`;
  $('#wybor-wszystkie').textContent = k === n ? 'Odznacz wszystkie' : 'Zaznacz wszystkie';
  chipsy($('#tryb-domyslny'), stan.tryb, (t) => {
    stan.tryb = t;
    try { localStorage.setItem('rm-skaner-tryb', t); } catch (e) {}
    rysujListe();
  });

  const siatka = $('#siatka');
  siatka.innerHTML = '';
  stan.strony.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'strona' + (s.wybrana ? '' : ' odznaczona');
    el.innerHTML = `
      <div class="strona-obraz">
        <img alt="Strona ${i + 1}">
        <span class="strona-nr">Str. ${i + 1}</span>
        <button class="strona-check" aria-label="${s.wybrana ? 'Odznacz' : 'Zaznacz'} stronę ${i + 1}" aria-pressed="${s.wybrana}">${s.wybrana ? '✓' : ''}</button>
        ${s.wykryto ? '' : '<span class="strona-uwaga">Sprawdź kadr</span>'}
      </div>
      <div class="strona-akcje">
        <button data-a="lewo" aria-label="Przesuń wcześniej" ${i === 0 ? 'disabled' : ''}>◀</button>
        <button data-a="kadr" aria-label="Popraw kadr">✂️</button>
        <button data-a="obroc" aria-label="Obróć">↻</button>
        <button data-a="usun" aria-label="Usuń">🗑</button>
        <button data-a="prawo" aria-label="Przesuń dalej" ${i === n - 1 ? 'disabled' : ''}>▶</button>
      </div>`;
    el.querySelector('img').src = s.mini;
    // dotknięcie strony = zaznacz / odznacz; kadr poprawia się nożyczkami ✂️
    el.querySelector('.strona-obraz').addEventListener('click', () => {
      s.wybrana = !s.wybrana;
      zmiana(); rysujListe();
    });
    el.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => akcja(b.dataset.a, s)));
    siatka.appendChild(el);
  });
}

$('#wybor-wszystkie').addEventListener('click', () => {
  const wszystkie = wybrane().length === stan.strony.length;
  stan.strony.forEach((s) => { s.wybrana = !wszystkie; });
  zmiana(); rysujListe();
});

async function akcja(a, s) {
  const i = stan.strony.indexOf(s);
  if (a === 'kadr') return otworzEdytor(s);
  if (a === 'lewo' && i > 0) [stan.strony[i - 1], stan.strony[i]] = [stan.strony[i], stan.strony[i - 1]];
  if (a === 'prawo' && i < stan.strony.length - 1) [stan.strony[i + 1], stan.strony[i]] = [stan.strony[i], stan.strony[i + 1]];
  if (a === 'usun') {
    if (!confirm(`Usunąć stronę ${i + 1}?`)) return;
    if (s.mini) URL.revokeObjectURL(s.mini);
    stan.strony.splice(i, 1);
  }
  if (a === 'obroc') {
    zaslona('Obracam…'); await oddech();
    s.obrot = (s.obrot + 90) % 360;
    await przelicz(s);
    zaslona(null);
  }
  zmiana();
  rysujListe();
}

$('#tryb-wszystkie').addEventListener('click', async () => {
  const n = stan.strony.length;
  for (let i = 0; i < n; i++) {
    zaslona(`Zmieniam jakość, strona ${i + 1} z ${n}…`); await oddech();
    stan.strony[i].tryb = stan.tryb;
    await przelicz(stan.strony[i]);
  }
  zaslona(null); zmiana(); rysujListe();
  toast('Zmieniono jakość wszystkich stron');
});

// ---------- EDYTOR KADRU ----------

const MAX_EDYTOR = 1600;
let podgladT = null;

async function otworzEdytor(s) {
  zaslona('Otwieram…'); await oddech();
  const obraz = await Skan.wczytaj(s.zrodlo, MAX_EDYTOR);
  zaslona(null);
  stan.ed = { s, rogi: s.rogi.map((p) => p.slice()), tryb: s.tryb, obrot: s.obrot, obraz };
  $('#ed-tytul').textContent = `Strona ${stan.strony.indexOf(s) + 1}`;
  const c = $('#ed-obraz');
  c.width = obraz.width; c.height = obraz.height;
  c.getContext('2d').drawImage(obraz, 0, 0);
  pokaz('edytor');
  dopasujPole();
  rysujRamke();
  chipsyEd();
  odswiezPodglad(0);
}

function dopasujPole() {
  const ed = stan.ed; if (!ed) return;
  const maxW = Math.min(document.querySelector('.app').clientWidth - 32, 788);
  const maxH = Math.max(260, window.innerHeight * 0.58);
  const s = Math.min(maxW / ed.obraz.width, maxH / ed.obraz.height);
  const pole = $('#ed-pole');
  pole.style.width = Math.round(ed.obraz.width * s) + 'px';
  pole.style.height = Math.round(ed.obraz.height * s) + 'px';
  rysujRamke();
}
window.addEventListener('resize', dopasujPole);

function rysujRamke() {
  const ed = stan.ed; if (!ed) return;
  const pole = $('#ed-pole'), W = pole.clientWidth, H = pole.clientHeight;
  $('#ed-ramka').setAttribute('viewBox', `0 0 ${W} ${H}`);
  $('#ed-wielokat').setAttribute('points', ed.rogi.map(([x, y]) => `${x * W},${y * H}`).join(' '));
  document.querySelectorAll('.rog').forEach((r) => {
    const [x, y] = ed.rogi[+r.dataset.i];
    r.style.left = x * W + 'px'; r.style.top = y * H + 'px';
  });
}

function chipsyEd() {
  chipsy($('#ed-tryb'), stan.ed.tryb, (k) => { stan.ed.tryb = k; chipsyEd(); odswiezPodglad(0); });
}

// szybki podgląd z obrazu edytora (mniejsza rozdzielczość), pełna obróbka dopiero po "Gotowe"
function odswiezPodglad(opozn = 250) {
  clearTimeout(podgladT);
  podgladT = setTimeout(async () => {
    const ed = stan.ed; if (!ed) return;
    const w = Skan.przetworz(ed.obraz, ed.rogi, ed.tryb, ed.obrot);
    const m = Skan.miniatura(w, 900);
    const b = await Skan.doBloba(m, 'image/jpeg', 0.8);
    zwolnij(w); zwolnij(m);
    const img = $('#ed-podglad');
    if (img.src) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(b);
  }, opozn);
}

// przeciąganie rogów + lupa (palec zasłania róg, lupa pokazuje go powiększonego)
(function () {
  let aktywny = null;
  const lupa = $('#lupa'), lctx = lupa.getContext('2d');

  function pokazLupe(x, y) {
    const ed = stan.ed, pole = $('#ed-pole'), W = pole.clientWidth, H = pole.clientHeight;
    const ZOOM = 3, R = lupa.width;
    const sx = x * ed.obraz.width, sy = y * ed.obraz.height;
    const zakres = R / ZOOM * (ed.obraz.width / W);
    lctx.fillStyle = '#000'; lctx.fillRect(0, 0, R, R);
    lctx.drawImage(ed.obraz, sx - zakres / 2, sy - zakres / 2, zakres, zakres, 0, 0, R, R);
    lctx.strokeStyle = '#22c55e'; lctx.lineWidth = 2;
    lctx.beginPath(); lctx.moveTo(R / 2, 0); lctx.lineTo(R / 2, R); lctx.moveTo(0, R / 2); lctx.lineTo(R, R / 2); lctx.stroke();
    // lupa nad palcem, przy górnej krawędzi pod palcem
    let lx = x * W - R / 2, ly = y * H - R - 50;
    if (ly < -20) ly = y * H + 50;
    lx = Math.max(-10, Math.min(W - R + 10, lx));
    lupa.style.left = lx + 'px'; lupa.style.top = ly + 'px';
    lupa.hidden = false;
  }

  document.querySelectorAll('.rog').forEach((r) => {
    r.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      aktywny = { i: +r.dataset.i, id: e.pointerId };
      try { r.setPointerCapture(e.pointerId); } catch (err) {}
      const [x, y] = stan.ed.rogi[aktywny.i];
      pokazLupe(x, y);
    });
    r.addEventListener('pointermove', (e) => {
      if (!aktywny || e.pointerId !== aktywny.id) return;
      const pr = $('#ed-pole').getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - pr.left) / pr.width));
      const y = Math.min(1, Math.max(0, (e.clientY - pr.top) / pr.height));
      stan.ed.rogi[aktywny.i] = [x, y];
      rysujRamke();
      pokazLupe(x, y);
    });
    const koniec = (e) => {
      if (!aktywny || e.pointerId !== aktywny.id) return;
      aktywny = null; lupa.hidden = true;
      odswiezPodglad();
    };
    r.addEventListener('pointerup', koniec);
    r.addEventListener('pointercancel', koniec);
  });
})();

$('#ed-wykryj').addEventListener('click', () => {
  const r = Skan.wykryj(stan.ed.obraz);
  if (!r) { toast('Nie widzę wyraźnie kartki. Ustaw rogi ręcznie.'); return; }
  stan.ed.rogi = r; rysujRamke(); odswiezPodglad(0);
});
$('#ed-calosc').addEventListener('click', () => { stan.ed.rogi = Skan.PELNY.map((p) => p.slice()); rysujRamke(); odswiezPodglad(0); });
$('#ed-lewo').addEventListener('click', () => { stan.ed.obrot = (stan.ed.obrot + 270) % 360; odswiezPodglad(0); toast('Obrócono w lewo', 1000); });
$('#ed-prawo').addEventListener('click', () => { stan.ed.obrot = (stan.ed.obrot + 90) % 360; odswiezPodglad(0); toast('Obrócono w prawo', 1000); });

function zamknijEdytor() {
  const ed = stan.ed; if (!ed) return;
  clearTimeout(podgladT);
  zwolnij(ed.obraz);
  const img = $('#ed-podglad'); if (img.src) { URL.revokeObjectURL(img.src); img.removeAttribute('src'); }
  stan.ed = null;
  pokaz('lista');
}

$('#ed-anuluj').addEventListener('click', zamknijEdytor);
$('#ed-zapisz').addEventListener('click', async () => {
  const ed = stan.ed, s = ed.s;
  s.rogi = ed.rogi; s.tryb = ed.tryb; s.obrot = ed.obrot; s.wykryto = true;
  zaslona('Zapisuję stronę…'); await oddech();
  await przelicz(s);
  zaslona(null);
  zmiana();
  zamknijEdytor();
  rysujListe();
});

// ---------- ZAPIS: PDF albo JPG ----------

function domyslnaNazwa() {
  const d = new Date();
  return `Skan ${d.getFullYear()}-${nr2(d.getMonth() + 1)}-${nr2(d.getDate())} ${nr2(d.getHours())}.${nr2(d.getMinutes())}`;
}

function rysujFormat() {
  const pdf = stan.format === 'pdf', k = wybrane().length;
  $('#z-fmt-pdf').classList.toggle('on', pdf);
  $('#z-fmt-jpg').classList.toggle('on', !pdf);
  $('#z-fmt-opis').textContent = pdf
    ? `Zaznaczone strony (${k}) połączą się w jeden plik PDF, w kolejności z listy.`
    : `Każda zaznaczona strona (${k}) to osobny plik JPG z numerem strony w nazwie.`;
  $('#z-haslo-sekcja').hidden = !pdf;
  $('#z-jpg-uwaga').hidden = pdf;
  $('#z-utworz').textContent = pdf ? '📄 Utwórz PDF' : `🖼 Utwórz JPG (${k})`;
}

function ustawFormat(f) {
  if (stan.format === f) return;
  stan.format = f;
  try { localStorage.setItem('rm-skaner-format', f); } catch (e) {}
  stan.pliki = null; $('#z-gotowe').hidden = true;
  rysujFormat();
}
try { const f = localStorage.getItem('rm-skaner-format'); if (f === 'pdf' || f === 'jpg') stan.format = f; } catch (e) {}
$('#z-fmt-pdf').addEventListener('click', () => ustawFormat('pdf'));
$('#z-fmt-jpg').addEventListener('click', () => ustawFormat('jpg'));

function otworzZapis() {
  if (!wybrane().length) return toast('Zaznacz co najmniej jedną stronę.');
  if (!$('#z-nazwa').value) $('#z-nazwa').value = domyslnaNazwa();
  $('#z-blad').hidden = true;
  $('#z-gotowe').hidden = !stan.pliki;
  rysujFormat();
  pokaz('zapis');
}

const niewazne = () => { stan.pliki = null; $('#z-gotowe').hidden = true; };
$('#z-haslo-wl').addEventListener('change', (e) => { $('#z-haslo-box').hidden = !e.target.checked; niewazne(); });
$('#z-pokaz').addEventListener('change', (e) => { const t = e.target.checked ? 'text' : 'password'; $('#z-haslo1').type = t; $('#z-haslo2').type = t; });
['#z-nazwa', '#z-haslo1', '#z-haslo2'].forEach((s) => $(s).addEventListener('input', niewazne));

function blad(t) { const el = $('#z-blad'); el.textContent = t; el.hidden = !t; }

$('#z-utworz').addEventListener('click', async () => {
  blad('');
  const strony = wybrane();
  if (!strony.length) return blad('Nie ma zaznaczonych stron.');
  const pdf = stan.format === 'pdf';
  let haslo = null;
  if (pdf && $('#z-haslo-wl').checked) {
    haslo = $('#z-haslo1').value;
    if (haslo.length < 6) return blad('Hasło musi mieć co najmniej 6 znaków.');
    if (haslo !== $('#z-haslo2').value) return blad('Hasła się różnią.');
  }
  const baza = $('#z-nazwa').value.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\.(pdf|jpe?g)$/i, '').trim() || domyslnaNazwa();
  zaslona(pdf ? (haslo ? 'Łączę strony i szyfruję PDF…' : 'Łączę strony w PDF…') : 'Przygotowuję JPG…'); await oddech();
  try {
    if (pdf) {
      const dane = [];
      for (const s of strony) dane.push({ jpeg: new Uint8Array(await s.wynik.arrayBuffer()), w: s.w, h: s.h });
      const blob = await PdfRM.zloz(dane, { haslo });
      stan.pliki = [new File([blob], baza + '.pdf', { type: 'application/pdf' })];
    } else {
      // numer w nazwie = numer strony z listy, pliki układają się w folderze po kolei
      stan.pliki = plikiJpg(baza);
    }
  } catch (e) {
    zaslona(null);
    return blad(pdf ? 'Nie udało się utworzyć PDF. Spróbuj ponownie.' : 'Nie udało się przygotować JPG. Spróbuj ponownie.');
  }
  zaslona(null);
  const mb = (stan.pliki.reduce((a, f) => a + f.size, 0) / 1048576).toFixed(1).replace('.', ',');
  $('#z-tytul-gotowe').textContent = pdf ? '✅ PDF gotowy' : `✅ JPG gotowe (${stan.pliki.length})`;
  $('#z-opis').textContent = pdf
    ? `${stan.pliki[0].name}, ${strony.length} str., ${mb} MB${haslo ? ', zabezpieczony hasłem' : ''}.`
    : `${stan.pliki.length === 1 ? stan.pliki[0].name : stan.pliki[0].name + ' … ' + stan.pliki[stan.pliki.length - 1].name}, razem ${mb} MB.`;
  $('#z-udostepnij').textContent = pdf ? '📤 Zapisz w Plikach / wyślij' : '📤 Zapisz w Zdjęciach / Plikach / wyślij';
  $('#z-pobierz').textContent = stan.pliki.length > 1 ? `⬇️ Pobierz pliki (${stan.pliki.length})` : '⬇️ Pobierz plik';
  $('#z-gotowe').hidden = false;
  $('#z-udostepnij').hidden = !(navigator.canShare && navigator.canShare({ files: stan.pliki }));
  $('#z-gotowe').scrollIntoView({ behavior: 'smooth' });
});

$('#z-udostepnij').addEventListener('click', async () => {
  if (!stan.pliki) return;
  try { await navigator.share({ files: stan.pliki }); stan.zapisano = true; } catch (e) { /* anulowano */ }
});

$('#z-pobierz').addEventListener('click', async () => {
  if (!stan.pliki) return;
  await pobierzPliki(stan.pliki);
  stan.zapisano = true;
});

function wyczysc() {
  for (const s of stan.strony) if (s.mini) URL.revokeObjectURL(s.mini);
  stan.strony = []; stan.pliki = null; stan.zapisano = true;
  $('#z-nazwa').value = ''; $('#z-haslo1').value = ''; $('#z-haslo2').value = '';
  $('#z-haslo-wl').checked = false; $('#z-haslo-box').hidden = true; $('#z-gotowe').hidden = true;
  rysujListe();
  pokaz('lista');
}

$('#z-wyczysc').addEventListener('click', () => {
  if (!confirm('Usunąć wszystkie zeskanowane strony z pamięci? Upewnij się, że plik jest zapisany.')) return;
  wyczysc();
  toast('Wyczyszczono. Możesz skanować kolejny dokument.');
});
$('#z-wroc').addEventListener('click', () => pokaz('lista'));

// ---------- SKANOWANIE NA ŻYWO ----------
// Podgląd z aparatu w aplikacji: kartka szukana kilka razy na sekundę i obrysowana na zielono.
// Gdy ramka stoi nieruchomo ok. 1 s, zdjęcie robi się samo. Kolejna strona dopiero po zmianie kartki.
// Obraz z aparatu nie opuszcza telefonu, jak wszystko inne w tej aplikacji.

const Kamera = (() => {
  const STABILNIE_MS = 900;   // tyle ramka musi stać w miejscu przed auto-zdjęciem
  const RUCH = 0.02;          // dopuszczalne drganie rogu między klatkami (ułamek kadru)
  let strumien = null, petlaT = null, zajety = false;
  let ramka = null, stabilnaOd = 0, uzbrojony = true, brakOd = 0, wzorzec = null;
  let auto = true;
  try { auto = localStorage.getItem('rm-skaner-auto') !== '0'; } catch (e) {}
  const video = $('#kam-video'), maly = document.createElement('canvas');

  const dostepna = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  async function otworz() {
    if (!dostepna()) { $('#in-aparat').click(); return; }
    pokaz('kamera');
    status('Uruchamiam aparat…');
    try {
      strumien = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 4032 }, height: { ideal: 3024 } }
      });
    } catch (e) {
      zamknij();
      toast('Brak dostępu do aparatu. Otwieram zwykły aparat.', 3000);
      $('#in-aparat').click();
      return;
    }
    video.srcObject = strumien;
    try { await video.play(); } catch (e) {}
    await new Promise((r) => { if (video.videoWidth) r(); else video.onloadedmetadata = () => r(); });
    $('#kam-pole').style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
    ramka = null; stabilnaOd = 0; uzbrojony = true; brakOd = 0; wzorzec = null;
    rysujAuto(); licznik();
    petla();
  }

  function zamknij() {
    clearTimeout(petlaT); petlaT = null;
    if (strumien) strumien.getTracks().forEach((t) => t.stop());
    strumien = null; video.srcObject = null;
    pokaz('lista');
    rysujListe();
  }

  function status(t, ok) {
    const el = $('#kam-status'); el.textContent = t; el.classList.toggle('ok', !!ok);
  }

  function licznik() {
    const n = stan.strony.length;
    $('#kam-gotowe').textContent = n ? `Gotowe (${n})` : 'Gotowe';
  }

  function rysujAuto() {
    $('#kam-auto').textContent = auto ? 'Auto: wł.' : 'Auto: wył.';
    $('#kam-auto').classList.toggle('on', auto);
  }

  function rysujRamke(q, postep) {
    const w = $('#kam-wielokat');
    if (!q) { w.setAttribute('points', ''); return; }
    w.setAttribute('points', q.map(([x, y]) => `${x},${y}`).join(' '));
    w.style.fill = `rgba(34,197,94,${0.12 + 0.3 * (postep || 0)})`;
  }

  // mała szara miniatura kadru: po niej poznajemy, że pod aparatem leży już inna kartka
  function odcisk(c) {
    const m = document.createElement('canvas'); m.width = 24; m.height = 24;
    const x = m.getContext('2d', { willReadFrequently: true }); x.drawImage(c, 0, 0, 24, 24);
    const d = x.getImageData(0, 0, 24, 24).data, o = new Float32Array(576);
    for (let i = 0; i < 576; i++) o[i] = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3;
    return o;
  }
  const roznica = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };

  function petla() {
    if (!strumien) return;
    if (!zajety && video.videoWidth) {
      const vw = video.videoWidth, vh = video.videoHeight, s = 480 / Math.max(vw, vh);
      maly.width = Math.round(vw * s); maly.height = Math.round(vh * s);
      maly.getContext('2d', { willReadFrequently: true }).drawImage(video, 0, 0, maly.width, maly.height);
      let r = null;
      try { r = Skan.wykryj(maly, true); } catch (e) {}
      const teraz = performance.now();

      // ponowne uzbrojenie auto-zdjęcia: kartka zniknęła z kadru albo leży już inna
      if (!uzbrojony) {
        if (!r) { if (!brakOd) brakOd = teraz; if (teraz - brakOd > 400) uzbrojony = true; } else brakOd = 0;
        if (!uzbrojony && wzorzec && roznica(odcisk(maly), wzorzec) > 14) uzbrojony = true;
      }

      if (r) {
        const ruch = ramka ? Math.max(...r.map((p, i) => Math.hypot(p[0] - ramka[i][0], p[1] - ramka[i][1]))) : 1;
        if (ruch > RUCH) stabilnaOd = teraz;
        // wygładzanie: ramka nie skacze między klatkami
        ramka = ramka && ruch < 0.08 ? r.map((p, i) => [ramka[i][0] * 0.5 + p[0] * 0.5, ramka[i][1] * 0.5 + p[1] * 0.5]) : r;
        const postep = Math.min(1, (teraz - stabilnaOd) / STABILNIE_MS);
        rysujRamke(ramka, auto && uzbrojony ? postep : 0);
        if (!uzbrojony) status('Strona zapisana. Połóż następną kartkę.', true);
        else if (auto) status(postep < 1 ? 'Mam kartkę. Nie ruszaj telefonem…' : 'Robię zdjęcie…', true);
        else status('Mam kartkę. Naciśnij spust.', true);
        if (auto && uzbrojony && postep >= 1) { pstryk(); }
      } else {
        ramka = null; stabilnaOd = teraz;
        rysujRamke(null);
        status(uzbrojony ? 'Szukam kartki… Połóż ją na ciemniejszym blacie, całą w kadrze.' : 'Strona zapisana. Połóż następną kartkę.');
      }
    }
    petlaT = setTimeout(petla, 70);
  }

  async function pstryk() {
    if (!strumien || zajety || !video.videoWidth) return;
    zajety = true;
    const hint = ramka && ramka.map((p) => p.slice());
    const vw = video.videoWidth, vh = video.videoHeight, sk = Math.min(1, 3000 / Math.max(vw, vh));
    const zr = Skan.plotno(vw * sk, vh * sk);
    const ctx = zr.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(video, 0, 0, zr.width, zr.height);
    $('#kam-blysk').classList.remove('blysk'); void $('#kam-blysk').offsetWidth; $('#kam-blysk').classList.add('blysk');
    if (navigator.vibrate) try { navigator.vibrate(30); } catch (e) {}
    uzbrojony = false; brakOd = 0; wzorzec = odcisk(zr);
    status('Zapisuję stronę…', true);
    await oddech();
    try {
      await dodajStrone(zr, hint);
      const s = stan.strony[stan.strony.length - 1];
      $('#kam-mini').src = s.mini; $('#kam-mini').hidden = false;
      licznik();
      toast(`Strona ${stan.strony.length} zapisana`, 1200);
    } catch (e) {
      toast('Nie udało się zapisać strony. Spróbuj jeszcze raz.');
      uzbrojony = true;
    }
    zwolnij(zr);
    zajety = false;
  }

  $('#kam-spust').addEventListener('click', () => { uzbrojony = true; pstryk(); });
  $('#kam-gotowe').addEventListener('click', zamknij);
  $('#kam-auto').addEventListener('click', () => {
    auto = !auto; rysujAuto();
    try { localStorage.setItem('rm-skaner-auto', auto ? '1' : '0'); } catch (e) {}
  });
  $('#kam-systemowy').addEventListener('click', () => { zamknij(); $('#in-aparat').click(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && strumien) zamknij(); });

  return { otworz, dostepna };
})();

// JPG jednym dotknięciem: od razu arkusz udostępniania iPhone'a ("Zapisz obrazy" = do Zdjęć)
function plikiJpg(baza) {
  return wybrane().map((s) => new File([s.wynik], `${baza} - str ${nr2(stan.strony.indexOf(s) + 1)}.jpg`, { type: 'image/jpeg' }));
}

async function pobierzPliki(pliki) {
  for (const f of pliki) {
    const url = URL.createObjectURL(f), a = document.createElement('a');
    a.href = url; a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    if (pliki.length > 1) await new Promise((r) => setTimeout(r, 400)); // przeglądarka łapie pliki po kolei
  }
}

$('#btn-jpg').addEventListener('click', () => {
  if (!wybrane().length) return toast('Zaznacz co najmniej jedną stronę.');
  const pliki = plikiJpg(domyslnaNazwa());
  // share() musi pójść od razu w kliknięciu, bez czekania, inaczej iPhone go zablokuje
  if (navigator.canShare && navigator.canShare({ files: pliki })) {
    navigator.share({ files: pliki }).then(() => { stan.zapisano = true; toast('Zapisano'); }).catch(() => {});
  } else {
    pobierzPliki(pliki).then(() => { stan.zapisano = true; });
  }
});

// ---------- PRZYCISKI GŁÓWNE ----------

$('#btn-aparat').addEventListener('click', () => Kamera.otworz());
$('#btn-galeria').addEventListener('click', () => $('#in-galeria').click());
$('#btn-pdf').addEventListener('click', () => { stan.format = 'pdf'; otworzZapis(); });
$('#in-aparat').addEventListener('change', async (e) => { await dodajPliki(e.target.files); e.target.value = ''; });
$('#in-galeria').addEventListener('change', async (e) => { await dodajPliki(e.target.files); e.target.value = ''; });
$('#info-btn').addEventListener('click', () => pokaz('info'));
$('#info-wroc').addEventListener('click', () => pokaz('lista'));

// na komputerze: przeciągnij zdjęcia na okno
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer) dodajPliki(e.dataTransfer.files); });

// ostrzeżenie przed zamknięciem z niezapisanymi stronami
window.addEventListener('beforeunload', (e) => { if (stan.strony.length && !stan.zapisano) { e.preventDefault(); e.returnValue = ''; } });

rysujListe();

// ---------- OFFLINE / AKTUALIZACJE ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  let przeladowano = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // nowa wersja: przeładuj tylko, gdy nie ma zeskanowanych stron (inaczej skany by przepadły)
    if (przeladowano || stan.strony.length) return;
    przeladowano = true; location.reload();
  });
}

// iPhone trzyma aplikację z ekranu głównego w pamięci całymi dniami i nie wczytuje nowej wersji sam.
// Przy każdym powrocie do aplikacji sprawdzamy numer wersji na serwerze; bez stron odświeżamy od razu,
// ze stronami pokazujemy pasek, żeby skany nie przepadły bez pytania.
async function sprawdzWersje() {
  try {
    const t = await (await fetch('app.js?spr=' + Date.now(), { cache: 'no-store' })).text();
    const m = t.match(/const WERSJA = (\d+);/);
    if (!m || +m[1] <= WERSJA) return;
    if (!stan.strony.length) { location.reload(); return; }
    $('#aktualizacja').hidden = false;
  } catch (e) { /* brak zasięgu */ }
}
$('#aktualizacja-btn').addEventListener('click', () => {
  if (stan.strony.length && !stan.zapisano && !confirm('Odświeżenie usunie zeskanowane strony. Zapisz je najpierw jako PDF albo JPG. Odświeżyć mimo to?')) return;
  stan.zapisano = true; location.reload();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) sprawdzWersje(); });
sprawdzWersje();
