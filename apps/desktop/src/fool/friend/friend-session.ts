/**
 * Sesli oturumun KİMLİĞİ — pencere kapanınca kaybolmasın.
 *
 * Ölçülen hata
 * ------------
 * Oturum kimliği ``useRef`` içinde tutuluyordu, yani yalnızca bileşen yaşadığı
 * sürece. Üstüne ``stop()`` her çağrıldığında ``forgetCompanionSession`` ile
 * SİLİNİYORDU -- ve ``stop()`` mikrofonla ilgili her şeyde çağrılıyor:
 *
 *   * sayfadan çıkınca (``friend-view.tsx`` unmount)
 *   * sessize alınca (``toggle``)
 *   * eller serbest → bas-konuş geçince (``listenMode`` etkisi)
 *
 * Yani mikrofonu susturmak arkadaşın hafızasını siliyordu. Kullanıcının kendi
 * ``state.db``sinde ölçüldü:
 *
 *     kaynak     oturum   ortalama mesaj
 *     cli            33            24,6
 *     desktop         8            28,3
 *     friend         14             4,6   <- altı kat parçalı
 *
 * 14 Friend oturumunun 7'si ≤2 mesajlık (tek tur), 2'si SIFIR mesajlı --
 * açılmış ama hiç cevap alınmamış. Üçü altı saniye arayla açılmış.
 *
 * Bedeli yalnızca hafıza değil: her yeni oturum sunucuda ajan + MCP kurulumu
 * demek ve donmuş sistem promptu üzerine kurulu prompt önbelleğini çöpe atmak
 * demek. Kullanıcı bunu "çok düşünüyor" ve "cevap bile vermiyor" diye
 * bildirdi.
 *
 * Kapsam başına AYRI kimlik
 * -------------------------
 * Araç kümesi ajan kurulurken donuyor, yani Friend oturumu Jarvis oturumu
 * olamaz. İkisinin kimliği ayrı saklanıyor ve kip değişince doğru olan
 * sürdürülüyor -- eskiden kip değişimi tek kimliği çöpe atıyordu, geri
 * dönünce sohbet gitmiş oluyordu.
 *
 * Zone A: upstream bu dosyayı bilmiyor.
 */

import { sharedAtom } from '../cross-window-atom'

/** Kapsam adı → oturum kimliği. Kapsam ``friend`` ya da ``desktop``. */
export type FriendSessionMap = Record<string, string>

/**
 * ``sharedAtom``, ``persistentAtom`` DEĞİL.
 *
 * Notch ile Friend penceresi AYRI ``BrowserWindow``lar ve düz bir kalıcı atom
 * yalnızca YAZIYOR, diğer pencerenin yazdığını hiç duymuyor. Aynı hata daha
 * önce bas-konuş bağlamasında yaşandı: depo ``KeyQ``, notch ``ControlRight``.
 * Burada bedeli daha ağır olurdu -- notch bir oturumu sürdürürken Friend
 * penceresi başkasını açar ve kullanıcı iki ayrı hafızayla konuşurdu.
 */
export const $friendSessions = sharedAtom<FriendSessionMap>(
  'fool.desktop.friend.sessions',
  {},
  {
    decode: raw => {
      const parsed = JSON.parse(raw) as unknown

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {}
      }

      // Yalnızca dize değerler: bozuk bir kayıt yüzünden sesli yüzeyin hiç
      // açılmaması, oturumu kaybetmekten daha kötü olurdu.
      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0
        )
      )
    },
    encode: value => JSON.stringify(value)
  }
)

/** Bu kapsamda sürdürülecek oturum ("" = yok). */
export function readFriendSession(source: string): string {
  return $friendSessions.get()[source] ?? ''
}

/** Kimliği sakla; boş değer kaydı SİLER. */
export function writeFriendSession(source: string, sessionId: string): void {
  const current = $friendSessions.get()

  if (!sessionId) {
    if (!(source in current)) {
      return
    }

    const { [source]: _dropped, ...rest } = current

    $friendSessions.set(rest)

    return
  }

  if (current[source] === sessionId) {
    return
  }

  $friendSessions.set({ ...current, [source]: sessionId })
}

/**
 * Kalıcı depoyu ``ensureCompanionSession``a geçirilebilir biçime sok.
 *
 * Bağımlılık olarak geçiriliyor, doğrudan içeriden okunmuyor: oturum mantığı
 * saf kalınca sınanabiliyor (deponun kendisi ``localStorage``a dokunuyor).
 */
export const friendSessionStore = {
  read: readFriendSession,
  write: writeFriendSession
}
