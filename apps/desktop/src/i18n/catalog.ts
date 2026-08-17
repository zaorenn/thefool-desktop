// FOOL-SEAM: i18n-brand
// Katalog, The Fool marka dönüşümünden geçirilir. Bu bir kopya değil bir
// dönüşüm olduğu için upstream yeni metin eklediğinde o da otomatik markalanır.
// Kaybolursa: tüm arayüz "Hermes"e döner. Bkz. docs/fool/SEAMS.md
import { applyFoolBrand } from '../fool/branding'

import { ar } from './ar'
import { en } from './en'
import { ja } from './ja'
import type { Locale, Translations } from './types'
import { zh } from './zh'
import { zhHant } from './zh-hant'

export const TRANSLATIONS: Record<Locale, Translations> = applyFoolBrand({
  en,
  zh,
  'zh-hant': zhHant,
  ja,
  ar
})
