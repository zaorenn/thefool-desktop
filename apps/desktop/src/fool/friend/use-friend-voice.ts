/**
 * Friend penceresinin ses döngüsü.
 *
 * Notch'un kancasından ayrı, ama kuralları ORTAK: aynı VAD ayarı, aynı araya
 * girme kapısı, aynı durdur-sonra-gönder sırası (``fool/notch/``). İki
 * yüzeyin kuralları ayrışırsa aynı cümle iki yerde farklı davranır --
 * kullanıcı için tekrar üretilemeyen bir hata.
 *
 * Farkı akış: notch bas-konuş odaklı ve geçici, bu pencere sürekli dinliyor.
 * Kullanıcı buraya bakarak konuşuyor, o yüzden her turdan sonra mikrofon
 * kendiliğinden açılıyor ve tuşa hiç dokunulmuyor.
 *
 * Zone A: upstream bu dosyayı bilmiyor.
 */

import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useMicRecorder } from '@/app/chat/composer/hooks/use-mic-recorder'
import { useGatewayRequest } from '@/app/gateway/hooks/use-gateway-request'
import { blobToDataUrl } from '@/app/session/hooks/use-prompt-actions/utils'
import { transcribeAudio } from '@/hermes'
import { useI18n } from '@/i18n'
import { collectUnspokenTurnSpeech } from '@/lib/chat-messages'
import { monitorSpeechDuringPlayback } from '@/lib/voice-barge-in'
import {
  playSpeechText,
  type SpeechStreamSession,
  startSpeechStream,
  stopVoicePlayback
} from '@/lib/voice-playback'
import { $messages } from '@/store/session'

import {
  claimBarge,
  createBargeGate,
  releaseBarge
} from '../notch/barge-in'
import {
  createCompanionSessionState,
  ensureCompanionSession,
  forgetCompanionSession
} from '../notch/companion-session'
import { HANDS_FREE_VAD } from '../notch/hands-free'
import { interruptThenSubmit } from '../notch/interrupt'

import type { OrbPhase } from './orb-motion'

/** Ağ geçidi bu kaynağı görünce ``friend`` kapsamını uyguluyor. */
export const FRIEND_SOURCE = 'friend'

export interface FriendVoice {
  phase: OrbPhase
  /** Mikrofon seviyesi 0..1 — küreyi bu besliyor. */
  level: number
  /** Kullanıcının son söylediği. */
  transcript: string
  /** Ajanın son cevabı. */
  reply: string
  error: null | string
  start: () => void
  stop: () => void
  /** Bas-konuş: basıldı. */
  beginHold: () => void
  /** Bas-konuş: bırakıldı. */
  endHold: () => void
}

export function useFriendVoice(): FriendVoice {
  const { t } = useI18n()
  const messages = useStore($messages)
  const { handle: mic, level } = useMicRecorder(t.notifications.voice)
  const { requestGateway } = useGatewayRequest()

  const [phase, setPhase] = useState<OrbPhase>('idle')
  const [transcript, setTranscript] = useState('')
  const [reply, setReply] = useState('')
  const [error, setError] = useState<null | string>(null)
  const [active, setActive] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [lastSpokenId, setLastSpokenId] = useState<null | string>(null)

  const phaseRef = useRef<OrbPhase>('idle')

  phaseRef.current = phase

  const sessionRef = useRef(createCompanionSessionState())
  const bargeRef = useRef(createBargeGate())
  const streamRef = useRef<{ sent: number; session: SpeechStreamSession | null } | null>(null)
  const listenRef = useRef<() => void>(() => undefined)

  const resolveSessionId = useCallback(async () => {
    // Kapsam ``friend``: arac yok ama hafiza ajanla ORTAK. Ayirmak arkadasi
    // hafizasiz birakirdi -- her seferinde kendini yeniden anlatmak.
    return ensureCompanionSession(sessionRef.current, {
      create: params =>
        requestGateway('session.create', params) as Promise<{ session_id?: string }>,
      source: FRIEND_SOURCE
    })
  }, [requestGateway])

  const haltTurn = useCallback(async () => {
    const id = sessionRef.current.id

    if (!id || phaseRef.current === 'idle' || phaseRef.current === 'listening') {
      return
    }

    await requestGateway('session.interrupt', { session_id: id })
  }, [requestGateway])

  const submitAudio = useCallback(
    async (audio: Blob) => {
      const dataUrl = await blobToDataUrl(audio)
      const result = await transcribeAudio(dataUrl, audio.type)
      const text = (result.transcript ?? '').trim()

      if (!text) {
        // Sessiz kayit: bos metin gondermek ajani bosluga cevap vermeye
        // zorlardi. Sessizce dinlemeye don.
        releaseBarge(bargeRef.current)
        setPhase('idle')
        listenRef.current()

        return
      }

      setTranscript(text)
      setReply('')
      setPhase('thinking')
      releaseBarge(bargeRef.current)

      const sessionId = await resolveSessionId()

      if (!sessionId) {
        setError('Could not open a Friend session')
        setPhase('idle')

        return
      }

      await requestGateway('prompt.submit', {
        session_id: sessionId,
        surface: 'friend',
        text
      })
    },
    [requestGateway, resolveSessionId]
  )

  /** Mikrofonu aç; sessizlik turu bitirsin. */
  const listen = useCallback(() => {
    setError(null)
    setPhase('listening')
    void mic
      .start({
        ...HANDS_FREE_VAD,
        onSilence: () => {
          setPhase('thinking')

          void (async () => {
            try {
              const recording = await mic.stop()

              if (!recording) {
                setPhase('idle')
                listenRef.current()

                return
              }

              await submitAudio(recording.audio)
            } catch (cause) {
              setPhase('idle')
              setError(cause instanceof Error ? cause.message : String(cause))
            }
          })()
        }
      })
      .catch((cause: unknown) => {
        setPhase('idle')
        setError(cause instanceof Error ? cause.message : String(cause))
      })
  }, [mic, submitAudio])

  listenRef.current = listen

  const start = useCallback(() => {
    setActive(true)
    listen()
  }, [listen])

  /** Bas-konuş: tuşa/düğmeye basıldı — sessizlik saptayıcısı OLMADAN dinle.
   *
   * Sessizlik saptayıcısı kullanıcı hâlâ basılı tutarken kaydı kapatırdı --
   * cümlenin ortasında kesilen bir kayıt (aynı gerekçe ``notch/push-to-talk``
   * içinde de yazılı).
   */
  const beginHold = useCallback(() => {
    setActive(false)
    setError(null)
    setPhase('listening')
    void mic.start().catch((cause: unknown) => {
      setPhase('idle')
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }, [mic])

  /** Bas-konuş: bırakıldı — kaydı gönder. */
  const endHold = useCallback(() => {
    setPhase('thinking')

    void (async () => {
      try {
        const recording = await mic.stop()

        if (!recording) {
          setPhase('idle')

          return
        }

        await submitAudio(recording.audio)
      } catch (cause) {
        setPhase('idle')
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
  }, [mic, submitAudio])

  const stop = useCallback(() => {
    setActive(false)
    void mic.stop()
    stopVoicePlayback()
    streamRef.current?.session?.finish()
    streamRef.current = null
    releaseBarge(bargeRef.current)
    forgetCompanionSession(sessionRef.current)
    setCapturing(false)
    setPhase('idle')
  }, [mic])

  // Cevabi AKARKEN seslendir ve bittiginde YENIDEN dinle.
  //
  // ``streamRef`` reaktif bir degerin aynasi degil: acik bir WebSocket
  // oturumu ve o oturuma kac karakter gonderildigi.
  // eslint-disable-next-line no-restricted-syntax -- yukaridaki gerekce
  useEffect(() => {
    if (phase !== 'thinking' && phase !== 'speaking') {
      return
    }

    const pending = collectUnspokenTurnSpeech([...messages], lastSpokenId)

    if (!pending || !pending.text.trim()) {
      return
    }

    setReply(pending.text)

    if (!streamRef.current) {
      streamRef.current = { sent: 0, session: null }

      const spoken = pending

      void startSpeechStream({ source: 'voice-conversation' })
        .then(session => {
          if (streamRef.current) {
            streamRef.current.session = session
          }

          // Akis YOKSA (ag gecidi desteklemiyor) ya da hic ses uretmeden
          // kapanirsa metin TEK SEFERLIK oynatmayla seslendiriliyor.
          //
          // Bu geri dusus notch'ta vardi, buraya koymayi ATLAMISIM: sonuc
          // tam olarak "duyuyor, yaziyor, ama konusmuyor" oldu -- panel
          // TALKING yazarken hicbir ses cikmiyordu. Sessiz basarisizligin
          // ders kitabi hali.
          if (!session) {
            void playSpeechText(spoken.text, {
              messageId: spoken.id,
              source: 'voice-conversation'
            }).catch(() => undefined)

            return
          }

          void session.done.then(outcome => {
            if (outcome === 'fallback') {
              void playSpeechText(spoken.text, {
                messageId: spoken.id,
                source: 'voice-conversation'
              }).catch(() => undefined)
            }
          })
        })
        .catch(() => undefined)
    }

    const stream = streamRef.current
    const session = stream?.session

    if (stream && session && pending.text.length > stream.sent) {
      session.append(pending.text.slice(stream.sent))
      stream.sent = pending.text.length
      setPhase('speaking')
    }

    if (!pending.pending) {
      session?.finish()
      streamRef.current = null
      setLastSpokenId(pending.id)

      // Tur bitti: kullanici buraya BAKARAK konusuyor, tusa dokunmasi
      // beklenmiyor. Kisa gecikme oynatma kuyrugunun bosalmasi icin --
      // ayni karede acmak hoparlorun son hecesini mikrofona yakalatiyordu.
      if (active) {
        window.setTimeout(() => listenRef.current(), 250)
      } else {
        setPhase('idle')
      }
    }
  }, [active, lastSpokenId, messages, phase])

  // Araya girme: kullanici TUSA BASMADAN konusmaya baslayinca sus.
  const monitorActive = phase === 'thinking' || phase === 'speaking' || capturing

  // eslint-disable-next-line no-restricted-syntax -- ref'ler imperatif tutamac
  useEffect(() => {
    if (!monitorActive) {
      return
    }

    return monitorSpeechDuringPlayback({
      isPlaying: () => phaseRef.current === 'speaking',
      onSpeech: () => {
        if (!claimBarge(bargeRef.current, 'voice')) {
          return
        }

        streamRef.current?.session?.finish()
        streamRef.current = null
        stopVoicePlayback()
        void haltTurn().catch(() => undefined)
        setCapturing(true)
        setPhase('listening')
      },
      onUtterance: audio => {
        setCapturing(false)

        if (bargeRef.current.claimedBy !== 'voice') {
          return
        }

        if (!audio) {
          releaseBarge(bargeRef.current)
          setPhase('idle')
          listenRef.current()

          return
        }

        setPhase('thinking')
        void interruptThenSubmit({
          interrupt: haltTurn,
          onInterruptError: () => undefined,
          submit: () => submitAudio(audio)
        }).catch((cause: unknown) => {
          releaseBarge(bargeRef.current)
          setPhase('idle')
          setError(cause instanceof Error ? cause.message : String(cause))
        })
      }
    })
  }, [haltTurn, monitorActive, submitAudio])

  return { beginHold, endHold, error, level, phase, reply, start, stop, transcript }
}
