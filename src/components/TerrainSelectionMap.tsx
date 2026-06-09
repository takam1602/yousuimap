'use client'

import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useEffect, useRef } from 'react'

type Bounds = {
  north: number
  south: number
  west: number
  east: number
}

type SelectionPoint = {
  id: string
  lat: number
  lng: number
  label: string
}

type RoutePoint = SelectionPoint & {
  routeKey: string
  source: 'note' | 'custom'
}

type TerrainSelectionMapProps = {
  points: SelectionPoint[]
  routePoints: RoutePoint[]
  bounds: Bounds
  onSelectPoint: (point: SelectionPoint) => void
  onAddFreePoint: (lat: number, lng: number) => void
}

function boundsToLatLng(bounds: Bounds): L.LatLngBoundsExpression {
  return [
    [bounds.south, bounds.west],
    [bounds.north, bounds.east],
  ]
}

function routeColor(index: number, total: number) {
  if (index === 0) return '#0284c7'
  if (index === total - 1) return '#16a34a'
  return '#f59e0b'
}

function popupContent(title: string, subText?: string) {
  const wrapper = document.createElement('div')
  const heading = document.createElement('div')
  heading.className = 'text-sm font-semibold text-gray-900'
  heading.textContent = title
  wrapper.appendChild(heading)

  if (subText) {
    const sub = document.createElement('div')
    sub.className = 'mt-1 text-xs text-gray-500'
    sub.textContent = subText
    wrapper.appendChild(sub)
  }

  return wrapper
}

export default function TerrainSelectionMap({
  points,
  routePoints,
  bounds,
  onSelectPoint,
  onAddFreePoint,
}: TerrainSelectionMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const baseLayerRef = useRef<L.LayerGroup | null>(null)
  const routeLayerRef = useRef<L.LayerGroup | null>(null)
  const callbacksRef = useRef({ onSelectPoint, onAddFreePoint })

  useEffect(() => {
    callbacksRef.current = { onSelectPoint, onAddFreePoint }
  }, [onSelectPoint, onAddFreePoint])

  useEffect(() => {
    const container = containerRef.current
    if (!container || mapRef.current) return

    const paddedBounds = boundsToLatLng({
      north: bounds.north + 0.04,
      south: bounds.south - 0.04,
      west: bounds.west - 0.04,
      east: bounds.east + 0.04,
    })
    const map = L.map(container, {
      center: [(bounds.north + bounds.south) / 2, (bounds.east + bounds.west) / 2],
      zoom: 12,
      minZoom: 10,
      maxZoom: 17,
      maxBounds: paddedBounds,
      scrollWheelZoom: true,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map)

    const baseLayer = L.layerGroup().addTo(map)
    const routeLayer = L.layerGroup().addTo(map)
    baseLayerRef.current = baseLayer
    routeLayerRef.current = routeLayer
    mapRef.current = map
    map.fitBounds(boundsToLatLng(bounds), { padding: [18, 18], maxZoom: 13 })

    map.on('click', (event) => {
      callbacksRef.current.onAddFreePoint(event.latlng.lat, event.latlng.lng)
    })

    setTimeout(() => map.invalidateSize(), 0)

    return () => {
      map.remove()
      mapRef.current = null
      baseLayerRef.current = null
      routeLayerRef.current = null
    }
  }, [bounds])

  useEffect(() => {
    const baseLayer = baseLayerRef.current
    if (!baseLayer) return

    baseLayer.clearLayers()
    points.forEach((point) => {
      L.circleMarker([point.lat, point.lng], {
        radius: 3.8,
        color: '#64748b',
        fillColor: '#ef4444',
        fillOpacity: 0.72,
        weight: 1,
      })
        .on('click', (event) => {
          if (event.originalEvent) {
            L.DomEvent.stopPropagation(event.originalEvent)
            event.originalEvent.preventDefault()
          }
          callbacksRef.current.onSelectPoint(point)
        })
        .bindPopup(popupContent(point.label), { minWidth: 180 })
        .addTo(baseLayer)
    })
  }, [points])

  useEffect(() => {
    const map = mapRef.current
    const routeLayer = routeLayerRef.current
    if (!map || !routeLayer) return

    routeLayer.clearLayers()
    const routePositions = routePoints.map((point) => [point.lat, point.lng] as [number, number])

    if (routePositions.length >= 2) {
      L.polyline(routePositions, {
        color: '#111827',
        weight: 4,
        opacity: 0.84,
      }).addTo(routeLayer)
    }

    routePoints.forEach((point, index) => {
      L.circleMarker([point.lat, point.lng], {
        radius: 8,
        color: '#111827',
        fillColor: routeColor(index, routePoints.length),
        fillOpacity: 0.95,
        weight: 2,
      })
        .on('click', (event) => {
          if (event.originalEvent) {
            L.DomEvent.stopPropagation(event.originalEvent)
            event.originalEvent.preventDefault()
          }
        })
        .bindPopup(popupContent(point.label, `${index + 1}`), { minWidth: 180 })
        .addTo(routeLayer)
    })

    if (routePositions.length >= 2) {
      map.fitBounds(routePositions, { padding: [28, 28], maxZoom: 15 })
    }
  }, [routePoints])

  return <div ref={containerRef} className="h-full min-h-[340px] w-full" />
}
