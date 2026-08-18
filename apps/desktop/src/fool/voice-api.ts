/**
 * Ses modeli uçlarına HTTP istemcisi.
 *
 * Neden RPC değil de HTTP
 * -----------------------
 * Masaüstünün geri kalanı ağ geçidiyle WebSocket RPC üzerinden konuşuyor.
 * Kurulum işi buna uymuyor: dakikalarca sürüyor ve panel bu sırada kapanıp
 * açılabiliyor. Durum sunucuda bir iş nesnesinde durduğu için basit bir HTTP
 * yoklaması, paneli yeniden açan kullanıcıya süren kurulumu olduğu gibi
 * gösterir — soket kopsa bile ilerleme kaybolmaz.
 *
 * Zone A: upstream bu dosyayı bilmiyor.
 */

import { $connection } from '@/store/session'

export interface VoiceJob {
  detail: string
  device: 'cpu' | 'cuda'
  elapsed: number
  entry_id: string
  error: string
  id: string
  percent: number
  stage: string
  state: 'running' | 'done' | 'failed' | 'cancelled'
}

export interface VoiceItem {
  assets_installed: boolean
  cuda_available: boolean
  devices: ('cpu' | 'cuda')[]
  engine_installed: boolean
  id: string
  installed: boolean
  job: VoiceJob | null
  kind: 'tts' | 'stt'
  label: string
  recommended: boolean
  size_label: string
  summary: string
}

export interface VoiceCatalog {
  cuda_available: boolean
  items: VoiceItem[]
  voice_dir: string
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const conn = $connection.get()

  if (!conn?.baseUrl) {
    throw new Error('Ağ geçidi bağlı değil')
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  // Başlık adında BOŞLUK OLAMAZ. Bu daha önce `X-The Fool-Session-Token`
  // olarak markalanmıştı ve geçersiz bir HTTP başlığı ürettiği için kimlik
  // doğrulama sessizce reddediliyordu — hata mesajı da vermiyordu.
  if (conn.token) {
    headers['X-Fool-Session-Token'] = conn.token
  }

  const response = await fetch(`${conn.baseUrl}${path}`, { ...init, headers })

  if (!response.ok) {
    const body = await response.text().catch(() => '')

    throw new Error(body || `${response.status} ${response.statusText}`)
  }

  return (await response.json()) as T
}

export const voiceApi = {
  cancel: (jobId: string) =>
    call<{ cancelled: boolean }>('/api/fool/voice/cancel', {
      body: JSON.stringify({ job_id: jobId }),
      method: 'POST'
    }),
  catalog: () => call<VoiceCatalog>('/api/fool/voice/catalog'),
  install: (entryId: string, device: 'cpu' | 'cuda') =>
    call<VoiceJob>('/api/fool/voice/install', {
      body: JSON.stringify({ device, entry_id: entryId }),
      method: 'POST'
    }),
  job: (jobId: string) => call<VoiceJob>(`/api/fool/voice/job/${jobId}`)
}
