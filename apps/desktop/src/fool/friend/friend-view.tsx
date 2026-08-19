/**
 * Friend penceresi — oturup konuşmak için.
 *
 * Neden notch yetmiyor
 * --------------------
 * Notch küçük ve geçici: başka bir uygulamada çalışırken bir şey sormak için.
 * Bu ise sohbetin KENDİSİ için — kullanıcı buraya bakarak konuşuyor. İkisini
 * tek yüzeyde birleştirmek, notch'u büyütüp odağı çalmak demekti.
 *
 * Ne farklı
 * ---------
 * * Araç yok. Kapsam ``friend`` (bkz. ``fool/session_scope.py``): terminal,
 *   dosya, kod yok. Sohbette yanlış anlaşılma sık ve normal; bedeli boşa
 *   giden bir tur olmalı.
 * * Hafıza ORTAK. Friend ile ajan aynı ``MEMORY.md`` / ``USER.md``
 *   dosyalarını görüyor. Ayırmak arkadaşı hafızasız bırakırdı -- her
 *   seferinde kendini yeniden anlatmak zorunda kalırdın.
 * * Küre GERÇEK mikrofon seviyesini takip ediyor. Rastgele animasyon ilk
 *   bakışta aynı görünüyor ama kullanıcı sustuğunda da oynamaya devam ediyor
 *   ve his anında bozuluyor: "beni duymuyor, sadece oynuyor".
 *
 * Zone A: upstream bu dosyayı bilmiyor.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { Mic, MicOff } from '@/lib/icons'
import { notifyError } from '@/store/notifications'

import { voiceApi, type VoiceCatalog } from '../voice-api'

import {
  advance,
  createOrbState,
  isHearing,
  type OrbPhase,
  ringOpacity,
  scaleFor
} from './orb-motion'
import { useFriendVoice } from './use-friend-voice'

const RING_COUNT = 3

/** Durum satırı — kullanıcıya görünen metin İngilizce (deponun kuralı). */
const PHASE_LABEL: Record<OrbPhase, string> = {
  idle: 'Tap to talk',
  listening: 'Listening',
  speaking: 'Talking',
  thinking: 'Thinking'
}

function Orb({ level, phase }: { level: number; phase: OrbPhase }) {
  const stateRef = useRef(createOrbState())
  const [frame, setFrame] = useState(() => ({ hearing: false, rings: [0, 0, 0], scale: 1 }))
  const levelRef = useRef(level)
  const phaseRef = useRef(phase)

  levelRef.current = level
  phaseRef.current = phase

  useEffect(() => {
    let raf = 0
    let last = performance.now()

    const tick = (now: number) => {
      const dt = now - last

      last = now

      const state = advance(stateRef.current, levelRef.current, dt)
      const current = phaseRef.current

      setFrame({
        hearing: isHearing(state, current),
        rings: Array.from({ length: RING_COUNT }, (_, index) =>
          ringOpacity(state, current, index)
        ),
        scale: scaleFor(state, current)
      })

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="relative flex size-72 items-center justify-center">
      {frame.rings.map((opacity, index) => (
        <span
          className="absolute rounded-full border border-(--theme-primary)"
          key={`ring-${index}`}
          style={{
            height: `${58 + index * 16}%`,
            opacity,
            transform: `scale(${frame.scale - index * 0.03})`,
            width: `${58 + index * 16}%`
          }}
        />
      ))}
      <span
        className="absolute rounded-full bg-(--theme-primary)"
        style={{
          height: '46%',
          // Gecis SURESI yok: kare basina zaten yumusatiliyor ve ustune CSS
          // gecisi koymak iki kat yumusatma demek -- kure sesin GERISINDE
          // kaliyor ve "duymuyor" hissi geri geliyor.
          opacity: frame.hearing ? 0.95 : 0.72,
          transform: `scale(${frame.scale})`,
          width: '46%'
        }}
      />
    </div>
  )
}

/** Bu pencerenin dinleme kipi. */
type ListenMode = 'hands-free' | 'push-to-talk'

export function FriendView() {
  const voice = useFriendVoice()
  const [muted, setMuted] = useState(false)
  const [listenMode, setListenMode] = useState<ListenMode>('hands-free')
  const [catalog, setCatalog] = useState<VoiceCatalog | null>(null)
  const [provider, setProvider] = useState('')
  const [holding, setHolding] = useState(false)

  // Kurulu motorlar ve bu pencerenin secili sesi.
  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const [data, saved] = await Promise.all([voiceApi.catalog(), voiceApi.modeProviders()])

        if (!cancelled) {
          setCatalog(data)
          setProvider(saved.providers?.friend ?? '')
        }
      } catch {
        // Sessizce gec: ses secimi olmadan da pencere calisiyor. Bir katalog
        // hatasinin sohbeti engellemesi yanlis olurdu.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const chooseProvider = useCallback(async (next: string) => {
    setProvider(next)

    try {
      await voiceApi.setModeProvider('friend', next)
    } catch (error) {
      notifyError(error, 'Could not save the voice')
    }
  }, [])

  const toggle = useCallback(() => {
    setMuted(previous => {
      const next = !previous

      if (next) {
        voice.stop()
      } else if (listenMode === 'hands-free') {
        voice.start()
      }

      return next
    })
  }, [listenMode, voice])

  // Kip degisince mikrofonu ona gore ayarla: eller serbest surekli dinliyor,
  // bas-konus yalnizca basiliyken.
  useEffect(() => {
    if (muted) {
      return
    }

    if (listenMode === 'hands-free') {
      voice.start()
    } else {
      voice.stop()
    }
    // ``voice`` her render'da yeni bir nesne; bagimliliga almak mikrofonu
    // acip kapatip dururdu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listenMode, muted])

  // Sayfa kapaninca mikrofonu MUTLAKA birak: acik kalan bir mikrofon
  // kullanicinin gormedigi en kotu durum.
  useEffect(() => {
    return () => voice.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hold = useCallback(() => {
    if (muted || listenMode !== 'push-to-talk') {
      return
    }

    setHolding(true)
    voice.beginHold()
  }, [listenMode, muted, voice])

  const release = useCallback(() => {
    if (!holding) {
      return
    }

    setHolding(false)
    voice.endHold()
  }, [holding, voice])

  const tts = (catalog?.items ?? []).filter(item => item.kind === 'tts' && item.installed)

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 px-8">
      <Orb level={voice.level} phase={voice.phase} />

      <div className="flex min-h-16 max-w-2xl flex-col items-center gap-2 text-center">
        <span className="text-xs tracking-wide text-muted-foreground uppercase">
          {muted ? 'Muted' : PHASE_LABEL[voice.phase]}
        </span>
        {/* Son soylenen ve son duyulan: kullanici yanlis anlasilmayi
            GORMELI. Sesli bir arayuzde bunu gostermemek, hatayi ancak
            cevap gelince fark etmek demek. */}
        {voice.transcript && (
          <p className="text-lg leading-snug text-balance">{voice.transcript}</p>
        )}
        {voice.reply && (
          <p className="text-sm leading-snug text-balance text-muted-foreground">
            {voice.reply}
          </p>
        )}
        {voice.error && (
          <p className="text-sm text-(--theme-warm)">{voice.error}</p>
        )}
      </div>

      {/* Mikrofon dugmesi kipe gore FARKLI davraniyor: eller serbestte
          sustur/ac, bas-konusta basili tutulan tus. Tek dugmeye iki anlam
          yuklemek yerine davranisi kipe baglamak, kullanicinin ne yapacagini
          tahmin etmesini gerektirmiyor. */}
      <button
        aria-label={
          listenMode === 'push-to-talk' ? 'Hold to talk' : muted ? 'Unmute' : 'Mute'
        }
        className={`flex size-14 items-center justify-center rounded-full border transition-colors ${
          holding
            ? 'border-(--theme-primary) bg-(--theme-primary)/15'
            : 'border-(--stroke-nous) hover:bg-(--surface-hover)'
        }`}
        onClick={listenMode === 'hands-free' ? toggle : undefined}
        onPointerCancel={release}
        onPointerDown={listenMode === 'push-to-talk' ? hold : undefined}
        onPointerLeave={release}
        onPointerUp={release}
        type="button"
      >
        {muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
      </button>

      {/* Kontroller: dinleme kipi ve ses. Ayarlara gitmeden buradan
          degistirilebiliyor -- konusurken "sesi begenmedim" demek icin
          baska bir sayfaya gitmek akisi kesiyordu. */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="flex overflow-hidden rounded-full border border-(--stroke-nous)">
          {(['hands-free', 'push-to-talk'] as const).map(mode => (
            <button
              className={`px-3 py-1 transition-colors ${
                listenMode === mode
                  ? 'bg-(--theme-primary) text-white'
                  : 'hover:bg-(--surface-hover)'
              }`}
              key={mode}
              onClick={() => setListenMode(mode)}
              type="button"
            >
              {mode === 'hands-free' ? 'Hands-free' : 'Push to talk'}
            </button>
          ))}
        </div>

        <select
          aria-label="Voice"
          className="h-7 rounded border border-(--stroke-nous) bg-transparent px-2 text-xs"
          onChange={event => void chooseProvider(event.target.value)}
          value={provider}
        >
          {/* Bos = genel ``tts.provider``a dus. Bu pencerenin kendi sesi
              olmak ZORUNDA degil. */}
          <option value="">Default voice</option>
          {tts.map(item => (
            <option key={item.id} value={item.provider_id || item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
