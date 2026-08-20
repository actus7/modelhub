import { ProviderDetail } from "@/components/dashboard/providers/provider-detail"

export default async function ProviderDetailRoute({
  params,
}: {
  params: Promise<{ providerId: string }>
}) {
  const { providerId } = await params
  return <ProviderDetail providerId={decodeURIComponent(providerId)} />
}

