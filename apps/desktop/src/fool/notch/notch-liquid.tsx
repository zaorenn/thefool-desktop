/**
 * Çentiğin sıvı açılış/kapanışı ve üst kenar dalgaları.
 *
 * Kullanıcının tarifi birebir:
 *
 *   "notch açılırken o top sıvı bir animasyonmuş gibi ekranın ortasına gelsin,
 *    sonra sanki yerçekimi onu yukarı çekiyormuş gibi çeksin ve sanki su
 *    sıçraması gibi notchu oluştursun, sonra kaybolsun o kırmızı top. Daha
 *    sonra notch kapanırken top notchu sıvı gibi dönerek içine çeksin ve
 *    ekranın üstünden yukarı çekerek kaybolsun."
 *
 *   "notch dinlerken ekranda genişleyip kocaman yer kaplamak yerine notchtan
 *    çıkan dalgalar ... ince dalgalarla animasyonlu şekilde çevrilsin ve
 *    konuşma algılandığında dalgalar tekrardan notcha geri çekilsin."
 *
 * Kapsam ÜST KENAR: kullanıcı sonradan daralttı ("sadece ekranın en üst
 * kısmını ilgilendirmesini istiyorum, diğer kenarlar önemli değil"). Bu, işi
 * ciddi biçimde kolaylaştırıyor -- çentik penceresi zaten ekran genişliğinde
 * ve her şey onun içinde kalıyor, tam ekran bir katman gerekmiyor.
 *
 * Neden sürekli duran top KALDIRILDI: "notchun hemen altında sürekli duran o
 * yuvarlak top çok dikkat dağıtıcı." Top artık bir DURUM göstergesi değil, bir
 * GEÇİŞ: yalnızca açılırken ve kapanırken var.
 *
 * Animasyonlar CSS keyframe'leriyle: bileşen her karede yeniden render
 * edilmiyor, tarayıcı kendi zamanlayıcısında yürütüyor. Motion ile yapmak her
 * kare için React işi üretirdi ve bu şerit modelin cevabı akarken de
 * çiziliyor.
 *
 * Zone A: upstream bu dosyayı bilmiyor.
 */

import { useEffect, useState } from 'react'

/** Açılış animasyonunun toplam süresi -- çentik bundan sonra "oluşmuş" olur. */
export const LIQUID_OPEN_MS = 620

/** Kapanış: top çentiği içine çekip yukarı kayboluyor. */
export const LIQUID_CLOSE_MS = 480

export type LiquidPhase = 'closing' | 'idle' | 'opening'

const KEYFRAMES = `
@keyframes fool-liquid-open {
  /* Ekranın ortasına düşüyor -- sıvı gibi, hafifçe yayılarak. */
  0%   { transform: translate3d(0, 96px, 0) scale(0.42, 0.58); opacity: 0; }
  22%  { transform: translate3d(0, 92px, 0) scale(1.18, 0.82); opacity: 1; }
  /* Yerçekimi TERSİNE: yukarı çekiliyor ve çekilirken inceliyor. */
  62%  { transform: translate3d(0, 22px, 0) scale(0.72, 1.42); opacity: 1; }
  /* Sıçrama: çentiğin oturduğu yerde eziliyor. */
  84%  { transform: translate3d(0, -2px, 0) scale(1.9, 0.46); opacity: 0.85; }
  100% { transform: translate3d(0, -6px, 0) scale(2.6, 0.2); opacity: 0; }
}

@keyframes fool-liquid-close {
  /* Çentiği içine çekiyor: dönerek toparlanıyor. */
  0%   { transform: translate3d(0, -4px, 0) scale(2.4, 0.24) rotate(0deg); opacity: 0; }
  34%  { transform: translate3d(0, 6px, 0) scale(1.05, 1.05) rotate(120deg); opacity: 1; }
  /* Ve üst kenardan yukarı kayboluyor. */
  100% { transform: translate3d(0, -80px, 0) scale(0.3, 0.86) rotate(320deg); opacity: 0; }
}

/* Dalgalar çentikten ÇIKIYOR: üst kenar boyunca dışa doğru akıyor. */
@keyframes fool-wave-out {
  0%   { transform: scaleX(0.04); opacity: 0; }
  30%  { opacity: 0.9; }
  100% { transform: scaleX(1); opacity: 0; }
}
`

/**
 * Açılış/kapanış topu.
 *
 * ``phase`` ``idle`` iken HİÇBİR ŞEY çizilmiyor -- sürekli duran top şikâyeti
 * tam olarak buydu.
 */
export function NotchLiquid({ phase }: { phase: LiquidPhase }) {
  if (phase === 'idle') {
    return null
  }

  const opening = phase === 'opening'

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center overflow-hidden" style={{ height: 200 }}>
      <style>{KEYFRAMES}</style>
      <span
        className="block rounded-full"
        style={{
          animation: `${opening ? 'fool-liquid-open' : 'fool-liquid-close'} ${
            opening ? LIQUID_OPEN_MS : LIQUID_CLOSE_MS
          }ms cubic-bezier(.42,0,.32,1) both`,
          background:
            'radial-gradient(circle at 50% 38%, color-mix(in srgb, var(--theme-primary) 94%, white) 0%, var(--theme-primary) 62%, color-mix(in srgb, var(--theme-primary) 74%, black) 100%)',
          boxShadow: '0 0 14px color-mix(in srgb, var(--theme-primary) 55%, transparent)',
          height: 18,
          width: 18
        }}
      />
    </div>
  )
}

/**
 * ÜST KENAR dalgaları -- yalnızca dinlerken.
 *
 * Çentiğin iki yanından dışa doğru akan ince çizgiler. Konuşma algılandığında
 * ``active`` düşüyor ve dalgalar çentiğe geri çekiliyor (``scaleX`` sıfıra
 * gidiyor): kullanıcının istediği "konuşma algılandığında dalgalar tekrardan
 * notcha geri çekilsin".
 */
export function NotchEdgeWaves({ active }: { active: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" style={{ height: 3 }}>
      <style>{KEYFRAMES}</style>
      {([0, 1, 2] as const).map(index => (
        <span
          className="absolute top-0 h-px"
          key={index}
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, var(--theme-primary) 50%, transparent 100%)',
            // Geri ÇEKİLME: ``active`` düşünce animasyon durup ölçek sıfıra
            // iniyor, yani dalga çentiğe geri emiliyor.
            animation: active
              ? `fool-wave-out 1500ms ease-out ${index * 420}ms infinite`
              : undefined,
            inset: '0 0 auto 0',
            opacity: active ? undefined : 0,
            transform: active ? undefined : 'scaleX(0)',
            transition: active ? undefined : 'transform 260ms ease-in, opacity 260ms ease-in'
          }}
        />
      ))}
    </div>
  )
}

/**
 * Oturum açılıp kapanırken GEÇİŞ evresini üret.
 *
 * Evre kendiliğinden sönüyor: açılış/kapanış bir OLAY, bir durum değil. Süre
 * dolduğunda ``idle``a dönmezse top ekranda asılı kalırdı -- kaldırılan
 * davranışın ta kendisi.
 */
export function useLiquidPhase(sessionActive: boolean): LiquidPhase {
  const [phase, setPhase] = useState<LiquidPhase>('idle')
  const [seen, setSeen] = useState(sessionActive)

  useEffect(() => {
    if (sessionActive === seen) {
      return undefined
    }

    setSeen(sessionActive)
    setPhase(sessionActive ? 'opening' : 'closing')

    const timer = setTimeout(
      () => setPhase('idle'),
      sessionActive ? LIQUID_OPEN_MS : LIQUID_CLOSE_MS
    )

    return () => clearTimeout(timer)
  }, [seen, sessionActive])

  return phase
}
