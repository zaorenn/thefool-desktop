# Geliştirme notları

Bu monorepo'da tökezlediğim ve tekrar tökezlenmesi muhtemel yerler.

## `npm install` — workspace bayrağı KULLANMA

```bash
# DOĞRU
npm install

# YANLIŞ — ağacı buduyor
npm install --workspace apps/desktop
```

Workspace-kapsamlı kurulum, ağacı yalnızca o workspace'in ihtiyaçlarına göre
yeniden uzlaştırıyor ve **başka workspace'lerin paketlerini siliyor.** Sonucu
teşhisi zor iki belirti:

1. **Üretim derlemesi kırılır:**
   `Error: Can't resolve 'tw-shimmer' in apps/desktop/src`
2. **Ayar panelleri sonsuza kadar iskelet kalır.**
   `tw-shimmer` bir shimmer/iskelet kütüphanesi; `@import 'tw-shimmer'`
   çözülemeyince kod-bölmeli ayar panelleri dinamik import'ta düşüyor.
   Arayüzde hata görünmüyor — sadece yüklenmiyor gibi duruyor.
3. Yan etki: `tsc --noEmit` aniden `Cannot find module '@assistant-ui/core'`
   demeye başlar.

Kökten `npm install` her şeyi geri getiriyor (bende 504 paket geri geldi).

## Python ortamı

```bash
uv venv .venv --python 3.13
uv pip install --python .venv -e ".[dev]"
```

Sistem Python'u 3.14 olabilir; repo `<3.14` istiyor. `.python-version` 3.11
diyor ama 3.13 sorunsuz çalışıyor.

Masaüstü uygulaması geliştirme modunda backend'i **repo kökündeki `.venv`**
içinde arıyor ([main.ts:2188](../../apps/desktop/electron/main.ts:2188)) —
bu yüzden venv `.venv` adıyla ve repo kökünde olmalı.

### `uv run --with <paket>` KULLANMA

```bash
# YANLIŞ — .venv'i bozar
uv run --with pyyaml python -c "..."

# DOĞRU
.venv/Scripts/python.exe -c "..."
```

`uv run --with`, `.venv` üzerine geçici bir katman kurmaya çalışıyor; Electron
veya pytest dosyaları kilitliyorsa yarıda kalıyor ve **paketleri silinmiş bir
venv** bırakıyor. Belirti: `ModuleNotFoundError: No module named 'yaml'` ve
`thefool` komutunun aniden patlaması. Onarım:

```bash
uv pip install --python .venv -e ".[dev]"
```

## Uygulamayı çalıştırma

```bash
# Geliştirme (vite + electron)
npm run dev --workspace apps/desktop

# Yalnızca arayüz (tarayıcıda; IPC yok, "Desktop IPC bridge is unavailable"
# hatası bu modda NORMAL)
npm run dev:renderer --workspace apps/desktop

# Üretim derlemesi
npm run build --workspace apps/desktop
npx electron .            # apps/desktop içinden, dev sunucusu olmadan
```

> `npm run <script> --workspace X` **güvenli** — budayan şey `npm install`.

### Geliştirme modunda ayar panelleri boş geliyorsa

Kaynak dosyaları düzenledikçe vite modülleri geçersiz kılıyor ve daha önce
yüklenmiş dinamik import'lar düşebiliyor:

```
TypeError: Failed to fetch dynamically imported module: .../syntax-diff.tsx
```

Uygulamayı yeniden başlatmak yeterli. Üretim derlemesinde bu sorun yok —
chunk'lar diskten geliyor.

## Testler

```bash
# The Fool koruma testleri — merge sonrasi HER ZAMAN
.venv/Scripts/python.exe -m pytest tests/fool/ -q

# Upstream testleri
.venv/Scripts/python.exe -m pytest tests/hermes_cli/ -q \
  --ignore=tests/hermes_cli/test_doctor_journal_modes.py
```

`test_doctor_journal_modes.py` Windows'ta **upstream'de de** toplanamıyor
(`os.geteuid` POSIX'e özel). Bizim değişikliklerimizle ilgisi yok —
değişiklikler stash'liyken de aynı hatayı veriyor.

## Windows'a özgü

- Klon `--filter=blob:none` ile yapıldı: tam commit geçmişi var, eski dosya
  içerikleri talep üzerine çekiliyor. İlk push'tan önce
  `git fetch upstream --refetch` gerekir (bkz. [RELEASE.md](RELEASE.md)).
- `contributors/emails/agent@Agents-Mac-mini.local` büyük/küçük harf
  çakışması yaşıyor; `git update-index --skip-worktree` ile susturuldu.
- `core.longpaths true` ayarlandı — node_modules + Electron derinliği için.
