/**
 * Bas-konuş tuş mantığının testleri.
 *
 * Buradaki her test bir SESSIZ hatayı karşılıyor: kaçırılan bir ``keyup``
 * mikrofonu açık bırakır, kullanıcı bıraktığını sanır ve kaydedilen her şey bir
 * sonraki mesaja karışır. Hiçbiri görünür bir hata vermez.
 */

import { describe, expect, it } from 'vitest'

import {
  createPushToTalkState,
  isHolding,
  MIN_HOLD_MS,
  onBlur,
  onKeyDown,
  onKeyUp,
  PUSH_TO_TALK_CODE
} from './push-to-talk'

describe('bas-konuş', () => {
  it('basılı tut ve bırak kaydı gönderir', () => {
    const state = createPushToTalkState()

    expect(onKeyDown(state, { code: PUSH_TO_TALK_CODE }, 1000)).toEqual({ type: 'start' })
    expect(isHolding(state)).toBe(true)
    expect(onKeyUp(state, { code: PUSH_TO_TALK_CODE }, 1000 + MIN_HOLD_MS + 50)).toEqual({
      heldMs: MIN_HOLD_MS + 50,
      type: 'commit'
    })
    expect(isHolding(state)).toBe(false)
  })

  it('başka tuşa aldırmaz', () => {
    const state = createPushToTalkState()

    expect(onKeyDown(state, { code: 'ControlLeft' }, 0)).toBeNull()
    expect(onKeyDown(state, { code: 'Space' }, 0)).toBeNull()
    expect(isHolding(state)).toBe(false)
  })

  it('tuş TEKRARI yeni kayıt başlatmaz', () => {
    // Basılı tutuş art arda keydown üretiyor. Her biri kaydı sıfırlasaydı
    // kullanıcının ilk hecesi kaybolurdu.
    const state = createPushToTalkState()

    expect(onKeyDown(state, { code: PUSH_TO_TALK_CODE }, 0)).toEqual({ type: 'start' })
    expect(onKeyDown(state, { code: PUSH_TO_TALK_CODE, repeat: true }, 50)).toBeNull()
    expect(onKeyDown(state, { code: PUSH_TO_TALK_CODE, repeat: true }, 100)).toBeNull()

    // Süre İLK basıştan sayılmalı, son tekrardan değil.
    expect(onKeyUp(state, { code: PUSH_TO_TALK_CODE }, 500)).toEqual({ heldMs: 500, type: 'commit' })
  })

  it('çok kısa basış gönderilmez', () => {
    // Yanlışlıkla dokunma boş bir kayıt gönderirdi; ajan da boşluğa cevap
    // vermeye çalışırdı.
    const state = createPushToTalkState()

    onKeyDown(state, { code: PUSH_TO_TALK_CODE }, 0)

    expect(onKeyUp(state, { code: PUSH_TO_TALK_CODE }, MIN_HOLD_MS - 1)).toEqual({
      reason: 'too-short',
      type: 'cancel'
    })
  })

  it('odak kaybı bırakma sayılır', () => {
    // Alt-Tab basılıyken tuş bırakılırsa keyup BİZE gelmez; o olay odağı alan
    // uygulamaya gider. Basılı saymaya devam etmek mikrofonu sonsuza kadar
    // açık bırakırdı.
    const state = createPushToTalkState()

    onKeyDown(state, { code: PUSH_TO_TALK_CODE }, 0)
    expect(onBlur(state)).toEqual({ reason: 'blur', type: 'cancel' })
    expect(isHolding(state)).toBe(false)
  })

  it('basılı değilken blur hiçbir şey yapmaz', () => {
    const state = createPushToTalkState()

    expect(onBlur(state)).toBeNull()
  })

  it('basılmadan gelen keyup yok sayılır', () => {
    // Notch odağı BASILIYKEN alırsa yalnızca keyup görür; bu bir kayıt
    // olmadığı icin gönderilecek bir şey de yok.
    const state = createPushToTalkState()

    expect(onKeyUp(state, { code: PUSH_TO_TALK_CODE }, 1000)).toBeNull()
  })

  it('iptalden sonra yeniden basılabilir', () => {
    const state = createPushToTalkState()

    onKeyDown(state, { code: PUSH_TO_TALK_CODE }, 0)
    onBlur(state)

    expect(onKeyDown(state, { code: PUSH_TO_TALK_CODE }, 100)).toEqual({ type: 'start' })
    expect(onKeyUp(state, { code: PUSH_TO_TALK_CODE }, 100 + MIN_HOLD_MS + 1)).toMatchObject({
      type: 'commit'
    })
  })

  it('özel tuş kodu ile çalışır', () => {
    const state = createPushToTalkState()

    expect(onKeyDown(state, { code: 'F13' }, 0, 'F13')).toEqual({ type: 'start' })
    expect(onKeyUp(state, { code: 'F13' }, MIN_HOLD_MS + 1, 'F13')).toMatchObject({ type: 'commit' })
  })
})
