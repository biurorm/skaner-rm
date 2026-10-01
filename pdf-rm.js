// RM NIERUCHOMOŚCI, Skaner: składanie PDF ze stron JPEG
// Własny, mały zapis PDF (bez bibliotek). Opcjonalne hasło: szyfrowanie AES-256 (PDF 2.0, /V 5 /R 6),
// to samo, którego używa Adobe Acrobat. Klucze liczone przez Web Crypto w telefonie.
'use strict';

const PdfRM = (() => {
  const enc = new TextEncoder();
  const A4 = [595.28, 841.89];

  const sklej = (...cz) => {
    const n = cz.reduce((s, c) => s + c.length, 0), o = new Uint8Array(n);
    let p = 0; for (const c of cz) { o.set(c, p); p += c.length; }
    return o;
  };
  const losowe = (n) => crypto.getRandomValues(new Uint8Array(n));
  const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

  async function aesCbc(klucz, iv, dane) {
    const k = await crypto.subtle.importKey('raw', klucz, { name: 'AES-CBC' }, false, ['encrypt']);
    return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, k, dane));
  }
  // AES bez dopełnienia (dane są wielokrotnością 16 bajtów): Web Crypto zawsze dokleja blok, odcinamy go
  const aesBezDop = async (klucz, iv, dane) => (await aesCbc(klucz, iv, dane)).subarray(0, dane.length);

  // algorytm 2.B z ISO 32000-2 (skrót hasła dla R6)
  async function skrot2B(haslo, sol, udata) {
    let K = new Uint8Array(await crypto.subtle.digest('SHA-256', sklej(haslo, sol, udata)));
    let E = new Uint8Array([0]), i = 0;
    while (i < 64 || E[E.length - 1] > i - 32) {
      const jedn = sklej(haslo, K, udata), K1 = new Uint8Array(jedn.length * 64);
      for (let r = 0; r < 64; r++) K1.set(jedn, r * jedn.length);
      E = await aesBezDop(K.subarray(0, 16), K.subarray(16, 32), K1);
      let s = 0; for (let j = 0; j < 16; j++) s += E[j];
      K = new Uint8Array(await crypto.subtle.digest(['SHA-256', 'SHA-384', 'SHA-512'][s % 3], E));
      i++;
    }
    return K.subarray(0, 32);
  }

  async function przygotujSzyfr(hasloTekst) {
    const haslo = enc.encode(hasloTekst.normalize('NFC')).subarray(0, 127);
    const wlasciciel = losowe(32); // hasło właściciela losowe, nikt go nie zna
    const kluczPliku = losowe(32);
    const zero = new Uint8Array(16), pusto = new Uint8Array(0);

    const uWal = losowe(8), uKl = losowe(8);
    const U = sklej(await skrot2B(haslo, uWal, pusto), uWal, uKl);
    const UE = await aesBezDop(await skrot2B(haslo, uKl, pusto), zero, kluczPliku);

    const oWal = losowe(8), oKl = losowe(8);
    const O = sklej(await skrot2B(wlasciciel, oWal, U), oWal, oKl);
    const OE = await aesBezDop(await skrot2B(wlasciciel, oKl, U), zero, kluczPliku);

    const P = -4; // wszystkie uprawnienia (drukowanie, kopiowanie) po podaniu hasła
    const perm = new Uint8Array(16);
    new DataView(perm.buffer).setInt32(0, P, true);
    perm.set([0xff, 0xff, 0xff, 0xff, 0x54, 0x61, 0x64, 0x62], 4); // ...'T' 'a' 'd' 'b'
    perm.set(losowe(4), 12);
    const Perms = await aesBezDop(kluczPliku, zero, perm);

    const slownik = `<< /Filter /Standard /V 5 /R 6 /Length 256 /CF << /StdCF << /AuthEvent /DocOpen /CFM /AESV3 /Length 32 >> >> /StmF /StdCF /StrF /StdCF /O <${hex(O)}> /U <${hex(U)}> /OE <${hex(OE)}> /UE <${hex(UE)}> /P ${P} /Perms <${hex(Perms)}> /EncryptMetadata true >>`;
    return {
      slownik,
      // każdy strumień: losowy IV + AES-256-CBC z dopełnieniem PKCS#7
      szyfruj: async (dane) => { const iv = losowe(16); return sklej(iv, await aesCbc(kluczPliku, iv, dane)); }
    };
  }

  // strony: [{ jpeg: Uint8Array, w, h }] (w,h w pikselach); zwraca Blob PDF
  async function zloz(strony, { haslo } = {}) {
    const szyfr = haslo ? await przygotujSzyfr(haslo) : null;
    const obiekty = []; // [numer] = Uint8Array treści obiektu
    const nowy = () => obiekty.push(null);
    const KATALOG = nowy(), STRONY = nowy();
    const kids = [];

    for (const s of strony) {
      const poziom = s.w > s.h;
      const [pw, ph] = poziom ? [A4[1], A4[0]] : A4;
      // strona A4, obraz wpasowany i wyśrodkowany (białe marginesy tylko przy nietypowych proporcjach)
      const sk = Math.min(pw / s.w, ph / s.h), iw = s.w * sk, ih = s.h * sk;
      const tresc = enc.encode(`q ${iw.toFixed(2)} 0 0 ${ih.toFixed(2)} ${((pw - iw) / 2).toFixed(2)} ${((ph - ih) / 2).toFixed(2)} cm /Im0 Do Q`);
      const nrObr = nowy(), nrTr = nowy(), nrStr = nowy();
      const obr = szyfr ? await szyfr.szyfruj(s.jpeg) : s.jpeg;
      const tr = szyfr ? await szyfr.szyfruj(tresc) : tresc;
      obiekty[nrObr - 1] = sklej(enc.encode(`<< /Type /XObject /Subtype /Image /Width ${s.w} /Height ${s.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${obr.length} >>\nstream\n`), obr, enc.encode('\nendstream'));
      obiekty[nrTr - 1] = sklej(enc.encode(`<< /Length ${tr.length} >>\nstream\n`), tr, enc.encode('\nendstream'));
      obiekty[nrStr - 1] = enc.encode(`<< /Type /Page /Parent ${STRONY} 0 R /MediaBox [0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}] /Resources << /XObject << /Im0 ${nrObr} 0 R >> >> /Contents ${nrTr} 0 R >>`);
      kids.push(`${nrStr} 0 R`);
    }
    obiekty[KATALOG - 1] = enc.encode(`<< /Type /Catalog /Pages ${STRONY} 0 R >>`);
    obiekty[STRONY - 1] = enc.encode(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`);
    let SZYFR = 0;
    if (szyfr) { SZYFR = nowy(); obiekty[SZYFR - 1] = enc.encode(szyfr.slownik); }

    // celowo bez słownika /Info: w pliku nie ma daty, autora ani nazwy programu
    const czesci = [enc.encode('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n')];
    let poz = czesci[0].length;
    const ofs = [];
    obiekty.forEach((o, i) => {
      ofs.push(poz);
      const b = sklej(enc.encode(`${i + 1} 0 obj\n`), o, enc.encode('\nendobj\n'));
      czesci.push(b); poz += b.length;
    });
    const id = hex(losowe(16));
    let xref = `xref\n0 ${obiekty.length + 1}\n0000000000 65535 f \n`;
    for (const o of ofs) xref += `${String(o).padStart(10, '0')} 00000 n \n`;
    xref += `trailer\n<< /Size ${obiekty.length + 1} /Root ${KATALOG} 0 R${szyfr ? ` /Encrypt ${SZYFR} 0 R` : ''} /ID [<${id}> <${id}>] >>\nstartxref\n${poz}\n%%EOF\n`;
    czesci.push(enc.encode(xref));
    return new Blob(czesci, { type: 'application/pdf' });
  }

  return { zloz };
})();
