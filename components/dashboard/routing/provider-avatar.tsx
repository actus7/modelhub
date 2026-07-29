import { cn } from "@/lib/utils"

import { providerHue } from "./routing-utils"

/**
 * O repo não versiona logos de provedor, então o avatar é a inicial sobre um
 * hue derivado do id — estável entre sessões e suficiente para o olho encontrar
 * o mesmo provedor em lanes diferentes.
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
