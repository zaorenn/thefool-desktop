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

import { useCallback, useEffect, useState } from 'react'

import { ListRow, ListRowSkeleton, Pill, SettingsContent, SettingsSection } from '@/app/settings/primitives'
import { Button } from '@/components/ui/button'
import { triggerHaptic } from '@/lib/haptics'
import { Cpu, Download, Mic, Volume2, Zap } from '@/lib/icons'
import { notifyError } from '@/store/notifications'

import { voiceApi, type VoiceCatalog, type VoiceItem, type VoiceJob } from './voice-api'

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

function VoiceRow({
  item,
  onInstall,
  onDevice,
  onSelect,
  onVoice,
  pending
}: {
  item: VoiceItem
  onInstall: (id: string, device: 'cpu' | 'cuda') => void
  onDevice: (id: string, device: 'auto' | 'cpu' | 'cuda') => void
  onSelect: (id: string) => void
  onVoice: (id: string, voice: string) => void
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

  return (
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
            {!item.cuda_available && (
              <span className="ml-1 text-[0.62rem] text-muted-foreground">no CUDA on this machine</span>
            )}
          </div>
        ) : null
      }
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
}

export function VoiceSettings() {
  const [catalog, setCatalog] = useState<VoiceCatalog | null>(null)
  const [jobs, setJobs] = useState<Record<string, VoiceJob>>({})
  const [loading, setLoading] = useState(true)
  // Katalogu yeniden cekmek icin sayac. Bir "reload" geri cagrimi yerine bunu
  // kullanmak, iptal bayragini efektin KENDI kapanisinda tutmayi mumkun
  // kiliyor; ref'e alinmis bir bayrak bir render geç kalir ve bayat okur.
  const [reloadToken, setReloadToken] = useState(0)

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
      await voiceApi.setDevice(id, device)
      setReloadToken(token => token + 1)
    } catch (error) {
      notifyError(error, 'Could not change device')
    }
  }, [])

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
        {tts.map(item => (
          <VoiceRow item={item} key={item.id} onDevice={setDevice} onInstall={install} onSelect={select} onVoice={setVoice} pending={jobs[item.id] ?? null} />
        ))}
      </SettingsSection>

      <SettingsSection icon={Mic} title="Speech to text">
        {stt.map(item => (
          <VoiceRow item={item} key={item.id} onDevice={setDevice} onInstall={install} onSelect={select} onVoice={setVoice} pending={jobs[item.id] ?? null} />
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
