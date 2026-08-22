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
