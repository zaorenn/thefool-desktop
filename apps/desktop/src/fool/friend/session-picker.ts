/**
 * Hangi sohbetle devam edileceğinin saf mantığı.
 *
 * Neden ayrı dosya
 * ----------------
 * Buradaki asıl karar görsel değil: bir oturumun KAPSAMI oluşturulurken
 * donuyor (``fool/session_scope.py``). Yani ``desktop`` kaynaklı bir oturumu
 * sürdürmek, pencerede "Friend" yazsa bile terminali olan bir ajanı sürdürmek
 * demek. Panelin bir şey gösterip başka bir şey yapması, sesin kendisinde
 * yaşanan hatanın aynısı olurdu.
 *
 * Çözüm: seçilen oturum KİPİ de belirliyor. Tek hakikat oturumun kendisi.
 *
 * Zone A: upstream bu dosyayı bilmiyor.
 */

import type { FriendModeId } from './friend-mode'

export interface SessionSummary {
  id: string
  message_count: number
  preview: string
  source: string
  started_at: number
  title: string
}

/** Kapsamı ARAÇSIZ olan kaynaklar -- bunlar arkadaş kipine karşılık geliyor. */
const COMPANION_SOURCES = new Set(['companion', 'friend'])

/**
 * Bu oturumu sürdürmek hangi kipe karşılık geliyor?
 *
 * ``desktop``, ``cli``, ``tui`` ve tanımadığımız her kaynak Jarvis: kapsam
 * kısıtlanmamış demek. Kapalı taraf güvenli taraf DEĞİL burada -- tersi:
 * araçlı bir oturumu "Friend" diye göstermek, kullanıcıya makineye
 * dokunamayacağını söylemek olurdu.
 */
export function modeForSession(session: SessionSummary): FriendModeId {
  return COMPANION_SOURCES.has((session.source || '').trim().toLowerCase()) ? 'friend' : 'jarvis'
}

/** Bu oturum makineye dokunabiliyor mu? Listede AÇIKÇA gösteriliyor. */
export function touchesMachine(session: SessionSummary): boolean {
  return modeForSession(session) === 'jarvis'
}

/**
 * Listede gösterilecek ad.
 *
 * Başlık yoksa önizleme, o da yoksa kimlik. Boş bir satır göstermek,
 * kullanıcının hangi sohbeti seçtiğini bilememesi demek.
 */
export function sessionLabel(session: SessionSummary): string {
  const title = (session.title || '').trim()

  if (title) {
    return title
  }

  const preview = (session.preview || '').trim().replace(/\s+/g, ' ')

  if (preview) {
    return preview.length > 60 ? `${preview.slice(0, 59)}…` : preview
  }

  return session.id
}

/**
 * Sürdürülmeye DEĞER oturumlar.
 *
 * Boş oturumlar eleniyor: kullanıcının deposunda sıfır mesajlı iki Friend
 * oturumu vardı (açılmış, hiç cevap alınmamış) ve bunları listelemek,
 * kullanıcıya boş bir sohbeti "devam ettir" diye sunmak olurdu.
 *
 * Sıralama son etkinliğe göre değil BAŞLANGICA göre gelmiyor -- sunucu zaten
 * son etkinliğe göre sıralı gönderiyor; burada yalnızca eleme var, çünkü
 * yeniden sıralamak sunucunun bildiği şeyi tahmin etmek olurdu.
 */
export function resumableSessions(sessions: SessionSummary[], limit = 12): SessionSummary[] {
  return sessions.filter(session => (session.message_count || 0) > 0).slice(0, limit)
}
