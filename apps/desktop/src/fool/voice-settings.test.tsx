/**
 * Ses ayarları panelinin davranış testleri.
 *
 * Sınanan şey görünüm değil, kullanıcının gerçekten yaşadığı akış: kurulu olan
 * öğe "Installed" der, olmayan indirilebilir, süren bir kurulum panel yeniden
 * açıldığında kaldığı yerden görünür ve CUDA düğmesi kart yokken ÇIKMAZ.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { VoiceCatalog, VoiceItem, VoiceJob } from './voice-api'

const catalog = vi.fn()
const install = vi.fn()
const job = vi.fn()

vi.mock('./voice-api', () => ({
  voiceApi: {
    cancel: (...args: unknown[]) => Promise.resolve({ cancelled: true }),
    catalog: (...args: unknown[]) => catalog(...args),
    install: (...args: unknown[]) => install(...args),
    job: (...args: unknown[]) => job(...args),
    setDevice: (...args: unknown[]) => Promise.resolve({ ok: true }),
    setVoice: (...args: unknown[]) => Promise.resolve({ ok: true }),
    select: (...args: unknown[]) => Promise.resolve({ ok: true })
  }
}))

const notifyError = vi.fn()

vi.mock('@/store/notifications', () => ({
  notifyError: (...args: unknown[]) => notifyError(...args)
}))

const { VoiceSettings } = await import('./voice-settings')

function item(overrides: Partial<VoiceItem> = {}): VoiceItem {
  return {
    active: false,
    device: 'auto',
    voice: '',
    voices: [],
    assets_installed: true,
    cuda_available: false,
    devices: ['cpu'],
    engine_installed: true,
    id: 'piper',
    installed: true,
    job: null,
    kind: 'tts',
    label: 'Piper',
    recommended: false,
    size_label: '~63 MB',
    summary: 'Fast and fully local.',
    ...overrides
  }
}

function reply(items: VoiceItem[], cudaAvailable = false): VoiceCatalog {
  return { active: { stt: '', tts: '' }, cuda_available: cudaAvailable, items, voice_dir: 'C:\\fool\\voices' }
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(cleanup)

describe('VoiceSettings', () => {
  it('AKTIF ogeyi "In use" olarak gosterir', async () => {
    catalog.mockResolvedValue(reply([item({ active: true })]))

    render(<VoiceSettings />)

    expect(await screen.findByText('In use')).toBeTruthy()
  })

  it('kurulu ama aktif OLMAYAN oge secilebilir', async () => {
    // Dort model de kurulu oldugunda hangisinin konustugu belirsizdi;
    // "Use" dugmesi o secimi mumkun kiliyor.
    catalog.mockResolvedValue(reply([item({ active: false })]))

    render(<VoiceSettings />)

    expect(await screen.findByText('Use')).toBeTruthy()
    expect(screen.queryByText('In use')).toBeNull()
  })

  it('kurulu OLMAYAN oge icin CPU dugmesi cikarir', async () => {
    catalog.mockResolvedValue(reply([item({ engine_installed: false, installed: false })]))

    render(<VoiceSettings />)

    expect(await screen.findByText('CPU')).toBeTruthy()
    expect(screen.queryByText('In use')).toBeNull()
  })

  it('CUDA dugmesi kart YOKKEN cikmaz', async () => {
    // Sunmak, sessizce CPU'ya dusen bir kurulum demekti ve kullanici neden
    // yavas oldugunu anlamiyordu.
    catalog.mockResolvedValue(
      reply([item({ cuda_available: false, devices: ['cpu', 'cuda'], installed: false })])
    )

    render(<VoiceSettings />)

    await screen.findByText('CPU')
    expect(screen.queryByText('CUDA')).toBeNull()
  })

  it('CUDA dugmesi kart VARKEN cikar', async () => {
    catalog.mockResolvedValue(
      reply([item({ cuda_available: true, devices: ['cpu', 'cuda'], installed: false })], true)
    )

    render(<VoiceSettings />)

    expect(await screen.findByText('CUDA')).toBeTruthy()
  })

  it('sunucuda SUREN kurulumu panel acilir acilmaz gosterir', async () => {
    // Panel kapatilip acildiginda cubuk sifirlanmamali: is sunucuda duruyor.
    const running: VoiceJob = {
      detail: '12 / 63 MB',
      device: 'cpu',
      elapsed: 4,
      entry_id: 'piper',
      error: '',
      id: 'j1',
      percent: 41,
      stage: 'downloading voice model',
      state: 'running'
    }

    catalog.mockResolvedValue(reply([item({ installed: false, job: running })]))
    job.mockResolvedValue(running)

    render(<VoiceSettings />)

    expect(await screen.findByText(/downloading voice model/)).toBeTruthy()
    expect(screen.getByText('41%')).toBeTruthy()
    expect(screen.getByText('Installing…')).toBeTruthy()
  })

  it('basarisiz kurulumun HATASINI gosterir', async () => {
    // Sessiz basarisizlik en kotusu: kullanici neden calismadigini bilemez.
    catalog.mockResolvedValue(
      reply([
        item({
          installed: false,
          job: {
            detail: '',
            device: 'cpu',
            elapsed: 3,
            entry_id: 'piper',
            error: 'pip failed: no matching distribution',
            id: 'j2',
            percent: 12,
            stage: 'failed',
            state: 'failed'
          }
        })
      ])
    )

    render(<VoiceSettings />)

    expect(await screen.findByText(/pip failed/)).toBeTruthy()
  })

  it('katalog cekilemezse kullaniciya bildirir', async () => {
    catalog.mockRejectedValue(new Error('gateway down'))

    render(<VoiceSettings />)

    await waitFor(() => {
      expect(notifyError).toHaveBeenCalled()
    })
  })

  it('TTS ve STT ayri bolumlerde listelenir', async () => {
    catalog.mockResolvedValue(
      reply([item(), item({ id: 'faster-whisper', kind: 'stt', label: 'Faster-Whisper' })])
    )

    render(<VoiceSettings />)

    expect(await screen.findByText('Text to speech')).toBeTruthy()
    expect(screen.getByText('Speech to text')).toBeTruthy()
    expect(screen.getByText('Faster-Whisper')).toBeTruthy()
  })
})
