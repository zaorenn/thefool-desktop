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
  interruptVoicePlayback,
  playSpeechText,
  type SpeechStreamSession,
  startSpeechStream,
  takeVoicePlaybackInterrupted
} from '@/lib/voice-playback'
import { isVoiceStopCommand } from '@/lib/voice-stop-word'
import { ownsAmbientCue } from '@/store/ambient'
import { $busy, $messages } from '@/store/session'
import { $voicePlayback } from '@/store/voice-playback'

import { voiceApi } from '../voice-api'
import { canSpeak, claimVoice, releaseVoice } from '../voice-owner'

import { $voiceSessionId, waitForVoiceSession } from './active-session'
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
  type BeginActivation,
  listenOptionsFor,
  modeForActivation
} from './hands-free'
import { interruptThenSubmit, shouldInterruptTurn } from './interrupt'
import { createPttSpeechState, observeLevel } from './ptt-speech'
import {
  createFillerState,
  FILL_AFTER_MS,
  resetTurn,
  shouldFill,
  takeFiller
} from './thinking-filler'
import { turnEndAction } from './turn-end'

/**
 * Baska bir yuzeyin ustlendigi cevap kimlikleri icin ust sinir.
 *
 * Kayit yalnizca "bu cevabi bir daha talep etme" demek ve bir cevap ancak
 * geldigi anda talep ediliyor -- saatler sonra degil. Sinirsiz birakmak, uzun
 * bir oturumda her cevabin kimligini sonsuza kadar tutmakti.
 */
const DECLINED_CAP = 200

/** Kaydi ekle ve seti sinirda tut (en eskiler dusuyor). */
function rememberDeclined(declined: Set<string>, id: string): void {
  declined.add(id)

  while (declined.size > DECLINED_CAP) {
    const oldest = declined.values().next().value

    if (oldest === undefined) {
      return
    }

    declined.delete(oldest)
  }
}

export type NotchStatus = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

/**
 * Ses için beklenecek en uzun süre.
 *
 * Oynatma katmanının kendi bekçileri var (ilk-ses ve duraklama sınırları); bu
 * yalnızca takılı bir oynatmanın çentiği sonsuza kadar açık bırakmaması için.
 */
const TURN_AUDIO_CAP_MS = 120_000

export interface NotchVoice {
  /** Son hata — notch'ta kısa bir satır olarak gösteriliyor. */
  error: null | string
  /** Araya girme yakalaması sürüyor mu? Yeniden açma kararını besliyor. */
  capturing: boolean
  /** Son turda hiç konuşma duyuldu mu? Sessiz tur sayacını besliyor. */
  heardSpeech: boolean
  /** Mikrofon seviyesi 0..1; dalga formunu bu besliyor. */
  level: number
  /** Ajanın son cevabı -- notch onu GÖSTERİYOR, sadece okumuyor. */
  reply: string
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

interface NotchVoiceOptions {
  /**
   * Kullanıcı "dur" dedi (ya da "boşver", "hoşça kal"...).
   *
   * ``useVoiceConversation`` ile AYNI ad ve AYNI anlam. Sohbet kipi bu
   * sözcükleri bir tur olarak GÖNDERMİYOR, konuşmayı bitiriyor; notch
   * göndermeye devam ediyordu, yani "dur" demek modele "dur" yazmaktı ve
   * konuşma hiç bitmiyordu. Kullanıcının istediği "notch bu conversation
   * modun birebir aynısı olmalı" tam olarak bu tür farklar.
   */
  onStopWord?: () => void
}

export function useNotchVoice({ onStopWord }: NotchVoiceOptions = {}): NotchVoice {
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
  // Ajanin cevabi. Notch artik sohbet yuzeyi: kullanici ne dendigini
  // GORMELI, yalnizca duymak gurultulu bir odada yetmiyor.
  const [reply, setReply] = useState('')
  const [error, setError] = useState<null | string>(null)
  // Geri cagirim ref'te: ``submitAudio`` bagimliligina koymak, cagiran her
  // yeni fonksiyon verdiginde onu yeniden kurardi ve suren bir yakalamayi
  // koparirdi. (Reaktif deger DEGIL -- bir prop.)
  const onStopWordRef = useRef(onStopWord)

  onStopWordRef.current = onStopWord

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
  // Baska bir yuzeyin ustlendigi cevaplar. Bu olmadan efekt her token'da
  // yeniden talep ederdi: talep reddedilince ``streamRef`` bosaliyor ve bir
  // sonraki tik ayni yolu bastan denerdi -- saniyede onlarca bosuna IPC.
  const declinedRef = useRef<Set<string>>(new Set())
  // Bu turun EN GUNCEL konusma metni.
  //
  // Yedek yol bunu okuyor, akisin acilisinda yakalanan ``pending`` nesnesini
  // DEGIL: o nesne oturum acilirken donduruluyor ve cevap o anda daha yeni
  // baslamis oluyor. Kapanista onu okumak, uzun bir cevabin yalnizca ilk
  // cumlesini seslendirmek demekti. Ustelik cevap tamamlaninca
  // ``lastSpokenId`` yaziliyor ve ``collectUnspokenTurnSpeech`` artik ``null``
  // donuyor -- yani metni geri okumanin baska yolu kalmiyor.
  const turnSpeechRef = useRef<null | { id: string; pending: boolean; text: string }>(null)
  // Akis bu cevap icin HIC ses uretmedi: kimlik burada bekliyor ve cevap
  // TAMAMLANINCA tek seferlik yoldan okunuyor.
  const fallbackRef = useRef<null | string>(null)
  // Yedek yol metin AKARKEN kurulduysa efektin bir kez daha kosmasi gerekiyor:
  // cevap zaten tamamlanmissa yeni bir ``messages`` tiki gelmeyebilir.
  const [fallbackTick, setFallbackTick] = useState(0)
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
  // Metin bitti ama SES sürüyor: tur, oynatma boşa düşene kadar ayakta.
  const awaitingPlaybackRef = useRef(false)
  // Bu basışta konuşma duyuldu mu? Araya girme kararını bu taşıyor.
  const speechGateRef = useRef(createPttSpeechState())
  // Sesli arkadasin KENDI oturumu. Bugune kadar masaustu sohbet panelinin
  // oturumu kullaniliyordu ve o oturum ``desktop`` kapsaminda kuruluyor:
  // olculdu, 21 takim / 73 arac / 8 tanesi makineye dokunuyor. Yani "hava
  // nasil?" diyen arkadas ``terminal_run`` ve ``computer_use``a sahipti.
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

    // Durdurma YALNIZCA arkadas oturumuna gidiyor.
    //
    // Burada ``?? $voiceSessionId.get()`` vardi ve hemen ustundeki yorumun
    // yasaklad|g| seyi yap|yordu: arkadas oturumu henuz acilmamisken
    // bas-konusa basmak, kullanicinin SOHBET PANELINDE suren isini
    // kesiyordu. Yorum ile kod ayrismisti.
    //
    // Durduracak bir sey yoksa dogru davranis hicbir sey yapmamak.
    const sessionId = $voiceSessionId.get()

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
    // Kullanici notch'ta konusmaya basladi: sesin sahibi o (Friend
    // penceresi acik degilse).
    claimVoice('notch')
    setCapturing(false)
    setHeardSpeech(false)
    setStatus('listening')

    // Motoru KULLANICI KONUŞURKEN ısıt.
    //
    // Isıtma bugüne kadar yalnızca çentik oturumu AÇILIRKEN çağrılıyordu.
    // Motor boşta 300 sn sonra boşaltıldığı için (kullanıcının kendi isteği)
    // her uzun aradan sonra soğuk bedel geri geliyordu: ölçüldü, kokoro
    // soğuk 29,43 sn / sıcak 1,07 sn.
    //
    // Zamanlayıcıyla sıcak tutmak YANLIŞ cevap olurdu -- kullanıcı motorun
    // 5 dakika sonra kapanmasını açıkça istedi. Doğru an bu: mikrofon
    // açılıyor, kullanıcı konuşmaya başlıyor ve yükleme o saniyelerin
    // arkasına gizleniyor. Cevap akmaya başladığında motor ayakta oluyor.
    //
    // Çağrı UCUZ ve korumalı: uç nokta hemen dönüyor ve ``tts_warmup.warm``
    // zaten ısınıyorsa yeni iş başlatmıyor.
    void voiceApi.warmVoice().catch(() => undefined)
    // Bekleyen "sesi bekle" bayrağı düşüyor: kullanıcı yeni bir tur açtı.
    awaitingPlaybackRef.current = false

    // ARAYA GİRME BURADA DEĞİL.
    //
    // Eskiden ``stopVoicePlayback()`` ve ``haltTurn()`` tam burada, tuşa
    // BASILDIĞI anda çağrılıyordu. Yani sağ Ctrl'ye yanlışlıkla dokunmak --
    // ya da ne söyleyeceğine karar vermeden basmak -- modelin cevabını
    // öldürüyordu, üstelik geri dönüşü olmadan.
    //
    // Kullanıcının istediği kural: tuşa basılması yetmez, o tuş basılıyken
    // GERÇEKTEN konuşulduğu anlaşıldığında kesilsin. Karar aşağıdaki
    // ``onLevel`` geri çağrısında, eşik ve süre kuralı ``./ptt-speech.ts``de.
    speechGateRef.current = createPttSpeechState()

    // Eller serbest kipte kaydın sınırını sessizlik çiziyor; bas-konuşta
    // KULLANICI çiziyor. İkisine aynı ayarı vermek, tuş hâlâ basılıyken
    // kaydın kapanması demekti — cümlenin ortasında kesilen bir kayıt.
    const options = listenOptionsFor(modeForActivation(activation))

    const onLevel = (level: number) => {
      const speaking = observeLevel(speechGateRef.current, {
        level,
        now: Date.now(),
        // Eşik oynatma sırasında yükseliyor: hoparlör sızıntısı tek başına
        // araya girme sayılmamalı.
        playing: $voicePlayback.get().status !== 'idle'
      })

      if (!speaking) {
        return
      }

      setHeardSpeech(true)
      // ŞİMDİ araya giriliyor: akış oturumu kapanıyor, ses kesiliyor ve süren
      // tur durduruluyor -- yoksa eski cevabın kalanı yeni turdan sonra
      // konuşulur.
      streamRef.current?.session?.finish()
      streamRef.current = null
      // Susturmak ve MODELE SOYLEMEK tek is: bkz. ``interruptVoicePlayback``.
      // Burada yalnizca susturuluyordu, yani centikte sozunu kestiginizde
      // model bunu hic ogrenmiyor ve cumlesini bitirmis gibi devam ediyordu.
      interruptVoicePlayback()
      void haltTurn().catch(() => undefined)
    }

    void mic
      .start({
        ...(options ?? {}),
        onLevel,
        ...(options
          ? {
              onSilence: () => {
                // Sessizlik turu bitirdi: konuşma duyulmuştu, yoksa
                // ``onSilence`` değil boşta zaman aşımı çalışırdı.
                setHeardSpeech(true)
                commitRef.current()
              }
            }
          : {})
      })
      .catch((cause: unknown) => {
        setStatus('idle')
        setError(cause instanceof Error ? cause.message : String(cause))
      })
  }, [haltTurn, mic])

  /**
   * Notch kapandı — mikrofonu bırak ama SOHBETİ BİTİRME.
   *
   * Eskiden burada ``forgetCompanionSession`` vardı ve notch'u kapatmak
   * hafızayı siliyordu. Ölçüldü (kullanıcının ``state.db``si): 14 Friend
   * oturumu, ortalama 4,6 mesaj -- masaüstü sohbetinde 28,3. Yeni bir sohbet
   * artık açık bir eylem (bkz. ``friend-session.ts``).
   */
  const endSession = useCallback(() => {
    releaseVoice('notch')
  }, [])

  const cancel = useCallback(() => {
    discardRef.current = true
    void mic.stop()
    releaseBarge(bargeRef.current)
    setCapturing(false)
    setStatus('idle')
  }, [mic])

  /**
   * Sesin gittiği oturum: KULLANICININ AÇIK SOHBETİ.
   *
   * Arada hiçbir şey yok. Önce sesin kendi ``companion``/``friend`` kapsamı
   * vardı ve ayrı bir oturum açıyordu; Friend/Jarvis kipleri kaldırıldığı
   * için o ayrım da kalktı. Kullanıcının isteği birebir: "direkt olarak
   * chatten konuşabilelim, hiçbir aracı olmadan sesimiz direkt modele
   * gitsin."
   *
   * Sonucu açıkça yazılmalı: ses artık sohbet panelinin kapsamında koşuyor
   * (``desktop`` -- terminal, dosya, kod dahil). Bunu ayıran mekanizma
   * kiplerdi ve kipler kullanıcının kararıyla kaldırıldı.
   */
  const resolveSessionId = useCallback(async () => waitForVoiceSession(), [])


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

      // "Dur" bir TUR DEGIL.
      //
      // Sohbet kipi bunu zaten boyle ele aliyordu; notch metni oldugu gibi
      // gonderiyordu, yani konusmayi bitirmenin sesli yolu yoktu ve model
      // "dur" diye bir mesaj aliyordu. Esleme YALNIZCA butun cumle bir
      // durdurma ifadesiyken tutuyor, o yuzden "stop the container" gercek
      // bir istek olarak gecmeye devam ediyor.
      if (isVoiceStopCommand(text)) {
        streamRef.current?.session?.finish()
        streamRef.current = null
        interruptVoicePlayback()
        void haltTurn().catch(() => undefined)
        releaseBarge(bargeRef.current)
        setCapturing(false)
        setStatus('idle')
        onStopWordRef.current?.()

        return
      }

      setTranscript(text)
      setReply('')
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

      if (!sessionId) {
        // Sessizce yutmak, kullanicinin konusup hicbir sey olmadigini
        // gormesi olurdu -- ve deposunda tam olarak bu vardi: sifir mesajli
        // oturumlar.
        //
        // Mesaj NE YAPILACAGINI soyluyor. Onceki hali ("Could not open a
        // voice session") sebebi de caresi de vermiyordu: oturumu ana pencere
        // aciyor, centik yalnizca onu okuyor. Kullanici centige bakip
        // bekleyebilirdi.
        setError('No chat is open yet — open one in the main window, then talk')
        setStatus('idle')

        return
      }

      // Sozunu KESTIYSE model bunu ogrenmeli.
      //
      // Mandal araya girme yollarinda kuruluyor ve besteci gonderimi onu
      // zaten tuketiyor (``use-prompt-actions/submit.ts``). Notch ag gecidine
      // DOGRUDAN gidiyor, yani o yoldan gecmiyor: tuketilmezse bayrak orada
      // asili kalir ve KULLANICININ YAZDIGI bir sonraki mesaj, hicbir seyin
      // kesilmedigi bir anda "sozunu kestim" diye isaretlenirdi.
      const interrupted = takeVoicePlaybackInterrupted()

      await requestGateway('prompt.submit', {
        session_id: sessionId,
        ...(interrupted ? { interrupted } : {}),
        // Notch'tan konuşuldu: kullanıcı başka bir uygulamaya bakıyor.
        // HUD ile aynı ipucu, ağ geçidi bunu tur başına bağlam olarak
        // kullanıyor.
        surface: 'hud',
        text
      })
    },
    [haltTurn, requestGateway, resolveSessionId]
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

  /**
   * Akış hiç ses üretmedi — metni TEK SEFERLİK yoldan oku.
   *
   * Metin ``turnSpeechRef``ten okunuyor: akışın açıldığı andaki kopya bayat
   * olur. Cevap hâlâ akıyorsa yalnızca işaretleniyor ve efekt tamamlanınca
   * okuyor.
   */
  const armFallback = useCallback((id: string) => {
    const snapshot = turnSpeechRef.current

    if (!snapshot || snapshot.id !== id) {
      return
    }

    if (snapshot.pending) {
      fallbackRef.current = id
      setFallbackTick(tick => tick + 1)

      return
    }

    void playSpeechText(snapshot.text, {
      messageId: id,
      source: 'voice-conversation'
    }).catch(() => undefined)
  }, [])

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

    // Friend penceresi acikken o konusuyor: notch sessiz kalip yalnizca
    // DURUMU gosteriyor (bkz. fool/voice-owner.ts). Iki yuzey birden
    // seslendirmeye kalkinca her biri digerini iptal ediyordu.
    if (!canSpeak('notch')) {
      return
    }

    const pending = collectUnspokenTurnSpeech(messages, lastSpokenId)

    if (pending?.text) {
      setReply(pending.text)
    }

    if (!pending || !pending.text.trim()) {
      return
    }

    turnSpeechRef.current = { id: pending.id, pending: pending.pending, text: pending.text }

    // YEDEK YOL: akis bu cevap icin hic ses uretmedi ve metin o sirada hala
    // akiyordu. Cevap tamamlanana kadar bekleniyor -- yarim cevabi okuyup
    // kalanini hic okumamak, sessiz kalmanin bir baskasi olurdu.
    if (fallbackRef.current) {
      if (fallbackRef.current !== pending.id) {
        fallbackRef.current = null
      } else {
        if (pending.pending) {
          return
        }

        fallbackRef.current = null
        setLastSpokenId(pending.id)

        void playSpeechText(pending.text, {
          messageId: pending.id,
          source: 'voice-conversation'
        }).catch(() => undefined)

        if (statusRef.current !== 'listening') {
          setStatus('idle')
        }

        return
      }
    }

    // Akış oturumu tur başına BİR kez açılıyor.
    if (!streamRef.current && !declinedRef.current.has(pending.id)) {
      streamRef.current = { sent: 0, session: null }

      // Bu cevabı seslendirme hakkı ANA SÜREÇTEN alınıyor.
      //
      // ``canSpeak`` bu yarışı hiç taşımıyordu: ``$voiceOwner`` düz bir atom
      // ve çentik AYRI bir ``BrowserWindow``. ``claimVoice('notch')`` yalnızca
      // çentiğin kendi kopyasına yazıyor, ana penceredeki
      // ``canSpeak('composer')`` her zaman ``true`` dönüyordu. Yani sahiplik
      // hakemi tam da var olma sebebi olan durumda -- iki PENCERE arasında --
      // hiçbir şey yapmıyordu ve kullanıcı aynı cümleyi iki kez duyuyordu.
      //
      // ``ownsAmbientCue`` ana süreçte çözülüyor (``electron/event-dedupe.ts``)
      // ve yarışsız. Besteci zaten onu kullanıyordu; eksik olan çentiğin
      // katılmasıydı.
      //
      // Öncelik bedavaya geliyor: çentik AKARKEN talep ediyor (ilk token'da),
      // besteci ise ancak cevap TAMAMLANINCA. Yani çentik açıkken her zaman
      // önce o talep ediyor ve kazanıyor.
      const claimId = pending.id

      void ownsAmbientCue(`speak:${claimId}`)
        .then(owns => {
          if (!owns) {
            // Başka bir yüzey bu cevabı üstlendi. Akışı hiç açma: açmak
            // "iptal edildi" durumuna düşüp iki sentezi birden başlatırdı.
            rememberDeclined(declinedRef.current, claimId)
            streamRef.current = null

            return null
          }

          // ``messageId`` VERİLİYOR: ``claimSpeech`` onsuz ``undefined`` alıp
          // her zaman ``true`` dönüyordu, yani pencere İÇİ tekilleştirme de
          // baypas ediliyordu.
          return startSpeechStream({ messageId: claimId, source: 'voice-conversation' })
        })
        .then(session => {
          if (streamRef.current) {
            streamRef.current.session = session
          }

          // Akış yoksa (ağ geçidi desteklemiyorsa) tek seferlik oynatmaya
          // düşülüyor — ses hiç çıkmamasındansa geç çıkması iyidir. Bu satir
          // bir YORUM olarak vardi ama karsiligi yazilmamisti: akis ucu
          // olmayan bir arka uctan hicbir ses cikmiyordu.
          if (!session) {
            armFallback(claimId)

            return
          }

          void session.done.then(outcome => {
            if (outcome === 'fallback') {
              armFallback(claimId)
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

    // Baloncuk tamamlandı: akışı kapat. Turu bitirmek AYRI bir karar --
    // metin sesin saniyelerce önünde gidiyor (bkz. ``./turn-end.ts``).
    if (!pending.pending) {
      session?.finish()
      streamRef.current = null
      setLastSpokenId(pending.id)

      const action = turnEndAction({
        playbackIdle: $voicePlayback.get().status === 'idle',
        replyComplete: true,
        status: statusRef.current
      })

      if (action === 'end') {
        setStatus('idle')
      } else if (action === 'hold-for-audio') {
        // Ses sürüyor: tur AYAKTA. Aşağıdaki etki, oynatma boşa düştüğü anda
        // bitiriyor.
        awaitingPlaybackRef.current = true
        setStatus('speaking')
      }
    }
  }, [armFallback, fallbackTick, lastSpokenId, messages, status])

  // Metin bitti, ses sürüyor: turu SESİN sonunda bitir.
  //
  // Bu bekleyiş olmadan çentik model konuşurken kapanıyor, araya girme
  // izleyicisi sökülüyor ve ne sesle ne tuşla araya girilebiliyordu --
  // gerekçenin tamamı ``./turn-end.ts``de.
  //
  // ``awaitingPlaybackRef`` reaktif bir değerin AYNASI değil: "bu tur sesi
  // bekliyor" diyen imperatif bir bayrak, ve tek yazarı bir üstteki efekt.
  // Reaktif olan değer (``$voicePlayback``) geri çağrının içinde DOĞRUDAN
  // okunuyor, ki kuralın koruduğu şey de bu.
  // eslint-disable-next-line no-restricted-syntax -- yukarıdaki gerekçe
  useEffect(() => {
    if (!awaitingPlaybackRef.current) {
      return undefined
    }

    const finish = () => {
      if (!awaitingPlaybackRef.current) {
        return
      }

      awaitingPlaybackRef.current = false

      if (statusRef.current === 'speaking') {
        setStatus('idle')
      }
    }

    // Oynatma zaten boşsa (ses bu arada bitti) hemen kapat.
    if ($voicePlayback.get().status === 'idle') {
      finish()

      return undefined
    }

    const stop = $voicePlayback.listen(state => {
      if (state.status === 'idle') {
        finish()
      }
    })

    // Emniyet kemeri: oynatma katmanının kendi bekçileri var ama takılı bir
    // oynatma çentiği sonsuza kadar açık bırakmasın.
    const cap = setTimeout(finish, TURN_AUDIO_CAP_MS)

    return () => {
      stop()
      clearTimeout(cap)
    }
  }, [status])

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
        interruptVoicePlayback()
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
          // Turun YATISMASINI bekle. Sohbet kipi bunu baslangictan beri
          // yapiyordu, centik yapmiyordu: uretim ortasinda araya girince yeni
          // cumle hala mesgul bir oturuma gidiyordu. Kural artik ortak
          // (``./interrupt.ts``), yani ikisi ayrisamiyor.
          //
          // ``$busy`` centik penceresinde hic dolmuyorsa bekleme ANINDA
          // donuyor -- yani en kotu hal bugunku davranis.
          settle: { busy: () => $busy.get() },
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
    reply,
    status,
    transcript
  }
}
