# The Fool — kalan işler (devralma promptu)

Depo: `C:\thefool-desktop` (Windows, `main` dalı, remote `zaorenn/thefool-desktop`).
Python venv: `.venv\Scripts\python.exe`. Testleri **daima** `PYTHONUTF8=1` ile
çalıştır, yoksa Türkçe kaynak dosyalarda `UnicodeDecodeError` alırsın.

## Şu anki durum

- `main` = `eef034b2d` **Version 0.21.12** (itilmiş).
- **Commit'lenmemiş 3 dosya var, önce bunları bitir:**
  - `apps/desktop/src/fool/notch/ptt-binding.ts` — bas-konuş için değiştirici
    kombosu (`Shift+ControlRight`) desteği eklendi
  - `apps/desktop/src/fool/notch/ptt-binding-combo.test.ts` — 9 test, geçiyor
  - `tests/fool/test_local_only_tts.py` — Piper ses kimliklerinin geçerliliğini
    tutan muhafızlar
- `apps/desktop/release/TheFool-0.21.12-win-x64.exe` **derlendi ama YAYINLANMADI**.
- Yayında olan son sürüm: **v0.21.11**.

## Kalan işler (kullanıcının istedikleri)

1. **Bas-konuş kombo seçicisini ayarlar arayüzüne bağla.** Mantık hazır
   (`parsePttBinding` / `formatPttBinding` / `bindingMatches` /
   `formatPttBindingLabel`), ama UI hâlâ tek tuş yakalıyor. Kullanıcı
   `Shift + Sağ Ctrl` gibi bir kombo atayıp kaydedebilmeli.
2. **Notch kök sorunları:** uygulama tamamen arka plandayken bile konuşma
   çalışmalı. Laptopta "sağ Ctrl'e basılı tutmak bir şey değiştirmiyordu, ses
   kaydı başlamıyordu" raporu var — ama o rapor espeak düzeltmesinden ÖNCEYDİ,
   yani önce güncel sürümde tekrar doğrulat.
3. **HUD modundaki hataları çöz**, rahat kullanılabilir hâle getir.
4. **İlk kurulumda konuşma dili sorulsun mu?** Karar kullanıcıda, henüz cevap
   vermedi. Sebep: `tts.speech_language` ayarlanmazsa Chatterbox tek dilli
   modeli yükleyip Türkçeyi İngilizce fonetiğiyle okuyor (`Merhaba → Mehabal`).
   Tahminle çözme — Latin alfabesinde Türkçe/İngilizce ayrımı güvenilir değil.
5. **STT'de iki motor da "use" gösteriyor, indirme düğmesi çıkmıyor.**
   Sebep bulundu: `whisper-turbo` ve `faster-whisper` aynı `probe_module`'ü
   paylaşıyor, biri kurulunca ikisi de "kurulu" sayılıyor
   (`fool/voice_models.py::status`).
6. **Windows bildirimine tıklayınca** uygulama değil, Electron + dosya yolu
   içeren bir arayüz açılıyor.

## Kesin kurallar (kullanıcının açık talebi)

- **Kullanıcı "çalışıyor" demeden sürüm YAYINLAMA.** Sırada iş varken release
  çıkarmak daha önce haklı olarak tepki çekti.
- **Edge TTS önerme.** Piper/Chatterbox dahil uygulamadaki her özellik
  çalışmalı; geçici çözüm olarak motor değiştirmek kabul değil.
- **Kurulu olmayan bir motor seçilebilir olmamalı.**
- Terminal, masaüstü ve exe **aynı sürümü** göstermeli.

## Bu oturumda öğrenilen tuzaklar — tekrarlama

- **Log kırpılıyor.** Arka plan komutlarının `.output` dosyası son ~2 KB'a
  düşüyor. `N failed` özetiyle görünen `FAILED` satır sayısı uyuşmuyorsa
  aldanma; tam koşuyu `> "$TEMP/kendi-dosyan.txt"` ile kendi dosyana yönlendir.
- **İkinci kopya örüntüsü.** Aynı sabit/desen iki yerde duruyor, biri
  düzeltiliyor, muhafız yalnızca ona bakıyor ve CANLI olan yanlış kalıyor.
  Bu oturumda üç kez oldu: hazır-olma belirteci (3 kopya), terminal logosu
  (2 kopya), `install.ps1` dizin adı. Bir şeyi düzeltirken **hep** aynı deseni
  ağacın tamamında ara.
- **Kırmızı test paketi gerçek hata gizler.** İki gerçek hata tam da
  "Windows gürültüsü" sanılan kırmızıların altındaydı. Yeni bir kırmızı
  görünce önce "gerçek mi" diye bak.
- **Çizimi metin taraması yakalayamaz.** Logo `█` karakterinden çiziliyordu,
  içinde "Hermes" dizesi geçmiyordu; bütün marka testleri yeşilken ekranda
  HERMES-AGENT yazıyordu.
- **espeak-ng veri yüklemesi başarısız olunca C tarafında `exit()` çağırıyor** —
  hiçbir Python `try/except` yakalayamaz, bütün arka uç ölür. Kullanıcı adında
  ASCII olmayan harf varsa (`Birhan Oğurlu`) yol okunamıyordu. Düzeltildi:
  `apps/desktop/electron/backend-env.ts::espeakDataEnv` (pakette, anında) +
  `tools/tts_tool.py::_ascii_safe_path` (runtime). Bu sınıfın dersi genel:
  **bir motorun çökmesi ürünü düşürmemeli.**

## Depo gelenekleri

- Commit mesajları: kullanıcının GÖRDÜĞÜ sorunu anlatan tek cümlelik başlık,
  gövdede ölçülen kanıt. Sonuna:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **FOOL-SEAM** işaretleri: yeni bir dikiş eklersen
  `tests/fool/test_branding.py::EXPECTED_SEAMS` ve `docs/fool/SEAMS.md`'ye de
  ekle, yoksa muhafız düşer.
- Yorumlar Türkçe ve "ölçülen sonuç"u anlatıyor — üsluba uy.
- Sürüm bumpı üç dosyayı birlikte değiştirir (`fool_cli/__init__.py`,
  `pyproject.toml`, `apps/desktop/package.json`); `test_version_lockstep.py`
  bunu tutuyor.

## Doğrulama komutları

```bash
PYTHONUTF8=1 .venv/Scripts/python.exe -m pytest tests/fool -q -p no:cacheprovider
cd apps/desktop && npx tsc -p . --noEmit && npx tsc -p tsconfig.electron.json --noEmit
cd apps/desktop && npx vitest run          # 6400+ test
cd apps/desktop && npx eslint src/ electron/   # 0 hata olmalı
```

Temiz paket derlemesi (eşlik kipi `.companion-local` yüzünden **şart**):

```bash
cd apps/desktop && VITE_COMPANION=0 npm run build && npm run builder -- --win nsis --publish never
```

`tests/tools` altında ~265 kırmızı test var: hepsi POSIX varsayımı, Windows'ta
olmayan ilkeller (`AF_UNIX`, `mkfifo`, symlink ayrıcalığı) ya da bilerek
Windows'ta bulunmayan özellikler (tirith). Ürün hatası değil, dokunma.

## Kullanıcının makineleri

- **Masaüstü** (`sarhen`): CUDA var, Chatterbox kurulu ve çalışıyor
  (sıcak sentez 1.6 sn üretim → 2.1 sn ses). Klonlar: `girlfriend`,
  `girlfriend-soft`, `Video Project 10`. Runtime `b08e32ec1` = 0.21.3'te
  KALMIŞ; buraya da 0.21.12 kurulmalı.
- **Laptop** (`Birhan Oğurlu`): espeak düzeltmesinden sonra stabil. LM Studio'yu
  masaüstünden (`192.168.0.5:1234`) kullanıyor.
