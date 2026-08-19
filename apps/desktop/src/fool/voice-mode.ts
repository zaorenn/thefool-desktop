/**
 * İki sesli kip: arkadaş ve Jarvis.
 *
 * Aynı sesli yüzeyden iki farklı şey isteniyor ve gereksinimleri çelişiyor:
 * arkadaş kipinde çoğu tur bir görev değil (kısa, sıcak, araçsız), Jarvis
 * kipinde gerçekten iş yapılıyor (terminal, dosya, kod). Tek kipte
 * birleştirmek ikisini de bozuyordu.
 *
 * Kip OTURUM açılışında belirleniyor
 * ----------------------------------
 * Araç kümesi ajan kurulurken donuyor ve prompt önbelleği donmuş sistem
 * promptu + araç şemaları üzerine kurulu. Kip değiştirmek yeni bir oturum
 * açmak demek; tur içinde değiştirmek her turda ajanı yeniden kurmak ve
 * önbelleği çöpe atmak olurdu.
 *
 * Sunucu tarafındaki karşılığı ``fool/voice_modes.py`` ve
 * ``fool/session_scope.py`` -- oturum ``source`` alanıyla kapsamını
 * seçiyor.
 *
 * Zone A: upstream bu dosyayı bilmiyor.
 */

import { persistentAtom } from '@/lib/persisted'

export type VoiceModeId = 'companion' | 'jarvis'

export interface VoiceModeInfo {
  id: VoiceModeId
  /** Kullanıcıya görünen ad (İngilizce -- uygulamanın varsayılan dili). */
  label: string
  summary: string
  /**
   * Oturum bu ``source`` ile açılıyor ve ağ geçidi kapsamı ondan çıkarıyor.
   *
   * ``companion`` -> kısıtlı takım (6 takım, 0 tanesi makineye dokunuyor)
   * ``desktop``   -> sahibinin tam yüzeyi (21 takım) -- Jarvis'in istediği
   */
  source: string
  /** Makineye dokunabiliyor mu? Arayüzde uyarı göstermek için. */
  touchesMachine: boolean
}

export const VOICE_MODES: Record<VoiceModeId, VoiceModeInfo> = {
  companion: {
    id: 'companion',
    label: 'Friend',
    source: 'companion',
    summary: 'Just talk. No tools, nothing to break — it cannot touch the machine.',
    touchesMachine: false
  },
  jarvis: {
    id: 'jarvis',
    label: 'Jarvis',
    source: 'desktop',
    summary:
      'Gets things done: terminal, files, code, browser. Confirms before anything destructive.',
    touchesMachine: true
  }
}

/**
 * Varsayılan ARKADAŞ.
 *
 * Sesli yüzey varsayılan olarak makineye dokunamamalı: kullanıcı Jarvis'i
 * bilerek seçmeli.
 */
export const DEFAULT_VOICE_MODE: VoiceModeId = 'companion'

const isVoiceModeId = (value: unknown): value is VoiceModeId =>
  typeof value === 'string' && value in VOICE_MODES

/** Tanınmayan her şey arkadaş kipine düşüyor -- kapalı taraf güvenli taraf. */
export const sanitizeVoiceMode = (raw: unknown): VoiceModeId =>
  isVoiceModeId(raw) ? raw : DEFAULT_VOICE_MODE

/**
 * Seçili kip. ``persistentAtom``: notch penceresi ile ayarlar paneli AYRI
 * pencereler ve ikisi de aynı kipi görmek zorunda.
 */
export const $voiceMode = persistentAtom<VoiceModeId>(
  'fool.desktop.voice.mode',
  DEFAULT_VOICE_MODE,
  {
    decode: raw => sanitizeVoiceMode(raw),
    encode: value => sanitizeVoiceMode(value)
  }
)

export const voiceModeInfo = (id: unknown): VoiceModeInfo => VOICE_MODES[sanitizeVoiceMode(id)]
