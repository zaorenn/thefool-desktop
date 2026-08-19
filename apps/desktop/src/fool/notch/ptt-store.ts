/**
 * Bas-konuş tuşunun kalıcı hâli.
 *
 * Notch penceresi ile ayarlar paneli AYRI pencereler; ikisi de aynı bağlamayı
 * görmek zorunda. ``persistentAtom`` bunu depo genelinde kullanılan yolla
 * çözüyor: değer ``localStorage``da, değişiklik ``storage`` olayıyla diğer
 * pencereye ulaşıyor. Bir ref ya da React state tek pencerede kalırdı ve
 * kullanıcı ayarı değiştirdikten sonra notch'un yeniden başlatılmasını
 * beklerdi.
 *
 * Zone A: upstream bu dosyayı bilmiyor.
 */

import { persistentAtom } from '@/lib/persisted'

import { DEFAULT_PTT_CODE, sanitizePttCode } from './ptt-binding'

export const $pttCode = persistentAtom<string>('fool.desktop.notch.pushToTalkCode', DEFAULT_PTT_CODE, {
  // Saklanan değer kullanıcının elinde: bozuk bir giriş bas-konuşu sessizce
  // ölü bırakırdı, o yüzden okuma yolunda temizleniyor.
  decode: raw => sanitizePttCode(raw),
  encode: value => sanitizePttCode(value)
})
