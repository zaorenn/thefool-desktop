/**
 * Araya girerken süren turu durdurma sırası — saf, DOM'suz, sınanabilir.
 *
 * Neden gerekiyor
 * ---------------
 * Notch araya girince yalnızca OYNATMAYI kesiyordu: ``stopVoicePlayback()`` +
 * akış oturumunu kapat. Model ise cevabı üretmeye devam ediyor. Sonuç, ölçülü
 * bir hata değil ama net bir davranış kırıklığı:
 *
 *   * Eski cevabın kalan tokenları gelmeye devam ediyor ve
 *     ``collectUnspokenTurnSpeech`` onları YENİ tur bittikten sonra
 *     seslendiriyor -- kullanıcı sözünü kesti, ajan biraz sonra kaldığı
 *     yerden devam ediyor.
 *   * Yeni istem, eski tur hâlâ meşgulken gönderiliyor.
 *
 * Composer tarafı bunu zaten doğru yapıyor (``use-voice-conversation.ts``:
 * üretim evresinde ``onInterrupt`` çağrılıyor ve ``busy`` yatışana kadar
 * bekleniyor). Notch o dikişi hiç kullanmıyordu.
 *
 * Neden durdurma BAŞARISIZ olsa da gönderiyoruz
 * ---------------------------------------------
 * Kullanıcının söylediği cümle elimizde. Durdurma çağrısı ağ hatasıyla
 * düşerse onu YUTMAK, kullanıcının konuşmasını sessizce çöpe atmak demek --
 * araya girmenin kendisinden daha kötü bir sonuç. Hata bildiriliyor, cümle
 * yine de gönderiliyor.
 *
 * Zone A: upstream bu dosyayı bilmiyor.
 */

import type { NotchStatus } from './use-notch-voice'

/**
 * Süren turu durdurmak gerekiyor mu?
 *
 * ``speaking`` de dahil: oynatma sürerken üretim çoktan bitmiş OLABİLİR ama
 * bunu notch bilmiyor ve bitmiş bir turu durdurmak ağ geçidinde işlemsiz.
 * Emin olmadığımızda durdurmak, emin olmadığımızda bırakmaktan ucuz.
 */
export function shouldInterruptTurn(status: NotchStatus): boolean {
  return status === 'thinking' || status === 'speaking'
}

export interface InterruptThenSubmitSteps {
  interrupt: () => Promise<unknown> | unknown
  submit: () => Promise<unknown> | unknown
  /** Durdurma düştüyse haber ver — ama akışı kesme. */
  onInterruptError?: (cause: unknown) => void
}

/**
 * Önce durdur, SONRA gönder.
 *
 * Sıra garanti: gönderim, durdurma çözülmeden başlamıyor. Ters sırada
 * çalıştırmak yeni istemi meşgul bir oturuma yollamak demekti.
 */
export async function interruptThenSubmit(steps: InterruptThenSubmitSteps): Promise<void> {
  try {
    await steps.interrupt()
  } catch (cause) {
    steps.onInterruptError?.(cause)
  }

  await steps.submit()
}
