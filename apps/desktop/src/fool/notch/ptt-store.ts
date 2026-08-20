/**
 * Bas-konuş tuşunun kalıcı hâli.
 *
 * Notch penceresi ile ayarlar paneli AYRI pencereler; ikisi de aynı bağlamayı
 * görmek zorunda.
 *
 * Burada ÖNCEDEN ``persistentAtom`` vardı ve bu yorum, değişikliğin ``storage``
 * olayıyla diğer pencereye ulaştığını söylüyordu. Ulaşmıyordu: o atom yazıyor
 * ama hiç dinlemiyor. Yorumun "kullanıcı notch'un yeniden başlatılmasını
 * beklerdi" diye tarif ettiği hata, tam olarak yaşanan hataydı -- ayarda tuşu
 * değiştiriyorsun, notch eski tuşu dinlemeye devam ediyor. Ölçüldü: depo
 * ``KeyQ``, notch penceresindeki atom ``ControlRight``.
 *
 * ``sharedAtom`` dinlemeyi de ekliyor (bkz. ``fool/cross-window-atom.ts``).
 *
 * Zone A: upstream bu dosyayı bilmiyor.
 */

import { sharedAtom } from '../cross-window-atom'

import { DEFAULT_PTT_CODE, sanitizePttCode } from './ptt-binding'

export const $pttCode = sharedAtom<string>('fool.desktop.notch.pushToTalkCode', DEFAULT_PTT_CODE, {
  // Saklanan değer kullanıcının elinde: bozuk bir giriş bas-konuşu sessizce
  // ölü bırakırdı, o yüzden okuma yolunda temizleniyor.
  decode: raw => sanitizePttCode(raw),
  encode: value => sanitizePttCode(value)
})
