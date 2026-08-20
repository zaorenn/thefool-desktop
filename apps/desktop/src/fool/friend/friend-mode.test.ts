/**
 * Kip seçiminin tehlikeli tarafı: yanlış kip SESSİZCE makineye erişim verir.
 *
 * Testlerin çoğu o yönü tutuyor -- bozuk/eksik girdinin Jarvis'e düşmemesi.
 */

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_FRIEND_MODE,
  FRIEND_MODES,
  friendModeInfo,
  friendModeSource,
  sanitizeFriendMode
} from './friend-mode'

describe('friend mode', () => {
  it('varsayilan ARKADAS -- makineye dokunamaz', () => {
    expect(DEFAULT_FRIEND_MODE).toBe('friend')
    expect(FRIEND_MODES[DEFAULT_FRIEND_MODE].touchesMachine).toBe(false)
  })

  it('arkadas kipi ``friend`` kaynagini kullaniyor, ``companion`` DEGIL', () => {
    // ``companion`` hafizasiz; Friend penceresi bilerek hafizayi paylasiyor.
    expect(friendModeSource('friend')).toBe('friend')
  })

  it('Jarvis tam yuzeyi aliyor', () => {
    expect(friendModeSource('jarvis')).toBe('desktop')
    expect(FRIEND_MODES.jarvis.touchesMachine).toBe(true)
  })

  it.each([undefined, null, '', 'JARVIS ', 'desktop', 42, {}, 'companion'])(
    'taninmayan girdi (%o) arkadas kipine dusuyor',
    raw => {
      expect(sanitizeFriendMode(raw)).toBe('friend')
      expect(friendModeInfo(raw).touchesMachine).toBe(false)
    }
  )

  it('gecerli kip AYNEN korunuyor', () => {
    expect(sanitizeFriendMode('jarvis')).toBe('jarvis')
    expect(sanitizeFriendMode('friend')).toBe('friend')
  })

  it('her kipin kullaniciya gorunen bir aciklamasi var', () => {
    // Kullanici makineye erisim verdigini GORMELI.
    for (const mode of Object.values(FRIEND_MODES)) {
      expect(mode.label.length).toBeGreaterThan(0)
      expect(mode.summary.length).toBeGreaterThan(10)
    }
  })
})
