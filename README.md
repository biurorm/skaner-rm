# Skaner RM

PWA do skanowania dokumentow (akty, umowy) telefonem do jednego PDF.

- Zdjecie strony -> automatyczne wykrycie rogow kartki (jasnosc + krawedzie, potem dociagniecie bokow do ~1 px) -> prostowanie perspektywy -> poprawa jakosci (wyrownanie tla, cienie i zolte swiatlo znikaja, pieczatki zostaja kolorowe, wyostrzenie) -> PDF A4.
- Tryby: Kolor, Szarosc, Czarno-biale, Oryginal. Kadr poprawiany palcem z lupa, obrot, kolejnosc stron, usuwanie.
- Haslo: szyfrowanie AES-256 (PDF 2.0, /V 5 /R 6), wlasna implementacja na Web Crypto, sprawdzona pypdf.

## Bezpieczenstwo
- Zero serwera i zero bibliotek zewnetrznych. Pliki: skan.js (obraz), pdf-rm.js (PDF + szyfrowanie), app.js (interfejs).
- CSP w index.html: connect-src 'self', script-src 'self'. Strona nie moze niczego wyslac na inny adres.
- Zdjecia tylko w pamieci (Blob), bez localStorage/IndexedDB; sw.js trzyma wylacznie pliki aplikacji.
- PDF bez slownika /Info (bez daty, autora, programu).

## Wydanie
Folder pushu: `C:/Users/Ania Lenart/skaner-rm/` (repo biurorm/skaner-rm, GitHub Pages).
Przy kazdej zmianie podbij razem: `WERSJA` w app.js, `?v=` w index.html, `CACHE` w sw.js.
