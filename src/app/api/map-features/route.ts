import { NextRequest, NextResponse } from 'next/server'

type Bounds = {
  north: number
  south: number
  west: number
  east: number
}

type OverpassElement = {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  nodes?: number[]
  geometry?: { lat: number; lon: number }[]
  members?: { type: string; ref: number; role?: string; geometry?: { lat: number; lon: number }[] }[]
  tags?: Record<string, string>
}

type MapLayerKey = 'river' | 'rail' | 'road' | 'boundary' | 'place' | 'station'

const OVERPASS_ENDPOINT = process.env.OVERPASS_API_URL ?? 'https://overpass-api.de/api/interpreter'
const OVERPASS_USER_AGENT = process.env.OVERPASS_USER_AGENT ?? 'yousuimap/0.1 map-features'
const MAX_LABELS = 180
const CACHE_TTL_MS = 1000 * 60 * 60 * 24
const LINE_LIMITS: Record<MapLayerKey, number> = {
  river: 180,
  rail: 120,
  road: 500,
  boundary: 180,
  place: 0,
  station: 0,
}

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

type PrioritizedMapLineFeature = MapLineFeature & {
  priority: number
}

type MapLabelFeature = {
  id: string
  layer: MapLayerKey
  name: string
  lat: number
  lng: number
}

type MapFeaturesResponse = {
  lines: MapLineFeature[]
  labels: MapLabelFeature[]
  source: string
  warning?: string
}

const featureCache = new Map<string, { data: MapFeaturesResponse; expiresAt: number }>()

function parseNumber(value: string | null) {
  if (value === null) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function boundsFromRequest(req: NextRequest): Bounds | null {
  const north = parseNumber(req.nextUrl.searchParams.get('north'))
  const south = parseNumber(req.nextUrl.searchParams.get('south'))
  const west = parseNumber(req.nextUrl.searchParams.get('west'))
  const east = parseNumber(req.nextUrl.searchParams.get('east'))

  if (north === null || south === null || west === null || east === null) return null
  if (north <= south || east <= west) return null
  if (north > 90 || south < -90 || east > 180 || west < -180) return null
  if ((north - south) * (east - west) > 0.4) return null

  return { north, south, west, east }
}

function overpassQuery({ south, west, north, east }: Bounds) {
  const bbox = `${south},${west},${north},${east}`
  return `
[out:json][timeout:18];
relation["boundary"="administrative"]["admin_level"~"7|8"](${bbox})->.boundaryRelations;
way(r.boundaryRelations)->.boundaryWays;
(
  way["waterway"~"river|stream|canal|drain"](${bbox});
  way["railway"~"rail|subway|light_rail|tram|monorail"](${bbox});
  way["highway"~"motorway|trunk|primary|secondary|tertiary"](${bbox});
  way["highway"]["ref"](${bbox});
  way["boundary"="administrative"]["admin_level"~"7|8"](${bbox});
  .boundaryRelations;
  .boundaryWays;
  node["railway"="station"](${bbox});
  node["place"~"city|town|village|suburb|neighbourhood"](${bbox});
);
out body geom(${bbox});`
}

function wayLayer(tags: Record<string, string> | undefined): MapLayerKey | null {
  if (!tags) return null
  if (tags.waterway) return 'river'
  if (tags.railway) return 'rail'
  if (tags.highway) return 'road'
  if (tags.boundary === 'administrative') return 'boundary'
  return null
}

function nodeLayer(tags: Record<string, string> | undefined): MapLayerKey | null {
  if (!tags) return null
  if (tags.railway === 'station') return 'station'
  if (tags.place) return 'place'
  return null
}

function featureName(tags: Record<string, string> | undefined) {
  if (!tags) return ''
  return tags['name:ja'] ?? tags.name ?? tags.ref ?? ''
}

function cacheKey(bounds: Bounds) {
  return [bounds.north, bounds.south, bounds.west, bounds.east].map((value) => value.toFixed(6)).join(':')
}

function pointsFromGeometry(geometry: { lat: number; lon: number }[] | undefined) {
  if (!Array.isArray(geometry)) return []
  return geometry.flatMap((point): MapFeaturePoint[] => {
    if (!point) return []
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return []
    return [{ lat: point.lat, lng: point.lon }]
  })
}

function linePriority(layer: MapLayerKey, tags: Record<string, string> | undefined) {
  if (layer === 'road') {
    const highwayPriority: Record<string, number> = {
      motorway: 60,
      trunk: 55,
      primary: 50,
      secondary: 45,
      tertiary: 35,
    }
    return (tags?.ref ? 20 : 0) + (tags?.highway ? highwayPriority[tags.highway] ?? 0 : 0)
  }
  if (layer === 'rail') return 50
  if (layer === 'boundary') return 45
  if (layer === 'river') return tags?.waterway === 'drain' ? 20 : 35
  return 0
}

function parseOverpassFeatures(elements: OverpassElement[]): MapFeaturesResponse {
  const boundaryWayNames = new Map<number, string>()
  const relationBoundaryLines = elements.flatMap((element): PrioritizedMapLineFeature[] => {
    if (element.type !== 'relation' || wayLayer(element.tags) !== 'boundary') return []
    const name = featureName(element.tags)
    return (element.members ?? []).flatMap((member, memberIndex): PrioritizedMapLineFeature[] => {
      if (member.type !== 'way') return []
      boundaryWayNames.set(member.ref, name)
      const points = pointsFromGeometry(member.geometry)
      if (points.length < 2) return []
      return [{ id: `boundary-${element.id}-${member.ref}-${memberIndex}`, layer: 'boundary', name, points, priority: 45 }]
    })
  })

  const wayLines = elements
    .flatMap((element): PrioritizedMapLineFeature[] => {
      if (element.type !== 'way') return []
      const layer = wayLayer(element.tags) ?? (boundaryWayNames.has(element.id) ? 'boundary' : null)
      if (!layer) return []
      const points = pointsFromGeometry(element.geometry)
      if (points.length < 2) return []
      return [{
        id: `${layer}-${element.id}`,
        layer,
        name: featureName(element.tags) || boundaryWayNames.get(element.id) || '',
        points,
        priority: linePriority(layer, element.tags),
      }]
    })

  const lineCounts = new Map<MapLayerKey, number>()
  const lines = [...wayLines, ...relationBoundaryLines]
    .sort((a, b) => b.priority - a.priority)
    .filter((line) => {
      const count = lineCounts.get(line.layer) ?? 0
      if (count >= LINE_LIMITS[line.layer]) return false
      lineCounts.set(line.layer, count + 1)
      return true
    })
    .map((line) => ({ id: line.id, layer: line.layer, name: line.name, points: line.points }))

  const labels = elements
    .flatMap((element): MapLabelFeature[] => {
      if (element.type !== 'node' || typeof element.lat !== 'number' || typeof element.lon !== 'number') return []
      const layer = nodeLayer(element.tags)
      const name = featureName(element.tags)
      if (!layer || !name) return []
      return [{ id: `${layer}-${element.id}`, layer, name, lat: element.lat, lng: element.lon }]
    })
    .slice(0, MAX_LABELS)

  return { lines, labels, source: 'openstreetmap-overpass' }
}

async function fetchOverpassElements(bounds: Bounds) {
  const response = await fetch(OVERPASS_ENDPOINT, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'User-Agent': OVERPASS_USER_AGENT,
    },
    body: new URLSearchParams({ data: overpassQuery(bounds) }),
  })

  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(`Overpass API failed: ${response.status} ${message.slice(0, 160)}`.trim())
  }

  const payload = await response.json() as { elements?: OverpassElement[] }
  return payload.elements ?? []
}

export async function GET(req: NextRequest) {
  const bounds = boundsFromRequest(req)
  if (!bounds) return NextResponse.json({ error: 'Invalid bounds' }, { status: 400 })
  const key = cacheKey(bounds)
  const cached = featureCache.get(key)

  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.data, {
      headers: { 'cache-control': 'public, max-age=3600, stale-while-revalidate=86400' },
    })
  }

  try {
    const data = parseOverpassFeatures(await fetchOverpassElements(bounds))
    featureCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS })
    return NextResponse.json(data, {
      headers: { 'cache-control': 'public, max-age=3600, stale-while-revalidate=86400' },
    })
  } catch (error) {
    if (cached) {
      return NextResponse.json(
        { ...cached.data, warning: 'Map feature source is unavailable; stale cache returned.' },
        { headers: { 'cache-control': 'public, max-age=300' } }
      )
    }

    console.error(error)
    return NextResponse.json({ error: 'Map feature source is unavailable' }, { status: 502 })
  }
}
