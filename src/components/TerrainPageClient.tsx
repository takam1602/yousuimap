'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
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
  createdBy?: string
  createdByLogin?: string
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

const MAP_SLUG = 'tsuchiura-yosui'
const SAVED_PROFILES_STORAGE_KEY = `terrain-profiles:${MAP_SLUG}:v1`
const TERRAIN_PROFILES_ENDPOINT = `/api/terrain-profiles?map=${encodeURIComponent(MAP_SLUG)}`
const terrainProfileEndpoint = (profileId: string) =>
  `/api/terrain-profiles/${encodeURIComponent(profileId)}?map=${encodeURIComponent(MAP_SLUG)}`
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js'
const DEM_ZOOM = 14
const TERRAIN_ROWS = 56
const TERRAIN_COLS = 64
const MAX_RENDERED_MARKERS = 1200
const MAX_PROFILE_SAMPLES = 1200
const MIN_PROFILE_SAMPLES = 80
const METERS_PER_PROFILE_SAMPLE = 45
const MAX_RENDERED_LABELS = 80

const EMPTY_MAP_FEATURES: MapOverlayFeatures = { lines: [], labels: [] }
const MAP_LAYER_KEYS: MapLayerKey[] = ['river', 'rail', 'road', 'boundary', 'place', 'station']
const INITIAL_LAYER_VISIBILITY: MapLayerVisibility = {
  river: true,
  rail: true,
  road: false,
  boundary: false,
  place: true,
  station: true,
}
const MAP_LAYER_OPTIONS: { key: MapLayerKey; label: string; description: string; color: string }[] = [
  { key: 'river', label: '河川・水路', description: '河川、用水路、排水路', color: '#2563eb' },
  { key: 'rail', label: '鉄道', description: '鉄道路線', color: '#111827' },
  { key: 'road', label: '主要道路', description: '高速・国道・主要地方道', color: '#f97316' },
  { key: 'boundary', label: '市町村境界', description: '行政境界', color: '#7c3aed' },
  { key: 'place', label: '主要地名', description: '市街地・町名', color: '#047857' },
  { key: 'station', label: '主要駅名', description: '鉄道駅', color: '#be123c' },
]

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
        createdBy: typeof profile.createdBy === 'string' ? profile.createdBy : undefined,
        createdByLogin: typeof profile.createdByLogin === 'string' ? profile.createdByLogin : undefined,
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

function isMapLayerKey(value: unknown): value is MapLayerKey {
  return typeof value === 'string' && MAP_LAYER_KEYS.includes(value as MapLayerKey)
}

function normalizeMapFeaturePoint(value: unknown): MapFeaturePoint | null {
  if (!isRecord(value)) return null
  const lat = Number(value.lat)
  const lng = Number(value.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

function normalizeMapFeatures(value: unknown): MapOverlayFeatures {
  if (!isRecord(value)) return EMPTY_MAP_FEATURES

  const lines = Array.isArray(value.lines)
    ? value.lines.flatMap((feature): MapLineFeature[] => {
        if (!isRecord(feature) || !isMapLayerKey(feature.layer) || !Array.isArray(feature.points)) return []
        const points = feature.points.flatMap((point): MapFeaturePoint[] => {
          const normalized = normalizeMapFeaturePoint(point)
          return normalized ? [normalized] : []
        })
        if (points.length < 2) return []
        return [{
          id: typeof feature.id === 'string' ? feature.id : `${feature.layer}-${points[0].lat}-${points[0].lng}`,
          layer: feature.layer,
          name: typeof feature.name === 'string' ? feature.name : '',
          points,
        }]
      })
    : []

  const labels = Array.isArray(value.labels)
    ? value.labels.flatMap((feature): MapLabelFeature[] => {
        if (!isRecord(feature) || !isMapLayerKey(feature.layer)) return []
        const point = normalizeMapFeaturePoint(feature)
        if (!point || typeof feature.name !== 'string' || !feature.name.trim()) return []
        return [{
          id: typeof feature.id === 'string' ? feature.id : `${feature.layer}-${point.lat}-${point.lng}`,
          layer: feature.layer,
          name: feature.name,
          lat: point.lat,
          lng: point.lng,
        }]
      })
    : []

  return { lines, labels }
}

function mapFeaturesEndpoint(bounds: Bounds) {
  const params = new URLSearchParams({
    north: String(bounds.north),
    south: String(bounds.south),
    west: String(bounds.west),
    east: String(bounds.east),
  })
  return `/api/map-features?${params}`
}

function isGithubAuthenticatedUser(user: { app_metadata?: Record<string, unknown> } | null | undefined) {
  const metadata = user?.app_metadata ?? {}
  const provider = metadata.provider
  const providers = metadata.providers
  return provider === 'github' || (Array.isArray(providers) && providers.includes('github'))
}

async function responseError(response: Response) {
  try {
    const body = await response.json()
    if (isRecord(body)) {
      if (typeof body.error === 'string') return body.error
      if (isRecord(body.error)) {
        const error = body.error
        const parts = [
          typeof error.message === 'string' ? error.message : null,
          typeof error.details === 'string' ? error.details : null,
          typeof error.hint === 'string' ? error.hint : null,
          typeof error.code === 'string' ? `code: ${error.code}` : null,
        ].filter(Boolean)
        if (parts.length) return parts.join(' / ')
      }
      if (body.error) return JSON.stringify(body.error)
    }
  } catch {
    // ignore non-JSON error body
  }
  return `${response.status} ${response.statusText}`.trim()
}

function profileActionErrorMessage(error: unknown, action: '保存' | '削除') {
  const message = error instanceof Error ? error.message : ''
  if (message === 'ログインが必要です' || message === 'Login is required') {
    return 'GitHub ログインが必要です。'
  }
  if (message.includes('Supabase is not configured') || message.includes('environment variables are missing')) {
    return `共有プロファイルの${action}に失敗しました: Supabase のサーバー環境変数が未設定です。`
  }
  if (message.includes('terrain_profiles') && message.includes('does not exist')) {
    return `共有プロファイルの${action}に失敗しました: Supabase に terrain_profiles テーブルがありません。マイグレーションを適用してください。`
  }
  if (message.includes('row-level security') || message.includes('violates row-level security')) {
    return `共有プロファイルの${action}に失敗しました: Supabase の権限設定を確認してください。サーバー側には service role key が必要です。`
  }
  if (!message) return `共有プロファイルの${action}に失敗しました。`
  return `共有プロファイルの${action}に失敗しました: ${message}`
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
  selectedRouteKey,
  verticalExaggeration,
  mapFeatures,
  visibleLayers,
}: {
  containerRef: RefObject<HTMLDivElement | null>
  grid: TerrainGrid | null
  points: TerrainPoint[]
  routePoints: RoutePoint[]
  selectedRouteKey: string | null
  verticalExaggeration: number
  mapFeatures: MapOverlayFeatures
  visibleLayers: MapLayerVisibility
}) {
  const cameraStateRef = useRef<{
    yaw: number
    pitch: number
    distance: number
    target: { x: number; y: number; z: number } | null
  }>({ yaw: -0.75, pitch: 0.58, distance: 26, target: null })
  const lastFocusedRouteKeyRef = useRef<string | null>(null)

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
      renderer.domElement.style.cursor = 'grab'
      renderer.domElement.style.touchAction = 'none'
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

      const layerColors: Record<MapLayerKey, number> = {
        river: 0x2563eb,
        rail: 0x111827,
        road: 0xf97316,
        boundary: 0x7c3aed,
        place: 0x047857,
        station: 0xbe123c,
      }
      const lineLayerYOffset: Record<MapLayerKey, number> = {
        river: 0.1,
        rail: 0.16,
        road: 0.13,
        boundary: 0.2,
        place: 0.22,
        station: 0.24,
      }
      const createLabelSprite = (text: string, color: number) => {
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')
        const label = text.slice(0, 18)
        const font = 'bold 28px sans-serif'
        if (context) context.font = font
        const width = Math.ceil(Math.max(80, context ? context.measureText(label).width + 24 : label.length * 18 + 24))
        const height = 44
        canvas.width = width
        canvas.height = height
        if (context) {
          context.font = font
          context.textBaseline = 'middle'
          context.fillStyle = 'rgba(255,255,255,0.88)'
          context.strokeStyle = '#cbd5e1'
          context.lineWidth = 2
          context.beginPath()
          context.roundRect(1, 1, width - 2, height - 2, 8)
          context.fill()
          context.stroke()
          context.fillStyle = `#${color.toString(16).padStart(6, '0')}`
          context.fillText(label, 12, height / 2 + 1)
        }
        const texture = new THREE.CanvasTexture(canvas)
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false })
        const sprite = new THREE.Sprite(material)
        sprite.scale.set(width * 0.008, height * 0.008, 1)
        return sprite
      }

      const featureGroup = new THREE.Group()
      mapFeatures.lines.forEach((feature) => {
        if (!visibleLayers[feature.layer]) return
        const featurePositions = feature.points
          .filter((point) => isInsideBounds(point, grid.bounds))
          .map((point) => {
            const position = toScenePoint(point)
            position.y += lineLayerYOffset[feature.layer]
            return position
          })
        if (featurePositions.length < 2) return
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(featurePositions),
          new THREE.LineBasicMaterial({ color: layerColors[feature.layer], linewidth: 2 })
        )
        featureGroup.add(line)
      })
      mapFeatures.labels
        .filter((feature) => visibleLayers[feature.layer] && isInsideBounds(feature, grid.bounds))
        .slice(0, MAX_RENDERED_LABELS)
        .forEach((feature) => {
          const sprite = createLabelSprite(feature.name, layerColors[feature.layer])
          const position = toScenePoint(feature)
          sprite.position.copy(position)
          sprite.position.y += feature.layer === 'station' ? 0.72 : 0.6
          featureGroup.add(sprite)
        })
      scene.add(featureGroup)

      const markerGroup = new THREE.Group()
      const markerGeometry = new THREE.SphereGeometry(0.052, 10, 8)
      const routeGeometry = new THREE.SphereGeometry(0.12, 14, 10)
      const selectedRouteGeometry = new THREE.SphereGeometry(0.22, 18, 14)
      const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xdc2626 })
      const startMaterial = new THREE.MeshBasicMaterial({ color: 0x0284c7 })
      const midMaterial = new THREE.MeshBasicMaterial({ color: 0xf59e0b })
      const endMaterial = new THREE.MeshBasicMaterial({ color: 0x16a34a })
      const selectedMaterial = new THREE.MeshBasicMaterial({ color: 0xdb2777 })
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

      const routeMarkers = routePoints
        .filter((point) => isInsideBounds(point, grid.bounds))
        .map((point) => ({ point, position: toScenePoint(point) }))
      const routePositions = routeMarkers.map((marker) => marker.position)

      routeMarkers.forEach(({ point, position }, index) => {
        const selected = point.routeKey === selectedRouteKey
        const marker = new THREE.Mesh(
          selected ? selectedRouteGeometry : routeGeometry,
          selected ? selectedMaterial : index === 0 ? startMaterial : index === routePositions.length - 1 ? endMaterial : midMaterial
        )
        marker.position.copy(position)
        marker.position.y += selected ? 0.38 : 0.26
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

      const selectedRoutePoint =
        selectedRouteKey && selectedRouteKey !== lastFocusedRouteKeyRef.current
          ? routePoints.find((point) => point.routeKey === selectedRouteKey && isInsideBounds(point, grid.bounds))
          : null
      const selectedTarget = selectedRoutePoint ? toScenePoint(selectedRoutePoint) : null
      if (selectedRouteKey !== lastFocusedRouteKeyRef.current) {
        lastFocusedRouteKeyRef.current = selectedRouteKey
      }

      const savedCamera = cameraStateRef.current
      const target = savedCamera.target
        ? new THREE.Vector3(savedCamera.target.x, savedCamera.target.y, savedCamera.target.z)
        : new THREE.Vector3(0, heightRange * 0.22, 0)
      if (selectedTarget) {
        target.set(selectedTarget.x, selectedTarget.y + 0.2, selectedTarget.z)
      }
      let yaw = savedCamera.yaw
      let pitch = savedCamera.pitch
      let distance = savedCamera.distance
      let dragging = false
      let dragMode: 'rotate' | 'pan' = 'rotate'
      let lastX = 0
      let lastY = 0

      const updateCamera = () => {
        const horizontal = distance * Math.cos(pitch)
        camera.position.copy(target).add(new THREE.Vector3(
          Math.sin(yaw) * horizontal,
          distance * Math.sin(pitch) + heightRange * 0.25 - target.y,
          Math.cos(yaw) * horizontal
        ))
        camera.lookAt(target)
        cameraStateRef.current = {
          yaw,
          pitch,
          distance,
          target: { x: target.x, y: target.y, z: target.z },
        }
      }

      const panCamera = (dx: number, dy: number) => {
        const forward = new THREE.Vector3()
        camera.getWorldDirection(forward)
        forward.y = 0
        if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1)
        forward.normalize()
        const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()
        const panScale = distance * 0.0018
        target.addScaledVector(right, -dx * panScale)
        target.addScaledVector(forward, dy * panScale)
        target.x = clamp(target.x, -12, 12)
        target.z = clamp(target.z, -12, 12)
        updateCamera()
      }

      const onPointerDown = (event: PointerEvent) => {
        dragging = true
        dragMode = event.shiftKey || event.button === 1 || event.button === 2 ? 'pan' : 'rotate'
        lastX = event.clientX
        lastY = event.clientY
        renderer.domElement.style.cursor = 'grabbing'
        renderer.domElement.setPointerCapture(event.pointerId)
      }

      const onPointerMove = (event: PointerEvent) => {
        if (!dragging) return
        const dx = event.clientX - lastX
        const dy = event.clientY - lastY
        lastX = event.clientX
        lastY = event.clientY
        if (dragMode === 'pan') {
          panCamera(dx, dy)
        } else {
          yaw -= dx * 0.006
          pitch = clamp(pitch + dy * 0.006, 0.18, 1.18)
          updateCamera()
        }
      }

      const onPointerUp = (event: PointerEvent) => {
        dragging = false
        renderer.domElement.style.cursor = 'grab'
        if (renderer.domElement.hasPointerCapture(event.pointerId)) {
          renderer.domElement.releasePointerCapture(event.pointerId)
        }
      }

      const onWheel = (event: WheelEvent) => {
        event.preventDefault()
        distance = clamp(distance * (1 + event.deltaY * 0.0012), 4, 96)
        updateCamera()
      }

      const onContextMenu = (event: MouseEvent) => {
        event.preventDefault()
      }

      renderer.domElement.addEventListener('pointerdown', onPointerDown)
      renderer.domElement.addEventListener('pointermove', onPointerMove)
      renderer.domElement.addEventListener('pointerup', onPointerUp)
      renderer.domElement.addEventListener('pointercancel', onPointerUp)
      renderer.domElement.addEventListener('wheel', onWheel, { passive: false })
      renderer.domElement.addEventListener('contextmenu', onContextMenu)

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
        renderer.domElement.removeEventListener('contextmenu', onContextMenu)
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
          const disposeMaterial = (material: any) => {
            material?.map?.dispose?.()
            material?.dispose?.()
          }
          if (Array.isArray(object.material)) object.material.forEach(disposeMaterial)
          else disposeMaterial(object.material)
        })
      }
      renderer?.dispose?.()
      if (canvas && container.contains(canvas)) container.removeChild(canvas)
    }
  }, [containerRef, grid, points, routePoints, selectedRouteKey, verticalExaggeration, mapFeatures, visibleLayers])
}

function formatElevation(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-'
  return `${value.toFixed(1)} m`
}

function formatDistance(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(2)} km`
  return `${value.toFixed(0)} m`
}

function routePointColor(index: number, total: number) {
  if (index === 0) return '#0284c7'
  if (index === total - 1) return '#16a34a'
  return '#f59e0b'
}

function routePointDistances(routePoints: RoutePoint[]) {
  let distance = 0
  return routePoints.map((point, index) => {
    const marker = { point, index, distance }
    if (index < routePoints.length - 1) {
      distance += haversineMeters(point, routePoints[index + 1])
    }
    return marker
  })
}

function elevationAtDistance(profile: ProfilePoint[], distance: number) {
  const points = profile.filter((point) => point.elevation !== null)
  if (!points.length) return null
  if (distance <= points[0].distance) return points[0].elevation

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    if (distance > current.distance) continue

    const segmentDistance = current.distance - previous.distance
    if (segmentDistance <= 0) return current.elevation
    const t = clamp((distance - previous.distance) / segmentDistance, 0, 1)
    return (previous.elevation ?? 0) + ((current.elevation ?? 0) - (previous.elevation ?? 0)) * t
  }

  return points.at(-1)?.elevation ?? null
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

function ElevationProfileChart({
  profile,
  routePoints,
  selectedRouteKey,
  onSelectRoutePoint,
}: {
  profile: ProfilePoint[]
  routePoints: RoutePoint[]
  selectedRouteKey: string | null
  onSelectRoutePoint: (routeKey: string) => void
}) {
  const stats = profileStats(profile)
  if (!stats) {
    return (
      <div className="flex h-72 items-center justify-center rounded border border-dashed bg-gray-50 text-sm text-gray-500">
        断面データなし
      </div>
    )
  }

  const width = 1040
  const height = 340
  const padLeft = 58
  const padRight = 28
  const padTop = 58
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
  const routeMarkers = routePointDistances(routePoints)
    .filter((marker) => marker.distance >= 0 && marker.distance <= totalDistance)
    .map((marker) => {
      const elevation = elevationAtDistance(profile, marker.distance)
      const x = padLeft + (marker.distance / totalDistance) * graphWidth
      const y =
        elevation === null ? null : padTop + ((stats.max - elevation) / elevationRange) * graphHeight
      return { ...marker, elevation, x, y }
    })

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
      {routeMarkers.map((marker) => {
        const selected = marker.point.routeKey === selectedRouteKey
        const color = selected ? '#db2777' : routePointColor(marker.index, routeMarkers.length)
        return (
          <g key={marker.point.routeKey}>
            <title>{`${marker.index + 1}. ${marker.point.label} / ${formatDistance(marker.distance)}`}</title>
            <rect
              x={marker.x - 9}
              y={padTop}
              width="18"
              height={graphHeight}
              fill="transparent"
              className="cursor-pointer"
              onClick={() => onSelectRoutePoint(marker.point.routeKey)}
            />
            <line
              x1={marker.x}
              x2={marker.x}
              y1={padTop}
              y2={height - padBottom}
              stroke={color}
              strokeWidth={selected ? '2.75' : '1.5'}
              strokeDasharray="5 5"
              opacity={selected ? '0.95' : '0.75'}
              pointerEvents="none"
            />
          </g>
        )
      })}
      <polyline points={points} fill="none" stroke="#0f766e" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      {routeMarkers.map((marker) => {
        const selected = marker.point.routeKey === selectedRouteKey
        const color = selected ? '#db2777' : routePointColor(marker.index, routeMarkers.length)
        const label = String(marker.index + 1)
        const badgeWidth = Math.max(22, label.length * 7 + 12)
        const badgeY = 18 + (marker.index % 2) * 22
        return (
          <g
            key={`${marker.point.routeKey}-label`}
            className="cursor-pointer"
            role="button"
            tabIndex={0}
            aria-label={`${marker.index + 1}. ${marker.point.label}`}
            onClick={() => onSelectRoutePoint(marker.point.routeKey)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') onSelectRoutePoint(marker.point.routeKey)
            }}
          >
            <title>{`${marker.index + 1}. ${marker.point.label} / ${formatDistance(marker.distance)}`}</title>
            {marker.y !== null && (
              <circle
                cx={marker.x}
                cy={marker.y}
                r={selected ? '8' : '5.5'}
                fill="#ffffff"
                stroke={color}
                strokeWidth={selected ? '4' : '3'}
              />
            )}
            <line
              x1={marker.x}
              x2={marker.x}
              y1={badgeY + 10}
              y2={padTop}
              stroke={color}
              strokeWidth="1"
              opacity="0.45"
            />
            <rect
              x={marker.x - badgeWidth / 2}
              y={badgeY - 10}
              width={badgeWidth}
              height="20"
              rx="10"
              fill={color}
              stroke="#ffffff"
              strokeWidth={selected ? '3' : '2'}
            />
            <text
              x={marker.x}
              y={badgeY + 4}
              fill="#ffffff"
              fontSize="12"
              fontWeight="700"
              textAnchor="middle"
            >
              {label}
            </text>
          </g>
        )
      })}
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
  const { session, user, loading: authLoading } = useAuth()
  const isGithubUser = useMemo(() => isGithubAuthenticatedUser(user), [user])
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
  const [profilesLoading, setProfilesLoading] = useState(true)
  const [profileActionLoading, setProfileActionLoading] = useState(false)
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [profileName, setProfileName] = useState('')
  const [profileMessage, setProfileMessage] = useState<string | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [selectedRouteKey, setSelectedRouteKey] = useState<string | null>(null)
  const [mapFeatures, setMapFeatures] = useState<MapOverlayFeatures>(EMPTY_MAP_FEATURES)
  const [mapFeaturesLoading, setMapFeaturesLoading] = useState(true)
  const [mapFeaturesError, setMapFeaturesError] = useState<string | null>(null)
  const [visibleLayers, setVisibleLayers] = useState<MapLayerVisibility>(INITIAL_LAYER_VISIBILITY)
  const [exportingPng, setExportingPng] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const authHeaders = useCallback((json = false) => {
    if (!session?.access_token) throw new Error('ログインが必要です')
    return {
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${session.access_token}`,
    }
  }, [session])

  useEffect(() => {
    let cancelled = false
    setProfilesLoading(true)
    setProfileError(null)

    fetch(TERRAIN_PROFILES_ENDPOINT)
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response))
        return response.json()
      })
      .then((data) => {
        if (cancelled) return
        const loadedProfiles = normalizeSavedProfiles(data)
        setSavedProfiles(loadedProfiles)
        setProfileName(nextProfileName(loadedProfiles))
      })
      .catch((error) => {
        if (cancelled) return
        const localProfiles = loadSavedProfiles()
        const detail = error instanceof Error && error.message ? `: ${error.message}` : ''
        setSavedProfiles(localProfiles)
        setProfileName(nextProfileName(localProfiles))
        setProfileError(
          localProfiles.length
            ? `共有プロファイルを読み込めませんでした${detail}。端末内の旧プロファイルを表示しています。`
            : `共有プロファイルを読み込めませんでした${detail}。`
        )
      })
      .finally(() => {
        if (!cancelled) setProfilesLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setMapFeaturesLoading(true)
    setMapFeaturesError(null)

    fetch(mapFeaturesEndpoint(TSUCHIURA_BOUNDS))
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response))
        return response.json()
      })
      .then((data) => {
        if (!cancelled) setMapFeatures(normalizeMapFeatures(data))
      })
      .catch(() => {
        if (!cancelled) {
          setMapFeatures(EMPTY_MAP_FEATURES)
          setMapFeaturesError('地図レイヤーを読み込めませんでした。')
        }
      })
      .finally(() => {
        if (!cancelled) setMapFeaturesLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

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

  useEffect(() => {
    if (!selectedRouteKey) return
    if (routePoints.some((point) => point.routeKey === selectedRouteKey)) return
    setSelectedRouteKey(null)
  }, [routePoints, selectedRouteKey])

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

  const saveCurrentRouteProfile = useCallback(async () => {
    if (routePoints.length < 2 || !isGithubUser) return

    const selectedProfile = savedProfiles.find((item) => item.id === selectedProfileId) ?? null
    if (selectedProfile?.createdBy && selectedProfile.createdBy !== user?.id) return

    const name = profileName.trim() || nextProfileName(savedProfiles)
    const pointsToSave = routePoints.map(serializeRoutePoint)
    const nextId = selectedProfile?.id || createProfileId()

    setProfileActionLoading(true)
    setProfileError(null)
    setProfileMessage(null)

    try {
      const response = await fetch(TERRAIN_PROFILES_ENDPOINT, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ id: nextId, name, points: pointsToSave }),
      })
      if (!response.ok) throw new Error(await responseError(response))
      const [savedProfile] = normalizeSavedProfiles([await response.json()])
      if (!savedProfile) throw new Error('保存結果を読み取れませんでした')

      setSavedProfiles((current) => {
        const withoutSaved = current.filter((item) => item.id !== savedProfile.id)
        return [savedProfile, ...withoutSaved]
      })
      setSelectedProfileId(savedProfile.id)
      setProfileName(savedProfile.name)
      setProfileMessage('共有プロファイルに保存しました。')
    } catch (error) {
      console.error(error)
      setProfileError(profileActionErrorMessage(error, '保存'))
    } finally {
      setProfileActionLoading(false)
    }
  }, [authHeaders, isGithubUser, profileName, routePoints, savedProfiles, selectedProfileId, user?.id])

  const deleteSelectedRouteProfile = useCallback(async () => {
    if (!selectedProfileId || !isGithubUser) return
    const selectedProfile = savedProfiles.find((item) => item.id === selectedProfileId) ?? null
    if (!selectedProfile || selectedProfile.createdBy !== user?.id) return
    if (!confirm('この共有プロファイルを削除しますか？')) return

    setProfileActionLoading(true)
    setProfileError(null)
    setProfileMessage(null)

    try {
      const response = await fetch(terrainProfileEndpoint(selectedProfileId), {
        method: 'DELETE',
        headers: authHeaders(),
      })
      if (!response.ok) throw new Error(await responseError(response))
      setSavedProfiles((current) => current.filter((item) => item.id !== selectedProfileId))
      setSelectedProfileId('')
      setProfileName(nextProfileName(savedProfiles.filter((item) => item.id !== selectedProfileId)))
      setProfileMessage('共有プロファイルを削除しました。')
    } catch (error) {
      console.error(error)
      setProfileError(profileActionErrorMessage(error, '削除'))
    } finally {
      setProfileActionLoading(false)
    }
  }, [authHeaders, isGithubUser, savedProfiles, selectedProfileId, user?.id])

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
    selectedRouteKey,
    verticalExaggeration,
    mapFeatures,
    visibleLayers,
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
  const canManageSelectedProfile = Boolean(selectedSavedProfile?.createdBy && selectedSavedProfile.createdBy === user?.id)
  const canSaveProfile = isGithubUser && routePoints.length >= 2 && (!selectedSavedProfile || !selectedSavedProfile.createdBy || canManageSelectedProfile)
  const canDeleteProfile = isGithubUser && Boolean(selectedProfileId) && canManageSelectedProfile
  const enabledLayerCount = MAP_LAYER_OPTIONS.filter((option) => visibleLayers[option.key]).length
  const mapFeatureCount = mapFeatures.lines.length + mapFeatures.labels.length
  const toggleMapLayer = useCallback((key: MapLayerKey) => {
    setVisibleLayers((current) => ({ ...current, [key]: !current[key] }))
  }, [])

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
                <span>レイヤー {enabledLayerCount}種</span>
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
                  onSelectRoutePoint={setSelectedRouteKey}
                  onExporterReady={registerMapExporter}
                  mapFeatures={mapFeatures}
                  visibleLayers={visibleLayers}
                  selectedRouteKey={selectedRouteKey}
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
                <ElevationProfileChart
                  profile={profile}
                  routePoints={routePoints}
                  selectedRouteKey={selectedRouteKey}
                  onSelectRoutePoint={setSelectedRouteKey}
                />
              )}
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <IoBookmarkOutline className="text-lg text-teal-700" />
                <h2 className="text-base font-semibold">共有プロファイル</h2>
              </div>
              <span className="text-xs text-gray-500">
                {profilesLoading ? '読込中' : `${savedProfiles.length}件`}
              </span>
            </div>
            <div className="space-y-3">
              <select
                className="w-full rounded border bg-white px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-400"
                value={selectedProfileId}
                disabled={profilesLoading || profileActionLoading}
                onChange={(event) => {
                  const profileId = event.target.value
                  if (profileId) loadSavedRouteProfile(profileId)
                  else startNewSavedProfile()
                  setProfileMessage(null)
                  setProfileError(null)
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
                className="w-full rounded border px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-400"
                placeholder="プロファイル名"
                value={profileName}
                disabled={profileActionLoading}
                onChange={(event) => setProfileName(event.target.value)}
              />
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-1 rounded border bg-teal-700 px-2 py-2 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
                  onClick={saveCurrentRouteProfile}
                  disabled={!canSaveProfile || profileActionLoading || authLoading}
                >
                  <IoSaveOutline />
                  {profileActionLoading ? '処理中' : '保存'}
                </button>
                <button
                  type="button"
                  className="rounded border bg-white px-2 py-2 text-sm font-semibold text-gray-700 transition hover:border-teal-500 hover:text-teal-700 disabled:cursor-not-allowed disabled:text-gray-300"
                  onClick={startNewSavedProfile}
                  disabled={profileActionLoading}
                >
                  新規
                </button>
                <button
                  type="button"
                  className="rounded border bg-white px-2 py-2 text-sm font-semibold text-gray-700 transition hover:border-red-500 hover:text-red-600 disabled:cursor-not-allowed disabled:text-gray-300"
                  onClick={deleteSelectedRouteProfile}
                  disabled={!canDeleteProfile || profileActionLoading || authLoading}
                >
                  削除
                </button>
              </div>
              {!authLoading && !isGithubUser && (
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  保存・削除は GitHub ログイン後に有効になります。
                </div>
              )}
              {selectedSavedProfile && (
                <div className="text-xs text-gray-500">
                  {selectedSavedProfile.points.length}点 / 更新 {new Date(selectedSavedProfile.updatedAt).toLocaleString('ja-JP')}
                  {selectedSavedProfile.createdByLogin ? ` / 作成 ${selectedSavedProfile.createdByLogin}` : ''}
                </div>
              )}
              {isGithubUser && selectedSavedProfile?.createdBy && !canManageSelectedProfile && (
                <div className="rounded border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                  他のユーザーが作成した共有プロファイルです。編集する場合は新規として保存してください。
                </div>
              )}
              {profileMessage && <div className="text-xs text-teal-700">{profileMessage}</div>}
              {profileError && <div className="text-xs text-red-600">{profileError}</div>}
            </div>
          </section>

          <section className="rounded border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <IoMapOutline className="text-lg text-teal-700" />
                <h2 className="text-base font-semibold">表示レイヤー</h2>
              </div>
              <span className="text-xs text-gray-500">{enabledLayerCount}/{MAP_LAYER_OPTIONS.length}</span>
            </div>
            <div className="space-y-2">
              {MAP_LAYER_OPTIONS.map((option) => (
                <label
                  key={option.key}
                  className="flex cursor-pointer items-center gap-3 rounded border bg-white px-3 py-2 text-sm transition hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-teal-700"
                    checked={visibleLayers[option.key]}
                    onChange={() => toggleMapLayer(option.key)}
                  />
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: option.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-gray-800">{option.label}</span>
                    <span className="block text-xs text-gray-500">{option.description}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-3 text-xs text-gray-500">
              {mapFeaturesLoading ? 'OSMレイヤー取得中' : `取得済み ${mapFeatureCount}件`}
              {mapFeaturesError && <span className="ml-2 text-red-600">{mapFeaturesError}</span>}
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
