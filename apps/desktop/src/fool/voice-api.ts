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

async function call<T>(path: string, body?: unknown): Promise<T> {
  // Masaustu KOPRUSU uzerinden -- ham ``fetch`` DEGIL.
  //
  // Ilk yazimda ``fetch(conn.baseUrl + path)`` kullanildi ve panel her zaman
  // bos geldi: istek sessizce basarisiz oluyordu (koken/kimlik dogrulama
  // renderer'dan cozulemiyor). Uygulamanin geri kalani zaten bu koprudan
  // geciyor; ayri bir yol acmak, calisan tek yolu atlamak demekti.
  const desktop = window.hermesDesktop

  if (!desktop?.api) {
    throw new Error('Masaüstü köprüsü yok')
  }

  return desktop.api<T>({
    ...(body === undefined ? {} : { body }),
    method: body === undefined ? 'GET' : 'POST',
    path,
    // Kurulum baslatma cagrisi ag gecidinde is nesnesi yaratana kadar
    // bekliyor; varsayilan 15 sn kisa kalabiliyor.
    timeoutMs: 60_000
  })
}

export const voiceApi = {
  cancel: (jobId: string) => call<{ cancelled: boolean }>('/api/fool/voice/cancel', { job_id: jobId }),
  catalog: () => call<VoiceCatalog>('/api/fool/voice/catalog'),
  install: (entryId: string, device: 'cpu' | 'cuda') =>
    call<VoiceJob>('/api/fool/voice/install', { device, entry_id: entryId }),
  job: (jobId: string) => call<VoiceJob>(`/api/fool/voice/job/${jobId}`)
}
