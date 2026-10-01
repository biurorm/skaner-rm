// RM NIERUCHOMOŚCI, Skaner
// Zdjęcia stron dokumentu -> automatyczny kadr, prostowanie, poprawa jakości -> jeden PDF (opcjonalnie z hasłem AES-256).
// Wszystko w pamięci telefonu. Żadnego serwera, żadnego zapisu zdjęć na stałe.
'use strict';

// numer wersji widoczny w zielonym pasku; podbijać razem z ?v= w index.html i CACHE w sw.js
const WERSJA = 1;

const $ = (s) => document.querySelector(s);
document.querySelectorAll('[data-wersja]').forEach((el) => { el.textContent = 'v' + WERSJA; });

const TRYBY = [
  { k: 'kolor', n: 'Kolor' },
  { k: 'szary', n: 'Szarość' },
  { k: 'czb', n: 'Czarno-białe' },
  { k: 'oryginal', n: 'Oryginał' }
];

const stan = {
  strony: [],      // { id, zrodlo: Blob, rogi, wykryto, tryb, obrot, wynik: Blob, w, h, mini: url }
  tryb: 'kolor',
  pdf: null,       // File gotowego PDF
  ed: null         // edytowana strona: { s, rogi, tryb, obrot, obraz: canvas }
};
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

async function dodajPliki(pliki) {
  pliki = Array.from(pliki || []).filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name));
  if (!pliki.length) return;
  let nieudane = 0;
  for (let i = 0; i < pliki.length; i++) {
    zaslona(pliki.length > 1 ? `Przetwarzam stronę ${i + 1} z ${pliki.length}…` : 'Kadruję i poprawiam…');
    await oddech();
    try {
      const zr = await Skan.wczytaj(pliki[i]);
      const rogi = Skan.wykryj(zr);
      const s = {
        id: ++licznikId, zrodlo: await Skan.doBloba(zr, 'image/jpeg', 0.92),
        rogi: rogi || Skan.PELNY, wykryto: !!rogi, tryb: stan.tryb, obrot: 0
      };
      await przelicz(s, zr);
      zwolnij(zr);
      stan.strony.push(s);
    } catch (e) {
      nieudane++;
    }
  }
  zaslona(null);
  stan.pdf = null;
  rysujListe();
  if (nieudane) toast(`Nie udało się wczytać ${nieudane} zdjęć`);
  else toast(pliki.length > 1 ? `Dodano ${pliki.length} stron` : `Strona ${stan.strony.length} dodana`);
}

// ---------- LISTA ----------

function rysujListe() {
  const n = stan.strony.length;
  $('#pusto').hidden = n > 0;
  $('#btn-pdf').disabled = n === 0;
  $('#btn-pdf').textContent = n ? `📄 PDF (${n})` : '📄 PDF';
  $('#tryb-wszystkie').hidden = n === 0;
  chipsy($('#tryb-domyslny'), stan.tryb, (k) => {
    stan.tryb = k;
    try { localStorage.setItem('rm-skaner-tryb', k); } catch (e) {}
    rysujListe();
  });

  const siatka = $('#siatka');
  siatka.innerHTML = '';
  stan.strony.forEach((s, i) => {
    const k = document.createElement('div');
    k.className = 'strona';
    k.innerHTML = `
      <div class="strona-obraz">
        <img alt="Strona ${i + 1}">
        <span class="strona-nr">${i + 1}</span>
        ${s.wykryto ? '' : '<span class="strona-uwaga">Sprawdź kadr</span>'}
      </div>
      <div class="strona-akcje">
        <button data-a="lewo" aria-label="Przesuń wcześniej" ${i === 0 ? 'disabled' : ''}>◀</button>
        <button data-a="kadr" aria-label="Popraw kadr">✂️</button>
        <button data-a="obroc" aria-label="Obróć">↻</button>
        <button data-a="usun" aria-label="Usuń">🗑</button>
        <button data-a="prawo" aria-label="Przesuń dalej" ${i === n - 1 ? 'disabled' : ''}>▶</button>
      </div>`;
    k.querySelector('img').src = s.mini;
    k.querySelector('.strona-obraz').addEventListener('click', () => otworzEdytor(s));
    k.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => akcja(b.dataset.a, s)));
    siatka.appendChild(k);
  });
}

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
  stan.pdf = null;
  rysujListe();
}

$('#tryb-wszystkie').addEventListener('click', async () => {
  const n = stan.strony.length;
  for (let i = 0; i < n; i++) {
    zaslona(`Zmieniam jakość, strona ${i + 1} z ${n}…`); await oddech();
    stan.strony[i].tryb = stan.tryb;
    await przelicz(stan.strony[i]);
  }
  zaslona(null); stan.pdf = null; rysujListe();
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
  stan.pdf = null;
  zamknijEdytor();
  rysujListe();
});

// ---------- PDF ----------

function domyslnaNazwa() {
  const d = new Date(), z = (n) => String(n).padStart(2, '0');
  return `Skan ${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}.${z(d.getMinutes())}`;
}

function otworzZapis() {
  if (!$('#z-nazwa').value) $('#z-nazwa').value = domyslnaNazwa();
  $('#z-blad').hidden = true;
  $('#z-gotowe').hidden = !stan.pdf;
  pokaz('zapis');
}

$('#z-haslo-wl').addEventListener('change', (e) => { $('#z-haslo-box').hidden = !e.target.checked; stan.pdf = null; $('#z-gotowe').hidden = true; });
$('#z-pokaz').addEventListener('change', (e) => { const t = e.target.checked ? 'text' : 'password'; $('#z-haslo1').type = t; $('#z-haslo2').type = t; });
['#z-nazwa', '#z-haslo1', '#z-haslo2'].forEach((s) => $(s).addEventListener('input', () => { stan.pdf = null; $('#z-gotowe').hidden = true; }));

function blad(t) { const el = $('#z-blad'); el.textContent = t; el.hidden = !t; }

$('#z-utworz').addEventListener('click', async () => {
  blad('');
  let haslo = null;
  if ($('#z-haslo-wl').checked) {
    haslo = $('#z-haslo1').value;
    if (haslo.length < 6) return blad('Hasło musi mieć co najmniej 6 znaków.');
    if (haslo !== $('#z-haslo2').value) return blad('Hasła się różnią.');
  }
  const nazwa = ($('#z-nazwa').value.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\.pdf$/i, '').trim() || domyslnaNazwa()) + '.pdf';
  zaslona(haslo ? 'Składam i szyfruję PDF…' : 'Składam PDF…'); await oddech();
  try {
    const strony = [];
    for (const s of stan.strony) strony.push({ jpeg: new Uint8Array(await s.wynik.arrayBuffer()), w: s.w, h: s.h });
    const blob = await PdfRM.zloz(strony, { haslo });
    stan.pdf = new File([blob], nazwa, { type: 'application/pdf' });
  } catch (e) {
    zaslona(null);
    return blad('Nie udało się utworzyć PDF. Spróbuj ponownie.');
  }
  zaslona(null);
  const mb = (stan.pdf.size / 1048576).toFixed(1).replace('.', ',');
  $('#z-opis').textContent = `${nazwa}, ${stan.strony.length} str., ${mb} MB${haslo ? ', zabezpieczony hasłem' : ''}.`;
  $('#z-gotowe').hidden = false;
  $('#z-udostepnij').hidden = !(navigator.canShare && navigator.canShare({ files: [stan.pdf] }));
  $('#z-gotowe').scrollIntoView({ behavior: 'smooth' });
});

$('#z-udostepnij').addEventListener('click', async () => {
  if (!stan.pdf) return;
  try { await navigator.share({ files: [stan.pdf] }); } catch (e) { /* anulowano */ }
});

$('#z-pobierz').addEventListener('click', () => {
  if (!stan.pdf) return;
  const url = URL.createObjectURL(stan.pdf), a = document.createElement('a');
  a.href = url; a.download = stan.pdf.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
});

function wyczysc() {
  for (const s of stan.strony) if (s.mini) URL.revokeObjectURL(s.mini);
  stan.strony = []; stan.pdf = null;
  $('#z-nazwa').value = ''; $('#z-haslo1').value = ''; $('#z-haslo2').value = '';
  $('#z-haslo-wl').checked = false; $('#z-haslo-box').hidden = true; $('#z-gotowe').hidden = true;
  rysujListe();
  pokaz('lista');
}

$('#z-wyczysc').addEventListener('click', () => {
  if (!confirm('Usunąć wszystkie zeskanowane strony z pamięci? Upewnij się, że PDF jest zapisany.')) return;
  wyczysc();
  toast('Wyczyszczono. Możesz skanować kolejny dokument.');
});
$('#z-wroc').addEventListener('click', () => pokaz('lista'));

// ---------- PRZYCISKI GŁÓWNE ----------

$('#btn-aparat').addEventListener('click', () => $('#in-aparat').click());
$('#btn-galeria').addEventListener('click', () => $('#in-galeria').click());
$('#btn-pdf').addEventListener('click', otworzZapis);
$('#in-aparat').addEventListener('change', async (e) => { await dodajPliki(e.target.files); e.target.value = ''; });
$('#in-galeria').addEventListener('change', async (e) => { await dodajPliki(e.target.files); e.target.value = ''; });
$('#info-btn').addEventListener('click', () => pokaz('info'));
$('#info-wroc').addEventListener('click', () => pokaz('lista'));

// na komputerze: przeciągnij zdjęcia na okno
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer) dodajPliki(e.dataTransfer.files); });

// ostrzeżenie przed zamknięciem z niezapisanymi stronami
window.addEventListener('beforeunload', (e) => { if (stan.strony.length && !stan.pdf) { e.preventDefault(); e.returnValue = ''; } });

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
