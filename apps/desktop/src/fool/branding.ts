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
  /** "Nous Research" yerine geçen üretici adı. */
  vendor: 'Fool Labs',
  /** Terminal komutu — pyproject `[project.scripts]` ile eşleşmeli. */
  cli: 'thefool',
  /** Veri dizini adı — `~/.thefool`. Python tarafıyla eşleşmeli. */
  homeDirName: '.thefool',
  /** electron-builder appId. */
  appId: 'com.thefool.desktop',
  /** Derin bağlantı şeması — thefool://... */
  protocol: 'thefool'
} as const

/**
 * Sıra ÖNEMLİ: en uzun/en özel kalıp önce gelmeli, yoksa "Hermes Desktop"
 * daha genel olan "Hermes" kuralı tarafından yenir ve "The Fool Desktop"
 * yerine "The Fool Desktop" üretilemez.
 *
 * `\b` sınırları sayesinde iç sözleşmeye DOKUNULMAZ — regex'te `_` bir kelime
 * karakteri olduğu için:
 *   HERMES_HOME  → eşleşmez (HERMES'ten sonra `_` var, `\b` yok)
 *   hermes_cli   → eşleşmez (aynı sebep)
 *   ~/.hermes    → eşleşir  (`.` kelime karakteri değil) — ve zaten değişmesini
 *                  istediğimiz yer burası
 */
const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bHERMES\s+DESKTOP\b/g, BRAND.desktop.toUpperCase()],
  [/\bHERMES\s+AGENT\b/g, BRAND.wordmark],
  [/\bHermes\s+Desktop\b/g, BRAND.desktop],
  [/\bHermes\s+Agent\b/g, BRAND.name],
  [/\bNous\s+Research\b/g, BRAND.vendor],
  [/\bNous\b/g, BRAND.vendor],
  [/\bHERMES\b/g, BRAND.wordmark],
  [/\bHermes\b/g, BRAND.name],
  [/\bhermes\b/g, BRAND.cli]
]

/** Tek bir metni markala. Dışarıdan da kullanılabilir (ör. sabit stringler). */
export function brandText(input: string): string {
  let out = input
  for (const [pattern, replacement] of RULES) {
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
