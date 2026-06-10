'use client'

import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useCallback, useEffect, useRef } from 'react'

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

type MapLayerKey = 'river' | 'rail' | 'road' | 'boundary' | 'place' | 'station'

type MapFeaturePoint = {
  lat: number
  lng: number
}

type MapLineFeature = {
  id: string
  layer: MapLayerKey
  name: string
  points: MapFeaturePoint[]
}

type MapLabelFeature = {
  id: string
  layer: MapLayerKey
  name: string
  lat: number
  lng: number
}

type MapOverlayFeatures = {
  lines: MapLineFeature[]
  labels: MapLabelFeature[]
}

type MapLayerVisibility = Record<MapLayerKey, boolean>

type ExportedMapImage = {
  dataUrl: string
  width: number
  height: number
}

type MapExporter = () => Promise<ExportedMapImage>

type TerrainSelectionMapProps = {
  points: SelectionPoint[]
  routePoints: RoutePoint[]
  bounds: Bounds
  onSelectPoint: (point: SelectionPoint) => void
  onAddFreePoint: (lat: number, lng: number) => void
  onExporterReady?: (exporter: MapExporter | null) => void
  mapFeatures: MapOverlayFeatures
  visibleLayers: MapLayerVisibility
}

type LatestMapData = {
  points: SelectionPoint[]
  routePoints: RoutePoint[]
  mapFeatures: MapOverlayFeatures
  visibleLayers: MapLayerVisibility
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

function layerColor(layer: MapLayerKey) {
  if (layer === 'river') return '#2563eb'
  if (layer === 'rail') return '#111827'
  if (layer === 'road') return '#f97316'
  if (layer === 'boundary') return '#7c3aed'
  if (layer === 'station') return '#be123c'
  return '#047857'
}

function layerWeight(layer: MapLayerKey) {
  if (layer === 'road') return 3
  if (layer === 'rail') return 2.5
  if (layer === 'boundary') return 2
  return 2.4
}

function layerDash(layer: MapLayerKey) {
  if (layer === 'boundary') return '6 5'
  if (layer === 'rail') return '8 4'
  return undefined
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function labelIcon(feature: MapLabelFeature) {
  const color = layerColor(feature.layer)
  return L.divIcon({
    className: '',
    html: `<div style="display:inline-block;white-space:nowrap;border:1px solid #cbd5e1;border-radius:6px;background:rgba(255,255,255,.9);padding:2px 6px;color:${color};font-size:11px;font-weight:700;box-shadow:0 1px 2px rgba(15,23,42,.16)">${escapeHtml(feature.name)}</div>`,
    iconAnchor: [0, 0],
  })
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

function loadTileImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Map tile failed: ${src}`))
    image.src = src
  })
}

function drawCircleMarker(
  context: CanvasRenderingContext2D,
  point: L.Point,
  radius: number,
  fill: string,
  stroke: string,
  lineWidth: number
) {
  context.beginPath()
  context.arc(point.x, point.y, radius, 0, Math.PI * 2)
  context.fillStyle = fill
  context.fill()
  context.lineWidth = lineWidth
  context.strokeStyle = stroke
  context.stroke()
}

export default function TerrainSelectionMap({
  points,
  routePoints,
  bounds,
  onSelectPoint,
  onAddFreePoint,
  onExporterReady,
  mapFeatures,
  visibleLayers,
}: TerrainSelectionMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const baseLayerRef = useRef<L.LayerGroup | null>(null)
  const featureLayerRef = useRef<L.LayerGroup | null>(null)
  const routeLayerRef = useRef<L.LayerGroup | null>(null)
  const callbacksRef = useRef({ onSelectPoint, onAddFreePoint })
  const latestDataRef = useRef<LatestMapData>({ points, routePoints, mapFeatures, visibleLayers })

  useEffect(() => {
    callbacksRef.current = { onSelectPoint, onAddFreePoint }
  }, [onSelectPoint, onAddFreePoint])

  useEffect(() => {
    latestDataRef.current = { points, routePoints, mapFeatures, visibleLayers }
  }, [points, routePoints, mapFeatures, visibleLayers])

  const exportCurrentMap = useCallback(async () => {
    const map = mapRef.current
    if (!map) throw new Error('Map is not ready')

    const size = map.getSize()
    const width = Math.max(1, Math.round(size.x))
    const height = Math.max(1, Math.round(size.y))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is not available')

    context.fillStyle = '#f8fafc'
    context.fillRect(0, 0, width, height)

    const zoom = map.getZoom()
    const tileSize = 256
    const tileCount = 2 ** zoom
    const pixelBounds = map.getPixelBounds()
    const pixelMin = pixelBounds.getTopLeft()
    const pixelMax = pixelBounds.getBottomRight()
    const minTile = pixelMin.divideBy(tileSize).floor()
    const maxTile = pixelMax.divideBy(tileSize).floor()
    const tileJobs: Promise<void>[] = []

    for (let tileX = minTile.x; tileX <= maxTile.x; tileX += 1) {
      for (let tileY = minTile.y; tileY <= maxTile.y; tileY += 1) {
        if (tileY < 0 || tileY >= tileCount) continue
        const wrappedX = ((tileX % tileCount) + tileCount) % tileCount
        const subdomain = ['a', 'b', 'c'][Math.abs(tileX + tileY) % 3]
        const url = `https://${subdomain}.tile.openstreetmap.org/${zoom}/${wrappedX}/${tileY}.png`
        const drawX = tileX * tileSize - pixelMin.x
        const drawY = tileY * tileSize - pixelMin.y

        tileJobs.push(
          loadTileImage(url)
            .then((image) => {
              context.drawImage(image, drawX, drawY, tileSize, tileSize)
            })
            .catch(() => {
              context.fillStyle = '#e5e7eb'
              context.fillRect(drawX, drawY, tileSize, tileSize)
            })
        )
      }
    }

    await Promise.all(tileJobs)

    const {
      points: latestPoints,
      routePoints: latestRoutePoints,
      mapFeatures: latestMapFeatures,
      visibleLayers: latestVisibleLayers,
    } = latestDataRef.current
    const mapBounds = map.getBounds()

    latestMapFeatures.lines.forEach((feature) => {
      if (!latestVisibleLayers[feature.layer]) return
      const positions = feature.points
        .filter((point) => mapBounds.contains([point.lat, point.lng]))
        .map((point) => map.latLngToContainerPoint([point.lat, point.lng]))
      if (positions.length < 2) return
      context.beginPath()
      positions.forEach((position, index) => {
        if (index === 0) context.moveTo(position.x, position.y)
        else context.lineTo(position.x, position.y)
      })
      context.strokeStyle = layerColor(feature.layer)
      context.lineWidth = layerWeight(feature.layer)
      context.setLineDash(feature.layer === 'boundary' ? [6, 5] : feature.layer === 'rail' ? [8, 4] : [])
      context.lineJoin = 'round'
      context.lineCap = 'round'
      context.stroke()
      context.setLineDash([])
    })

    latestMapFeatures.labels.forEach((feature) => {
      if (!latestVisibleLayers[feature.layer] || !mapBounds.contains([feature.lat, feature.lng])) return
      const position = map.latLngToContainerPoint([feature.lat, feature.lng])
      const label = feature.name.slice(0, 18)
      context.font = 'bold 11px sans-serif'
      const labelWidth = Math.ceil(context.measureText(label).width) + 12
      context.fillStyle = 'rgba(255,255,255,0.9)'
      context.strokeStyle = '#cbd5e1'
      context.lineWidth = 1
      context.fillRect(position.x, position.y, labelWidth, 18)
      context.strokeRect(position.x, position.y, labelWidth, 18)
      context.fillStyle = layerColor(feature.layer)
      context.textAlign = 'left'
      context.textBaseline = 'middle'
      context.fillText(label, position.x + 6, position.y + 9)
    })

    latestPoints.forEach((point) => {
      if (!mapBounds.contains([point.lat, point.lng])) return
      const markerPoint = map.latLngToContainerPoint([point.lat, point.lng])
      drawCircleMarker(context, markerPoint, 4, '#ef4444', '#64748b', 1)
    })

    const routePositions = latestRoutePoints.map((point) => map.latLngToContainerPoint([point.lat, point.lng]))
    if (routePositions.length >= 2) {
      context.beginPath()
      routePositions.forEach((position, index) => {
        if (index === 0) context.moveTo(position.x, position.y)
        else context.lineTo(position.x, position.y)
      })
      context.strokeStyle = '#111827'
      context.lineWidth = 4
      context.lineJoin = 'round'
      context.lineCap = 'round'
      context.stroke()
    }

    routePositions.forEach((position, index) => {
      drawCircleMarker(context, position, 9, routeColor(index, routePositions.length), '#111827', 2)
      context.fillStyle = '#ffffff'
      context.font = 'bold 11px sans-serif'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(String(index + 1), position.x, position.y + 0.5)
    })

    context.fillStyle = 'rgba(255, 255, 255, 0.86)'
    context.fillRect(8, height - 24, 236, 16)
    context.fillStyle = '#475569'
    context.font = '10px sans-serif'
    context.textAlign = 'left'
    context.textBaseline = 'middle'
    context.fillText('© OpenStreetMap contributors', 12, height - 16)

    return { dataUrl: canvas.toDataURL('image/png'), width, height }
  }, [])

  useEffect(() => {
    onExporterReady?.(exportCurrentMap)
    return () => onExporterReady?.(null)
  }, [exportCurrentMap, onExporterReady])

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
      crossOrigin: true,
    }).addTo(map)

    const featureLayer = L.layerGroup().addTo(map)
    const baseLayer = L.layerGroup().addTo(map)
    const routeLayer = L.layerGroup().addTo(map)
    featureLayerRef.current = featureLayer
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
      featureLayerRef.current = null
      baseLayerRef.current = null
      routeLayerRef.current = null
    }
  }, [bounds])

  useEffect(() => {
    const featureLayer = featureLayerRef.current
    if (!featureLayer) return

    featureLayer.clearLayers()
    mapFeatures.lines.forEach((feature) => {
      if (!visibleLayers[feature.layer]) return
      const positions = feature.points.map((point) => [point.lat, point.lng] as [number, number])
      if (positions.length < 2) return
      L.polyline(positions, {
        color: layerColor(feature.layer),
        weight: layerWeight(feature.layer),
        opacity: 0.86,
        dashArray: layerDash(feature.layer),
      })
        .bindTooltip(escapeHtml(feature.name || feature.layer), { sticky: true })
        .addTo(featureLayer)
    })
    mapFeatures.labels.forEach((feature) => {
      if (!visibleLayers[feature.layer]) return
      L.marker([feature.lat, feature.lng], { icon: labelIcon(feature), interactive: false }).addTo(featureLayer)
    })
  }, [mapFeatures, visibleLayers])

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
    const routeLayer = routeLayerRef.current
    if (!routeLayer) return

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
  }, [routePoints])

  return <div ref={containerRef} className="h-full min-h-[340px] w-full" />
}
