/**
 * Masaüstündeki küçük "pet" — çentikten damlayan orb.
 *
 * Neden BURADA, Friend penceresinde değil
 * ---------------------------------------
 * Damlama animasyonunu önce Friend sayfasına koymuştum ve orası yanlıştı:
 * o sayfa zaten bir sekme, yani orb hiçbir yerden "damlamıyor", sadece
 * sayfanın içinde beliriyordu. Kullanıcının istediği şey masaüstünde bir şey:
 * ekranın tepesindeki çentikten aşağı düşen ve orada duran küçük bir arkadaş.
 *
 * Çentik penceresi buna zaten uygun: yüksekliği 220 px ama çentik çubuğu
 * yalnızca 22-92 px (``NOTCH_WINDOW_HEIGHT`` / ``EXPANDED_HEIGHT``). Altında
 * kalan ~130 px saydam ve fare olaylarını geçiriyor -- pet oraya düşüyor,
 * masaüstünü hiç işgal etmeden.
 *
 * ``pointer-events: none`` ŞART: çentik ekranın en üstünde duruyor ve
 * oradaki sekmeler, menüler tıklanabilir kalmalı.
 *
 * Zone A: upstream bu dosyayı bilmiyor.
 */

import type { NotchStatus } from './use-notch-voice'

/**
 * Damlama fiziği.
 *
 * Düşüşte ivmelenme (yerçekimi eğrisi), değdiği yerde ezilme, sonra
 * yaylanarak oturma. Sabit hızla düşen bir damla animasyon gibi görünüyor;
 * ivmelenen bir damla DÜŞÜYOR gibi görünüyor. Süre kısa (720 ms) ve bilerek:
 * uzun bir açılış animasyonu ikinci kez izlendiğinde gecikmeye dönüşüyor.
 */
const PET_KEYFRAMES = `
@keyframes fool-pet-drip {
  0%   { transform: translateY(-58px) scaleX(0.34) scaleY(1.7); opacity: 0; }
  14%  { opacity: 1; }
  52%  { transform: translateY(0) scaleX(0.58) scaleY(1.38); }
  68%  { transform: translateY(0) scaleX(1.28) scaleY(0.68); }
  82%  { transform: translateY(0) scaleX(0.9) scaleY(1.1); }
  100% { transform: translateY(0) scaleX(1) scaleY(1); }
}
@keyframes fool-pet-breathe {
  0%, 100% { transform: translateY(0) scale(1); }
  50%      { transform: translateY(-2px) scale(1.04); }
}
@media (prefers-reduced-motion: reduce) {
  @keyframes fool-pet-drip { 0% { opacity: 0 } 100% { opacity: 1 } }
  @keyframes fool-pet-breathe { 0%, 100% { transform: none } }
}
`

/** Evreye göre nefes hızı -- düşünürken hızlanıyor, boştayken yavaş. */
function breatheSeconds(status: NotchStatus): number {
  if (status === 'thinking') {
    return 1.1
  }

  if (status === 'listening' || status === 'speaking') {
    return 1.8
  }

  return 3.2
}

export function NotchPet({ level, status }: { level: number; status: NotchStatus }) {
  // Seviye küreyi büyütüyor. Rastgele bir animasyon ilk bakışta aynı
  // görünüyor ama kullanıcı sustuğunda da oynamaya devam ediyor ve his anında
  // bozuluyor: "beni duymuyor, sadece oynuyor".
  const grow = 1 + Math.min(1, Math.max(0, level)) * 0.34

  return (
    <div
      className="pointer-events-none flex w-full justify-center pt-2"
      style={{ animation: 'fool-pet-drip 720ms cubic-bezier(.55,0,.85,.35) both' }}
    >
      <style>{PET_KEYFRAMES}</style>
      <span
        className="block rounded-full"
        style={{
          animation: `fool-pet-breathe ${breatheSeconds(status)}s ease-in-out infinite`,
          background:
            'radial-gradient(circle at 50% 38%, color-mix(in srgb, var(--theme-primary) 94%, white) 0%, var(--theme-primary) 62%, color-mix(in srgb, var(--theme-primary) 74%, black) 100%)',
          // Hafif bir hale: masaustunde kendi basina duran bir sey, arkasindan
          // ayrilmali. Blur ABARTILI degil -- 10 px, parlayan bir top degil.
          boxShadow: '0 0 10px color-mix(in srgb, var(--theme-primary) 45%, transparent)',
          height: 18 * grow,
          width: 18 * grow
        }}
      />
    </div>
  )
}
