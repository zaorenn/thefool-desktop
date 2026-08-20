/**
 * Aynı anda TEK yüzey konuşur.
 *
 * Ölçülen hata
 * ------------
 * Oynatma tek bir küresel kanal (``lib/voice-playback.ts``) ve hem
 * ``playSpeechText`` hem ``startSpeechStream`` işe başlarken
 * ``stopVoicePlayback()`` çağırıyor. Uygulamada AYNI cevabı iki yüzey
 * seslendirmeye çalışıyordu -- sohbet panelinin ses döngüsü ve Friend
 * penceresi, ikisi de aynı ``$messages`` deposunu okuyor.
 *
 * Sonuç: her biri diğerini iptal ediyor. Ekranda "Preparing audio" sonsuza
 * kadar duruyor, hiç ses çıkmıyor ve iki sentez işi birden makineyi
 * kastırıyor. Kullanıcının "ses gelmedi, bilgisayar deli gibi kastı" dediği
 * şey buydu.
 *
 * Çözüm bir kilit değil SAHİPLİK: hangi yüzey konuşmaya yetkili olduğu
 * açıkça yazılıyor. Kilit olsaydı ikinci yüzey bekleyip sonra AYNI cevabı
 * tekrar okurdu -- kullanıcı her şeyi iki kez duyardı.
 *
 * Zone A: upstream bu dosyayı bilmiyor.
 */

import { atom } from 'nanostores'

export type VoiceSurface = 'composer' | 'friend' | 'notch'

/**
 * Öncelik: büyük olan kazanır.
 *
 * Friend penceresi en yüksek çünkü kullanıcı onu AÇARAK konuşmayı seçti ve
 * ekranda ona bakıyor. Notch ikinci: görünür ama geçici. Composer en düşük:
 * orada ses bir yan özellik, ana iş yazışmak.
 */
const PRIORITY: Record<VoiceSurface, number> = {
  composer: 1,
  friend: 3,
  notch: 2
}

/** Şu an konuşmaya yetkili yüzey. ``null`` = kimse. */
export const $voiceOwner = atom<VoiceSurface | null>(null)

/**
 * Sahipliği talep et.
 *
 * Daha yüksek öncelikli bir yüzey sahipse ``false`` döner ve çağıran
 * SESSİZ kalır -- konuşmaya çalışıp diğerini iptal etmek yerine.
 */
export function claimVoice(surface: VoiceSurface): boolean {
  const current = $voiceOwner.get()

  if (current === surface) {
    return true
  }

  if (current !== null && PRIORITY[current] > PRIORITY[surface]) {
    return false
  }

  $voiceOwner.set(surface)

  return true
}

/** Sahipliği bırak -- yalnızca gerçekten sahipsen. */
export function releaseVoice(surface: VoiceSurface): void {
  if ($voiceOwner.get() === surface) {
    $voiceOwner.set(null)
  }
}

/**
 * Bu yüzey şu an konuşabilir mi?
 *
 * Sahip YOKSA da ``true``: sahiplik seslendirmeyi engellemek için değil,
 * ÇAKIŞMAYI engellemek için var. Tek yüzey açıkken hiçbir şey talep
 * etmemişse yine konuşulmalı.
 */
export function canSpeak(surface: VoiceSurface): boolean {
  const current = $voiceOwner.get()

  return current === null || current === surface
}
