import { notFound } from 'next/navigation'
import MapPageClient from '@/components/MapPageClient'
import { getWaterwayMap, waterwayMaps } from '@/lib/waterwayMaps'

export function generateStaticParams() {
  return waterwayMaps.map((map) => ({ slug: map.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const config = getWaterwayMap(slug)
  if (!config) return {}

  return {
    title: `${config.title} | 勘翁マップ`,
    description: config.description,
  }
}

export default async function WaterwayMapPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const config = getWaterwayMap(slug)
  if (!config) notFound()

  return <MapPageClient config={config} />
}
