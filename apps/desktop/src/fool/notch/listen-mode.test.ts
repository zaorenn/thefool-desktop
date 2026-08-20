import { describe, expect, it } from 'vitest'

import {
  $listenMode,
  DEFAULT_LISTEN_MODE,
  listenModeHint,
  sanitizeListenMode,
  toggleListenMode
} from './listen-mode'

describe('listen mode', () => {
  it('varsayilan ELLER SERBEST -- sesli arayuzun amaci bu', () => {
    expect(DEFAULT_LISTEN_MODE).toBe('hands-free')
  })

  it.each([undefined, null, '', 'HANDS-FREE', 'ptt', 7, {}])(
    'taninmayan girdi (%o) varsayilana dusuyor',
    raw => {
      expect(sanitizeListenMode(raw)).toBe('hands-free')
    }
  )

  it('gecerli kipler AYNEN korunuyor', () => {
    expect(sanitizeListenMode('push-to-talk')).toBe('push-to-talk')
    expect(sanitizeListenMode('hands-free')).toBe('hands-free')
  })

  it('cevirmek iki kipi degistiriyor', () => {
    $listenMode.set('hands-free')

    expect(toggleListenMode()).toBe('push-to-talk')
    expect($listenMode.get()).toBe('push-to-talk')
    expect(toggleListenMode()).toBe('hands-free')
  })

  it('ipucu HANGI kipte oldugunu ve ne olacagini soyluyor', () => {
    // Yalnizca kipi yazmak yetmezdi: kullanici dugmeye basinca ne olacagini
    // bilmeden basmaz.
    expect(listenModeHint('hands-free', 'Ctrl+Alt+V')).toContain('push-to-talk')
    expect(listenModeHint('push-to-talk', 'Ctrl+Alt+V')).toContain('hands-free')
    expect(listenModeHint('push-to-talk', 'Ctrl+Alt+V')).toContain('Ctrl+Alt+V')
  })
})
