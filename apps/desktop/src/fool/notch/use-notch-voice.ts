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
import { monitorSpeechDuringPlayback } from '@/lib/voice-barge-in'
import {
  playSpeechText,
  type SpeechStreamSession,
  startSpeechStream,
  stopVoicePlayback
} from '@/lib/voice-playback'
import { $activeSessionId, $messages } from '@/store/session'

import { $voiceMode, voiceModeInfo } from '../voice-mode'

import {
  type BargeGate,
  claimBarge,
  createBargeGate,
  forceClaimBarge,
  isPlayingPhase,
  releaseBarge,
  shouldMonitorBargeIn
} from './barge-in'
import {
  createCompanionSessionState,
  ensureCompanionSession,
  forgetCompanionSession
} from './companion-session'
import {
  type BeginActivation,
  listenOptionsFor,
  modeForActivation
} from './hands-free'
import { interruptThenSubmit, shouldInterruptTurn } from './interrupt'
import {
  createFillerState,
  FILL_AFTER_MS,
  resetTurn,
  shouldFill,
  takeFiller
} from './thinking-filler'

export type NotchStatus = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

export interface NotchVoice {
  /** Son hata — notch'ta kısa bir satır olarak gösteriliyor. */
  error: null | string
  /** Araya girme yakalaması sürüyor mu? Yeniden açma kararını besliyor. */
  capturing: boolean
  /** Son turda hiç konuşma duyuldu mu? Sessiz tur sayacını besliyor. */
  heardSpeech: boolean
  /** Mikrofon seviyesi 0..1; dalga formunu bu besliyor. */
  level: number
  /** Kullanıcının son söylediği (yazıya dökülmüş) metin. */
  transcript: string
  status: NotchStatus
  /**
   * Kaydı aç. ``'key'`` tuşa basıldı (bas-konuş), ``'auto'`` eller serbest
   * döngüsü kendiliğinden açtı (sessizlik kaydı bitirir).
   */
  begin: (activation?: BeginActivation) => void
  /** Tuş bırakıldı — kaydı kapat, yaz, gönder. */
  commit: () => void
  /** İptal: kaydı at, hiçbir şey gönderme. */
  cancel: () => void
  /** Notch oturumu kapandı — arkadaş oturumunu unut. */
  endSession: () => void
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
  // Turu kimin kestigi. Tus ve ses ayni anda gelebiliyor; kapisiz birakmak
  // ayni cumleyi modele iki kez gonderiyordu.
  const bargeRef = useRef<BargeGate>(createBargeGate())
  // Araya girme yakalamasi SURUYOR mu? Izleyici, durum 'listening'e dondugu
  // an sokulup atilirsa yakaladigi cumleyi teslim edemeden olur -- yani
  // kullanicinin araya girerken soyledigi sey kaybolur. Bu bayrak izleyiciyi
  // teslimat bitene kadar ayakta tutuyor.
  const [capturing, setCapturing] = useState(false)
  // Son turda konuşma duyuldu mu? Boşta zaman aşımıyla kapanan bir kayıt
  // "kullanıcı orada değil" demek; sessiz tur sayacı bunu sayıyor.
  const [heardSpeech, setHeardSpeech] = useState(false)
  // Doldurma durumu ref'te: klavye/zamanlayici yollarindan okunuyor ve
  // state'e tasimak her turda gereksiz render demekti.
  const fillerRef = useRef(createFillerState())
  // Bu turda cevaptan metin geldi mi? Geldiyse sessizlik bitti.
  const speechStartedRef = useRef(false)
  // Sesli arkadasin KENDI oturumu. Bugune kadar masaustu sohbet panelinin
  // oturumu kullaniliyordu ve o oturum ``desktop`` kapsaminda kuruluyor:
  // olculdu, 21 takim / 73 arac / 8 tanesi makineye dokunuyor. Yani "hava
  // nasil?" diyen arkadas ``terminal_run`` ve ``computer_use``a sahipti.
  const companionRef = useRef(createCompanionSessionState())
  // ``onSilence`` geri çağrımı ``commit``ten ÖNCE kuruluyor; ref olmadan
  // tanımlanmamış bir değere kapanır.
  const commitRef = useRef<() => void>(() => undefined)

  // Suren turu ag gecidinde DURDUR.
  //
  // Oynatmayi kesmek yetmiyordu: model cevabi uretmeye devam ediyor, kalan
  // tokenlar geliyor ve ``collectUnspokenTurnSpeech`` onlari YENI tur
  // bittikten sonra seslendiriyor -- kullanici sozunu kesti, ajan biraz sonra
  // kaldigi yerden devam ediyor. Composer tarafi bu dikisi zaten kullaniyordu
  // (``use-voice-conversation.ts``), notch hic kullanmiyordu.
  const haltTurn = useCallback(async () => {
    if (!shouldInterruptTurn(statusRef.current)) {
      return
    }

    // Durdurma ARKADAS oturumuna gitmeli: paylasilan oturumu durdurmak,
    // kullanicinin sohbet panelinde suren isini kesmek olurdu.
    const sessionId = companionRef.current.id ?? $activeSessionId.get()

    if (!sessionId) {
      return
    }

    await requestGateway('session.interrupt', { session_id: sessionId })
  }, [requestGateway])

  const begin = useCallback((activation: BeginActivation = 'key') => {
    setError(null)
    discardRef.current = false
    // Tuşa basmak açık bir niyet: sesle başlamış bir yakalama varsa devral.
    // Kapıyı ilk gelene bırakmak tuşu sessizce yutardı — mikrofon açılmaz,
    // kullanıcı boşluğa konuşurdu.
    forceClaimBarge(bargeRef.current, 'key')
    setCapturing(false)
    setHeardSpeech(false)
    setStatus('listening')
    // Ajan konuşuyorsa sustur: kullanıcı araya giriyor demektir.
    // Akış oturumu da kapatılmalı, yoksa gelen metin arkada
    // seslendirilmeye devam eder.
    streamRef.current?.session?.finish()
    streamRef.current = null
    stopVoicePlayback()
    // Tuşla araya girmek de araya girmektir: süren tur durmalı, yoksa eski
    // cevabın kalanı yeni turdan sonra konuşulur.
    void haltTurn().catch(() => undefined)

    // Eller serbest kipte kaydın sınırını sessizlik çiziyor; bas-konuşta
    // KULLANICI çiziyor. İkisine aynı ayarı vermek, tuş hâlâ basılıyken
    // kaydın kapanması demekti — cümlenin ortasında kesilen bir kayıt.
    const options = listenOptionsFor(modeForActivation(activation))

    void mic
      .start(
        options
          ? {
              ...options,
              onSilence: () => {
                // Sessizlik turu bitirdi: konuşma duyulmuştu, yoksa
                // ``onSilence`` değil boşta zaman aşımı çalışırdı.
                setHeardSpeech(true)
                commitRef.current()
              }
            }
          : undefined
      )
      .catch((cause: unknown) => {
        setStatus('idle')
        setError(cause instanceof Error ? cause.message : String(cause))
      })
  }, [haltTurn, mic])

  /** Notch oturumu kapandı — bir sonraki açılış TEMİZ bir arkadaş oturumu alsın. */
  const endSession = useCallback(() => {
    forgetCompanionSession(companionRef.current)
  }, [])

  const cancel = useCallback(() => {
    discardRef.current = true
    void mic.stop()
    releaseBarge(bargeRef.current)
    setCapturing(false)
    setStatus('idle')
  }, [mic])

  // Arkadas oturumunu getir; acilamazsa PAYLASILAN oturuma dus.
  //
  // Sesli sohbetin HIC calismamasi, kisitlanmamis calismasindan daha kotu bir
  // sonuc: ag gecidi henuz ayakta degilse kullanici yine konusabilmeli.
  const resolveSessionId = useCallback(async () => {
    // Kapsami SESLI KIP belirliyor: arkadas kisitli, Jarvis sahibinin tam
    // yuzeyi. Kip degistiyse ``ensureCompanionSession`` yeni bir oturum aciyor
    // -- arac kumesi ajan kurulurken donuyor ve eskisini kullanmaya devam
    // etmek kullanicinin sectigi kipi sessizce yok saymakti.
    const own = await ensureCompanionSession(companionRef.current, {
      create: params =>
        requestGateway('session.create', params) as Promise<{ session_id?: string }>,
      source: voiceModeInfo($voiceMode.get()).source
    })

    return own ?? $activeSessionId.get()
  }, [requestGateway])

  // Yazıya dök ve gönder. İKİ giriş yolu paylaşıyor: tuşla biten kayıt ve
  // araya girerken yakalanan cümle. Ayrı yazmak, ikisinden birinin canlı
  // oturum kimliği gibi bir ayrıntıyı kaçırması demekti.
  const submitAudio = useCallback(
    async (audio: Blob) => {
      const dataUrl = await blobToDataUrl(audio)
      const result = await transcribeAudio(dataUrl, audio.type)
      const text = (result.transcript ?? '').trim()

      if (!text) {
        // Sessiz kayıt. Boş metin göndermek ajanı boşluğa cevap vermeye
        // zorlardı; sessizce başa dönmek doğru.
        setStatus('idle')
        releaseBarge(bargeRef.current)

        return
      }

      setTranscript(text)
      // Yeni tur: doldurma hakki yenileniyor, sessizlik sayaci sifirlaniyor.
      resetTurn(fillerRef.current)
      speechStartedRef.current = false
      setStatus('thinking')
      // Yeni tur başladı: bir sonraki araya girme kapıyı yeniden talep
      // edebilmeli.
      releaseBarge(bargeRef.current)

      // CANLI oturum kimligi -- saklanan kimlik DEGIL. Ikisi ayri ad uzayi:
      // saklanan kimlik diske yazilan kayit, canli kimlik ag gecidinin
      // bellekteki oturumu. Saklanani gondermek ag gecidinde hicbir seye
      // denk gelmiyor ve mesaj sessizce kayboluyor -- ilk yazimda tam bu
      // oldu, kullanici "soyledigim seyler modele gitmiyor" dedi.
      const sessionId = await resolveSessionId()

      await requestGateway('prompt.submit', {
        session_id: sessionId,
        // Notch'tan konuşuldu: kullanıcı başka bir uygulamaya bakıyor.
        // HUD ile aynı ipucu, ağ geçidi bunu tur başına bağlam olarak
        // kullanıyor.
        surface: 'hud',
        text
      })
    },
    [requestGateway, resolveSessionId]
  )

  const commit = useCallback(() => {
    setStatus('transcribing')

    void (async () => {
      try {
        const recording = await mic.stop()

        if (!recording || discardRef.current) {
          setStatus('idle')
          releaseBarge(bargeRef.current)

          return
        }

        await submitAudio(recording.audio)
      } catch (cause) {
        setStatus('idle')
        releaseBarge(bargeRef.current)
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
  }, [mic, submitAudio])

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
      // Cevap geldi: sessizlik bitti, doldurma penceresi kapandi.
      speechStartedRef.current = true
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

  // Araya girme: kullanıcı TUŞA BASMADAN konuşmaya başlayınca da sus.
  //
  // ``lib/voice-barge-in.ts`` bu işi zaten yapabiliyordu ama notch onu hiç
  // çağırmıyordu; araya girmenin tek yolu sağ Ctrl'ye basmaktı. İnsanla
  // konuşurken kimse araya girmek için düğmeye basmaz.
  //
  // İzleyici ``thinking`` evresinde DE açık: model cevabı üretirken 1-3
  // saniye tam sessizlik oluyor ve kullanıcı çoğu zaman tam o boşlukta
  // fikrini değiştirip konuşuyor. Yalnızca oynatma sırasında izlemek o araya
  // girmeyi tamamen kaçırıyordu.
  //
  // İzleyici ÖN KAYIT tutuyor: tetiklendiği anda yeni bir kaydedici açmak
  // "dur, aslında—" cümlesinin ilk hecelerini yer. Bu yüzden yakalanan ses
  // doğrudan gönderim yoluna veriliyor, kullanıcıdan tekrar istenmiyor.
  const monitorActive = shouldMonitorBargeIn(status) || capturing

  // Buradaki ref'ler reaktif bir degerin AYNASI degil: ``statusRef`` render
  // sirasinda yaziliyor (efekt icinde degil) ve ``bargeRef`` / ``streamRef``
  // birer imperatif tutamac -- kapi durumu ve acik bir WebSocket oturumu.
  // State'e tasimak izleyiciyi her durum degisiminde sokup atardi; o da her
  // seferinde yeni bir ``getUserMedia`` akisi ve sifirlanan gurultu tabani
  // demek.
  // eslint-disable-next-line no-restricted-syntax -- yukaridaki gerekce
  useEffect(() => {
    if (!monitorActive) {
      return
    }

    // Durum ``thinking`` <-> ``speaking`` arasında gidip gelirken izleyici
    // YENİDEN kurulmamalı: her kurulum yeni bir ``getUserMedia`` akışı açar
    // ve gürültü tabanı kalibrasyonunu sıfırlar. Bu yüzden efekt tek bir
    // boolean'a bağlı ve güncel durum ``statusRef`` üzerinden okunuyor.
    const stop = monitorSpeechDuringPlayback({
      isPlaying: () => isPlayingPhase(statusRef.current),
      onSpeech: () => {
        if (!claimBarge(bargeRef.current, 'voice')) {
          // Kullanıcı aynı anda tuşa da bastı; o yol kaydı zaten yönetiyor.
          return
        }

        // Akış oturumu da kapatılmalı, yoksa gelen metin arkada
        // seslendirilmeye devam eder.
        streamRef.current?.session?.finish()
        streamRef.current = null
        stopVoicePlayback()
        // Durdurma HEMEN gidiyor, yakalamanın bitmesi beklenmiyor: kullanıcı
        // konuşurken model saniyelerce üretmeye devam ederdi ve o metin
        // bağlama girerdi.
        void haltTurn().catch(() => undefined)
        setCapturing(true)
        setStatus('listening')
      },
      onUtterance: audio => {
        if (bargeRef.current.claimedBy !== 'voice') {
          // Tuş devraldı — yakalanan sesi göndermek çift gönderim olurdu.
          setCapturing(false)

          return
        }

        setCapturing(false)

        if (!audio) {
          // Yakalama yoksa kullanıcıyı sessizliğe düşürme: başa dön.
          releaseBarge(bargeRef.current)
          setStatus('idle')

          return
        }

        setStatus('transcribing')
        // Sıra garanti: gönderim, durdurma çözülmeden başlamıyor. Ters
        // sırada çalıştırmak yeni istemi MEŞGUL bir oturuma yollamaktı.
        // Durdurma düşerse cümle YİNE gönderiliyor -- ağ hatasını yutup
        // kullanıcının konuşmasını çöpe atmak daha kötü bir sonuç.
        void interruptThenSubmit({
          interrupt: haltTurn,
          onInterruptError: () => undefined,
          submit: () => submitAudio(audio)
        }).catch((cause: unknown) => {
          setStatus('idle')
          releaseBarge(bargeRef.current)
          setError(cause instanceof Error ? cause.message : String(cause))
        })
      }
    })

    return stop
  }, [haltTurn, monitorActive, submitAudio])

  // Dusunme sessizligini doldur.
  //
  // Kullanici konusmayi bitiriyor, model cevabi uretmeye basliyor ve arada
  // 1-3 saniye TAM sessizlik oluyor. Ekranda "Thinking..." yaziyor ama
  // kullanici cogu zaman ekrana bakmiyor -- notch'un butun amaci bu. Kulakta
  // hicbir sey yok ve konusma olmus gibi duyuluyor: kullanici ya tekrar
  // konusuyor (araya girme sayiliyor) ya da bekleyip bekleyemeyecegini
  // bilemiyor.
  //
  // Her bosluk DOLDURULMUYOR: kisa bir duraklama insan konusmasinda zaten
  // var ve her turda "hmm" demek bir sure sonra bir tik gibi duyuluyor.
  // Kural dar -- yalnizca esigi gecen bosluk, tur basina bir kez, arka
  // arkaya ayni sozcuk olmadan (bkz. thinking-filler.ts).
  //
   
  // tutamac (doldurma durumu, akis oturumu), reaktif deger aynasi degil
  useEffect(() => {
    if (status !== 'thinking') {
      return
    }

    const timer = setTimeout(() => {
      const allowed = shouldFill(fillerRef.current, {
        elapsedMs: FILL_AFTER_MS,
        enabled: true,
        hasSpeechStarted: speechStartedRef.current,
        // Araya girme surerken doldurmak, kullanicinin ustune konusmak olur.
        interrupted: bargeRef.current.claimedBy === 'voice'
      })

      if (!allowed) {
        return
      }

      // Tek seferlik oynatma kullaniliyor, akis oturumu DEGIL: akis oturumu
      // turun cevabina ait ve doldurma sozcugunu oraya yazmak onu cevabin
      // basina yapistirirdi.
      void playSpeechText(takeFiller(fillerRef.current), {
        source: 'voice-conversation'
      }).catch(() => undefined)
    }, FILL_AFTER_MS)

    return () => clearTimeout(timer)
  }, [status])

  commitRef.current = commit

  return {
    begin,
    cancel,
    capturing,
    commit,
    endSession,
    error,
    heardSpeech,
    level,
    status,
    transcript
  }
}
