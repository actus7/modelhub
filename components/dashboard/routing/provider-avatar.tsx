import { cn } from "@/lib/utils"

import { providerLogoSrc } from "./provider-logos"
import { providerHue } from "./routing-utils"

/**
 * Logo oficial quando existe (public/providers/<id>.svg, ver provider-logos.ts);
 * senão a inicial sobre um hue derivado do id — estável entre sessões e
 * suficiente para o olho encontrar o mesmo provedor em lanes diferentes.
 */
export function ProviderAvatar({
  className,
  label,
  providerId,
  size = 20,
}: {
  className?: string
  label: string
  providerId: string
  size?: number
}) {
  const logoSrc = providerLogoSrc(providerId)

  if (logoSrc) {
    return (
      <span
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted",
          className,
        )}
        style={{ height: size, width: size }}
        title={label}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- ícone estático pequeno, next/image não agrega nada aqui */}
        <img alt="" className="h-[65%] w-[65%] object-contain" src={logoSrc} />
      </span>
    )
  }

  const hue = providerHue(providerId)

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold",
        className,
      )}
      style={{
        backgroundColor: `oklch(0.72 0.13 ${hue} / 0.22)`,
        color: `oklch(0.55 0.16 ${hue})`,
        fontSize: Math.round(size * 0.5),
        height: size,
        width: size,
      }}
      title={label}
    >
      {label.charAt(0).toUpperCase()}
    </span>
  )
}
