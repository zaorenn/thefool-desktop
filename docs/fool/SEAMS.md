# Dikiş Kayıt Defteri (SEAMS)

Bu dosya, The Fool'un upstream (`NousResearch/hermes-agent`) dosyalarına
dokunduğu **her yeri** listeler. Başka hiçbir yerde upstream kodu değişmez.

Amaç: `git merge upstream/main` sonrasında neyin risk altında olduğunu tahmin
etmek zorunda kalmamak. Liste kısa; kısa kalmalı.

## Nasıl kontrol edilir

Merge sonrası, sırayla:

```bash
grep -rn "FOOL-SEAM" --exclude-dir=.git --exclude-dir=node_modules .
```

Aşağıdaki tabloda kaç dikiş varsa, grep o kadar sonuç vermeli. Eksik varsa
merge onu yutmuştur — tablodaki "geri koyma" sütunu ne yapılacağını söyler.

Sonra koruma testleri:

```bash
python -m pytest tests/fool/ -q
```

## Dikişler

### Uygulanmış

| # | id | Dosya | Ne | Kaybolursa ne olur | Geri koyma |
|---|----|-------|----|--------------------|------------|
| 1 | `i18n-brand` | `apps/desktop/src/i18n/catalog.ts` | `TRANSLATIONS` `applyFoolBrand()` ile sarmalanır | Tüm arayüz metinleri "Hermes"e döner | import + sarmalama satırını geri ekle |
| 2 | `wordmark` | `apps/desktop/src/components/chat/intro.tsx` | `WORDMARK` sabiti `BRAND.wordmark`'tan gelir | Açılış ekranında "HERMES AGENT" yazar | sabiti `BRAND.wordmark` yap |
| 3 | `theme-preset` | `apps/desktop/src/themes/presets.ts` | `theFoolTheme` kaydı + `DEFAULT_SKIN_NAME` | Crimson tema kaybolur, varsayılan `nous`a döner | import + preset kaydını geri ekle |
| 4 | `update-origin` | `hermes_cli/update_cmd.py` | `OFFICIAL_REPO_URL(S)` The Fool deposu | Kullanıcılar sessizce upstream Hermes'e güncellenir | sabitleri düzelt |
| 5 | `banner-repo` | `hermes_cli/banner.py` | `_UPSTREAM_REPO_URL`, `_OFFICIAL_REPO_CANONICAL`, `_RELEASE_URL_BASE` | Sürüm bağlantıları Nous'a gider | sabitleri düzelt |
| 6 | `cli-scripts` | `pyproject.toml` | `[project.scripts]` → `thefool` | Komut adı `hermes`'e döner | script adlarını düzelt |

**İşaretsiz dikiş:** `brand-dist` → `apps/desktop/package.json`
(`appId`, `productName`, `executableName`, protokol, dmg/nsis/mac/linux adları).
JSON yorum kabul etmediği için `FOOL-SEAM` işareti konamıyor; bunun yerine
`tests/fool/test_branding.py::test_desktop_package_carries_fool_identity`
koruyor.

### Planlanan (henüz uygulanmadı)

| id | Dosya | Ne | Neden beklemede |
|----|-------|----|-----------------|
| `home-dir` | `hermes_constants.py` **ve** `apps/desktop/electron/main.ts` | Veri dizini `~/.thefool` | Python ve Electron dizini BAĞIMSIZ hesaplıyor; ikisi ayrışırsa uygulama backend'ini bulamaz. Çalışan bir temel doğrulandıktan sonra, iki taraf birlikte değiştirilecek. |
| `locale-brand` | Python locale yükleyici | `locales/*.yaml` → `brand_value()` | CLI/TUI metinleri. Masaüstü i18n'i zaten kapsandı. |
| `overlay-window` | `apps/desktop/electron/main.ts` | Sesli sohbet notch penceresi | Özellik henüz yazılmadı. |

## Kural

Yeni bir dikiş eklemek zorunda kaldığında:

1. Mantığı **`fool/` veya `src/fool/` altına** yaz. Upstream dosyasına giren
   şey yalnızca bir import + bir çağrı olsun.
2. Dikişin yanına `FOOL-SEAM: <id>` yorumunu koy.
3. Bu tabloya bir satır ekle.
4. `tests/fool/` altına dikişi koruyan bir test yaz.

Dikiş sayısı arttıkça merge maliyeti artar. On civarında tutmak hedef; yeni
özellikler dikişten değil, **eklenti noktalarından** (Bölge B) girmeli.

## Neden bu kadar az dikiş yeterli

Hermes zaten uzantı için tasarlanmış. Aşağıdakiler **sıfır dikişle** çalışır:

- **Görsel kimlik (CLI + TUI + GUI)** → `~/.thefool/skins/the-fool.yaml`.
  `skin_engine.py`: *"A skin dropped in ~/.hermes/skins/ therefore themes all
  three surfaces at once."*
- **Ses klonlama** → `agent/tts_provider.py` ABC'si. Dosyanın kendi ifadesiyle:
  *"the hook is additive infrastructure waiting for a real consumer."*
- **Konuşma tanıma** → `agent/transcription_provider.py` ABC'si
- **Masaüstü panel/sayfa/komut/kısayol** → `contrib/registry.ts` katkı alanları
  (`PANES_AREA`, `ROUTES_AREA`, `PALETTE_AREA`, `KEYBINDS_AREA`, …)
- **Ek temalar** → `THEMES_AREA` katkısı
- **Model sağlayıcı** → model-provider eklenti SDK'sı
