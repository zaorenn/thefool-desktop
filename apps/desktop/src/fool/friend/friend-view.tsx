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

import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Mic, MicOff } from '@/lib/icons'
import { notifyError } from '@/store/notifications'
import { $voicePlayback } from '@/store/voice-playback'

import { voiceApi, type VoiceCatalog } from '../voice-api'

import { $friendMode, FRIEND_MODES, friendModeInfo } from './friend-mode'
import {
  advance,
  createOrbState,
  isHearing,
  type OrbPhase,
  ringOpacity,
  scaleFor
} from './orb-motion'
import { useFriendVoice } from './use-friend-voice'
import { isWarming, warmingLabel } from './warming'

const RING_COUNT = 3

/** Windows'ta ``option`` renkleri ``select``ten MIRAS ALINMIYOR; acikca
 *  veriliyor, yoksa koyu temada yazilar okunmuyor. */
const OPTION_STYLE = { background: '#1a1a1a', color: '#f0f0f0' } as const

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
  const mode = useStore($friendMode)
  const [muted, setMuted] = useState(false)
  const [listenMode, setListenMode] = useState<ListenMode>('hands-free')
  const [catalog, setCatalog] = useState<VoiceCatalog | null>(null)
  const [provider, setProvider] = useState('')
  const [speaker, setSpeaker] = useState('')

  // ``provider`` state'i hook'tan ONCE: hook onu okuyor.
  // Sentez SAGLAYICI ADI istiyor, katalog kimligi degil.
  const voice = useFriendVoice(
    (catalog?.items ?? []).find(item => item.id === provider)?.provider_id || '',
    mode
  )

  const [holding, setHolding] = useState(false)

  // Kurulu motorlar ve bu pencerenin secili sesi.
  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const data = await voiceApi.catalog()

        if (!cancelled) {
          setCatalog(data)
          // GENEL secili motor. Friend ayri bir ses tutmuyor: iki yuzey
          // ayni motoru kullaniyor, yani hic tahliye/yeniden yukleme
          // olmuyor ve kullanici tek bir hakikat goruyor.
          const active = data.items.find(item => item.kind === 'tts' && item.active)

          setProvider(active ? active.id : '')
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

  /** Ses secimi GENEL ayari degistiriyor, Friend'e ozel bir kopya DEGIL.
   *
   * Once kip basina ayri tutuyordum ve iki sorun uretti: (1) sohbet paneli
   * ile Friend farkli motor secince tek-motor kurali her turu
   * yukle-bosalt-yukle donguse ceviriyordu, (2) kullanici "Friend'in sesi
   * ile global ses ayni olmali" dedi -- hakli, iki yerde iki ses tutmak
   * kullaniciya iki ayri hakikat sunmak.
   */
  const chooseProvider = useCallback(async (next: string) => {
    setProvider(next)
    // Motor degisti: eski motorun ses tipi yenisinde yok.
    setSpeaker('')

    try {
      await voiceApi.select(next)
    } catch (error) {
      notifyError(error, 'Could not save the voice')
    }
  }, [])

  /** Motorun KENDI ses tipleri (Kokoro'nun yedi sesi gibi). */
  const chooseSpeaker = useCallback(
    async (entryId: string, next: string) => {
      setSpeaker(next)

      try {
        await voiceApi.setVoice(entryId, next)
      } catch (error) {
        notifyError(error, 'Could not save the speaker')
      }
    },
    []
  )

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

  // Modelleri PENCERE ACILIR ACILMAZ isit.
  //
  // Olculdu: kokoro soguk 24,17 sn / sicak 0,32 sn, styletts2 soguk
  // 67,21 sn / sicak 0,86 sn. Bu pencere isitmayi hic cagirmiyordu, yani
  // ilk cumlede soguk yuklemeyi kullanici bekliyordu -- ayarlardaki Listen
  // dugmesi 2,5 sn'de konusurken. Fark buydu.
  //
  // Hata YUTULUYOR: isitma bir iyilestirme, gereklilik degil. Basarisiz
  // olursa ilk cumle modeli kendisi yukler; kullaniciya bildirim gostermek
  // hicbir sey bozulmamisken telas yaratirdi.
  useEffect(() => {
    void voiceApi.warmVoice().catch(() => undefined)
  }, [provider])

  // Friend acikken NOTCH da acik kalsin.
  //
  // Kullanici istegi ve mantikli: notch ekranin ustunde durup durumu
  // gosteriyor, boylece Friend sekmesinden ciksan bile konusmanin nerede
  // oldugunu goruyorsun. Notch SESSIZ kaliyor -- ses sahibi Friend
  // (bkz. fool/voice-owner.ts); notch yalnizca gosterge.
  useEffect(() => {
    void window.hermesDesktop?.notch?.open?.()

    return () => {
      void window.hermesDesktop?.notch?.close?.()
    }
  }, [])

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

  // Model uyaniyor mu? Olculdu: soguk yukleme 4,67-40,52 sn ve o sure
  // boyunca ekranda "Talking" yazip HIC ses cikmiyordu -- kullanici icin
  // "bozuk"tan ayirt edilemez.
  const playback = useStore($voicePlayback)
  const [preparingSince, setPreparingSince] = useState<null | number>(null)
  const [warming, setWarming] = useState(false)

  useEffect(() => {
    if (playback.status !== 'preparing') {
      setPreparingSince(null)
      setWarming(false)

      return
    }

    const startedAt = preparingSince ?? Date.now()

    if (preparingSince === null) {
      setPreparingSince(startedAt)
    }

    const timer = setInterval(() => {
      setWarming(isWarming({ elapsedMs: Date.now() - startedAt, preparing: true }))
    }, 300)

    return () => clearInterval(timer)
  }, [playback.status, preparingSince])

  const tts = (catalog?.items ?? []).filter(item => item.kind === 'tts' && item.installed)

  // Secili motorun katalog kaydi -- ses tipleri ondan geliyor.
  const selected = provider ? tts.find(item => item.id === provider) : tts.find(item => item.active)

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 px-8">
      <Orb level={voice.level} phase={voice.phase} />

      <div className="flex min-h-16 max-w-2xl flex-col items-center gap-2 text-center">
        <span className="text-xs tracking-wide text-muted-foreground uppercase">
          {muted ? 'Muted' : PHASE_LABEL[voice.phase]}
        </span>
        {/* Makineye erisim SESSIZ olmamali: sesli sohbette yanlis anlasilma
            sik ve normal, kullanici hangi kipte konustugunu gormeli. */}
        {friendModeInfo(mode).touchesMachine && (
          <span className="text-xs text-(--theme-warm)">
            Jarvis — {friendModeInfo(mode).summary}
          </span>
        )}
        {/* Bekleme kacinilmaz (model diskten VRAM'e yuklenecek) ama
            GORUNMEZ olmasi degil. */}
        {warming && (
          <span className="text-xs text-(--theme-warm)">
            {warmingLabel(selected?.label ?? provider)}
          </span>
        )}
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
        {/* KIP secimi. Ayni pencereden iki farkli sey isteniyor: arkadas
            kipinde cogu tur bir gorev degil (kisa, sicak, aracsiz), Jarvis
            kipinde gercekten is yapiliyor (terminal, dosya, kod). Secim
            oturumu yeniden aciyor -- arac kumesi ajan kurulurken donuyor. */}
        <div className="flex overflow-hidden rounded-full border border-(--stroke-nous)">
          {(Object.keys(FRIEND_MODES) as (keyof typeof FRIEND_MODES)[]).map(option => (
            <button
              className={`px-3 py-1 transition-colors ${
                mode === option
                  ? 'bg-(--theme-primary) text-white'
                  : 'hover:bg-(--surface-hover)'
              }`}
              key={option}
              onClick={() => $friendMode.set(option)}
              title={FRIEND_MODES[option].summary}
              type="button"
            >
              {FRIEND_MODES[option].label}
            </button>
          ))}
        </div>

        <div className="flex overflow-hidden rounded-full border border-(--stroke-nous)">
          {(['hands-free', 'push-to-talk'] as const).map(option => (
            <button
              className={`px-3 py-1 transition-colors ${
                listenMode === option
                  ? 'bg-(--theme-primary) text-white'
                  : 'hover:bg-(--surface-hover)'
              }`}
              key={option}
              onClick={() => setListenMode(option)}
              type="button"
            >
              {option === 'hands-free' ? 'Hands-free' : 'Push to talk'}
            </button>
          ))}
        </div>

        {/* ``bg-transparent`` YANLISTI: acilir listenin secenekleri isletim
            sisteminin kendi menusunde ciziliyor ve saydam zeminde koyu tema
            ile birlesince yazilar OKUNMUYORDU. Zemin ve metin rengi acikca
            veriliyor; ``option``lara da ayrica, cunku Windows onlari
            select'ten miras almiyor. */}
        <select
          aria-label="Voice"
          className="h-7 rounded border border-(--stroke-nous) bg-(--surface-1) px-2 text-xs text-(--text-primary)"
          onChange={event => void chooseProvider(event.target.value)}
          value={provider}
        >
          {/* Bos = genel ``tts.provider``a dus. Bu pencerenin kendi sesi
              olmak ZORUNDA degil. */}
          <option style={OPTION_STYLE} value="">
            Default voice
          </option>
          {/* ``select`` KATALOG KIMLIGI bekliyor, saglayici adi degil
              (``qwen3-tts`` indirilir, ``qwen3`` secilir). */}
          {tts.map(item => (
            <option key={item.id} style={OPTION_STYLE} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>

        {/* Motorun KENDI ses tipleri. Yalnizca birden fazlasi varsa
            gosteriliyor: tek secenekli bir acilir liste gurultu. */}
        {selected && selected.voices.length > 1 && (
          <select
            aria-label="Speaker"
            className="h-7 rounded border border-(--stroke-nous) bg-(--surface-1) px-2 text-xs text-(--text-primary)"
            onChange={event => void chooseSpeaker(selected.id, event.target.value)}
            value={speaker || selected.voice || selected.voices[0]?.id || ''}
          >
            {selected.voices.map(entry => (
              <option key={entry.id} style={OPTION_STYLE} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}
