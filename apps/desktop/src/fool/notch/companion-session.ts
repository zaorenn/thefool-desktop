/**
 * Sesli arkadaşın KENDİ oturumu.
 *
 * Ölçülen durum
 * -------------
 * Notch bugüne kadar ``$activeSessionId`` kullanıyordu -- yani masaüstü sohbet
 * panelinin oturumu. O oturum ``desktop`` kapsamında kuruluyor ve ölçüldü
 * (``tui_gateway.server._load_enabled_toolsets``):
 *
 *     desktop     21 takım, 73 araç, 8 tanesi makineye dokunuyor
 *     companion    6 takım,  7 araç, 0 tanesi
 *
 * Yani "hava nasıl?" diyen sesli arkadaş ``terminal_run``, ``computer_use``,
 * ``execute_code`` ve ``delegate_task``a sahipti. Sesli sohbette yanlış
 * anlaşılma sık ve normal; bedeli silinmiş bir dosya olmamalı.
 *
 * İkinci kazanç bağlam: sesli sohbet artık ajanın üzerinde çalıştığı oturumun
 * geçmişine karışmıyor.
 *
 * Neden ayrı OTURUM, tur başına kısıtlama değil
 * ---------------------------------------------
 * Araç kümesi ajan kurulurken donuyor ve prompt önbelleği donmuş sistem
 * promptu + araç şemaları üzerine kurulu. Tur başına değiştirmek ajanı her
 * turda yeniden kurmak ve önbelleği çöpe atmak demekti.
 *
 * Zone A: upstream bu dosyayı bilmiyor.
 */

/** Ağ geçidinin bu kaynağı gördüğünde uyguladığı kapsam adı. */
export const COMPANION_SOURCE = 'companion'

export interface CompanionSessionDeps {
  /** ``session.create`` çağrısı. */
  create: (params: Record<string, unknown>) => Promise<{ session_id?: string }>
  /** Şu anki çalışma dizini (oturum onunla açılıyor). */
  cwd?: string
  /**
   * Oturumun KAPSAMI. Sesli kip bunu belirliyor: arkadaş ``companion``
   * (kısıtlı), Jarvis ``desktop`` (sahibinin tam yüzeyi).
   *
   * Kapsam oturum açılışında donuyor -- araç kümesi ajan kurulurken
   * belirleniyor ve prompt önbelleği ona bağlı.
   */
  source?: string
}

export interface CompanionSessionState {
  id: null | string
  /** Süren oluşturma -- iki eşzamanlı istek iki oturum açmasın. */
  pending: null | Promise<null | string>
  /** Açık oturumun kapsamı. Kip değişince oturum YENİLENMELİ. */
  source: null | string
}

export const createCompanionSessionState = (): CompanionSessionState => ({
  id: null,
  pending: null,
  source: null
})

/**
 * Arkadaş oturumunu getir; yoksa aç.
 *
 * Aynı anda gelen iki çağrı TEK oturum açar: ``session.create`` saniyeler
 * sürebiliyor (sunucu tarafında ajan + MCP kurulumu) ve kullanıcı o sırada
 * konuşmaya başlarsa ikinci bir çağrı gelir. İki oturum açmak, ikinci
 * cümlenin birincinin bağlamını görmemesi demekti.
 */
export async function ensureCompanionSession(
  state: CompanionSessionState,
  deps: CompanionSessionDeps
): Promise<null | string> {
  const wanted = deps.source ?? COMPANION_SOURCE

  // Kip degistiyse ESKI oturum kullanilamaz: kapsami ajan kurulurken dondu ve
  // arkadas oturumunda terminal yok, Jarvis oturumunda kisit yok. Eskisini
  // kullanmaya devam etmek, kullanicinin sectigi kipi sessizce yok saymakti.
  if (state.id && state.source === wanted) {
    return state.id
  }

  if (state.id && state.source !== wanted) {
    state.id = null
    state.source = null
  }

  if (state.pending) {
    return state.pending
  }

  const pending = (async () => {
    try {
      const created = await deps.create({
        cwd: deps.cwd ?? '',
        source: wanted
      })

      const id = created.session_id ?? null

      state.id = id
      state.source = id ? wanted : null

      return id
    } catch {
      // Oturum acilamadiysa cagiran taraf eski davranisa (paylasilan oturum)
      // dusuyor: sesli sohbetin HIC calismamasi, kisitlanmamis calismasindan
      // daha kotu bir sonuc.
      return null
    } finally {
      state.pending = null
    }
  })()

  state.pending = pending

  return pending
}

/** Oturum kapandı (kısayol ya da uygulama kapanışı) -- kimliği unut. */
export function forgetCompanionSession(state: CompanionSessionState): void {
  state.id = null
  state.source = null
}
