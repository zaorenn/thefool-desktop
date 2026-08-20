/**
 * Ses ayarları: yerel TTS/STT motorlarını uygulama içinden indir.
 *
 * Neden
 * -----
 * Upstream'de bu modeller "ilk kullanımda kendiliğinden iner". Pratikte
 * kullanıcı sesi açıyor, arka planda yüzlerce MB inmeye başlıyor ve arayüzde
 * hiçbir şey görünmüyor — sadece "çalışmıyor" gibi duruyor. Burada ne olduğu,
 * ne kadar kaldığı ve bittiği görülüyor.
 *
 * Çubuk dürüst: model dosyası inerken yüzde GERÇEK baytlardan geliyor. pip
 * aşamasında gerçek bir yüzde yok, o yüzden aşama adı yazılıyor ve çubuk
 * sonuna dayanmıyor (bkz. ``fool/voice_models.py``).
 *
 * Zone A: upstream bu dosyayı bilmiyor; birleştirmede çakışamaz.
 */

import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { ListRow, ListRowSkeleton, Pill, SettingsContent, SettingsSection } from '@/app/settings/primitives'
import { Button } from '@/components/ui/button'
import { triggerHaptic } from '@/lib/haptics'
import { Cpu, Download, Info, Keyboard, Mic, Play, Volume2, Zap } from '@/lib/icons'
import { notifyError } from '@/store/notifications'

import { DEFAULT_PTT_CODE, formatPttCode, isBindableCode } from './notch/ptt-binding'
import { $pttCode } from './notch/ptt-store'
import {
  DEFAULT_NOTCH_SHORTCUT,
  formatAccelerator,
  toAccelerator
} from './notch/shortcut-accelerator'
import { voiceApi, type VoiceCatalog, type VoiceClone, type VoiceItem, type VoiceJob } from './voice-api'

//: Süren bir kurulum varken yoklama aralığı. Saniyede bir, dakikalarca sürebilen
//: bir iş için fazlasıyla yeterli ve ağ geçidini meşgul etmiyor.
const POLL_MS = 1000

function ProgressBar({ job }: { job: VoiceJob }) {
  return (
    <div className="mt-2">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
          style={{ width: `${Math.max(job.percent, 2)}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[0.68rem] text-muted-foreground">
        <span>
          {job.stage}
          {job.detail ? ` — ${job.detail}` : ''}
        </span>
        <span className="font-mono">{job.percent.toFixed(0)}%</span>
      </div>
    </div>
  )
}

/**
 * Model başına dinleme düğmesi.
 *
 * Dört motor "kurulu" yazıyor ve kullanıcı hangisinin nasıl konuştuğunu
 * duymadan seçim yapıyordu. Ses seçmek kulakla yapılan bir iş.
 *
 * Asıl kazanç ölçüm: geçen süre de gösteriliyor. Bu depodaki en pahalı hata
 * sınıfı -- "cihaz cuda yazıyordu, motor CPU'da koşuyordu" -- tam burada
 * görünür oluyor. Kokoro CUDA'da 0,08 sn; CPU'da saniyeler. Bir düğmeye basıp
 * "3,4 s" görmek, panelin "CUDA" yazmasından daha inandırıcı bir kanıt.
 */
function PreviewButton({ item }: { item: VoiceItem }) {
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState<null | number>(null)

  const play = useCallback(async () => {
    setBusy(true)
    triggerHaptic()

    try {
      const result = await voiceApi.preview(item.id)

      setElapsed(result.elapsed_ms)
      // Ses ``data:`` URI olarak calindi: gecici dosya sunucuda zaten
      // siliniyor ve tarayiciya ikinci bir istek yaptirmak, motorun
      // sentezini bir kez daha tetikleme riski demekti.
      const audio = new Audio(`data:${result.mime};base64,${result.audio_base64}`)

      await audio.play()
    } catch (error) {
      notifyError(error, `Could not preview ${item.label}`)
    } finally {
      setBusy(false)
    }
  }, [item.id, item.label])

  if (!item.installed) {
    return null
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button disabled={busy} onClick={() => void play()} size="sm" variant="ghost">
        <Play className="size-3.5" />
        {busy ? 'Speaking…' : 'Listen'}
      </Button>
      {elapsed !== null && (
        <span className="text-[0.62rem] text-muted-foreground tabular-nums">
          {(elapsed / 1000).toFixed(2)} s
        </span>
      )}
    </div>
  )
}

function VoiceRow({
  item,
  onInstall,
  onDevice,
  clones,
  onClone,
  onSelect,
  onVoice,
  pending
}: {
  item: VoiceItem
  onInstall: (id: string, device: 'cpu' | 'cuda') => void
  onDevice: (id: string, device: 'auto' | 'cpu' | 'cuda') => void
  onSelect: (id: string) => void
  onVoice: (id: string, voice: string) => void
  clones: VoiceClone[]
  onClone: (action: 'select' | 'delete' | 'upload', payload: string | File, entryId: string) => void
  pending: VoiceJob | null
}) {
  const running = pending?.state === 'running'
  const supportsCuda = item.devices.includes('cuda')

  let action = null

  if (running) {
    action = (
      <Button disabled size="sm" variant="outline">
        Installing…
      </Button>
    )
  } else if (item.installed) {
    // Kurulu olmak ile KULLANILIYOR olmak ayri seyler. Yalnizca "Installed"
    // gostermek, dort modelin de kurulu oldugu bir listede hangisinin
    // konustugunu belirsiz birakiyordu.
    action = item.active ? (
      <Pill tone="primary">In use</Pill>
    ) : (
      <Button onClick={() => { triggerHaptic('open'); onSelect(item.id) }} size="sm" variant="outline">
        Use
      </Button>
    )
  } else {
    action = (
      <div className="flex gap-2">
        <Button
          onClick={() => {
            triggerHaptic('open')
            onInstall(item.id, 'cpu')
          }}
          size="sm"
          variant="outline"
        >
          <Cpu className="mr-1 size-3.5" />
          CPU
        </Button>
        {/* CUDA düğmesi yalnızca GERÇEKTEN kullanılabilir olduğunda çıkıyor.
            Kartı olmayan birine sunmak, sessizce CPU'ya düşen bir kurulum
            demekti ve kullanıcı neden yavaş olduğunu anlamıyordu. */}
        {supportsCuda && item.cuda_available && (
          <Button
            onClick={() => {
              triggerHaptic('open')
              onInstall(item.id, 'cuda')
            }}
            size="sm"
          >
            <Zap className="mr-1 size-3.5" />
            CUDA
          </Button>
        )}
      </div>
    )
  }

  const row = (
    <ListRow
      action={action}
      below={
        pending && pending.state === 'running' ? (
          <ProgressBar job={pending} />
        ) : item.installed && supportsCuda ? (
          // Kurulumdaki CPU/CUDA secimi hangi PAKETIN inecegini belirler;
          // bu ise modelin her calismada NEREDE kosacagini. Ikisini tek
          // dugmeye baglamak, kurduktan sonra aygit degistirmeyi imkansiz
          // kiliyordu.
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {/* Ses secimi: bir motorun birden cok sesi var ve hangisinin
                konustugu panelde hic gorunmuyordu. Piper'in listesi DISKTEN
                geliyor -- inmemis bir sesi sunmak calisma aninda patlardi. */}
            {item.voices.length > 1 && (
              <select
                className="mr-2 h-6 rounded border border-(--stroke-nous) bg-transparent px-1 text-[0.66rem]"
                onChange={event => onVoice(item.id, event.target.value)}
                value={item.voice || item.voices[0]?.id || ''}
              >
                {item.voices.map(voice => (
                  <option key={voice.id} value={voice.id}>
                    {voice.label}
                  </option>
                ))}
              </select>
            )}
            {(['auto', 'cpu', 'cuda'] as const).map(device => (
              <Button
                className="h-6 px-2 text-[0.66rem]"
                disabled={device === 'cuda' && !item.cuda_available}
                key={device}
                onClick={() => { triggerHaptic('open'); onDevice(item.id, device) }}
                size="sm"
                variant={item.device === device ? 'default' : 'ghost'}
              >
                {device === 'auto' ? 'Auto' : device.toUpperCase()}
              </Button>
            ))}
            {!item.cuda_available ? (
              <span className="ml-1 text-[0.62rem] text-muted-foreground">no CUDA on this machine</span>
            ) : item.device === 'cuda' && !item.cuda_ready ? (
              // Yapilandirmada "cuda" yazmasi ile motorun GERCEKTEN CUDA
              // calistirmasi ayri seyler; ikincisi olmadan sessizce CPU'ya
              // duser. Fark burada gorunur oluyor.
              <span className="ml-1 text-[0.62rem] text-(--theme-warm)">CUDA runtime missing</span>
            ) : null}
            {/* Kulakla secim + gercek gecikme. Panelin "CUDA" yazmasindan
                daha inandirici bir kanit. */}
            {item.kind === 'tts' && <PreviewButton item={item} />}
            {/* Buyuk bir modeli CPU'ya almanin bedelini ONCEDEN soyle:
                bir kez tiklayip dort dakika bekleyen kullanici uygulamanin
                dondugunu saniyor. Dugme gizlenmiyor -- karar onun. */}
            {item.cpu_warning && item.device === 'cpu' && (
              <span className="ml-1 text-[0.62rem] text-(--theme-warm)">
                {item.cpu_warning}
              </span>
            )}
          </div>
        ) : null
      }
      className={item.installed && item.clone_capable ? 'pb-1' : undefined}
      description={item.summary}
      hint={
        pending?.state === 'failed'
          ? `Failed: ${pending.error}`
          : [item.size_label, supportsCuda ? 'CPU / CUDA' : 'CPU'].filter(Boolean).join(' · ')
      }
      title={
        <span className="flex items-center gap-2">
          {item.label}
          {item.recommended && <Pill tone="primary">Recommended</Pill>}
        </span>
      }
    />
  )

  if (!item.installed || !item.clone_capable) {
    return row
  }

  // Klonlama YALNIZCA destekleyen ve KURULU motorlarda. Digerlerine referans
  // kayit sunmak sessizce yok sayilirdi -- kullanici sesini yukleyip hicbir
  // sey degismedigini gorurdu.
  return (
    <div>
      {row}
      <CloneSection
        clones={clones}
        item={item}
        onDelete={id => onClone('delete', id, item.id)}
        onSelect={(entryId, cloneId) => onClone('select', cloneId, entryId)}
        onUpload={file => onClone('upload', file, item.id)}
      />
    </div>
  )
}


/**
 * Ses klonlama: referans kaydı sürükle-bırak, klonlar arasından seç.
 *
 * Chatterbox sıfır-atış klonlama yapıyor — 5-10 saniyelik temiz bir kayıt
 * yeterli, eğitim yok. Yetenek arka uçta zaten vardı ama kaydı vermenin
 * hiçbir yolu yoktu: yapılandırmaya elle dosya yolu yazmak gerekiyordu.
 */
function CloneSection({
  item,
  clones,
  onDelete,
  onSelect,
  onUpload
}: {
  item: VoiceItem
  clones: VoiceClone[]
  onDelete: (id: string) => void
  onSelect: (entryId: string, cloneId: string) => void
  onUpload: (file: File) => void
}) {
  const [dragging, setDragging] = useState(false)
  // Motorlar ayni ozelligi FARKLI davraniyor -- chatterbox gercek klonlama,
  // styletts2 ton/ritim odunc alan bir stil aktarimi, f5-tts kaydin metnini
  // kendisi cikariyor. Tek bir genel "drop to clone" yazisi bu farki
  // gizliyordu; kullanici "her ses modeli icin nasil yapilacagi anlatilsin"
  // istedi. Aciklama varsayilan KAPALI -- her satirda acik durursa kucuk
  // panel gereksiz uzuyor.
  const [showHelp, setShowHelp] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="mt-3 rounded-lg border border-dashed border-(--stroke-nous) p-3">
      {/* Suruklemek TEK yol degil -- bir dosyayi Gezgin'den bu pencereye
          suruklemek herkes icin dogal degil (dokunmatik, ekran okuyucu,
          bir dosyayi bulup elle suruklemek istemeyen kullanici). Tiklamak
          AYNI yere ayni dosyayi getiriyor, gizli bir input uzerinden. */}
      <input
        accept=".wav,.mp3,.flac,.m4a,.ogg"
        className="hidden"
        onChange={event => {
          const file = event.target.files?.[0]

          if (file) {
            onUpload(file)
          }

          event.target.value = ''
        }}
        ref={fileInputRef}
        type="file"
      />
      <div
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md px-3 py-4 text-center transition-colors ${
          dragging ? 'bg-(--theme-primary)/10' : ''
        }`}
        onClick={() => fileInputRef.current?.click()}
        onDragLeave={() => setDragging(false)}
        onDragOver={event => {
          event.preventDefault()
          setDragging(true)
        }}
        onDrop={event => {
          event.preventDefault()
          setDragging(false)

          const file = event.dataTransfer.files?.[0]

          if (file) {
            onUpload(file)
          }
        }}
      >
        <Mic className="size-4 text-(--theme-primary)" />
        <div className="flex items-center gap-1">
          <span className="text-[0.72rem] font-medium">Drop a voice sample to clone it — or click to browse</span>
          {item.clone_help && (
            <button
              aria-label={`How cloning works on ${item.label}`}
              className="text-muted-foreground hover:text-(--text-primary)"
              onClick={event => {
                event.stopPropagation()
                setShowHelp(previous => !previous)
              }}
              type="button"
            >
              <Info className="size-3" />
            </button>
          )}
        </div>
        <div className="text-[0.66rem] text-muted-foreground">
          5–10 seconds of clean speech · wav, mp3, flac, m4a, ogg
        </div>
        {showHelp && item.clone_help && (
          <div className="mt-1 max-w-xs text-[0.64rem] text-(--text-secondary)">
            {item.clone_help}
          </div>
        )}
      </div>

      {clones.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {/* Motorun KENDI sesine donus: klonu kapatmanin tek yolu bu.
              Olmazsa kullanici bir kez klon sectikten sonra geri donemez. */}
          <button
            className={`flex items-center justify-between rounded px-2 py-1 text-left text-[0.7rem] ${
              item.clone ? 'text-muted-foreground' : 'bg-(--theme-primary)/15 font-medium'
            }`}
            onClick={() => onSelect(item.id, '')}
            type="button"
          >
            <span>Model&rsquo;s own voice</span>
            {!item.clone && <span className="text-[0.62rem]">in use</span>}
          </button>

          {clones.map(clone => (
            <div
              className={`flex items-center justify-between rounded px-2 py-1 text-[0.7rem] ${
                item.clone === clone.id ? 'bg-(--theme-primary)/15 font-medium' : ''
              }`}
              key={clone.id}
            >
              <button
                className="min-w-0 flex-1 truncate text-left"
                onClick={() => onSelect(item.id, clone.id)}
                type="button"
              >
                {clone.label}
              </button>
              <span className="ml-2 shrink-0 text-[0.62rem] text-muted-foreground">
                {item.clone === clone.id ? 'in use' : `${Math.round(clone.bytes / 1024)} KB`}
              </span>
              <Button
                className="ml-1 h-5 px-1 text-[0.62rem]"
                onClick={() => onDelete(clone.id)}
                size="sm"
                variant="ghost"
              >
                ×
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Bas-konuş tuşunu yeniden bağla.
 *
 * Varsayılan sağ Ctrl her makinede yok: bazı dizüstülerde fiziksel olarak
 * bulunmuyor, bazı kullanıcılar onu IME değiştirmeye ya da ekran okuyucuya
 * bağlamış. O makinelerde bas-konuş hiç çalışmıyordu ve sebebi görünmüyordu —
 * kullanıcı notch'u açık görüp konuşuyor, hiçbir şey olmuyor.
 *
 * Yakalama ``code`` okuyor, ``key`` değil: ``code`` fiziksel tuşu gösterir ve
 * klavye düzeninden etkilenmez.
 */
function PushToTalkRow() {
  const code = useStore($pttCode)
  const [capturing, setCapturing] = useState(false)

  useEffect(() => {
    if (!capturing) {
      return
    }

    const onKey = (event: KeyboardEvent) => {
      // Escape yakalamayı İPTAL eder — bağlanabilir tuşlar arasında da
      // değil, yani kullanıcının her zaman bir çıkış yolu var.
      if (event.code === 'Escape') {
        event.preventDefault()
        setCapturing(false)

        return
      }

      if (!isBindableCode(event.code)) {
        return
      }

      event.preventDefault()
      $pttCode.set(event.code)
      setCapturing(false)
    }

    window.addEventListener('keydown', onKey, true)

    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing])

  return (
    <ListRow
      action={
        <div className="flex items-center gap-2">
          <Pill>{capturing ? 'Press a key…' : formatPttCode(code)}</Pill>
          <Button onClick={() => { triggerHaptic(); setCapturing(previous => !previous) }} size="sm" variant="outline">
            {capturing ? 'Cancel' : 'Rebind'}
          </Button>
          {code !== DEFAULT_PTT_CODE && (
            <Button onClick={() => { triggerHaptic(); $pttCode.set(DEFAULT_PTT_CODE) }} size="sm" variant="ghost">
              Reset
            </Button>
          )}
        </div>
      }
      description="Hold this key while the notch session is open to talk. Escape cancels a rebind."
      title="Push to talk key"
    />
  )
}

/**
 * Notch'u acan GLOBAL kisayol.
 *
 * Bas-konus tusundan (yukaridaki satir) FARKLI bir sey ve ikisini
 * karistirmak kolay:
 *
 *   * Global kisayol notch'u ACAR ve arkadas turunu baslatir; uygulama
 *     odakta olmasa bile calisir.
 *   * Bas-konus tusu yalnizca notch ACIKKEN ve odaktayken is gorur.
 *
 * Kayit BASARISIZ olabiliyor: istenen tusu baska bir uygulama tutuyorsa
 * Electron sessizce ``false`` donuyor. O durum kullaniciya SOYLENIYOR --
 * yoksa tusa basip hicbir sey olmadigini gorur ve sebebini ogrenemez.
 */
function NotchShortcutRow() {
  const [shortcut, setShortcut] = useState('')
  const [capturing, setCapturing] = useState(false)
  const [taken, setTaken] = useState(false)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const state = await window.hermesDesktop?.notch?.shortcut?.()

      if (!cancelled && state) {
        setShortcut(state.shortcut ?? '')
        setTaken(Boolean(state.preferred && state.shortcut !== state.preferred))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const apply = useCallback(async (accelerator: string) => {
    const result = await window.hermesDesktop?.notch?.setShortcut?.(accelerator)

    if (result) {
      setShortcut(result.shortcut ?? '')
      setTaken(Boolean(result.taken))
    }
  }, [])

  useEffect(() => {
    if (!capturing) {
      return
    }

    const onKey = (event: KeyboardEvent) => {
      // Escape her zaman cikis yolu -- yakalamayi iptal eder.
      if (event.code === 'Escape') {
        event.preventDefault()
        setCapturing(false)

        return
      }

      // Bos donen bilesim (tek basina degistirici, bilinmeyen tus) YOK
      // SAYILIYOR: yakalama acik kaliyor ve kullanici tekrar deneyebiliyor.
      // Gecersiz bir seyi kaydedip "olmadi" demek daha kotu olurdu.
      const accelerator = toAccelerator({
        alt: event.altKey,
        code: event.code,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        shift: event.shiftKey
      })

      if (!accelerator) {
        return
      }

      event.preventDefault()
      setCapturing(false)
      void apply(accelerator)
    }

    window.addEventListener('keydown', onKey, true)

    return () => window.removeEventListener('keydown', onKey, true)
  }, [apply, capturing])

  return (
    <ListRow
      action={
        <div className="flex items-center gap-2">
          <Pill>{capturing ? 'Press a combination…' : formatAccelerator(shortcut)}</Pill>
          <Button
            onClick={() => { triggerHaptic(); setCapturing(previous => !previous) }}
            size="sm"
            variant="outline"
          >
            {capturing ? 'Cancel' : 'Rebind'}
          </Button>
          {shortcut !== DEFAULT_NOTCH_SHORTCUT && (
            <Button
              onClick={() => { triggerHaptic(); void apply(DEFAULT_NOTCH_SHORTCUT) }}
              size="sm"
              variant="ghost"
            >
              Reset
            </Button>
          )}
        </div>
      }
      description={
        taken
          ? `Another app already owns your choice — ${formatAccelerator(shortcut)} is active instead.`
          : 'Opens the notch and starts a Friend turn, even when the app is not focused. Escape cancels a rebind.'
      }
      title="Notch shortcut"
    />
  )
}

export function VoiceSettings() {
  const [catalog, setCatalog] = useState<VoiceCatalog | null>(null)
  const [jobs, setJobs] = useState<Record<string, VoiceJob>>({})
  const [loading, setLoading] = useState(true)
  // Katalogu yeniden cekmek icin sayac. Bir "reload" geri cagrimi yerine bunu
  // kullanmak, iptal bayragini efektin KENDI kapanisinda tutmayi mumkun
  // kiliyor; ref'e alinmis bir bayrak bir render geç kalir ve bayat okur.
  const [reloadToken, setReloadToken] = useState(0)
  const [clones, setClones] = useState<VoiceClone[]>([])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const data = await voiceApi.catalog()

        if (cancelled) {
          return
        }

        setCatalog(data)
        // Sunucudaki suren isler aliniyor: panel kapatilip acildiginda cubuk
        // kaldigi yerden devam etsin.
        setJobs(previous => {
          const next = { ...previous }

          for (const item of data.items) {
            if (item.job) {
              next[item.id] = item.job
            }
          }

          return next
        })
      } catch (error) {
        if (!cancelled) {
          notifyError(error, 'Could not load voice models')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [reloadToken])

  // Suren is VARKEN yokla. Bosta yoklama yapmamak kasitli: panel acik kalirsa
  // saniyede bir gereksiz istek uretirdi.
  useEffect(() => {
    const running = Object.values(jobs).filter(job => job.state === 'running')

    if (running.length === 0) {
      return
    }

    let cancelled = false

    const timer = setInterval(() => {
      void (async () => {
        for (const job of running) {
          try {
            const fresh = await voiceApi.job(job.id)

            if (cancelled) {
              return
            }

            setJobs(previous => ({ ...previous, [fresh.entry_id]: fresh }))

            // Is bittiginde katalog yeniden cekiliyor: "Installed" rozeti
            // gercek duruma gore gelsin, iyimser tahminle degil.
            if (fresh.state !== 'running') {
              setReloadToken(token => token + 1)
            }
          } catch {
            // Tek bir yoklama hatasi kurulumu iptal etmez; sonraki tur dener.
          }
        }
      })()
    }, POLL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [jobs])

  const select = useCallback(async (id: string) => {
    try {
      await voiceApi.select(id)
      setReloadToken(token => token + 1)
    } catch (error) {
      notifyError(error, 'Could not switch model')
    }
  }, [])

  const setDevice = useCallback(async (id: string, device: 'auto' | 'cpu' | 'cuda') => {
    try {
      const result = await voiceApi.setDevice(id, device)

      // CUDA secildi ama ortam onu CALISTIRAMIYOR: yalnizca yapilandirmaya
      // yazmak sessiz bir yalan olurdu -- motor CPU'ya duser ve kullanici
      // yalnizca "cok yavas" gorur. Gercek calisma zamani hemen kuruluyor.
      if ((result as { needs_cuda_runtime?: boolean }).needs_cuda_runtime) {
        const job = await voiceApi.installCuda(id)

        setJobs(previous => ({ ...previous, [id]: job }))
      }

      setReloadToken(token => token + 1)
    } catch (error) {
      notifyError(error, 'Could not change device')
    }
  }, [])

  // Klon listesi katalogla AYNI anda yenileniyor: yukleme sonrasi liste
  // guncellenmezse kullanici sesini yukleyip goremez.
  useEffect(() => {
    let cancelled = false

    void voiceApi
      .clones()
      .then(r => {
        if (!cancelled) {
          setClones(r.clones)
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [reloadToken])

  const onClone = useCallback(
    async (action: 'select' | 'delete' | 'upload', payload: File | string, entryId: string) => {
      try {
        if (action === 'upload' && payload instanceof File) {
          // Dosya kopruden gectigi icin ham bayt tasinamiyor; base64'e
          // cevriliyor. ``readAsDataURL`` basina MIME onEki koyuyor, o
          // kirpiliyor.
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()

            reader.onerror = () => reject(reader.error ?? new Error('okunamadi'))
            reader.onload = () => resolve(String(reader.result ?? ''))
            reader.readAsDataURL(payload)
          })

          await voiceApi.uploadClone(payload.name, dataUrl.slice(dataUrl.indexOf(',') + 1))
        } else if (action === 'delete' && typeof payload === 'string') {
          await voiceApi.deleteClone(payload)
        } else if (action === 'select' && typeof payload === 'string') {
          await voiceApi.selectClone(entryId, payload)
        }

        setReloadToken(token => token + 1)
      } catch (error) {
        notifyError(error, 'Voice clone action failed')
      }
    },
    []
  )

  const setVoice = useCallback(async (id: string, voice: string) => {
    try {
      await voiceApi.setVoice(id, voice)
      setReloadToken(token => token + 1)
    } catch (error) {
      notifyError(error, 'Could not change voice')
    }
  }, [])

  const install = useCallback(async (id: string, device: 'cpu' | 'cuda') => {
    try {
      const job = await voiceApi.install(id, device)

      setJobs(previous => ({ ...previous, [id]: job }))
    } catch (error) {
      notifyError(error, 'Could not start the install')
    }
  }, [])

  if (loading) {
    return (
      <SettingsContent>
        <ListRowSkeleton />
        <ListRowSkeleton />
        <ListRowSkeleton />
      </SettingsContent>
    )
  }

  const tts = catalog?.items.filter(item => item.kind === 'tts') ?? []
  const stt = catalog?.items.filter(item => item.kind === 'stt') ?? []

  return (
    <SettingsContent>
      <SettingsSection
        icon={Volume2}
        meta={catalog?.cuda_available ? 'CUDA available' : 'CPU only'}
        title="Text to speech"
      >
        {/* OLCULMUS yavaslik uyarisi.
            Sayi geciyor, cunku "daha hizli bir secenek var" tek basina
            inandirici degil ve kullanici bir motoru bilerek secmis. Olculen
            fark ise karar verdirir (kyutai 2,52 sn / kokoro 0,20 sn).
            Kalite dususu ONERILMIYOR: piper daha da hizli ama kyutai'yi
            gercekciligi icin secen kisiye onu onermek, cozulen sorunu geri
            getirmek olurdu (bkz. fool/voice_bench.py::BASIC_QUALITY). */}
        {catalog?.slow_engine && (
          <div className="mb-2 rounded-md border border-(--theme-warm)/40 bg-(--theme-warm)/10 px-3 py-2 text-xs text-(--text-secondary)">
            {catalog.slow_engine.message}
          </div>
        )}
        {tts.map(item => (
          <VoiceRow clones={clones} item={item} key={item.id} onClone={onClone} onDevice={setDevice} onInstall={install} onSelect={select} onVoice={setVoice} pending={jobs[item.id] ?? null} />
        ))}
      </SettingsSection>

      <SettingsSection icon={Keyboard} title="Voice controls">
        <NotchShortcutRow />
        <PushToTalkRow />
      </SettingsSection>

      <SettingsSection icon={Mic} title="Speech to text">
        {stt.map(item => (
          <VoiceRow clones={clones} item={item} key={item.id} onClone={onClone} onDevice={setDevice} onInstall={install} onSelect={select} onVoice={setVoice} pending={jobs[item.id] ?? null} />
        ))}
      </SettingsSection>

      {catalog?.voice_dir && (
        <div className="flex items-center gap-2 pt-1 text-[0.68rem] text-muted-foreground">
          <Download className="size-3.5" />
          <span className="font-mono">{catalog.voice_dir}</span>
        </div>
      )}
    </SettingsContent>
  )
}
