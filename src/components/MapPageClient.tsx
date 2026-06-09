'use client'

import dynamic from 'next/dynamic'
import type { WaterwayMapConfig } from '@/lib/waterwayMaps'

const Map = dynamic(() => import('@/components/Map'), { ssr: false })

export default function MapPageClient({ config }: { config: WaterwayMapConfig }) {
  return (
    <Map
      mapSlug={config.slug}
      mapTitle={config.title}
      initialCenter={config.center}
      initialZoom={config.zoom}
    />
  )
}
