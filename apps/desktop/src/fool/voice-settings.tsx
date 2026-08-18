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

import { useCallback, useEffect, useRef, useState } from 'react'

import { ListRow, ListRowSkeleton, Pill, SettingsContent, SettingsSection } from '@/app/settings/primitives'
import { Button } from '@/components/ui/button'
import { triggerHaptic } from '@/lib/haptics'
import { Cpu, Download, Mic, Volume2, Zap } from '@/lib/icons'
import { notifyError } from '@/store/notifications'

import { type VoiceCatalog, type VoiceItem, type VoiceJob, voiceApi } from './voice-api'

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
  pending
}: {
  item: VoiceItem
  onInstall: (id: string, device: 'cpu' | 'cuda') => void
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
    action = <Pill tone="primary">Installed</Pill>
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
      below={pending && pending.state === 'running' ? <ProgressBar job={pending} /> : null}
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

  // Yoklama zamanlayıcısını bileşen sökülünce durdurmak için. Aksi halde panel
  // kapandıktan sonra da ağ geçidine istek gitmeye devam ederdi.
  const alive = useRef(true)

  const load = useCallback(async () => {
    try {
      const data = await voiceApi.catalog()

      if (!alive.current) {
        return
      }

      setCatalog(data)
      // Sunucudaki süren işler alınıyor: panel kapatılıp açıldığında çubuk
      // kaldığı yerden devam etsin.
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
      if (alive.current) {
        notifyError(error, 'Could not load voice models')
      }
    } finally {
      if (alive.current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    alive.current = true
    void load()

    return () => {
      alive.current = false
    }
  }, [load])

  // Süren iş VARKEN yokla. Boşta yoklama yapmamak kasıtlı: panel açık kalırsa
  // saniyede bir gereksiz istek üretirdi.
  useEffect(() => {
    const running = Object.values(jobs).filter(job => job.state === 'running')

    if (running.length === 0) {
      return
    }

    const timer = setInterval(() => {
      void (async () => {
        for (const job of running) {
          try {
            const fresh = await voiceApi.job(job.id)

            if (!alive.current) {
              return
            }

            setJobs(previous => ({ ...previous, [fresh.entry_id]: fresh }))

            // İş bittiğinde katalog yeniden çekiliyor: "Kurulu" rozeti
            // gerçek duruma göre gelsin, iyimser tahminle değil.
            if (fresh.state !== 'running') {
              void load()
            }
          } catch {
            // Tek bir yoklama hatası kurulumu iptal etmez; sonraki tur dener.
          }
        }
      })()
    }, POLL_MS)

    return () => clearInterval(timer)
  }, [jobs, load])

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
          <VoiceRow item={item} key={item.id} onInstall={install} pending={jobs[item.id] ?? null} />
        ))}
      </SettingsSection>

      <SettingsSection icon={Mic} title="Speech to text">
        {stt.map(item => (
          <VoiceRow item={item} key={item.id} onInstall={install} pending={jobs[item.id] ?? null} />
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
