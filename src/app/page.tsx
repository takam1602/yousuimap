'use client'

import dynamic from 'next/dynamic'

// Map.tsx の方は 'use client' + leaflet.css をインポート済み前提
const Map = dynamic(() => import('@/components/Map'), { ssr: false })

export default function Home() {
  return <Map />
}
