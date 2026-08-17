# The Fool — sürüm ve güncelleme hattı

> **Durum:** yapılandırma hazır, **hiçbir şey yayınlanmadı.** Depo henüz
> GitHub'da yok. Aşağıdakiler sen hazır olduğunda çalışacak adımlar.

## Kullanıcılar güncellemeyi nereden alacak

İki ayrı kanal var; ikisi de artık senin deponu gösteriyor:

| Kanal | Nasıl çalışır | Nerede ayarlı |
|---|---|---|
| **Masaüstü uygulaması** | electron-builder `publish` → GitHub Releases. Uygulama yeni sürümü oradan görür. | `apps/desktop/package.json` → `build.publish` |
| **CLI / backend** | `thefool update` git remote'undan çeker | `thefool_cli/update_cmd.py` → `OFFICIAL_REPO_URL` (FOOL-SEAM: update-origin) |

Upstream'in kendi `publish` bloğu **yoktu** — Nous sürümlerini repo dışından
üretiyor. Yani bu blok tamamen bizim eklediğimiz bir şey ve upstream merge'lerinde
çakışma üretmesi beklenmez.

## Yayına geçerken sıra

1. **GitHub'da depoyu aç** (`zaorenn/thefool-desktop`).
   İsim değişirse şu üç yeri birlikte güncelle, yoksa güncellemeler kopar:
   - `apps/desktop/package.json` → `build.publish.owner` / `.repo`
   - `thefool_cli/update_cmd.py` → `OFFICIAL_REPO_URL(S)`
   - `thefool_cli/banner.py` → `_UPSTREAM_REPO_URL`, `_OFFICIAL_REPO_CANONICAL`,
     `_RELEASE_URL_BASE`

2. **`origin` ekle ve ilk push:**

   ```bash
   git remote add origin https://github.com/zaorenn/thefool-desktop.git
   ```

   > **Blobsuz klon notu:** bu depo `--filter=blob:none` ile klonlandı (tam
   > commit geçmişi var, eski dosya içerikleri talep üzerine çekiliyor). İlk
   > push'tan önce eksik nesneleri geri doldur, yoksa push yarıda kalabilir:
   >
   > ```bash
   > git fetch upstream --refetch
   > ```
   >
   > Depo GitHub ölçüsüyle ~670 MB; ilk push uzun sürer, sonrakiler normaldir.

3. **Sürüm üret:**

   ```bash
   npm run dist --workspace apps/desktop
   ```

   Çıktı `apps/desktop/release/` altına düşer:
   `TheFool-0.17.0-win-x64.exe` gibi.

4. **GitHub Releases'e yükle.** `GH_TOKEN` ortam değişkeni ayarlıysa
   electron-builder bunu kendisi yapar.

## Upstream'den güncelleme alma

Fork'un asıl kazancı bu. Hermes'in yeni özellikleri ve güvenlik yamaları:

```bash
git fetch upstream
git merge upstream/main
python -m pytest tests/fool/ -q
```

Test kırmızı yanarsa bir dikiş merge sırasında kaybolmuştur —
[SEAMS.md](SEAMS.md) tablosundaki "geri koyma" sütunu ne yapılacağını söyler.

Merge sonrası markalaşmayı gözle de doğrulamak istersen:

```bash
grep -rn "FOOL-SEAM" --exclude-dir=.git --exclude-dir=node_modules .
```

## Sürüm numarası

İki ayrı numara var, bilinçli olarak ayrı:

- `apps/desktop/package.json` → `version` (masaüstü kabuğu, şu an `0.17.0`)
- `thefool_cli/__init__.py` → `__version__` (ajan çekirdeği, şu an `0.20.2`)

Upstream ikisini de kendi ritminde ilerletiyor. Kendi sürüm şemana geçmek
istersen bunları ayır ve `docs/fool/SEAMS.md`'ye birer satır ekle — aksi halde
her upstream merge'i senin numaranı geri alır.
