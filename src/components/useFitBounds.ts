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

    /* ── map が ready でなければ待つ ───────────── */
    if (!map._loaded) {
      map.whenReady(() => fitAll(map))
    } else {
      fitAll(map)
    }

    function fitAll(m: LeafletMap) {
      const bounds = new L.LatLngBounds(notes.map((n) => [n.lat, n.lng]))
      m.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 })
    }
  }, [notes, mapRef])
}
