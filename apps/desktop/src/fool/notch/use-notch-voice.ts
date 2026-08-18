/**
 * Notch'un ses akışı: bas → konuş → bırak → gönder → dinle.
 *
 * Neden mevcut ``useVoiceConversation`` kullanılmıyor
 * ---------------------------------------------------
 * O kanca farklı bir etkileşim modeli: sesle uyanıyor, sessizliği kendi
 * saptayıp kaydı kendi kapatıyor ve cevaptan sonra kendini yeniden kuruyor
 * (VAD döngüsü). Bas-konuş bunun tam tersi — kaydın ne zaman başlayıp
 * biteceğine KULLANICI karar veriyor. İkisini tek kancaya sıkıştırmak, sessizlik
 * saptayıcısının kullanıcı hâlâ tuşu basılı tutarken kaydı kapatması demek
 * olurdu: cümlenin ortasında kesilen bir kayıt.
 *
 * Paylaşılan parçalar yine de ortak: mikrofon kaydedicisi, transkripsiyon ucu,
 * gönderim RPC'si ve "hangi baloncuk henüz seslendirilmedi" seçicisi. Yeniden
 * yazılan tek şey akışın kendisi.
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
import {
  playSpeechText,
  type SpeechStreamSession,
  startSpeechStream,
  stopVoicePlayback
} from '@/lib/voice-playback'
import { $activeSessionId, $messages } from '@/store/session'

export type NotchStatus = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

export interface NotchVoice {
  /** Son hata — notch'ta kısa bir satır olarak gösteriliyor. */
  error: null | string
  /** Mikrofon seviyesi 0..1; dalga formunu bu besliyor. */
  level: number
  /** Kullanıcının son söylediği (yazıya dökülmüş) metin. */
  transcript: string
  status: NotchStatus
  /** Tuşa basıldı — kaydı aç. */
  begin: () => void
  /** Tuş bırakıldı — kaydı kapat, yaz, gönder. */
  commit: () => void
  /** İptal: kaydı at, hiçbir şey gönderme. */
  cancel: () => void
}

export function useNotchVoice(): NotchVoice {
  const { t } = useI18n()
  // Akan mesajlar: abonelik efekt icine gomulmuyor -- kod tabaninin kurali
  // reaktif degeri dogrudan okumak (ref'e aynalamak bir render geç kalir).
  const messages = useStore($messages)
  // Mikrofon hata metinleri uygulamada ZATEN çevrili duruyor; sabit yazmak
  // notch'u tek dile çivilerdi.
  const { handle: mic, level } = useMicRecorder(t.notifications.voice)
  const { requestGateway } = useGatewayRequest()

  const [status, setStatus] = useState<NotchStatus>('idle')
  // Oynatma geri cagriminin GUNCEL durumu gormesi icin. Kapanis
  // sirasindaki state degeri bayat olur ve yaris kaybedilir.
  const statusRef = useRef<NotchStatus>('idle')

  statusRef.current = status
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<null | string>(null)

  // Hangi baloncuğa kadar seslendirdiğimiz. Bu olmadan her cevap baştan
  // okunurdu.
  //
  // ``ref`` DEĞİL state: değeri akan mesajlardan türüyor, yani reaktif. Ref'e
  // aynalamak bir render geç kalır ve aynı baloncuk iki kez seslendirilebilir.
  const [lastSpokenId, setLastSpokenId] = useState<null | string>(null)
  // Bir kaydın atılacağını işaretler. `commit` ve `cancel` yarışabiliyor
  // (tuş bırakma ile odak kaybı aynı anda gelebilir); ilk gelen kazanır.
  const discardRef = useRef(false)
  // Suren akis oturumu ve o oturuma KADAR gonderilmis karakter sayisi.
  const streamRef = useRef<{ sent: number; session: SpeechStreamSession | null } | null>(null)

  const begin = useCallback(() => {
    setError(null)
    discardRef.current = false
    setStatus('listening')
    // Ajan konuşuyorsa sustur: kullanıcı araya giriyor demektir.
    // Akış oturumu da kapatılmalı, yoksa gelen metin arkada
    // seslendirilmeye devam eder.
    streamRef.current?.session?.finish()
    streamRef.current = null
    stopVoicePlayback()
    void mic.start().catch((cause: unknown) => {
      setStatus('idle')
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }, [mic])

  const cancel = useCallback(() => {
    discardRef.current = true
    void mic.stop()
    setStatus('idle')
  }, [mic])

  const commit = useCallback(() => {
    setStatus('transcribing')

    void (async () => {
      try {
        const recording = await mic.stop()

        if (!recording || discardRef.current) {
          setStatus('idle')

          return
        }

        const dataUrl = await blobToDataUrl(recording.audio)
        const result = await transcribeAudio(dataUrl, recording.audio.type)
        const text = (result.transcript ?? '').trim()

        if (!text) {
          // Sessiz kayıt. Boş metin göndermek ajanı boşluğa cevap vermeye
          // zorlardı; sessizce başa dönmek doğru.
          setStatus('idle')

          return
        }

        setTranscript(text)
        setStatus('thinking')

        // CANLI oturum kimligi -- saklanan kimlik DEGIL. Ikisi ayri ad uzayi:
        // saklanan kimlik diske yazilan kayit, canli kimlik ag gecidinin
        // bellekteki oturumu. Saklanani gondermek ag gecidinde hicbir seye
        // denk gelmiyor ve mesaj sessizce kayboluyor -- ilk yazimda tam bu
        // oldu, kullanici "soyledigim seyler modele gitmiyor" dedi.
        const sessionId = $activeSessionId.get()

        await requestGateway('prompt.submit', {
          session_id: sessionId,
          // Notch'tan konuşuldu: kullanıcı başka bir uygulamaya bakıyor.
          // HUD ile aynı ipucu, ağ geçidi bunu tur başına bağlam olarak
          // kullanıyor.
          surface: 'hud',
          text
        })
      } catch (cause) {
        setStatus('idle')
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
  }, [mic, requestGateway])

  // Cevabı AKARKEN seslendir.
  //
  // Neden akış: baloncuğun bitmesini beklemek, uzun bir cevapta kullanıcıyı
  // sessizce bekletiyordu — model 20 saniye yazıyor, ses ancak sonunda
  // başlıyor. ``startSpeechStream`` metni parça parça alıp konuşmayı hemen
  // başlatıyor, yani bekleme süresi ortadan kalkıyor.
  //
  // ``append`` yalnızca YENİ eklenen kısmı alıyor: her seferinde tüm metni
  // göndermek aynı cümleleri defalarca okuturdu.
  //
   
  // ``streamRef`` reaktif bir değerin AYNASI değil: açık bir WebSocket
  // oturumu ve o oturuma kaç karakter gönderildiği. State'e taşımak her
  // token'da yeniden render tetiklerdi.
  // eslint-disable-next-line no-restricted-syntax -- yukarıdaki gerekçe
  useEffect(() => {
    if (status !== 'thinking' && status !== 'speaking') {
      return
    }

    const pending = collectUnspokenTurnSpeech([...messages], lastSpokenId)

    if (!pending || !pending.text.trim()) {
      return
    }

    // Akış oturumu tur başına BİR kez açılıyor.
    if (!streamRef.current) {
      streamRef.current = { sent: 0, session: null }

      void startSpeechStream({ source: 'voice-conversation' })
        .then(session => {
          if (streamRef.current) {
            streamRef.current.session = session
          }

          // Akış yoksa (ağ geçidi desteklemiyorsa) tek seferlik oynatmaya
          // düşülüyor — ses hiç çıkmamasındansa geç çıkması iyidir.
          if (!session) {
            return
          }

          void session.done.then(outcome => {
            if (outcome === 'fallback') {
              void playSpeechText(pending.text, {
                messageId: pending.id,
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
      setStatus('speaking')
    }

    // Baloncuk tamamlandı: akışı kapat ve turu bitmiş say.
    if (!pending.pending) {
      session?.finish()
      streamRef.current = null
      setLastSpokenId(pending.id)

      if (statusRef.current !== 'listening') {
        setStatus('idle')
      }
    }
  }, [lastSpokenId, messages, status])

  return { begin, cancel, commit, error, level, status, transcript }
}
