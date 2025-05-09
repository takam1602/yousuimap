import { useEffect } from 'react'
import L from 'leaflet'
import type { Map as LeafletMap } from 'leaflet'

export default function useFitBounds(
  notes: { lat: number; lng: number }[],
  mapRef: React.RefObject<LeafletMap | null>,
) {
  useEffect(() => {
    if (notes.length === 0) return
    const map = mapRef.current
    if (!map) return

    const fitAll = () => {
      const bounds = new L.LatLngBounds(notes.map((n) => [n.lat, n.lng]))
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 })
    }

    /* map.whenReady はロード済みなら即実行される */
    map.whenReady(fitAll)
  }, [notes, mapRef])
}
