/**
 * Chat ↔ Cowork kipi.
 *
 * Ne olduğu
 * ---------
 * ``Cowork`` uygulamanın bugünkü hâli: bütün araçlar, proje ağacı, zamanlanmış
 * işler. ``Chat`` hızlı konuşmak için: model OKUYABİLİYOR (web, dosya, geçmiş,
 * hafıza) ama hiçbir şeyi değiştiremiyor -- yazma, komut çalıştırma, tarayıcı
 * sürme yok.
 *
 * Hız nereden geliyor
 * -------------------
 * Araç şemaları HER TURDA modele gidiyor. Ölçüldü: ``chat`` kümesi ~4.5K
 * token, ``coding`` ~10.3K. Yani Chat kipi tur başına ~5.800 token daha az
 * gönderiyor -- ağda da, modelin okuduğu bağlamda da.
 *
 * Kip neden OTURUM özelliği
 * -------------------------
 * Araç şemaları donmuş sistem promptunun parçası ve prompt önbelleği onun
 * üzerine kurulu (bkz. ``fool/session_scope.py``). Tur başına araç
 * değiştirmek ajanı yeniden kurmak demek.
 *
 * Kip oturumun ``source`` alanında yaşıyor ve ağ geçidi zaten onu okuyup
 * kapsamı seçiyor -- bu dosya yeni bir hakikat kaynağı EKLEMİYOR, var olanı
 * okuyor.
 *
 * Zone A: upstream bu dosyayı bilmiyor.
 */

import { computed } from 'nanostores'

import { activeGateway, ensureActiveGatewayOpen } from '@/store/gateway'
import { $selectedStoredSessionId, $sessions, sessionMatchesStoredId, setSessions } from '@/store/session'

export type ChatMode = 'chat' | 'cowork'

/** Chat kipindeki oturumların ``source`` değeri. */
export const CHAT_SOURCE = 'chat'

/**
 * Cowork'ün ``source`` değeri -- ``'cowork'`` DEĞİL.
 *
 * Ağ geçidi ``source``u kapsam çözümlemesinde kullanıyor ve ``desktop``
 * masaüstünün olağan kapsamı. ``'cowork'`` yazmak tanınmayan bir kapsam
 * üretirdi; bugün zararsız (kısıtlama uygulanmıyor) ama sessizce yanlış --
 * ileride biri o adı gerçek bir kapsam yaptığında kip anlamını değiştirirdi.
 */
export const COWORK_SOURCE = 'desktop'

/** Bir oturumun kaynağından kipini çıkar. */
export function modeOfSource(source: null | string | undefined): ChatMode {
  return (source ?? '').trim().toLowerCase() === CHAT_SOURCE ? 'chat' : 'cowork'
}

/** Bu saklanan oturumun kipi. Bilinmeyen oturum ``cowork`` sayılıyor --
 *  kısıtlamayı VARSAYMAK, kullanıcının aracını sessizce elinden almak olurdu. */
export function modeOfSession(storedSessionId: null | string): ChatMode {
  if (!storedSessionId) {
    return 'cowork'
  }

  const found = $sessions.get().find(session => sessionMatchesStoredId(session, storedSessionId))

  return modeOfSource(found?.source)
}

/** Şu an açık olan sohbetin kipi. */
export function activeMode(): ChatMode {
  return modeOfSession($selectedStoredSessionId.get())
}

/**
 * Kenar çubuğu SADELEŞSİN mi?
 *
 * Chat kipinde projeler, zamanlanmış işler, pinler ve filtreler gizleniyor;
 * geriye arama ve sohbet listesi kalıyor.
 *
 * Gizlenen bölümlerin DURUMU korunuyor (açık/kapalı, sıralama, filtreler):
 * Chat'e girip çıkmak kullanıcının düzenini sıfırlamamalı. O yüzden bu bir
 * görünürlük kapısı, bir sıfırlama değil.
 */
export const $chatSimpleSidebar = computed(
  [$selectedStoredSessionId, $sessions],
  (selected, sessions): boolean => {
    if (!selected) {
      return false
    }

    const found = sessions.find(session => sessionMatchesStoredId(session, selected))

    return modeOfSource(found?.source) === 'chat'
  }
)

/**
 * Bir oturumun kipini DEĞİŞTİR.
 *
 * Ağ geçidi canlı ajanı bırakıyor: araç kümesi değişince sistem promptu ve
 * onun üzerine kurulu önbellek geçersiz oluyor. Bedeli TEK bir tur -- değişimden
 * sonraki ilk cevap önbelleksiz geliyor. Arayüz bunu kullanıcıya soruyor.
 *
 * Yerel liste ÖNCE güncelleniyor: ağ geçidi cevabını beklemek, kullanıcının
 * onayladığı değişimin bir saniye boyunca ekranda görünmemesi demekti. Hata
 * olursa geri alınıyor.
 */
export async function setSessionMode(storedSessionId: string, mode: ChatMode): Promise<void> {
  const source = mode === 'chat' ? CHAT_SOURCE : COWORK_SOURCE
  const previous = $sessions.get().find(session => sessionMatchesStoredId(session, storedSessionId))?.source ?? null

  const write = (value: null | string) =>
    setSessions(sessions =>
      sessions.map(session => (sessionMatchesStoredId(session, storedSessionId) ? { ...session, source: value } : session))
    )

  write(source)

  try {
    let gateway = activeGateway()

    if (!gateway || gateway.connectionState !== 'open') {
      gateway = await ensureActiveGatewayOpen()
    }

    if (!gateway) {
      throw new Error('The Fool gateway is not connected')
    }

    await gateway.request('session.mode', { mode, session_key: storedSessionId })
  } catch (error) {
    // GERİ AL: kip değişmediği hâlde değişmiş görünmek, kullanıcının Chat
    // sandığı bir sohbette modele terminal vermek olurdu.
    write(previous)

    throw error
  }
}
