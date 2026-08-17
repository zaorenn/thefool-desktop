# Dikiş Kayıt Defteri (SEAMS)

Bu dosya, The Fool'un upstream (`NousResearch/hermes-agent`) dosyalarına
dokunduğu **her yeri** listeler. Başka hiçbir yerde upstream kodu değişmez.

Amaç: `git merge upstream/main` sonrasında neyin risk altında olduğunu tahmin
etmek zorunda kalmamak.

## Nasıl kontrol edilir

Merge sonrası, sırayla:

```bash
grep -rn "FOOL-SEAM" --exclude-dir=.git --exclude-dir=node_modules .
```

Sonra koruma testleri — bir dikiş sessizce kaybolduysa burası kırmızı yanar:

```bash
python -m pytest tests/fool/ -q
```

En tehlikeli senaryo çakışma değil; çakışmanın **sessizce** upstream lehine
çözülüp markalaşmanın geri alınmasıdır. Testler tam bunun için var.

## Dikişler

### Markalaşma — dönüşümler

Bunlar tek tek metin düzenlemesi değil, **dönüşüm**. Upstream yeni metin
eklediğinde onlar da otomatik markalanır; bakım maliyeti sıfır.

| id | Dosya | Ne yapar |
|----|-------|----------|
| `i18n-brand` | `apps/desktop/src/i18n/catalog.ts` | Masaüstü çeviri kataloğunun tamamı `applyFoolBrand()`'den geçer. Tek satır, 141+ metin, tüm diller. |
| `argparse-brand` | `hermes_cli/__init__.py` | argparse'ın metin kabul ettiği 4 nokta sarmalanır → tüm `--help` çıktısı. Yalnızca yardım metnine dokunur; argüman adları/`dest`/`choices` ellenmez. |
| `command-descriptions` | `hermes_cli/commands.py` | `CommandDef.__post_init__` tüm `/help` açıklamalarını markalar. |

### Markalaşma — noktasal

| id | Dosya | Kaybolursa |
|----|-------|------------|
| `wordmark` | `apps/desktop/src/components/chat/intro.tsx` | Açılış ekranında "HERMES AGENT" yazar |
| `html-title` | `apps/desktop/index.html` | Sekme/pencere başlığı "Hermes" olur |
| `version-banner` | `hermes_cli/_startup_fast.py`, `banner.py`, `cli.py` | Sürüm satırı "Hermes Agent v…" olur |
| `prog-name` | `hermes_cli/_parser.py`, `console_engine.py` | `usage: hermes` yazar |
| `bot-display-name` | `apps/desktop/src/plugins/hermes-bots/plugin.js` | Varsayılan profil "Hermes" görünür |
| `theme-preset` | `apps/desktop/src/themes/presets.ts` | Crimson tema kaybolur, varsayılan `nous`a döner |
| `default-mode` | `apps/desktop/src/themes/context.tsx` | Uygulama açık modda açılır, crimson kimlik zayıflar |

### Kimlik ve dağıtım

| id | Dosya | Kaybolursa |
|----|-------|------------|
| `cli-scripts` | `pyproject.toml` | Komut adı `hermes`e döner |
| `fool-packaging` | `pyproject.toml` | **`import fool` patlar — markalaşmanın TAMAMI çöker** |
| `home-dir` | `hermes_constants.py` **ve** `apps/desktop/electron/main.ts` | Veri dizini `hermes`e döner ve kullanıcının kurulu Hermes'iyle çakışır |
| `bot-handle` | `apps/desktop/src/plugins/hermes-bots/plugin.js` (2 yer) | `@thefool` hiçbir bota çözülmez |

### Nous bağlarının kesilmesi

| id | Dosya | Ne yapar |
|----|-------|----------|
| `update-origin` | `hermes_cli/update_cmd.py` | Güncellemeler The Fool deposundan gelir. Kaybolursa kullanıcılar **sessizce upstream Hermes'e güncellenir** ve markalaşma silinir. |
| `banner-repo` | `hermes_cli/banner.py` | Sürüm bağlantıları The Fool deposunu gösterir |
| `model-catalog` | `hermes_cli/model_catalog.py` | Katalog sürümle gelir; her açılışta Nous'a istek gitmez |
| `diagnostics-endpoint` | `hermes_cli/diagnostics_upload.py` | Loglar/sistem bilgisi hiçbir yere yüklenmez |
| `nous-account-commands` | `hermes_cli/commands.py` | `/subscription`, `/topup` kaldırıldı (Nous hesabına özel faturalama) |

### İşaretsiz dikiş

`brand-dist` → `apps/desktop/package.json`
(`appId`, `productName`, `executableName`, protokol, dmg/nsis/mac/linux adları,
`publish` bloğu).

JSON yorum kabul etmediği için `FOOL-SEAM` işareti konamıyor. Bunun yerine
`tests/fool/test_branding.py::test_desktop_package_carries_fool_identity`
koruyor.

## İkili dikişler — dikkat

Üç dikiş **iki yeri birden** değiştirmek zorunda. Yalnızca birini değiştirmek
sessiz bozulma üretir:

- **`home-dir`** — Python ve Electron veri dizinini BAĞIMSIZ hesaplıyor.
  Ayrışırlarsa masaüstü uygulaması backend'ini bulamaz.
- **`bot-handle`** — `botHandle()` görünen etiketi, mention çözücüsü ise
  çağrıyı üretir. Ayrışırlarsa kullanıcının yazdığı `@thefool` kimseye gitmez.
- **Marka sabitleri** — `fool/branding.py` ve `apps/desktop/src/fool/branding.ts`
  elle senkron tutulur.

Üçü de testle korunuyor.

## Kural

Yeni bir dikiş eklemek zorunda kaldığında:

1. Mantığı **`fool/` veya `src/fool/` altına** yaz. Upstream dosyasına giren şey
   yalnızca bir import + bir çağrı olsun.
2. Yanına `FOOL-SEAM: <id>` yorumunu koy.
3. Bu tabloya bir satır ekle.
4. `tests/fool/` altına dikişi koruyan bir test yaz.

Dikiş sayısı arttıkça merge maliyeti artar. Yeni özellikler dikişten değil,
**eklenti noktalarından** girmeli.

## Sıfır dikişle çalışan uzantı noktaları

Hermes zaten uzantı için tasarlanmış. Aşağıdakiler **upstream kodu hiç
düzenlenmeden** çalışır:

- **Görsel kimlik (CLI + TUI + GUI)** → `~/.thefool/skins/the-fool.yaml`.
  `skin_engine.py`: *"A skin dropped in ~/.hermes/skins/ therefore themes all
  three surfaces at once."*
- **Ses klonlama** → `agent/tts_provider.py` ABC'si. Dosyanın kendi ifadesiyle:
  *"the hook is additive infrastructure waiting for a real consumer."*
- **Konuşma tanıma** → `agent/transcription_provider.py`
- **Masaüstü panel / sayfa / komut / kısayol** → `contrib/registry.ts` katkı
  alanları (`PANES_AREA`, `ROUTES_AREA`, `PALETTE_AREA`, `KEYBINDS_AREA`, …)
- **Ek temalar** → `THEMES_AREA`
- **Model sağlayıcı** → model-provider eklenti SDK'sı

Notch/popup penceresi bunun tek istisnası: gerçek bir Electron `BrowserWindow`
gerektiği için ileride bir `overlay-window` dikişi gerekecek. Mantık
`apps/desktop/electron/fool/` altına yazılacak, `main.ts`'e yalnızca bir import
ve bir çağrı girecek — deseni upstream'in kendi `link-title-window.ts`'i.
