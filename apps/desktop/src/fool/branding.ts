/**
 * The Fool — marka kimliğinin TEK kaynağı (renderer tarafı).
 *
 * Bu dosya Bölge A'dadır: upstream'de `fool/` diye bir dizin yok, dolayısıyla
 * burada yazdığımız hiçbir şey `git merge upstream/main` sırasında çakışmaz.
 *
 * Buradaki `applyFoolBrand()` bir *kopya* değil bir *dönüşümdür*. i18n
 * kataloğuna tek bir dikişten (FOOL-SEAM: i18n-brand, `src/i18n/catalog.ts`)
 * bağlanır ve tüm dillerdeki metinleri geçerken markalar. Bunun sonucu:
 * upstream yarın "Hermes" içeren 50 yeni metin eklerse, onlar da hiçbir şey
 * yapmadan The Fool olur. Bakım maliyeti sıfır.
 *
 * @see docs/fool/SEAMS.md
 * @see docs/fool/ARCHITECTURE.md
 */

export const BRAND = {
  /** Ürünün konuşma dilindeki adı. */
  name: 'The Fool',
  /** Açılış ekranındaki büyük harf logotype (intro.tsx). */
  wordmark: 'THE FOOL',
  /** Masaüstü uygulamasının tam adı. */
  desktop: 'The Fool Desktop',
  /**
   * Ajanın KENDİNİ tanıttığı ad — sistem promptuna giren kimlik.
   * Ürün "The Fool", ajan "Fool Agent"; upstream'deki
   * "Hermes" / "Hermes Agent" ayrımının karşılığı.
   */
  agent: 'Fool Agent',
  /** "Nous Research" yerine geçen üretici adı. */
  vendor: 'Fool Labs',
  /** Terminal komutu — pyproject `[project.scripts]` ile eşleşmeli. */
  cli: 'fool',
  /** Veri dizini adı — `~/.fool`. Python tarafıyla eşleşmeli. */
  homeDirName: '.fool',
  /** electron-builder appId. */
  appId: 'com.fool.desktop',
  /** Derin bağlantı şeması — fool://... */
  protocol: 'fool'
} as const

/**
 * Sıra ÖNEMLİ: en uzun/en özel kalıp önce gelmeli, yoksa "Hermes Desktop"
 * daha genel olan "Hermes" kuralı tarafından yenir ve "The Fool Desktop"
 * yerine "The Fool Desktop" üretilemez.
 *
 * `\b` sınırları sayesinde iç sözleşmeye DOKUNULMAZ — regex'te `_` bir kelime
 * karakteri olduğu için:
 *   FOOL_HOME  → eşleşmez (HERMES'ten sonra `_` var, `\b` yok)
 *   fool_cli   → eşleşmez (aynı sebep)
 *   ~/.hermes    → eşleşir  (`.` kelime karakteri değil) — ve zaten değişmesini
 *                  istediğimiz yer burası
 */
const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bHERMES\s+DESKTOP\b/g, BRAND.desktop.toUpperCase()],
  [/\bHERMES\s+AGENT\b/g, BRAND.agent.toUpperCase()],
  [/\bHermes\s+Desktop\b/g, BRAND.desktop],
  // "Hermes Agent" -> "Fool Agent": ajanın tam adı. Açılış logotype'ı bu
  // kuraldan GEÇMEZ, doğrudan BRAND.wordmark'tan geliyor (intro.tsx).
  [/\bHermes\s+Agent\b/g, BRAND.agent],
  [/\bNous\s+Research\b/g, BRAND.vendor],
  [/\bNous\b/g, BRAND.vendor],
  [/\bHERMES\b/g, BRAND.wordmark],
  [/\bHermes\b/g, BRAND.name],
  [/\bhermes\b/g, BRAND.cli]
]

/**
 * Ad "The" içerdiği için ham değiştirme yer yer bozuk İngilizce üretir:
 *   "Restore a Hermes backup"      -> "Restore a The Fool backup"      ✗
 *   "Open the safe Hermes console" -> "Open the safe The Fool console"  ✗
 *
 * Bir artikel zaten varsa "The" düşer ve ad sıradan bir özel isim gibi davranır.
 * Tek başına geçtiğinde tam ad korunur ("The Fool couldn't start").
 *
 * Pencere bilinçli olarak BİR kelime: iki kelimelik pencere
 * "a standing goal The Fool works on" ifadesini de yanlışlıkla yakalıyordu —
 * oradaki artikel ürüne değil "goal" ismine ait.
 *
 * Python tarafındaki `_ARTICLE_FIX` ile birebir aynı tutulmalı.
 */
const ARTICLE_FIX: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(a|an|the|your|my|its|their)\s+((?:\w+\s+){0,1}?)The\s+Fool\b/gi, '$1 $2Fool'],
  [/\bThe\s+The\s+Fool\b/g, 'The Fool']
]

/** Tek bir metni markala. Dışarıdan da kullanılabilir (ör. sabit stringler). */
export function brandText(input: string): string {
  let out = input
  for (const [pattern, replacement] of RULES) {
    out = out.replace(pattern, replacement)
  }
  for (const [pattern, replacement] of ARTICLE_FIX) {
    out = out.replace(pattern, replacement)
  }
  return out
}

/**
 * Değeri tipine göre özyinelemeli markalar.
 *
 * i18n kataloğu düz bir string haritası DEĞİL: içinde iç içe nesneler,
 * diziler ve `project => \`New session in ${project}\`` gibi fonksiyonlar var.
 * Fonksiyonlar çağrı anında string ürettiği için, fonksiyonun kendisini değil
 * DÖNÜŞ DEĞERİNİ markalamamız gerekir — bu yüzden sarmalıyoruz.
 */
function brandValue(value: unknown): unknown {
  if (typeof value === 'string') return brandText(value)

  if (typeof value === 'function') {
    const fn = value as (...args: unknown[]) => unknown
    return (...args: unknown[]) => brandValue(fn(...args))
  }

  if (Array.isArray(value)) return value.map(brandValue)

  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = brandValue(val)
    }
    return out
  }

  // number | boolean | null | undefined | symbol — olduğu gibi geçer.
  return value
}

/**
 * i18n kataloğunun tamamını markalayarak döndürür. Tip korunur, böylece
 * upstream'in `Translations` sözleşmesi bozulmaz ve tip denetimi çalışmaya
 * devam eder.
 */
export function applyFoolBrand<T>(catalog: T): T {
  return brandValue(catalog) as T
}
