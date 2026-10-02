// RM NIERUCHOMOŚCI, Skaner: przetwarzanie zdjęcia strony
// Wszystko liczone w telefonie, bez bibliotek zewnętrznych i bez wysyłania czegokolwiek.
// Kroki: wczytanie -> wykrycie rogów kartki -> wyprostowanie perspektywy -> poprawa jakości -> obrót.
'use strict';

const Skan = (() => {
  const MAX_ZRODLO = 3000;   // dłuższy bok zdjęcia trzymanego w pamięci
  const MAX_WYNIK = 2339;    // dłuższy bok strony wynikowej (A4 przy 200 dpi)
  const DET = 640;           // rozdzielczość robocza wykrywania rogów

  function plotno(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    return c;
  }

  async function dekoduj(blob) {
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (e) {}
    try { return await createImageBitmap(blob); } catch (e) {}
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return img;
    } finally { URL.revokeObjectURL(url); }
  }

  // zdjęcie z aparatu/galerii -> płótno o rozsądnym rozmiarze
  async function wczytaj(blob, max = MAX_ZRODLO) {
    const bmp = await dekoduj(blob);
    const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
    const s = Math.min(1, max / Math.max(w, h));
    const c = plotno(w * s, h * s);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    return c;
  }

  const doBloba = (c, typ = 'image/jpeg', q = 0.9) => new Promise((ok, zle) => c.toBlob((b) => (b ? ok(b) : zle(new Error('toBlob'))), typ, q));

  // ---------- WYKRYWANIE KARTKI ----------

  function rozmyj(src, w, h, r) {
    // rozmycie pudełkowe w dwóch przejściach (poziom + pion)
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h), d = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      let s = 0; const o = y * w;
      for (let x = -r; x <= r; x++) s += src[o + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[o + x] = s / d;
        s += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = s / d;
        s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    return out;
  }

  function otsu(arr) {
    const hist = new Float64Array(256);
    for (let i = 0; i < arr.length; i++) hist[Math.max(0, Math.min(255, arr[i] | 0))]++;
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let wB = 0, sumB = 0, best = 0, prog = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = arr.length - wB; if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; prog = t; }
    }
    return prog;
  }

  function percentyl(arr, p) {
    const s = Float32Array.from(arr).sort();
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
  }

  function morf(maska, w, h, r, max) {
    // dylatacja (max=true) albo erozja kwadratem (2r+1), rozdzielnie
    const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = max ? 0 : 1;
      for (let k = -r; k <= r; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k)), m = maska[y * w + xx];
        if (max ? m : !m) { v = max ? 1 : 0; break; }
      }
      tmp[y * w + x] = v;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = max ? 0 : 1;
      for (let k = -r; k <= r; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k)), m = tmp[yy * w + x];
        if (max ? m : !m) { v = max ? 1 : 0; break; }
      }
      out[y * w + x] = v;
    }
    return out;
  }

  // największy spójny obszar maski; zwraca {liczba, wiersze: [[minX,maxX]...]}
  function najwiekszy(maska, w, h) {
    const etyk = new Int32Array(w * h), stos = new Int32Array(w * h);
    let nr = 0, bestNr = 0, bestN = 0;
    for (let i = 0; i < w * h; i++) {
      if (!maska[i] || etyk[i]) continue;
      nr++; let n = 0, sp = 0; stos[sp++] = i; etyk[i] = nr;
      while (sp) {
        const p = stos[--sp]; n++;
        const x = p % w, y = (p / w) | 0;
        if (x > 0 && maska[p - 1] && !etyk[p - 1]) { etyk[p - 1] = nr; stos[sp++] = p - 1; }
        if (x < w - 1 && maska[p + 1] && !etyk[p + 1]) { etyk[p + 1] = nr; stos[sp++] = p + 1; }
        if (y > 0 && maska[p - w] && !etyk[p - w]) { etyk[p - w] = nr; stos[sp++] = p - w; }
        if (y < h - 1 && maska[p + w] && !etyk[p + w]) { etyk[p + w] = nr; stos[sp++] = p + w; }
      }
      if (n > bestN) { bestN = n; bestNr = nr; }
    }
    if (!bestNr) return null;
    const pkt = [];
    for (let y = 0; y < h; y++) {
      let a = -1, b = -1;
      for (let x = 0; x < w; x++) if (etyk[y * w + x] === bestNr) { if (a < 0) a = x; b = x; }
      if (a >= 0) { pkt.push([a, y]); if (b !== a) pkt.push([b + 1, y]); }
    }
    return { n: bestN, pkt };
  }

  function otoczka(p) {
    p = p.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const kr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const dol = [], gora = [];
    for (const q of p) { while (dol.length >= 2 && kr(dol[dol.length - 2], dol[dol.length - 1], q) <= 0) dol.pop(); dol.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (gora.length >= 2 && kr(gora[gora.length - 2], gora[gora.length - 1], q) <= 0) gora.pop(); gora.push(q); }
    gora.pop(); dol.pop();
    return dol.concat(gora);
  }

  const pole = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; };

  // otoczka -> czworokąt: usuwamy wierzchołek, który najmniej zmienia pole
  function doCzworokata(h) {
    h = h.slice();
    while (h.length > 4) {
      let min = Infinity, ki = 0;
      for (let i = 0; i < h.length; i++) {
        const a = h[(i - 1 + h.length) % h.length], b = h[i], c = h[(i + 1) % h.length];
        const t = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
        if (t < min) { min = t; ki = i; }
      }
      h.splice(ki, 1);
    }
    return h.length === 4 ? h : null;
  }

  // kolejność: lewy górny, prawy górny, prawy dolny, lewy dolny
  function uporzadkuj(q) {
    const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
    q = q.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
    let start = 0, min = Infinity;
    q.forEach((p, i) => { if (p[0] + p[1] < min) { min = p[0] + p[1]; start = i; } });
    return [0, 1, 2, 3].map((k) => q[(start + k) % 4]);
  }

  function katyOk(q) {
    for (let i = 0; i < 4; i++) {
      const a = q[(i + 3) % 4], b = q[i], c = q[(i + 1) % 4];
      const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
      const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) || 1);
      const kat = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
      if (kat < 50 || kat > 130) return false;
    }
    return true;
  }

  // obszar maski -> czworokąt (bez oceny; ocenę robi zgodność z krawędziami zdjęcia)
  function zMaski(maska, w, h) {
    const obsz = najwiekszy(maska, w, h);
    if (!obsz || obsz.pkt.length < 6) return null;
    const q = doCzworokata(otoczka(obsz.pkt));
    if (!q) return null;
    const uq = uporzadkuj(q);
    if (obsz.n / (pole(uq) || 1) < 0.8) return null;
    return uq;
  }

  // ---- ocena czworokąta: czy każdy bok leży na prawdziwej krawędzi kartki ----
  // na każdym boku próbkujemy różnicę jasności tuż po obu stronach linii; prawdziwy brzeg kartki ma
  // wyraźny skok na całej długości, linia narysowana na kartce (tabelka, podpis) ma jasno po obu stronach,
  // a bok położony na brzegu zdjęcia albo w poprzek blatu skoku nie ma
  function wsparcie(g, w, h, q) {
    const pr = (x, y) => {
      if (x < 0 || y < 0 || x > w - 1.001 || y > h - 1.001) return null;
      const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
      const a = g[i] + (g[i + 1] - g[i]) * fx, b = g[i + w] + (g[i + w + 1] - g[i + w]) * fx;
      return a + (b - a) * fy;
    };
    const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
    const boki = [];
    for (let k = 0; k < 4; k++) {
      const A = q[k], B = q[(k + 1) % 4], L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      if (L < 10) return null;
      const t = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
      let n = [-t[1], t[0]];
      const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
      if ((cx - mx) * n[0] + (cy - my) * n[1] < 0) n = [-n[0], -n[1]]; // normalna do środka kartki
      const N = Math.max(12, Math.min(60, Math.round(L / 6)));
      let ok = 0, wszystkie = 0, znak = 0;
      for (let s = 0; s < N; s++) {
        const u = 0.06 + 0.88 * (s + 0.5) / N, px = A[0] + (B[0] - A[0]) * u, py = A[1] + (B[1] - A[1]) * u;
        let best = 0;
        for (let d = -2; d <= 2; d++) {
          const wn = pr(px + n[0] * (d + 3), py + n[1] * (d + 3)), zw = pr(px + n[0] * (d - 3), py + n[1] * (d - 3));
          if (wn === null || zw === null) continue;
          if (Math.abs(wn - zw) > Math.abs(best)) best = wn - zw;
        }
        wszystkie++;
        if (Math.abs(best) > 22) { ok++; znak += best > 0 ? 1 : -1; }
      }
      // brzeg kartki ma skok w jedną stronę (kartka jaśniejsza albo ciemniejsza od tła), nie na przemian
      const spojnosc = ok ? Math.abs(znak) / ok : 0;
      boki.push((ok / wszystkie) * (0.5 + 0.5 * spojnosc));
    }
    return boki;
  }

  function wynikQ(g, w, h, q) {
    if (!katyOk(q)) return null;
    for (const [x, y] of q) if (x < -0.03 * w || x > 1.03 * w || y < -0.03 * h || y > 1.03 * h) return null;
    const udzial = pole(q) / (w * h);
    if (udzial < 0.08 || udzial > 0.99) return null;
    const b = wsparcie(g, w, h, q);
    if (!b) return null;
    const sr = Math.pow(b[0] * b[1] * b[2] * b[3], 0.25), min = Math.min(...b);
    if (min < 0.3) return null;
    return { q, wynik: sr * sr * Math.pow(udzial, 0.35), sr };
  }

  // ---- proste linie na zdjęciu (transformata Hougha z kierunkiem gradientu) ----
  function linie(g, w, h) {
    const gx = new Float32Array(w * h), gy = new Float32Array(w * h), mag = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      gx[i] = g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1] - g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1];
      gy[i] = g[i + w - 1] + 2 * g[i + w] + g[i + w + 1] - g[i - w - 1] - 2 * g[i - w] - g[i - w + 1];
      mag[i] = Math.hypot(gx[i], gy[i]);
    }
    const T = Math.max(60, percentyl(mag, 0.9));
    const NT = 180, diag = Math.ceil(Math.hypot(w, h)), NR = diag + 1; // rho co 2 px, od -diag do +diag
    const acc = new Float32Array(NT * NR), cs = new Float32Array(NT), sn = new Float32Array(NT);
    for (let t = 0; t < NT; t++) { cs[t] = Math.cos(t * Math.PI / NT); sn[t] = Math.sin(t * Math.PI / NT); }
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      if (mag[i] < T) continue;
      let a = Math.atan2(gy[i], gx[i]); if (a < 0) a += Math.PI;
      const t0 = Math.round(a * NT / Math.PI);
      for (let dt = -3; dt <= 3; dt++) {
        const t = (t0 + dt + NT) % NT;
        const r = Math.round((x * cs[t] + y * sn[t] + diag) / 2);
        acc[t * NR + r] += 1;
      }
    }
    const wynik = [], minGlos = 0.12 * Math.min(w, h);
    for (let k = 0; k < 24; k++) {
      let m = 0, mi = -1;
      for (let i = 0; i < acc.length; i++) if (acc[i] > m) { m = acc[i]; mi = i; }
      if (mi < 0 || m < minGlos) break;
      const t = (mi / NR) | 0, r = mi % NR;
      wynik.push({ th: t * Math.PI / NT, rho: r * 2 - diag });
      for (let dt = -6; dt <= 6; dt++) {
        const tt = t + dt, odbite = tt < 0 || tt >= NT, t2 = (tt + NT) % NT;
        const rc = odbite ? NR - 1 - r : r; // przejście przez 0/180 stopni odwraca znak rho
        for (let dr = -7; dr <= 7; dr++) { const rr = rc + dr; if (rr >= 0 && rr < NR) acc[t2 * NR + rr] = 0; }
      }
    }
    return wynik;
  }

  function przeciecie(a, b) {
    const ca = Math.cos(a.th), sa = Math.sin(a.th), cb = Math.cos(b.th), sb = Math.sin(b.th);
    const det = ca * sb - sa * cb;
    if (Math.abs(det) < 1e-6) return null;
    return [(a.rho * sb - b.rho * sa) / det, (ca * b.rho - cb * a.rho) / det];
  }

  function zLinii(L, w, h, g) {
    const kat = (a, b) => { const d = Math.abs(a.th - b.th) % Math.PI; return Math.min(d, Math.PI - d); };
    const pary = [];
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      if (kat(L[i], L[j]) > 0.35) continue; // przeciwległe boki: prawie równoległe
      pary.push([L[i], L[j]]);
    }
    const kand = [];
    for (let i = 0; i < pary.length; i++) for (let j = i + 1; j < pary.length; j++) {
      const [a, b] = pary[i], [c, d] = pary[j];
      if (kat(a, c) < 0.8) continue; // druga para mniej więcej prostopadła
      const p = [przeciecie(a, c), przeciecie(c, b), przeciecie(b, d), przeciecie(d, a)];
      if (p.some((x) => !x)) continue;
      const o = wynikQ(g, w, h, uporzadkuj(p));
      if (o) kand.push(o);
    }
    return kand;
  }

  // zwraca 4 rogi w ułamkach (0..1) albo null, gdy kartki nie widać wyraźnie
  function wykryj(zrodlo) {
    const s = Math.min(1, DET / Math.max(zrodlo.width, zrodlo.height));
    const w = Math.max(8, Math.round(zrodlo.width * s)), h = Math.max(8, Math.round(zrodlo.height * s));
    const c = plotno(w, h), ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(zrodlo, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const jas = new Float32Array(w * h), pap = new Float32Array(w * h);
    for (let i = 0, j = 0; j < w * h; i += 4, j++) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      jas[j] = 0.299 * r + 0.587 * g + 0.114 * b;
      // "papierowość": jasne i mało nasycone (blat, drewno, obrus odpadają)
      pap[j] = jas[j] - 0.6 * (Math.max(r, g, b) - Math.min(r, g, b));
    }
    const g = rozmyj(jas, w, h, 1);
    const kand = [];
    const dodaj = (q) => { if (q) { const o = wynikQ(g, w, h, q); if (o) kand.push(o); } };

    // A) proste krawędzie: czworokąty z 4 linii, główna metoda (radzi sobie z kartką leżącą na innej kartce)
    try { kand.push(...zLinii(linie(rozmyj(jas, w, h, 2), w, h), w, h, g)); } catch (e) {}

    // B) kartka jaśniejsza od tła; mocniejsze otwarcie rozcina kartki, które się stykają
    const pr = rozmyj(pap, w, h, 2), prog = otsu(pr);
    const m0 = new Uint8Array(w * h);
    for (let i = 0; i < m0.length; i++) m0[i] = pr[i] > prog ? 1 : 0;
    for (const r of [2, 5, 9]) dodaj(zMaski(morf(morf(m0, w, h, r, false), w, h, r, true), w, h));

    // C) krawędzie: wszystko, czego nie da się "zalać" od brzegu zdjęcia, jest kartką
    const mag = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1] - g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1];
      const gy = g[i + w - 1] + 2 * g[i + w] + g[i + w + 1] - g[i - w - 1] - 2 * g[i - w] - g[i - w + 1];
      mag[i] = Math.hypot(gx, gy);
    }
    for (const pc of [0.8, 0.88, 0.94]) {
      const t = Math.max(18, percentyl(mag, pc));
      for (const r of [1, 2]) {
        let kr = new Uint8Array(w * h);
        for (let i = 0; i < kr.length; i++) kr[i] = mag[i] > t ? 1 : 0;
        kr = morf(kr, w, h, r, true);
        const tlo = new Uint8Array(w * h), stos = new Int32Array(w * h); let sp = 0;
        const zalej = (p) => { if (!kr[p] && !tlo[p]) { tlo[p] = 1; stos[sp++] = p; } };
        for (let x = 0; x < w; x++) { zalej(x); zalej((h - 1) * w + x); }
        for (let y = 0; y < h; y++) { zalej(y * w); zalej(y * w + w - 1); }
        while (sp) {
          const p = stos[--sp], x = p % w, y = (p / w) | 0;
          if (x > 0) zalej(p - 1); if (x < w - 1) zalej(p + 1);
          if (y > 0) zalej(p - w); if (y < h - 1) zalej(p + w);
        }
        let wn = new Uint8Array(w * h);
        for (let i = 0; i < wn.length; i++) wn[i] = tlo[i] ? 0 : 1;
        wn = morf(wn, w, h, r, false); // zdejmujemy grubość dorysowanej krawędzi
        dodaj(zMaski(wn, w, h));
      }
    }

    const best = kand.sort((a, b) => b.wynik - a.wynik)[0];
    if (!best || best.sr < 0.55) return null;
    const rogi = best.q.map(([x, y]) => [Math.min(1, Math.max(0, x / w)), Math.min(1, Math.max(0, y / h))]);
    try { return dopracuj(zrodlo, rogi); } catch (e) { return rogi; }
  }

  // dociągnięcie rogów w wyższej rozdzielczości: wzdłuż każdego boku szukamy najsilniejszej krawędzi,
  // dopasowujemy prostą i liczymy rogi jako przecięcia boków (dokładność ok. 1 piksela)
  function dopracuj(zrodlo, rogi) {
    const s = Math.min(1, 1200 / Math.max(zrodlo.width, zrodlo.height));
    const w = Math.round(zrodlo.width * s), h = Math.round(zrodlo.height * s);
    const c = plotno(w, h), ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(zrodlo, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data, g0 = new Float32Array(w * h);
    for (let i = 0, j = 0; j < w * h; i += 4, j++) g0[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const g = rozmyj(g0, w, h, 1);
    const pr = (x, y) => {
      x = Math.min(w - 1.001, Math.max(0, x)); y = Math.min(h - 1.001, Math.max(0, y));
      const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
      const a = g[i] + (g[i + 1] - g[i]) * fx, b = g[i + w] + (g[i + w + 1] - g[i + w]) * fx;
      return a + (b - a) * fy;
    };
    const q = rogi.map(([x, y]) => [x * w, y * h]);
    const R = 14, proste = [];
    for (let k = 0; k < 4; k++) {
      const A = q[k], B = q[(k + 1) % 4], L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const t = [(B[0] - A[0]) / L, (B[1] - A[1]) / L], n = [-t[1], t[0]];
      let pk = [];
      for (let u = 0.08 * L; u <= 0.92 * L; u += 4) {
        const P = [A[0] + t[0] * u, A[1] + t[1] * u];
        let best = 0, bd = null;
        for (let dd = -R; dd <= R; dd += 0.5) {
          const gr = Math.abs(pr(P[0] + n[0] * (dd + 1), P[1] + n[1] * (dd + 1)) - pr(P[0] + n[0] * (dd - 1), P[1] + n[1] * (dd - 1)));
          if (gr > best) { best = gr; bd = dd; }
        }
        if (bd !== null && best > 12) pk.push([P[0] + n[0] * bd, P[1] + n[1] * bd]);
      }
      let prosta = null;
      for (let iter = 0; iter < 3 && pk.length >= 8; iter++) {
        prosta = dopasujProsta(pk);
        const odl = pk.map((p) => Math.abs((p[0] - prosta.c[0]) * prosta.n[0] + (p[1] - prosta.c[1]) * prosta.n[1]));
        const prog = Math.max(1.5, [...odl].sort((a, b) => a - b)[Math.floor(odl.length * 0.6)] * 2.5);
        pk = pk.filter((p, i) => odl[i] <= prog);
      }
      if (!prosta || pk.length < 8) return rogi;
      proste.push(prosta);
    }
    const nowe = [];
    for (let k = 0; k < 4; k++) {
      const a = proste[(k + 3) % 4], b = proste[k]; // róg k leży na boku k-1 i boku k
      const det = a.n[0] * b.n[1] - a.n[1] * b.n[0];
      if (Math.abs(det) < 1e-6) return rogi;
      const ca = a.n[0] * a.c[0] + a.n[1] * a.c[1], cb = b.n[0] * b.c[0] + b.n[1] * b.c[1];
      const x = (ca * b.n[1] - cb * a.n[1]) / det, y = (a.n[0] * cb - b.n[0] * ca) / det;
      if (Math.hypot(x - q[k][0], y - q[k][1]) > 2.5 * R) return rogi;
      nowe.push([Math.min(1, Math.max(0, x / w)), Math.min(1, Math.max(0, y / h))]);
    }
    return katyOk(nowe) ? nowe : rogi;
  }

  function dopasujProsta(pk) {
    // prosta najmniejszych kwadratów prostopadłych: środek + normalna
    let cx = 0, cy = 0; for (const p of pk) { cx += p[0]; cy += p[1]; } cx /= pk.length; cy /= pk.length;
    let sxx = 0, syy = 0, sxy = 0;
    for (const p of pk) { const dx = p[0] - cx, dy = p[1] - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    const kat = 0.5 * Math.atan2(2 * sxy, sxx - syy); // kierunek prostej
    return { c: [cx, cy], n: [-Math.sin(kat), Math.cos(kat)] };
  }

  const PELNY = [[0, 0], [1, 0], [1, 1], [0, 1]];

  // ---------- PROSTOWANIE PERSPEKTYWY ----------

  // homografia: punkt prostokąta wynikowego (u,v) -> punkt na zdjęciu
  function homografia(dst, src) {
    const A = [], B = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = dst[i], [X, Y] = src[i];
      A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]); B.push(X);
      A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]); B.push(Y);
    }
    const n = 8;
    for (let k = 0; k < n; k++) {
      let p = k; for (let i = k + 1; i < n; i++) if (Math.abs(A[i][k]) > Math.abs(A[p][k])) p = i;
      [A[k], A[p]] = [A[p], A[k]]; [B[k], B[p]] = [B[p], B[k]];
      for (let i = k + 1; i < n; i++) {
        const f = A[i][k] / A[k][k];
        for (let j = k; j < n; j++) A[i][j] -= f * A[k][j];
        B[i] -= f * B[k];
      }
    }
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) { let s = B[i]; for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j]; x[i] = s / A[i][i]; }
    return [...x, 1];
  }

  function rozmiarWyniku(q) {
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    let w = Math.max(d(q[0], q[1]), d(q[3], q[2])), h = Math.max(d(q[0], q[3]), d(q[1], q[2]));
    // kartka bliska A4 -> dokładnie A4 (zdjęcie pod kątem lekko przekłamuje proporcje)
    const A4 = Math.SQRT2, r = Math.max(w, h) / Math.min(w, h);
    if (Math.abs(r - A4) / A4 < 0.09) { if (h >= w) h = w * A4; else w = h * A4; }
    const s = Math.min(MAX_WYNIK / Math.max(w, h), 1.3);
    return [Math.round(w * s), Math.round(h * s)];
  }

  function wyprostuj(zrodlo, rogi) {
    const W = zrodlo.width, H = zrodlo.height;
    const q = rogi.map(([x, y]) => [x * W, y * H]);
    const [ow, oh] = rozmiarWyniku(q);
    const M = homografia([[0, 0], [ow, 0], [ow, oh], [0, oh]], q);
    const sd = zrodlo.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    const out = plotno(ow, oh), octx = out.getContext('2d');
    const img = octx.createImageData(ow, oh), od = img.data;
    for (let v = 0; v < oh; v++) {
      for (let u = 0; u < ow; u++) {
        const uu = u + 0.5, vv = v + 0.5;
        const z = M[6] * uu + M[7] * vv + 1;
        let x = (M[0] * uu + M[1] * vv + M[2]) / z - 0.5, y = (M[3] * uu + M[4] * vv + M[5]) / z - 0.5;
        x = Math.min(W - 1.001, Math.max(0, x)); y = Math.min(H - 1.001, Math.max(0, y));
        const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
        const i00 = (y0 * W + x0) * 4, i10 = i00 + 4, i01 = i00 + W * 4, i11 = i01 + 4;
        const o = (v * ow + u) * 4;
        for (let c = 0; c < 3; c++) {
          const a = sd[i00 + c] + (sd[i10 + c] - sd[i00 + c]) * fx;
          const b = sd[i01 + c] + (sd[i11 + c] - sd[i01 + c]) * fx;
          od[o + c] = a + (b - a) * fy;
        }
        od[o + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    return out;
  }

  // ---------- POPRAWA JAKOŚCI ----------
  // tło kartki szacowane z mocno pomniejszonego obrazu (maksimum lokalne = papier bez tekstu),
  // potem każdy piksel dzielimy przez tło: cienie i żółtawe światło znikają, pieczątki zostają kolorowe

  function tloKartki(d, w, h, kan) {
    const K = 16, lw = Math.ceil(w / K), lh = Math.ceil(h / K);
    let low = new Float32Array(lw * lh);
    for (let ly = 0; ly < lh; ly++) for (let lx = 0; lx < lw; lx++) {
      // jasny percentyl w kratce: 3. najjaśniejsza z próbek
      const pr = [];
      for (let y = ly * K; y < Math.min(h, ly * K + K); y += 4) for (let x = lx * K; x < Math.min(w, lx * K + K); x += 4) pr.push(d[(y * w + x) * 4 + kan]);
      pr.sort((a, b) => b - a);
      low[ly * lw + lx] = pr[Math.min(pr.length - 1, 2)] || 255;
    }
    // dylatacja 2 kratek: tekst i tabelki nie zaniżają tła
    const dil = new Float32Array(lw * lh);
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
      let m = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = Math.min(lw - 1, Math.max(0, x + dx)), yy = Math.min(lh - 1, Math.max(0, y + dy));
        m = Math.max(m, low[yy * lw + xx]);
      }
      dil[y * lw + x] = m;
    }
    low = rozmyj(dil, lw, lh, 2);
    return { low, lw, lh, K };
  }

  function popraw(c, tryb) {
    if (tryb === 'oryginal') return c;
    const w = c.width, h = c.height, ctx = c.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    const kolor = tryb === 'kolor';
    if (!kolor) {
      for (let i = 0; i < d.length; i += 4) { const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = g; }
    }
    const kanaly = kolor ? [0, 1, 2] : [0];
    const tla = kanaly.map((k) => tloKartki(d, w, h, k));
    const czern = 40; // poziom czerni po wyrównaniu tła
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        for (let n = 0; n < kanaly.length; n++) {
          const { low, lw, lh, K } = tla[n];
          const fx = Math.min(lw - 1.001, Math.max(0, x / K - 0.5)), fy = Math.min(lh - 1.001, Math.max(0, y / K - 0.5));
          const x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0;
          const t0 = low[y0 * lw + x0] + (low[y0 * lw + x0 + 1] - low[y0 * lw + x0]) * ax;
          const t1 = low[(y0 + 1) * lw + x0] + (low[(y0 + 1) * lw + x0 + 1] - low[(y0 + 1) * lw + x0]) * ax;
          const tlo = Math.max(30, t0 + (t1 - t0) * ay);
          let v = Math.min(255, (d[i + kanaly[n]] / tlo) * 255);
          v = ((v - czern) / (250 - czern)) * 255;
          if (tryb === 'czb') v = (v - 150) * 4 + 128; // ostry próg z wąskim przejściem (gładkie litery)
          v = v < 0 ? 0 : v > 255 ? 255 : v;
          d[i + kanaly[n]] = v;
        }
        if (!kolor) d[i + 1] = d[i + 2] = d[i];
      }
    }
    if (tryb !== 'czb') wyostrz(d, w, h);
    ctx.putImageData(img, 0, 0);
    return c;
  }

  function wyostrz(d, w, h) {
    // maska wyostrzająca, delikatna: litery ostrzejsze, bez ziarna
    const a = 0.55, src = new Uint8ClampedArray(d);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const s = src[i + c] * 4 - src[i - 4 + c] - src[i + 4 + c] - src[i - w * 4 + c] - src[i + w * 4 + c];
        d[i + c] = src[i + c] + a * s / 4;
      }
    }
  }

  function obroc(c, stopnie) {
    const k = ((stopnie % 360) + 360) % 360;
    if (!k) return c;
    const o = k === 180 ? plotno(c.width, c.height) : plotno(c.height, c.width), ctx = o.getContext('2d');
    ctx.translate(o.width / 2, o.height / 2);
    ctx.rotate(k * Math.PI / 180);
    ctx.drawImage(c, -c.width / 2, -c.height / 2);
    return o;
  }

  // pełna obróbka strony; zwraca płótno gotowe do PDF
  function przetworz(zrodlo, rogi, tryb, obrot) {
    return obroc(popraw(wyprostuj(zrodlo, rogi || PELNY), tryb), obrot || 0);
  }

  function miniatura(c, max = 360) {
    const s = Math.min(1, max / Math.max(c.width, c.height));
    const m = plotno(c.width * s, c.height * s);
    m.getContext('2d').drawImage(c, 0, 0, m.width, m.height);
    return m;
  }

  return { wczytaj, wykryj, przetworz, miniatura, doBloba, plotno, PELNY };
})();
