# Skaner RM

PWA do skanowania dokumentow (akty, umowy) telefonem do jednego PDF.

- Zdjecie strony -> automatyczne wykrycie rogow kartki (jasnosc + krawedzie, potem dociagniecie bokow do ~1 px) -> prostowanie perspektywy -> poprawa jakosci (wyrownanie tla, cienie i zolte swiatlo znikaja, pieczatki zostaja kolorowe, wyostrzenie) -> PDF A4.
- Wykrywanie rogow (v2): proste krawedzie z transformaty Hougha + kandydaci z maski jasnosci i zalewania; kazdy czworokat oceniany tym, czy jego 4 boki leza na prawdziwym skoku jasnosci (kartka na innej kartce, linie tabelek i brzegi zdjecia odpadaja).
- Skanowanie na zywo (v3): podglad aparatu w aplikacji (getUserMedia), szybkie wykrywanie kartki ok. 10 razy/s (360 px, same proste krawedzie), zielona ramka; gdy ramka stoi ok. 0,9 s, zdjecie robi sie samo; kolejne dopiero po zmianie kartki (kartka znika albo inny obraz). Przycisk "Zwykly aparat" jako zapas.
- JPG jednym dotknieciem z listy: od razu arkusz udostepniania iPhone'a ("Zapisz obrazy" = do Zdjec).
- v4: dotkniecie strony = zaznacz/odznacz (kadr nozyczkami), sprawdzanie wersji przy kazdym powrocie do aplikacji (iPhone trzyma stara wersje PWA w pamieci): bez stron odswieza sam, ze stronami pokazuje pasek "Odswiez".
- v5 (07.10.2026): glowny przycisk "Aparat" otwiera zwykly aparat telefonu (pelne 12 Mpx z obrobka iPhone'a), skan na zywo jako opcja (link pod jakoscia). Strona wynikowa A4 300 dpi (3508 px), zrodlo do 4032 px. Nowa poprawa jakosci: tlo kartki z percentyla zamiast maksimum (papier naprawde bialy, prześwit z drugiej strony znika), maska nieostra ok. 1,5 px, krzywa tonalna biel/czern, JPEG 0.92.
- v6 (07.10.2026): przycisk "Usun zaznaczone (N)" w pasku zaznaczania, z potwierdzeniem.
- v7 (07.10.2026): z powrotem glowny jest skan na zywo z ramka (Rafal chce ramke w czasie rzeczywistym), ale zdjecie = najostrzejsza z 6 kolejnych klatek w pelnej rozdzielczosci (wariancja laplasjanu na srodku kartki), aparat podkrecony do maksymalnej rozdzielczosci i ciaglego fokusa (applyConstraints), na Androidzie prawdziwe zdjecie przez ImageCapture. Zwykly aparat telefonu jako link zapasowy. Toast z rozdzielczoscia aparatu przy starcie.
- Tryby: Kolor, Szarosc, Czarno-biale, Oryginal. Kadr poprawiany palcem z lupa, obrot, kolejnosc stron, usuwanie.
- Strony numerowane (Str. 1, 2...), zaznaczanie i odznaczanie kolkiem w rogu. Zapis zaznaczonych: PDF (jeden plik, w kolejnosci numerow, opcjonalnie haslo) albo JPG (osobne pliki "Nazwa - str 01.jpg", bez hasla).
- Haslo: szyfrowanie AES-256 (PDF 2.0, /V 5 /R 6), wlasna implementacja na Web Crypto, sprawdzona pypdf.

## Bezpieczenstwo
- Zero serwera i zero bibliotek zewnetrznych. Pliki: skan.js (obraz), pdf-rm.js (PDF + szyfrowanie), app.js (interfejs).
- CSP w index.html: connect-src 'self', script-src 'self'. Strona nie moze niczego wyslac na inny adres.
- Zdjecia tylko w pamieci (Blob), bez localStorage/IndexedDB; sw.js trzyma wylacznie pliki aplikacji.
- PDF bez slownika /Info (bez daty, autora, programu).

## Wydanie
Folder pushu: `C:/Users/Ania Lenart/skaner-rm/` (repo biurorm/skaner-rm, GitHub Pages).
Przy kazdej zmianie podbij razem: `WERSJA` w app.js, `?v=` w index.html, `CACHE` w sw.js.
