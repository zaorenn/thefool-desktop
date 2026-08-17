import { cn } from '@/lib/utils'

const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

// FOOL-SEAM: brand-mark
// Marka rozeti: The Fool işareti. Upstream burada `nous-girl.jpg`'i beyaz bir
// karo üzerinde gösteriyordu; işaret artık kendi zeminini taşıyan bir SVG
// (public/fool-mark.svg) olduğu için beyaz karo kaldırıldı — aksi halde
// crimson işaretin çevresinde beyaz bir çerçeve kalıyordu.
// Hakkında ekranında ve güncelleme panelinde görünür.
export function BrandMark({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'inline-flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md',
        className
      )}
      {...props}
    >
      <img alt="" className="size-full object-contain" src={assetPath('fool-mark.svg')} />
    </span>
  )
}
