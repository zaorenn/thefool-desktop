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

export function FriendView() {
  const voice = useFriendVoice()
  const [muted, setMuted] = useState(false)

  const toggle = useCallback(() => {
    setMuted(previous => {
      const next = !previous

      if (next) {
        voice.stop()
      } else {
        voice.start()
      }

      return next
    })
  }, [voice])

  // Sayfa acilinca konusmaya HAZIR olsun: kullanicinin once bir dugme
  // aramasi, "oturup konusmak" fikrinin tam tersi.
  useEffect(() => {
    voice.start()

    return () => voice.stop()
    // ``voice`` her render'da yeni bir nesne; bagimliliga almak mikrofonu
    // acip kapatip dururdu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

      <button
        aria-label={muted ? 'Unmute' : 'Mute'}
        className="flex size-12 items-center justify-center rounded-full border border-(--stroke-nous) transition-colors hover:bg-(--surface-hover)"
        onClick={toggle}
        type="button"
      >
        {muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
      </button>
    </div>
  )
}
