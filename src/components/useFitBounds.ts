import { useEffect, useRef } from 'react'
import L from 'leaflet'
import type { Map as LeafletMap } from 'leaflet'

/**
 * ピン全体を ❶ 初回ロード時だけ フィットするフック
 */
export default function useFitBounds(
  notes: { lat: number; lng: number }[],
  mapRef: React.RefObject<LeafletMap | null>,
) {
  /* ページリロード時だけ false に戻る */
  const hasFitted = useRef(false)

  useEffect(() => {
    if (hasFitted.current) return            // ❷ 2 回目以降は何もしない
    if (notes.length === 0) return

    const map = mapRef.current
    if (!map) return

    const fitAll = () => {
      const bounds = new L.LatLngBounds(notes.map((n) => [n.lat, n.lng]))
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 })
      hasFitted.current = true               // ❸ フラグを立てて再実行を防ぐ
    }

    map.whenReady(fitAll)
  }, [notes, mapRef])
}
