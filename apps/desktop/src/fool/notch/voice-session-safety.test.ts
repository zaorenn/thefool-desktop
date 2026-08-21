/**
 * Ses artık KULLANICININ AÇIK SOHBETİNE gidiyor.
 *
 * Önce sesin kendi ``companion``/``friend`` kapsamı ve ayrı bir oturumu
 * vardı. Friend/Jarvis kipleri kullanıcının kararıyla kaldırıldı, o ayrım da
 * kalktı: mikrofon doğrudan açık sohbete konuşuyor, arada hiçbir şey yok.
 *
 * Bedeli açıkça yazılmalı ve bu sınav onu görünür tutuyor: ses artık sohbet
 * panelinin kapsamında koşuyor (``desktop`` -- terminal, dosya, kod dahil).
 * Kapsamı ayıran mekanizma kiplerdi.
 *
 * Sınav kaynağı okuyor: davranışı taklit etmek, dosyanın gerçekte ne yaptığını
 * değil taklidin ne yaptığını sınamak olurdu.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(join(import.meta.dirname, 'use-notch-voice.ts'), 'utf8')

/** Yorumlar hariç GERÇEK kod. */
function code(source: string): string {
  return source
    .split('\n')
    .filter(line => {
      const trimmed = line.trimStart()

      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*')
    })
    .join('\n')
}

describe('ses ACIK SOHBETE gidiyor', () => {
  it('aktif oturum kimligini kullaniyor', () => {
    expect(code(SOURCE).includes('$activeSessionId.get()')).toBe(true)
  })

  it('ARACI oturum makinesi KALMADI', () => {
    const body = code(SOURCE)

    expect(body.includes('ensureCompanionSession')).toBe(false)
    expect(body.includes('createCompanionSessionState')).toBe(false)
    expect(body.includes('friendSessionStore')).toBe(false)
  })

  it('oturum yoksa kullaniciya SOYLUYOR', () => {
    expect(/setError\(/.test(code(SOURCE))).toBe(true)
  })
})
