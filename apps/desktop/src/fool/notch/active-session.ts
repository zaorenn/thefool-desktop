/**
 * Sesin gideceği oturum — PENCERELER ARASI.
 *
 * Ölçülen hata
 * ------------
 * Çentik ``$activeSessionId``i okuyordu ama o düz bir atom ve çentik AYRI bir
 * ``BrowserWindow``: kendi deposunda o değer hiç dolmuyor, ``null`` kalıyor.
 * Ses ``session_id: null`` ile gidiyor, ağ geçidi onu kendi seçtiği bir
 * oturuma düşürüyor.
 *
 * Kullanıcının gördüğü buydu: "mesajlar ilk önce bots kısmında gözüküyor
 * ancak ana sessiona hemen düşmüyor, bundan dolayı ses gecikiyor." Mesaj
 * yanlış oturuma gidiyor ve ana sohbete ancak eşitlenince düşüyor.
 *
 * Aynı tuzağa daha önce bas-konuş bağlaması ve dinleme kipi de düştü; çözüm
 * yine ``sharedAtom`` -- yazan pencerenin değerini diğeri de duyuyor.
 *
 * Zone A: upstream bu dosyayı bilmiyor.
 */

import { sharedAtom } from '../cross-window-atom'

/**
 * Ana pencerenin AÇIK sohbeti. ``''`` = henüz yok.
 *
 * Ana pencere yazıyor, çentik okuyor. Çentiğin kendi ``$activeSessionId``i
 * hiçbir zaman dolmuyor, o yüzden burası tek kaynak.
 */
export const $voiceSessionId = sharedAtom<string>('fool.desktop.voice.sessionId', '', {
  decode: raw => raw,
  encode: value => value
})

/** Oturum kimliğinin gelmesi için beklenecek en uzun süre. */
const WAIT_MS = 3_000

/**
 * Oturum kimliğini BEKLEYEREK oku (``''`` = süre doldu).
 *
 * Ölçülen yarış: köprü ana pencerede kuruluyor ve değeri oradan yayınlıyor.
 * Kullanıcı Ctrl+Alt+V'ye ana pencere daha oturumunu açmadan basarsa çentik
 * ``''`` okuyup HEMEN hata veriyordu -- kullanıcı cümlesini söylüyor, cümle
 * çöpe gidiyor ve çentikte tek satırlık bir hata kalıyordu.
 *
 * Bekleme kısa: 3 saniye, ve kullanıcı zaten konuşuyor olacağı için bedeli
 * görünmüyor. Süre dolarsa çağıran gerçekten söyleyecek bir şey biliyor
 * demektir; sonsuza kadar beklemek mikrofonu açık bırakmak olurdu.
 *
 * Değer ZATEN varsa hiç beklenmiyor -- normal yol bu.
 */
export function waitForVoiceSession(timeoutMs: number = WAIT_MS): Promise<string> {
  const current = $voiceSessionId.get()

  if (current) {
    return Promise.resolve(current)
  }

  return new Promise<string>(resolve => {
    let done = false

    const finish = (value: string) => {
      if (done) {
        return
      }

      done = true
      unsubscribe()
      clearTimeout(timer)
      resolve(value)
    }

    const timer = setTimeout(() => finish($voiceSessionId.get()), timeoutMs)

    // ``listen`` DEGIL ``subscribe``: ikincisi mevcut degeri de hemen veriyor,
    // yani abonelik kurulurken gelen bir yazi kacmiyor.
    const unsubscribe = $voiceSessionId.subscribe(value => {
      if (value) {
        finish(value)
      }
    })
  })
}
