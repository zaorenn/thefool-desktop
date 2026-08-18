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
  /** Su an SECILI olan saglayici mi? */
  active: boolean
  /** Calisma aygiti: auto | cpu | cuda. */
  device: 'auto' | 'cpu' | 'cuda'
  /** Secili ses kimligi. */
  voice: string
  /** Bu motorun secilebilir sesleri. */
  voices: { id: string; label: string }[]
  /** Bu motor ses klonlamayi destekliyor mu? */
  clone_capable: boolean
  /** Secili klon dosyasinin adi ("" = kapali). */
  clone: string
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

export interface VoiceClone {
  bytes: number
  id: string
  label: string
  path: string
}

export interface VoiceCatalog {
  active: { stt: string; tts: string }
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
  job: (jobId: string) => call<VoiceJob>(`/api/fool/voice/job/${jobId}`),
  select: (entryId: string) => call<{ ok: boolean }>('/api/fool/voice/select', { entry_id: entryId }),
  setDevice: (entryId: string, device: 'auto' | 'cpu' | 'cuda') =>
    call<{ ok: boolean }>('/api/fool/voice/device', { device, entry_id: entryId }),
  setVoice: (entryId: string, voice: string) =>
    call<{ ok: boolean }>('/api/fool/voice/voice', { entry_id: entryId, voice }),
  clones: () => call<{ clones: VoiceClone[] }>('/api/fool/voice/clones'),
  uploadClone: (filename: string, dataBase64: string) =>
    call<{ id: string; label: string }>('/api/fool/voice/clones/upload', {
      data_base64: dataBase64,
      filename
    }),
  selectClone: (entryId: string, cloneId: string) =>
    call<{ ok: boolean }>('/api/fool/voice/clones/select', { clone_id: cloneId, entry_id: entryId }),
  deleteClone: (cloneId: string) =>
    call<{ ok: boolean }>('/api/fool/voice/clones/delete', { clone_id: cloneId })
}
