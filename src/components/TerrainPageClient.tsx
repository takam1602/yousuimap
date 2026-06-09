'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import {
  IoAdd,
  IoArrowBackOutline,
  IoArrowDownOutline,
  IoArrowUpOutline,
  IoBookmarkOutline,
  IoClose,
  IoCubeOutline,
  IoDownloadOutline,
  IoImageOutline,
  IoListOutline,
  IoMapOutline,
  IoRefreshOutline,
  IoSaveOutline,
  IoStatsChartOutline,
  IoSwapHorizontalOutline,
  IoTrashOutline,
} from 'react-icons/io5'

const TerrainSelectionMap = dynamic(() => import('@/components/TerrainSelectionMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[340px] items-center justify-center bg-slate-50 text-sm text-gray-500">
      地図読み込み中
    </div>
  ),
})

declare global {
  interface Window {
    __threeLoadPromise?: Promise<any>
  }
}

type Note = {
  id: string
  lat: number
  lng: number
  text: string
}

type TerrainPoint = {
  id: string
  lat: number
  lng: number
  label: string
}

type RoutePoint = TerrainPoint & {
  routeKey: string
  source: 'note' | 'custom'
}

type Bounds = {
  north: number
  south: number
  west: number
  east: number
}

type TerrainCell = {
  lat: number
  lng: number
  elevation: number | null
}

type TerrainGrid = {
  bounds: Bounds
  rows: number
  cols: number
  cells: TerrainCell[][]
  minElevation: number
  maxElevation: number
}

type ProfilePoint = {
  lat: number
  lng: number
  distance: number
  elevation: number | null
}

type ProfileStats = {
  min: number
  max: number
  start: number | null
  end: number | null
  distance: number
  ascent: number
  descent: number
}

type SavedRoutePoint = {
  id: string
  lat: number
  lng: number
  label: string
  source: RoutePoint['source']
}

type SavedRouteProfile = {
  id: string
  name: string
  points: SavedRoutePoint[]
  createdAt: string
  updatedAt: string
}

type ExportedMapImage = {
  dataUrl: string
  width: number
  height: number
}

type MapExporter = () => Promise<ExportedMapImage>

const MAP_SLUG = 'tsuchiura-yosui'
const SAVED_PROFILES_STORAGE_KEY = `terrain-profiles:${MAP_SLUG}:v1`
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js'
const DEM_ZOOM = 14
const TERRAIN_ROWS = 56
const TERRAIN_COLS = 64
const MAX_RENDERED_MARKERS = 1200
const MAX_PROFILE_SAMPLES = 1200
const MIN_PROFILE_SAMPLES = 80
const METERS_PER_PROFILE_SAMPLE = 45

const TSUCHIURA_BOUNDS: Bounds = {
  north: 36.16,
  south: 36.0,
  west: 140.02,
  east: 140.2,
}

const FALLBACK_POINTS: TerrainPoint[] = [
  { id: 'sample-1', lat: 36.0773, lng: 140.1766, label: '土浦用水 サンプル地点 A' },
  { id: 'sample-2', lat: 36.045, lng: 140.1034, label: '土浦用水 サンプル地点 B' },
  { id: 'sample-3', lat: 36.037, lng: 140.0767, label: '土浦用水 サンプル地点 C' },
]

const INITIAL_ROUTE_POINTS = FALLBACK_POINTS.map((point, index) => ({
  ...point,
  routeKey: `initial-${point.id}-${index}`,
  source: 'note' as const,
}))

const demTileCache = new Map<string, Promise<(number | null)[][]>>()

function loadThree() {
  if (typeof window === 'undefined') return Promise.reject(new Error('window is not available'))
  if (window.__threeLoadPromise) return window.__threeLoadPromise

  window.__threeLoadPromise = import(/* webpackIgnore: true */ THREE_URL)
  return window.__threeLoadPromise
}

function parseDemText(text: string) {
  return text
    .trim()
    .split('\n')
    .map((row) =>
      row.split(',').map((value) => {
        const trimmed = value.trim()
        if (!trimmed || trimmed === 'e') return null
        const elevation = Number(trimmed)
        return Number.isFinite(elevation) ? elevation : null
      })
    )
}

function latLngToTile(lat: number, lng: number, zoom: number) {
  const n = 2 ** zoom
  const xFloat = ((lng + 180) / 360) * n
  const latRad = (lat * Math.PI) / 180
  const yFloat =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  const x = Math.floor(xFloat)
  const y = Math.floor(yFloat)

  return {
    x,
    y,
    px: Math.min(255, Math.max(0, Math.floor((xFloat - x) * 256))),
    py: Math.min(255, Math.max(0, Math.floor((yFloat - y) * 256))),
  }
}

async function loadDemTile(zoom: number, x: number, y: number) {
  const key = `${zoom}/${x}/${y}`
  const cached = demTileCache.get(key)
  if (cached) return cached

  const promise = fetch(`/api/dem/${zoom}/${x}/${y}`)
    .then((response) => {
      if (!response.ok) throw new Error(`DEM tile failed: ${response.status}`)
      return response.text()
    })
    .then(parseDemText)

  demTileCache.set(key, promise)
  return promise
}

async function getElevation(lat: number, lng: number) {
  try {
    const tile = latLngToTile(lat, lng, DEM_ZOOM)
    const rows = await loadDemTile(DEM_ZOOM, tile.x, tile.y)
    return rows[tile.py]?.[tile.px] ?? null
  } catch {
    return null
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function isInsideBounds(point: Pick<TerrainPoint, 'lat' | 'lng'>, bounds: Bounds) {
  return (
    point.lat <= bounds.north &&
    point.lat >= bounds.south &&
    point.lng >= bounds.west &&
    point.lng <= bounds.east
  )
}

function labelForNote(note: Note, index: number) {
  const label = note.text?.trim()
  if (label) return label
  return `地点 ${index + 1} (${note.lat.toFixed(5)}, ${note.lng.toFixed(5)})`
}

function routeKeyFor(point: TerrainPoint, index: number, source: RoutePoint['source']) {
  const safeId = point.id.replace(/[^a-zA-Z0-9_-]/g, '-')
  return `${source}-${safeId}-${index}-${Date.now()}`
}

function routePointFrom(point: TerrainPoint, index: number, source: RoutePoint['source'] = 'note'): RoutePoint {
  return {
    ...point,
    routeKey: routeKeyFor(point, index, source),
    source,
  }
}

function initialRouteFrom(points: TerrainPoint[]) {
  return points.slice(0, Math.min(3, points.length)).map((point, index) => ({
    ...point,
    routeKey: `loaded-${point.id}-${index}`,
    source: 'note' as const,
  }))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeSavedProfiles(value: unknown): SavedRouteProfile[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((profile): SavedRouteProfile[] => {
    if (!isRecord(profile) || typeof profile.id !== 'string' || typeof profile.name !== 'string') return []
    if (!Array.isArray(profile.points)) return []

    const points = profile.points.flatMap((point): SavedRoutePoint[] => {
      if (!isRecord(point)) return []
      const source = point.source === 'custom' ? 'custom' : 'note'
      if (typeof point.id !== 'string' || typeof point.label !== 'string') return []
      if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return []
      return [{ id: point.id, lat: Number(point.lat), lng: Number(point.lng), label: point.label, source }]
    })

    if (points.length < 2) return []
    const now = new Date().toISOString()
    return [
      {
        id: profile.id,
        name: profile.name.trim() || 'プロファイル',
        points,
        createdAt: typeof profile.createdAt === 'string' ? profile.createdAt : now,
        updatedAt: typeof profile.updatedAt === 'string' ? profile.updatedAt : now,
      },
    ]
  })
}

function loadSavedProfiles() {
  if (typeof window === 'undefined') return []
  try {
    return normalizeSavedProfiles(JSON.parse(window.localStorage.getItem(SAVED_PROFILES_STORAGE_KEY) || '[]'))
  } catch {
    return []
  }
}

function saveProfilesToStorage(profiles: SavedRouteProfile[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SAVED_PROFILES_STORAGE_KEY, JSON.stringify(profiles))
}

function serializeRoutePoint(point: RoutePoint): SavedRoutePoint {
  return { id: point.id, lat: point.lat, lng: point.lng, label: point.label, source: point.source }
}

function routePointFromSaved(point: SavedRoutePoint, index: number): RoutePoint {
  return routePointFrom(
    {
      id: point.id || `saved-${index + 1}`,
      lat: point.lat,
      lng: point.lng,
      label: point.label || `保存地点 ${index + 1}`,
    },
    index,
    point.source
  )
}

function nextProfileName(profiles: SavedRouteProfile[]) {
  let index = profiles.length + 1
  while (profiles.some((profile) => profile.name === `プロファイル ${index}`)) index += 1
  return `プロファイル ${index}`
}

function createProfileId() {
  return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function routeIsInitialFallback(routePoints: RoutePoint[]) {
  return (
    routePoints.length === INITIAL_ROUTE_POINTS.length &&
    routePoints.every((point, index) => point.routeKey === INITIAL_ROUTE_POINTS[index]?.routeKey)
  )
}

function haversineMeters(a: Pick<TerrainPoint, 'lat' | 'lng'>, b: Pick<TerrainPoint, 'lat' | 'lng'>) {
  const radius = 6371000
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const deltaLat = ((b.lat - a.lat) * Math.PI) / 180
  const deltaLng = ((b.lng - a.lng) * Math.PI) / 180
  const sinLat = Math.sin(deltaLat / 2)
  const sinLng = Math.sin(deltaLng / 2)
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng
  return 2 * radius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

async function buildTerrainGrid(bounds: Bounds): Promise<TerrainGrid> {
  const cells = await Promise.all(
    Array.from({ length: TERRAIN_ROWS }, async (_, row) =>
      Promise.all(
        Array.from({ length: TERRAIN_COLS }, async (_, col) => {
          const lat = bounds.north - ((bounds.north - bounds.south) * row) / (TERRAIN_ROWS - 1)
          const lng = bounds.west + ((bounds.east - bounds.west) * col) / (TERRAIN_COLS - 1)
          const elevation = await getElevation(lat, lng)
          return { lat, lng, elevation }
        })
      )
    )
  )

  const elevations = cells
    .flat()
    .map((cell) => cell.elevation)
    .filter((elevation): elevation is number => elevation !== null)
  const minElevation = elevations.length ? Math.min(...elevations) : 0
  const maxElevation = elevations.length ? Math.max(...elevations) : 1

  return { bounds, rows: TERRAIN_ROWS, cols: TERRAIN_COLS, cells, minElevation, maxElevation }
}

async function buildElevationProfile(routePoints: RoutePoint[]) {
  if (routePoints.length < 2) return []

  const segmentDistances = routePoints.slice(0, -1).map((point, index) =>
    haversineMeters(point, routePoints[index + 1])
  )
  const totalDistance = segmentDistances.reduce((sum, distance) => sum + distance, 0)
  if (totalDistance <= 0) return []

  const targetSamples = clamp(
    Math.ceil(totalDistance / METERS_PER_PROFILE_SAMPLE),
    MIN_PROFILE_SAMPLES,
    MAX_PROFILE_SAMPLES
  )
  const samples: Omit<ProfilePoint, 'elevation'>[] = []
  let distanceOffset = 0

  segmentDistances.forEach((segmentDistance, segmentIndex) => {
    const start = routePoints[segmentIndex]
    const end = routePoints[segmentIndex + 1]
    const segmentSamples = Math.max(2, Math.round((segmentDistance / totalDistance) * targetSamples))

    for (let index = 0; index < segmentSamples; index += 1) {
      if (segmentIndex > 0 && index === 0) continue
      const t = index / (segmentSamples - 1)
      samples.push({
        lat: start.lat + (end.lat - start.lat) * t,
        lng: start.lng + (end.lng - start.lng) * t,
        distance: distanceOffset + segmentDistance * t,
      })
    }

    distanceOffset += segmentDistance
  })

  return Promise.all(
    samples.map(async (sample) => ({
      ...sample,
      elevation: await getElevation(sample.lat, sample.lng),
    }))
  )
}

function nearestGridElevation(grid: TerrainGrid, lat: number, lng: number) {
  const row = Math.round(((grid.bounds.north - lat) / (grid.bounds.north - grid.bounds.south)) * (grid.rows - 1))
  const col = Math.round(((lng - grid.bounds.west) / (grid.bounds.east - grid.bounds.west)) * (grid.cols - 1))
  return grid.cells[clamp(row, 0, grid.rows - 1)]?.[clamp(col, 0, grid.cols - 1)]?.elevation
}

function terrainColor(elevation: number, min: number, max: number) {
  const t = clamp((elevation - min) / Math.max(max - min, 1), 0, 1)
  if (t < 0.33) {
    const p = t / 0.33
    return [0.1 + p * 0.16, 0.47 + p * 0.24, 0.34 + p * 0.02]
  }
  if (t < 0.66) {
    const p = (t - 0.33) / 0.33
    return [0.26 + p * 0.34, 0.71 - p * 0.06, 0.36 - p * 0.17]
  }
  const p = (t - 0.66) / 0.34
  return [0.6 + p * 0.22, 0.65 - p * 0.18, 0.19 + p * 0.08]
}

function useTerrainScene({
  containerRef,
  grid,
  points,
  routePoints,
  verticalExaggeration,
}: {
  containerRef: RefObject<HTMLDivElement | null>
  grid: TerrainGrid | null
  points: TerrainPoint[]
  routePoints: RoutePoint[]
  verticalExaggeration: number
}) {
  useEffect(() => {
    const container = containerRef.current
    if (!container || !grid) return

    let cancelled = false
    let animationId = 0
    let renderer: any
    let scene: any
    let resizeObserver: ResizeObserver | null = null

    loadThree().then((THREE) => {
      if (cancelled) return

      const width = container.clientWidth || 800
      const height = container.clientHeight || 520
      const centerLat = (grid.bounds.north + grid.bounds.south) / 2
      const centerLng = (grid.bounds.east + grid.bounds.west) / 2
      const metersPerLat = 111320
      const metersPerLng = 111320 * Math.cos((centerLat * Math.PI) / 180)
      const maxSpanMeters = Math.max(
        (grid.bounds.east - grid.bounds.west) * metersPerLng,
        (grid.bounds.north - grid.bounds.south) * metersPerLat
      )
      const sceneScale = 18 / Math.max(maxSpanMeters, 1)
      const verticalScale = sceneScale * verticalExaggeration
      const heightRange = Math.max(grid.maxElevation - grid.minElevation, 1) * verticalScale

      const toScenePoint = (point: Pick<TerrainPoint, 'lat' | 'lng'>) => {
        const elevation = nearestGridElevation(grid, point.lat, point.lng) ?? grid.minElevation
        return new THREE.Vector3(
          (point.lng - centerLng) * metersPerLng * sceneScale,
          (elevation - grid.minElevation) * verticalScale,
          -(point.lat - centerLat) * metersPerLat * sceneScale
        )
      }

      scene = new THREE.Scene()
      scene.background = new THREE.Color(0xf8fafc)

      const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000)
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      renderer.setSize(width, height)
      renderer.domElement.setAttribute('aria-label', '土浦用水の3D地形モデル')
      container.replaceChildren(renderer.domElement)

      const positions: number[] = []
      const colors: number[] = []
      const indices: number[] = []

      grid.cells.forEach((row) => {
        row.forEach((cell) => {
          const elevation = cell.elevation ?? grid.minElevation
          positions.push(
            (cell.lng - centerLng) * metersPerLng * sceneScale,
            (elevation - grid.minElevation) * verticalScale,
            -(cell.lat - centerLat) * metersPerLat * sceneScale
          )
          colors.push(...terrainColor(elevation, grid.minElevation, grid.maxElevation))
        })
      })

      for (let row = 0; row < grid.rows - 1; row += 1) {
        for (let col = 0; col < grid.cols - 1; col += 1) {
          const a = row * grid.cols + col
          const b = a + 1
          const c = a + grid.cols
          const d = c + 1
          indices.push(a, c, b, b, c, d)
        }
      }

      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
      geometry.setIndex(indices)
      geometry.computeVertexNormals()

      const material = new THREE.MeshLambertMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
      })
      scene.add(new THREE.Mesh(geometry, material))
      scene.add(new THREE.AmbientLight(0xffffff, 0.72))

      const directionalLight = new THREE.DirectionalLight(0xffffff, 1.05)
      directionalLight.position.set(-8, 14, 10)
      scene.add(directionalLight)

      const markerGroup = new THREE.Group()
      const markerGeometry = new THREE.SphereGeometry(0.052, 10, 8)
      const routeGeometry = new THREE.SphereGeometry(0.12, 14, 10)
      const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xdc2626 })
      const startMaterial = new THREE.MeshBasicMaterial({ color: 0x0284c7 })
      const midMaterial = new THREE.MeshBasicMaterial({ color: 0xf59e0b })
      const endMaterial = new THREE.MeshBasicMaterial({ color: 0x16a34a })
      const renderedPoints = points
        .filter((point) => isInsideBounds(point, grid.bounds))
        .slice(0, MAX_RENDERED_MARKERS)

      renderedPoints.forEach((point) => {
        const marker = new THREE.Mesh(markerGeometry, markerMaterial)
        const position = toScenePoint(point)
        marker.position.copy(position)
        marker.position.y += 0.12
        markerGroup.add(marker)
      })

      const routePositions = routePoints
        .filter((point) => isInsideBounds(point, grid.bounds))
        .map((point) => toScenePoint(point))

      routePositions.forEach((position, index) => {
        const marker = new THREE.Mesh(
          routeGeometry,
          index === 0 ? startMaterial : index === routePositions.length - 1 ? endMaterial : midMaterial
        )
        marker.position.copy(position)
        marker.position.y += 0.26
        markerGroup.add(marker)
      })
      scene.add(markerGroup)

      if (routePositions.length >= 2) {
        const linePoints = routePositions.map((position) => position.clone().setY(position.y + 0.28))
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(linePoints),
          new THREE.LineBasicMaterial({ color: 0x111827 })
        )
        scene.add(line)
      }

      const target = new THREE.Vector3(0, heightRange * 0.22, 0)
      let yaw = -0.75
      let pitch = 0.58
      let distance = 26
      let dragging = false
      let lastX = 0
      let lastY = 0

      const updateCamera = () => {
        const horizontal = distance * Math.cos(pitch)
        camera.position.set(
          Math.sin(yaw) * horizontal,
          distance * Math.sin(pitch) + heightRange * 0.25,
          Math.cos(yaw) * horizontal
        )
        camera.lookAt(target)
      }

      const onPointerDown = (event: PointerEvent) => {
        dragging = true
        lastX = event.clientX
        lastY = event.clientY
        renderer.domElement.setPointerCapture(event.pointerId)
      }

      const onPointerMove = (event: PointerEvent) => {
        if (!dragging) return
        const dx = event.clientX - lastX
        const dy = event.clientY - lastY
        lastX = event.clientX
        lastY = event.clientY
        yaw -= dx * 0.006
        pitch = clamp(pitch + dy * 0.006, 0.18, 1.18)
        updateCamera()
      }

      const onPointerUp = (event: PointerEvent) => {
        dragging = false
        if (renderer.domElement.hasPointerCapture(event.pointerId)) {
          renderer.domElement.releasePointerCapture(event.pointerId)
        }
      }

      const onWheel = (event: WheelEvent) => {
        event.preventDefault()
        distance = clamp(distance * (1 + event.deltaY * 0.0012), 12, 56)
        updateCamera()
      }

      renderer.domElement.addEventListener('pointerdown', onPointerDown)
      renderer.domElement.addEventListener('pointermove', onPointerMove)
      renderer.domElement.addEventListener('pointerup', onPointerUp)
      renderer.domElement.addEventListener('pointercancel', onPointerUp)
      renderer.domElement.addEventListener('wheel', onWheel, { passive: false })

      resizeObserver = new ResizeObserver(() => {
        const nextWidth = container.clientWidth || width
        const nextHeight = container.clientHeight || height
        renderer.setSize(nextWidth, nextHeight)
        camera.aspect = nextWidth / nextHeight
        camera.updateProjectionMatrix()
      })
      resizeObserver.observe(container)

      updateCamera()
      const render = () => {
        animationId = requestAnimationFrame(render)
        renderer.render(scene, camera)
      }
      render()

      const cleanup = () => {
        renderer.domElement.removeEventListener('pointerdown', onPointerDown)
        renderer.domElement.removeEventListener('pointermove', onPointerMove)
        renderer.domElement.removeEventListener('pointerup', onPointerUp)
        renderer.domElement.removeEventListener('pointercancel', onPointerUp)
        renderer.domElement.removeEventListener('wheel', onWheel)
      }

      const canvas = renderer.domElement as HTMLCanvasElement & { __terrainCleanup?: () => void }
      canvas.__terrainCleanup = cleanup
    }).catch(() => {
      if (cancelled) return
      const message = document.createElement('div')
      message.className = 'flex h-full items-center justify-center text-sm text-red-600'
      message.textContent = '3D表示を読み込めませんでした'
      container.replaceChildren(message)
    })

    return () => {
      cancelled = true
      if (animationId) cancelAnimationFrame(animationId)
      resizeObserver?.disconnect()
      const canvas = renderer?.domElement as (HTMLCanvasElement & { __terrainCleanup?: () => void }) | undefined
      canvas?.__terrainCleanup?.()
      if (scene) {
        scene.traverse((object: any) => {
          object.geometry?.dispose?.()
          if (Array.isArray(object.material)) object.material.forEach((mat: any) => mat.dispose?.())
          else object.material?.dispose?.()
        })
      }
      renderer?.dispose?.()
      if (canvas && container.contains(canvas)) container.removeChild(canvas)
    }
  }, [containerRef, grid, points, routePoints, verticalExaggeration])
}

function formatElevation(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-'
  return `${value.toFixed(1)} m`
}

function formatDistance(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(2)} km`
  return `${value.toFixed(0)} m`
}

function profileStats(profile: ProfilePoint[]): ProfileStats | null {
  const elevations = profile
    .map((point) => point.elevation)
    .filter((elevation): elevation is number => elevation !== null)
  if (!elevations.length) return null

  let ascent = 0
  let descent = 0
  for (let index = 1; index < profile.length; index += 1) {
    const previous = profile[index - 1].elevation
    const current = profile[index].elevation
    if (previous === null || current === null) continue
    const diff = current - previous
    if (diff > 0) ascent += diff
    else descent += Math.abs(diff)
  }

  return {
    min: Math.min(...elevations),
    max: Math.max(...elevations),
    start: profile.find((point) => point.elevation !== null)?.elevation ?? null,
    end: [...profile].reverse().find((point) => point.elevation !== null)?.elevation ?? null,
    distance: profile.at(-1)?.distance ?? 0,
    ascent,
    descent,
  }
}

function ElevationProfileChart({ profile }: { profile: ProfilePoint[] }) {
  const stats = profileStats(profile)
  if (!stats) {
    return (
      <div className="flex h-72 items-center justify-center rounded border border-dashed bg-gray-50 text-sm text-gray-500">
        断面データなし
      </div>
    )
  }

  const width = 1040
  const height = 320
  const padLeft = 58
  const padRight = 28
  const padTop = 24
  const padBottom = 46
  const graphWidth = width - padLeft - padRight
  const graphHeight = height - padTop - padBottom
  const elevationRange = Math.max(stats.max - stats.min, 1)
  const totalDistance = Math.max(stats.distance, 1)
  const points = profile
    .filter((point) => point.elevation !== null)
    .map((point) => {
      const x = padLeft + (point.distance / totalDistance) * graphWidth
      const y = padTop + ((stats.max - (point.elevation ?? stats.min)) / elevationRange) * graphHeight
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-80 w-full overflow-visible">
      <rect x={padLeft} y={padTop} width={graphWidth} height={graphHeight} fill="#f8fafc" />
      {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
        <g key={tick}>
          <line
            x1={padLeft}
            x2={width - padRight}
            y1={padTop + tick * graphHeight}
            y2={padTop + tick * graphHeight}
            stroke="#e5e7eb"
          />
          <text x={12} y={padTop + tick * graphHeight + 4} fill="#6b7280" fontSize="12">
            {(stats.max - tick * elevationRange).toFixed(0)}m
          </text>
        </g>
      ))}
      <line x1={padLeft} x2={width - padRight} y1={height - padBottom} y2={height - padBottom} stroke="#9ca3af" />
      <line x1={padLeft} x2={padLeft} y1={padTop} y2={height - padBottom} stroke="#9ca3af" />
      <polyline points={points} fill="none" stroke="#0f766e" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      <text x={padLeft} y={height - 8} fill="#6b7280" fontSize="12">0</text>
      <text x={width - padRight - 74} y={height - 8} fill="#6b7280" fontSize="12">
        {formatDistance(stats.distance)}
      </text>
    </svg>
  )
}

function escapeCsv(value: string | number | null) {
  if (value === null) return ''
  const text = String(value)
  if (!/[",\n]/.test(text)) return text
  return `"${text.replaceAll('"', '""')}"`
}

function downloadProfileCsv(profile: ProfilePoint[], routePoints: RoutePoint[]) {
  const header = ['index', 'distance_m', 'lat', 'lng', 'elevation_m']
  const rows = profile.map((point, index) => [
    index + 1,
    point.distance.toFixed(2),
    point.lat.toFixed(8),
    point.lng.toFixed(8),
    point.elevation === null ? null : point.elevation.toFixed(2),
  ])
  const routeRows = routePoints.map((point, index) => [
    `route-${index + 1}`,
    '',
    point.lat.toFixed(8),
    point.lng.toFixed(8),
    point.label,
  ])
  const csv = [header, ...rows, [], ['route_order', 'distance_m', 'lat', 'lng', 'label'], ...routeRows]
    .map((row) => row.map(escapeCsv).join(','))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `tsuchiura-yosui-profile-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Image failed to load'))
    image.src = src
  })
}

async function imageFromSvg(svg: SVGSVGElement, width: number, height: number) {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    return await loadImage(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function drawContainedImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement | HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number
) {
  const imageWidth = image instanceof HTMLCanvasElement ? image.width : image.naturalWidth || image.width
  const imageHeight = image instanceof HTMLCanvasElement ? image.height : image.naturalHeight || image.height
  const scale = Math.min(width / Math.max(imageWidth, 1), height / Math.max(imageHeight, 1))
  const drawWidth = imageWidth * scale
  const drawHeight = imageHeight * scale
  context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight)
}

function drawExportPanel(
  context: CanvasRenderingContext2D,
  title: string,
  image: HTMLImageElement | HTMLCanvasElement | null,
  x: number,
  y: number,
  width: number,
  height: number
) {
  context.fillStyle = '#ffffff'
  context.fillRect(x, y, width, height)
  context.strokeStyle = '#d4d4d8'
  context.lineWidth = 1
  context.strokeRect(x, y, width, height)
  context.fillStyle = '#18181b'
  context.font = 'bold 18px sans-serif'
  context.textBaseline = 'top'
  context.fillText(title, x + 16, y + 14)

  const contentX = x + 16
  const contentY = y + 48
  const contentWidth = width - 32
  const contentHeight = height - 64
  context.fillStyle = '#f8fafc'
  context.fillRect(contentX, contentY, contentWidth, contentHeight)

  if (image) {
    drawContainedImage(context, image, contentX, contentY, contentWidth, contentHeight)
  } else {
    context.fillStyle = '#71717a'
    context.font = '16px sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText('断面データなし', contentX + contentWidth / 2, contentY + contentHeight / 2)
    context.textAlign = 'left'
  }
}

function drawExportStat(
  context: CanvasRenderingContext2D,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number
) {
  context.fillStyle = '#f8fafc'
  context.fillRect(x, y, width, height)
  context.strokeStyle = '#e4e4e7'
  context.strokeRect(x, y, width, height)
  context.fillStyle = '#71717a'
  context.font = '13px sans-serif'
  context.textBaseline = 'top'
  context.fillText(label, x + 12, y + 10)
  context.fillStyle = '#18181b'
  context.font = 'bold 18px sans-serif'
  context.fillText(value, x + 12, y + 32)
}

function downloadCanvasPng(canvas: HTMLCanvasElement, filename: string) {
  const url = canvas.toDataURL('image/png')
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

export default function TerrainPageClient() {
  const sceneRef = useRef<HTMLDivElement | null>(null)
  const profileChartRef = useRef<HTMLDivElement | null>(null)
  const mapExporterRef = useRef<MapExporter | null>(null)
  const [points, setPoints] = useState<TerrainPoint[]>(FALLBACK_POINTS)
  const [routePoints, setRoutePoints] = useState<RoutePoint[]>(INITIAL_ROUTE_POINTS)
  const [usingFallback, setUsingFallback] = useState(true)
  const [terrainGrid, setTerrainGrid] = useState<TerrainGrid | null>(null)
  const [terrainLoading, setTerrainLoading] = useState(true)
  const [terrainError, setTerrainError] = useState<string | null>(null)
  const [profile, setProfile] = useState<ProfilePoint[]>([])
  const [profileLoading, setProfileLoading] = useState(false)
  const [verticalExaggeration, setVerticalExaggeration] = useState(12)
  const [pointSearch, setPointSearch] = useState('')
  const [savedProfiles, setSavedProfiles] = useState<SavedRouteProfile[]>([])
  const [savedProfilesLoaded, setSavedProfilesLoaded] = useState(false)
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [profileName, setProfileName] = useState('')
  const [exportingPng, setExportingPng] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  useEffect(() => {
    const loadedProfiles = loadSavedProfiles()
    setSavedProfiles(loadedProfiles)
    setProfileName(nextProfileName(loadedProfiles))
    setSavedProfilesLoaded(true)
  }, [])

  useEffect(() => {
    if (!savedProfilesLoaded) return
    saveProfilesToStorage(savedProfiles)
  }, [savedProfiles, savedProfilesLoaded])

  const registerMapExporter = useCallback((exporter: MapExporter | null) => {
    mapExporterRef.current = exporter
  }, [])

  useEffect(() => {
    let cancelled = false

    fetch(`/api/notes?map=${encodeURIComponent(MAP_SLUG)}`)
      .then((response) => (response.ok ? response.json() : []))
      .then((data: Note[]) => {
        if (cancelled || !Array.isArray(data)) return
        const normalized = data
          .filter((note) => Number.isFinite(note.lat) && Number.isFinite(note.lng))
          .map((note, index) => ({
            id: note.id,
            lat: note.lat,
            lng: note.lng,
            label: labelForNote(note, index),
          }))

        if (normalized.length) {
          setPoints(normalized)
          setUsingFallback(false)
          setRoutePoints((current) => (routeIsInitialFallback(current) ? initialRouteFrom(normalized) : current))
        }
      })
      .catch(() => {
        if (!cancelled) setUsingFallback(true)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setTerrainLoading(true)
    setTerrainError(null)

    buildTerrainGrid(TSUCHIURA_BOUNDS)
      .then((grid) => {
        if (cancelled) return
        setTerrainGrid(grid)
        setTerrainLoading(false)
      })
      .catch((error: Error) => {
        if (cancelled) return
        setTerrainError(error.message)
        setTerrainLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const addRoutePoint = useCallback((point: TerrainPoint) => {
    setRoutePoints((current) => {
      const last = current.at(-1)
      if (last && Math.abs(last.lat - point.lat) < 1e-10 && Math.abs(last.lng - point.lng) < 1e-10) {
        return current
      }
      return [...current, routePointFrom(point, current.length)]
    })
  }, [])

  const addFreeRoutePoint = useCallback((lat: number, lng: number) => {
    if (!isInsideBounds({ lat, lng }, TSUCHIURA_BOUNDS)) return
    setRoutePoints((current) => [
      ...current,
      routePointFrom(
        {
          id: `custom-${current.length + 1}-${lat.toFixed(5)}-${lng.toFixed(5)}`,
          lat,
          lng,
          label: `任意地点 ${current.filter((point) => point.source === 'custom').length + 1}`,
        },
        current.length,
        'custom'
      ),
    ])
  }, [])

  const moveRoutePoint = useCallback((index: number, direction: -1 | 1) => {
    setRoutePoints((current) => {
      const nextIndex = index + direction
      if (nextIndex < 0 || nextIndex >= current.length) return current
      const next = [...current]
      const item = next[index]
      next[index] = next[nextIndex]
      next[nextIndex] = item
      return next
    })
  }, [])

  const removeRoutePoint = useCallback((routeKey: string) => {
    setRoutePoints((current) => current.filter((point) => point.routeKey !== routeKey))
  }, [])

  const loadSavedRouteProfile = useCallback(
    (profileId: string) => {
      setSelectedProfileId(profileId)
      const savedProfile = savedProfiles.find((item) => item.id === profileId)
      if (!savedProfile) return
      setProfileName(savedProfile.name)
      setRoutePoints(savedProfile.points.map(routePointFromSaved))
    },
    [savedProfiles]
  )

  const startNewSavedProfile = useCallback(() => {
    setSelectedProfileId('')
    setProfileName(nextProfileName(savedProfiles))
  }, [savedProfiles])

  const saveCurrentRouteProfile = useCallback(() => {
    if (routePoints.length < 2) return

    const now = new Date().toISOString()
    const name = profileName.trim() || nextProfileName(savedProfiles)
    const pointsToSave = routePoints.map(serializeRoutePoint)
    const existingId = selectedProfileId && savedProfiles.some((item) => item.id === selectedProfileId) ? selectedProfileId : ''
    const nextId = existingId || createProfileId()

    setSavedProfiles((current) => {
      const existingIndex = current.findIndex((item) => item.id === nextId)
      if (existingIndex >= 0) {
        const next = [...current]
        next[existingIndex] = { ...next[existingIndex], name, points: pointsToSave, updatedAt: now }
        return next
      }
      return [...current, { id: nextId, name, points: pointsToSave, createdAt: now, updatedAt: now }]
    })
    setSelectedProfileId(nextId)
    setProfileName(name)
  }, [profileName, routePoints, savedProfiles, selectedProfileId])

  const deleteSelectedRouteProfile = useCallback(() => {
    if (!selectedProfileId) return
    setSavedProfiles((current) => current.filter((item) => item.id !== selectedProfileId))
    setSelectedProfileId('')
    setProfileName('')
  }, [selectedProfileId])

  useEffect(() => {
    if (profileName || selectedProfileId) return
    setProfileName(nextProfileName(savedProfiles))
  }, [profileName, savedProfiles, selectedProfileId])

  const refreshProfile = useCallback(() => {
    if (routePoints.length < 2) {
      setProfile([])
      return
    }
    setProfileLoading(true)
    buildElevationProfile(routePoints)
      .then(setProfile)
      .finally(() => setProfileLoading(false))
  }, [routePoints])

  useEffect(() => {
    refreshProfile()
  }, [refreshProfile])

  useTerrainScene({
    containerRef: sceneRef,
    grid: terrainGrid,
    points,
    routePoints,
    verticalExaggeration,
  })

  const insidePointCount = useMemo(
    () => points.filter((point) => isInsideBounds(point, TSUCHIURA_BOUNDS)).length,
    [points]
  )
  const filteredPoints = useMemo(() => {
    const query = pointSearch.trim().toLowerCase()
    if (!query) return points.slice(0, 8)
    return points.filter((point) => point.label.toLowerCase().includes(query)).slice(0, 12)
  }, [pointSearch, points])
  const stats = profileStats(profile)
  const selectedSavedProfile = useMemo(
    () => savedProfiles.find((item) => item.id === selectedProfileId) ?? null,
    [savedProfiles, selectedProfileId]
  )

  const downloadCombinedPng = useCallback(async () => {
    const sceneCanvas = sceneRef.current?.querySelector('canvas') as HTMLCanvasElement | null | undefined
    const mapExporter = mapExporterRef.current
    if (!sceneCanvas || !mapExporter) {
      setExportError('PNG出力に必要な表示がまだ準備できていません')
      return
    }

    setExportingPng(true)
    setExportError(null)

    try {
      const [sceneImage, exportedMap] = await Promise.all([
        loadImage(sceneCanvas.toDataURL('image/png')),
        mapExporter(),
      ])
      const mapImage = await loadImage(exportedMap.dataUrl)
      const profileSvg = profileChartRef.current?.querySelector('svg') as SVGSVGElement | null | undefined
      const profileRect = profileChartRef.current?.getBoundingClientRect()
      const profileImage = profileSvg
        ? await imageFromSvg(
            profileSvg,
            Math.max(1040, Math.round(profileRect?.width || 1040)),
            Math.max(320, Math.round(profileRect?.height || 320))
          )
        : null

      const width = 1440
      const margin = 32
      const gap = 24
      const headerHeight = 76
      const topPanelHeight = 500
      const statsHeight = 76
      const chartHeight = 410
      const topPanelWidth = (width - margin * 2 - gap) / 2
      const height = margin + headerHeight + topPanelHeight + gap + statsHeight + 16 + chartHeight + margin
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas is not available')

      context.fillStyle = '#f4f4f5'
      context.fillRect(0, 0, width, height)
      context.fillStyle = '#18181b'
      context.font = 'bold 30px sans-serif'
      context.textBaseline = 'top'
      context.fillText('土浦用水 3D地形・標高断面', margin, margin)
      context.font = '16px sans-serif'
      context.fillStyle = '#52525b'
      const subtitle = profileName.trim() || selectedSavedProfile?.name || '未保存プロファイル'
      context.fillText(`${subtitle} / 測線 ${routePoints.length}点 / ${new Date().toLocaleString('ja-JP')}`, margin, margin + 42)

      const topY = margin + headerHeight
      drawExportPanel(context, '3D地形', sceneImage, margin, topY, topPanelWidth, topPanelHeight)
      drawExportPanel(context, 'OSM地図', mapImage, margin + topPanelWidth + gap, topY, topPanelWidth, topPanelHeight)

      const statsY = topY + topPanelHeight + gap
      const statGap = 12
      const statWidth = (width - margin * 2 - statGap * 5) / 6
      const elevationDelta =
        stats && stats.start !== null && stats.end !== null ? formatElevation(stats.end - stats.start) : '-'
      const exportStats = [
        ['距離', stats ? formatDistance(stats.distance) : '-'],
        ['標高差', elevationDelta],
        ['累積上昇', stats ? formatElevation(stats.ascent) : '-'],
        ['累積下降', stats ? formatElevation(stats.descent) : '-'],
        ['最低', stats ? formatElevation(stats.min) : '-'],
        ['最高', stats ? formatElevation(stats.max) : '-'],
      ]
      exportStats.forEach(([label, value], index) => {
        drawExportStat(context, label, value, margin + index * (statWidth + statGap), statsY, statWidth, statsHeight)
      })

      drawExportPanel(context, '標高断面', profileImage, margin, statsY + statsHeight + 16, width - margin * 2, chartHeight)
      downloadCanvasPng(canvas, `tsuchiura-yosui-terrain-${new Date().toISOString().slice(0, 10)}.png`)
    } catch {
      setExportError('PNG出力に失敗しました。地図タイルの読み込み後に再試行してください')
    } finally {
      setExportingPng(false)
    }
  }, [profileName, routePoints.length, selectedSavedProfile?.name, stats])

  return (
    <div className="min-h-[calc(100vh-96px)] bg-zinc-50 text-zinc-900">
      <section className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <Link href="/" className="inline-flex items-center gap-2 text-sm text-gray-600 transition hover:text-gray-950">
              <IoArrowBackOutline />
              トップ
            </Link>
            <h1 className="mt-2 text-2xl font-bold sm:text-3xl">土浦用水 3D地形・標高断面</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 rounded border bg-white px-3 py-2 text-sm font-semibold shadow-sm transition hover:border-teal-500 hover:text-teal-700 disabled:cursor-not-allowed disabled:text-gray-300"
              onClick={downloadCombinedPng}
              disabled={!terrainGrid || terrainLoading || exportingPng}
            >
              <IoImageOutline />
              {exportingPng ? 'PNG作成中' : 'PNG出力'}
            </button>
            <Link
              href="/maps/tsuchiura-yosui"
              className="inline-flex items-center justify-center gap-2 rounded border bg-white px-3 py-2 text-sm font-semibold shadow-sm transition hover:border-blue-400 hover:text-blue-700"
            >
              <IoMapOutline />
              通常マップ
            </Link>
          </div>
        </div>
      </section>

      <main className="mx-auto grid max-w-7xl gap-4 px-4 py-4 xl:grid-cols-[minmax(0,1fr)_390px]">
        <div className="space-y-4">
          {exportError && (
            <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{exportError}</div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="overflow-hidden rounded border bg-white shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <IoCubeOutline className="shrink-0 text-lg text-teal-700" />
                  <h2 className="truncate text-base font-semibold">3D地形</h2>
                </div>
                <div className="text-xs text-gray-500">
                  {terrainGrid ? `${terrainGrid.minElevation.toFixed(0)}-${terrainGrid.maxElevation.toFixed(0)}m` : 'DEM'}
                </div>
              </div>
              <div ref={sceneRef} className="h-[420px] min-h-[420px] bg-slate-50 sm:h-[500px] xl:h-[520px]" />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-4 py-3 text-sm text-gray-600">
                <span>{usingFallback ? 'サンプル点' : `保存ピン ${points.length}点`}</span>
                <span>表示範囲内 {insidePointCount}点</span>
                <span>測線 {routePoints.length}点</span>
                {terrainLoading && <span>DEM読み込み中</span>}
                {terrainError && <span className="text-red-600">DEM取得に失敗しました</span>}
              </div>
            </section>

            <section className="overflow-hidden rounded border bg-white shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <IoMapOutline className="shrink-0 text-lg text-teal-700" />
                  <h2 className="truncate text-base font-semibold">地図選択</h2>
                </div>
                <div className="text-xs text-gray-500">クリック追加</div>
              </div>
              <div className="h-[420px] min-h-[420px] sm:h-[500px] xl:h-[520px]">
                <TerrainSelectionMap
                  points={points}
                  routePoints={routePoints}
                  bounds={TSUCHIURA_BOUNDS}
                  onSelectPoint={addRoutePoint}
                  onAddFreePoint={addFreeRoutePoint}
                  onExporterReady={registerMapExporter}
                />
              </div>
            </section>
          </div>

          <section className="rounded border bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <IoStatsChartOutline className="text-lg text-teal-700" />
                <h2 className="text-base font-semibold">断面</h2>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded border bg-white text-gray-700 transition hover:border-teal-500 hover:text-teal-700 disabled:cursor-not-allowed disabled:text-gray-300"
                  title="断面更新"
                  aria-label="断面更新"
                  onClick={refreshProfile}
                  disabled={routePoints.length < 2 || profileLoading}
                >
                  <IoRefreshOutline />
                </button>
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded border bg-white text-gray-700 transition hover:border-teal-500 hover:text-teal-700 disabled:cursor-not-allowed disabled:text-gray-300"
                  title="CSV出力"
                  aria-label="CSV出力"
                  onClick={() => downloadProfileCsv(profile, routePoints)}
                  disabled={!profile.length}
                >
                  <IoDownloadOutline />
                </button>
              </div>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
              <div className="rounded bg-gray-50 p-3">
                <div className="text-xs text-gray-500">距離</div>
                <div className="mt-1 font-semibold">{stats ? formatDistance(stats.distance) : '-'}</div>
              </div>
              <div className="rounded bg-gray-50 p-3">
                <div className="text-xs text-gray-500">標高差</div>
                <div className="mt-1 font-semibold">
                  {stats && stats.start !== null && stats.end !== null ? formatElevation(stats.end - stats.start) : '-'}
                </div>
              </div>
              <div className="rounded bg-gray-50 p-3">
                <div className="text-xs text-gray-500">累積上昇</div>
                <div className="mt-1 font-semibold">{stats ? formatElevation(stats.ascent) : '-'}</div>
              </div>
              <div className="rounded bg-gray-50 p-3">
                <div className="text-xs text-gray-500">累積下降</div>
                <div className="mt-1 font-semibold">{stats ? formatElevation(stats.descent) : '-'}</div>
              </div>
              <div className="rounded bg-gray-50 p-3">
                <div className="text-xs text-gray-500">最低</div>
                <div className="mt-1 font-semibold">{stats ? formatElevation(stats.min) : '-'}</div>
              </div>
              <div className="rounded bg-gray-50 p-3">
                <div className="text-xs text-gray-500">最高</div>
                <div className="mt-1 font-semibold">{stats ? formatElevation(stats.max) : '-'}</div>
              </div>
            </div>
            <div ref={profileChartRef}>
              {profileLoading ? (
                <div className="flex h-80 items-center justify-center rounded border border-dashed bg-gray-50 text-sm text-gray-500">
                  計算中
                </div>
              ) : (
                <ElevationProfileChart profile={profile} />
              )}
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <IoBookmarkOutline className="text-lg text-teal-700" />
              <h2 className="text-base font-semibold">プロファイル</h2>
            </div>
            <div className="space-y-3">
              <select
                className="w-full rounded border bg-white px-3 py-2 text-sm"
                value={selectedProfileId}
                onChange={(event) => {
                  const profileId = event.target.value
                  if (profileId) loadSavedRouteProfile(profileId)
                  else startNewSavedProfile()
                }}
              >
                <option value="">新規プロファイル</option>
                {savedProfiles.map((savedProfile) => (
                  <option key={savedProfile.id} value={savedProfile.id}>
                    {savedProfile.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                className="w-full rounded border px-3 py-2 text-sm"
                placeholder="プロファイル名"
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
              />
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-1 rounded border bg-teal-700 px-2 py-2 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
                  onClick={saveCurrentRouteProfile}
                  disabled={routePoints.length < 2}
                >
                  <IoSaveOutline />
                  保存
                </button>
                <button
                  type="button"
                  className="rounded border bg-white px-2 py-2 text-sm font-semibold text-gray-700 transition hover:border-teal-500 hover:text-teal-700"
                  onClick={startNewSavedProfile}
                >
                  新規
                </button>
                <button
                  type="button"
                  className="rounded border bg-white px-2 py-2 text-sm font-semibold text-gray-700 transition hover:border-red-500 hover:text-red-600 disabled:cursor-not-allowed disabled:text-gray-300"
                  onClick={deleteSelectedRouteProfile}
                  disabled={!selectedProfileId}
                >
                  削除
                </button>
              </div>
              {selectedSavedProfile && (
                <div className="text-xs text-gray-500">
                  {selectedSavedProfile.points.length}点 / 更新 {new Date(selectedSavedProfile.updatedAt).toLocaleString('ja-JP')}
                </div>
              )}
            </div>
          </section>

          <section className="rounded border bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <IoListOutline className="text-lg text-teal-700" />
                <h2 className="text-base font-semibold">測線</h2>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded border bg-white text-gray-700 transition hover:border-teal-500 hover:text-teal-700 disabled:cursor-not-allowed disabled:text-gray-300"
                  title="順番を反転"
                  aria-label="順番を反転"
                  onClick={() => setRoutePoints((current) => [...current].reverse())}
                  disabled={routePoints.length < 2}
                >
                  <IoSwapHorizontalOutline />
                </button>
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded border bg-white text-gray-700 transition hover:border-red-500 hover:text-red-600 disabled:cursor-not-allowed disabled:text-gray-300"
                  title="測線をクリア"
                  aria-label="測線をクリア"
                  onClick={() => setRoutePoints([])}
                  disabled={!routePoints.length}
                >
                  <IoTrashOutline />
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <input
                type="search"
                className="w-full rounded border px-3 py-2 text-sm"
                placeholder="ピン名で検索"
                value={pointSearch}
                onChange={(event) => setPointSearch(event.target.value)}
              />
              <div className="max-h-48 space-y-1 overflow-y-auto rounded border bg-gray-50 p-2">
                {filteredPoints.map((point) => (
                  <button
                    key={point.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded bg-white px-2 py-2 text-left text-sm transition hover:bg-teal-50"
                    onClick={() => addRoutePoint(point)}
                  >
                    <IoAdd className="shrink-0 text-teal-700" />
                    <span className="min-w-0 truncate">{point.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {routePoints.length === 0 && (
                <div className="rounded border border-dashed bg-gray-50 p-3 text-sm text-gray-500">測線点なし</div>
              )}
              {routePoints.map((point, index) => (
                <div key={point.routeKey} className="rounded border bg-white p-3 shadow-sm">
                  <div className="flex items-start gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-700 text-sm font-semibold text-white">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{point.label}</div>
                      <div className="mt-1 text-xs text-gray-500">
                        {point.lat.toFixed(6)}, {point.lng.toFixed(6)}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      <button
                        type="button"
                        className="flex h-8 w-8 items-center justify-center rounded border text-gray-700 transition hover:border-teal-500 hover:text-teal-700 disabled:cursor-not-allowed disabled:text-gray-300"
                        title="上へ"
                        aria-label="上へ"
                        onClick={() => moveRoutePoint(index, -1)}
                        disabled={index === 0}
                      >
                        <IoArrowUpOutline />
                      </button>
                      <button
                        type="button"
                        className="flex h-8 w-8 items-center justify-center rounded border text-gray-700 transition hover:border-teal-500 hover:text-teal-700 disabled:cursor-not-allowed disabled:text-gray-300"
                        title="下へ"
                        aria-label="下へ"
                        onClick={() => moveRoutePoint(index, 1)}
                        disabled={index === routePoints.length - 1}
                      >
                        <IoArrowDownOutline />
                      </button>
                      <button
                        type="button"
                        className="col-span-2 flex h-8 items-center justify-center rounded border text-gray-700 transition hover:border-red-500 hover:text-red-600"
                        title="削除"
                        aria-label="削除"
                        onClick={() => removeRoutePoint(point.routeKey)}
                      >
                        <IoClose />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded border bg-white p-4 shadow-sm">
            <label className="block text-sm font-semibold text-gray-700" htmlFor="vertical-scale">
              高さ倍率
            </label>
            <div className="mt-3 flex items-center gap-3">
              <input
                id="vertical-scale"
                type="range"
                min="4"
                max="28"
                value={verticalExaggeration}
                onChange={(event) => setVerticalExaggeration(Number(event.target.value))}
                className="w-full accent-teal-700"
              />
              <span className="w-12 text-right text-sm tabular-nums text-gray-700">{verticalExaggeration}x</span>
            </div>
          </section>
        </aside>
      </main>
    </div>
  )
}
