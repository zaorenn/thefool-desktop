/**
 * Friend penceresinde İKİ kip: arkadaş ve Jarvis.
 *
 * Neden ayrı bir depo
 * -------------------
 * ``fool/voice-mode.ts`` notch içindi ve orada arkadaş kipi ``companion``
 * kaynağını kullanıyor -- HAFIZASIZ (bkz. ``fool/session_scope.py``:
 * ``COMPANION_TOOLSETS`` içinde ``memory`` yok). Friend penceresi ise
 * bilerek hafızayı paylaşıyor; ``companion`` kaynağını buraya taşımak
 * pencerenin varlık sebebini sessizce geri alırdı.
 *
 * Kip OTURUM açılışında donuyor: araç kümesi ajan kurulurken belirleniyor ve
 * prompt önbelleği donmuş sistem promptu + araç şemaları üzerine kurulu.
 * Bu yüzden kip değişince ``ensureCompanionSession`` eski oturumu bırakıp
 * yenisini açıyor -- tur ortasında değiştirmek her turda ajanı yeniden
 * kurmak olurdu.
 *
 * Zone A: upstream bu dosyayı bilmiyor.
 */

import { persistentAtom } from '@/lib/persisted'

export type FriendModeId = 'friend' | 'jarvis'

export interface FriendModeInfo {
  id: FriendModeId
  /** Kullanıcıya görünen ad (İngilizce -- deponun kuralı). */
  label: string
  summary: string
  /** Oturum bu ``source`` ile açılıyor; ağ geçidi kapsamı ondan çıkarıyor. */
  source: string
  /** Makineye dokunabiliyor mu? Arayüzde uyarı göstermek için. */
  touchesMachine: boolean
}

export const FRIEND_MODES: Record<FriendModeId, FriendModeInfo> = {
  friend: {
    id: 'friend',
    label: 'Friend',
    // ``friend`` kapsami: arac yok ama hafiza ajanla ORTAK.
    source: 'friend',
    summary: 'Just talk. No terminal, no files — it cannot touch the machine.',
    touchesMachine: false
  },
  jarvis: {
    id: 'jarvis',
    label: 'Jarvis',
    // ``desktop``: sahibinin tam yuzeyi. ``scope_toolsets`` bunu
    // kisitlamiyor -- kisit tool-calling sinavinda
    // (bkz. ``fool/agent_authority.py``).
    source: 'desktop',
    summary: 'Gets things done: terminal, files, code. Asks before anything destructive.',
    touchesMachine: true
  }
}

/**
 * Varsayılan ARKADAŞ.
 *
 * Sesli bir yüzey varsayılan olarak makineye dokunamamalı. Sesli sohbette
 * yanlış anlaşılma sık ve normal; bedeli boşa giden bir tur olmalı, silinen
 * bir dosya değil. Jarvis bilerek seçiliyor.
 */
export const DEFAULT_FRIEND_MODE: FriendModeId = 'friend'

const isFriendModeId = (value: unknown): value is FriendModeId =>
  typeof value === 'string' && value in FRIEND_MODES

/** Tanınmayan her şey arkadaş kipine düşüyor -- kapalı taraf güvenli taraf. */
export const sanitizeFriendMode = (raw: unknown): FriendModeId =>
  isFriendModeId(raw) ? raw : DEFAULT_FRIEND_MODE

/** Seçili kip. Kalıcı: kullanıcı her açılışta yeniden seçmek zorunda değil. */
export const $friendMode = persistentAtom<FriendModeId>(
  'fool.desktop.friend.mode',
  DEFAULT_FRIEND_MODE,
  {
    decode: raw => sanitizeFriendMode(raw),
    encode: value => sanitizeFriendMode(value)
  }
)

export const friendModeInfo = (id: unknown): FriendModeInfo =>
  FRIEND_MODES[sanitizeFriendMode(id)]

/** Bu kiple açılacak oturum kaynağı. */
export const friendModeSource = (id: unknown): string => friendModeInfo(id).source
