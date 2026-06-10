import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin, hasSupabaseServerEnv, requireGithubUser } from '@/lib/serverSupabase'
import { DEFAULT_MAP_SLUG, isWaterwayMapSlug } from '@/lib/waterwayMaps'

type SavedRoutePoint = {
  id: string
  lat: number
  lng: number
  label: string
  source: 'note' | 'custom'
}

function mapSlugFromRequest(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('map') || DEFAULT_MAP_SLUG
  return isWaterwayMapSlug(slug) ? slug : null
}

function userLogin(user: { user_metadata: Record<string, unknown>; email?: string }) {
  const metadata = user.user_metadata ?? {}
  const login = metadata.user_name ?? metadata.preferred_username ?? metadata.name
  return typeof login === 'string' && login.trim() ? login.trim() : user.email ?? null
}

function cleanProfileId(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 128) return null
  if (!/^[a-zA-Z0-9:_-]+$/.test(trimmed)) return null
  return trimmed
}

function cleanPoint(value: unknown): SavedRoutePoint | null {
  if (!value || typeof value !== 'object') return null
  const point = value as Record<string, unknown>
  const id = typeof point.id === 'string' ? point.id.slice(0, 160) : ''
  const label = typeof point.label === 'string' ? point.label.slice(0, 240) : ''
  const lat = Number(point.lat)
  const lng = Number(point.lng)
  const source = point.source === 'custom' ? 'custom' : 'note'

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null

  return { id, lat, lng, label, source }
}

function cleanPoints(value: unknown) {
  if (!Array.isArray(value)) return null
  const points = value.map(cleanPoint).filter((point): point is SavedRoutePoint => Boolean(point))
  if (points.length < 2 || points.length > 200) return null
  return points
}

function profileFromRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    points: row.points,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    createdByLogin: row.created_by_login,
  }
}

export async function GET(req: NextRequest) {
  const mapSlug = mapSlugFromRequest(req)
  if (!mapSlug) return NextResponse.json({ error: 'Unknown map' }, { status: 404 })

  if (!hasSupabaseServerEnv()) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 })

  const supabase = createSupabaseAdmin()
  const { data, error } = await supabase
    .from('terrain_profiles')
    .select('id, name, points, created_at, updated_at, created_by, created_by_login')
    .eq('map_slug', mapSlug)
    .order('updated_at', { ascending: false })

  if (error) return NextResponse.json({ error }, { status: 500 })
  return NextResponse.json((data ?? []).map(profileFromRow))
}

export async function POST(req: NextRequest) {
  const auth = await requireGithubUser(req)
  if ('error' in auth) return auth.error

  const mapSlug = mapSlugFromRequest(req)
  if (!mapSlug) return NextResponse.json({ error: 'Unknown map' }, { status: 404 })
  if (!hasSupabaseServerEnv()) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 })

  const body = await req.json()
  const id = cleanProfileId(body.id)
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : 'プロファイル'
  const points = cleanPoints(body.points)

  if (!id) return NextResponse.json({ error: 'Invalid profile id' }, { status: 400 })
  if (!points) return NextResponse.json({ error: 'Invalid profile points' }, { status: 400 })

  const supabase = createSupabaseAdmin()
  const { data: existing, error: selectError } = await supabase
    .from('terrain_profiles')
    .select('id, created_by, created_at')
    .eq('id', id)
    .eq('map_slug', mapSlug)
    .maybeSingle()

  if (selectError) return NextResponse.json({ error: selectError }, { status: 500 })
  if (existing && existing.created_by !== auth.user.id) {
    return NextResponse.json({ error: 'Only the creator can update this profile' }, { status: 403 })
  }

  const now = new Date().toISOString()
  const payload = {
    id,
    map_slug: mapSlug,
    name,
    points,
    created_by: existing?.created_by ?? auth.user.id,
    created_by_login: userLogin(auth.user),
    created_at: existing?.created_at ?? now,
    updated_at: now,
  }

  const { data, error } = await supabase
    .from('terrain_profiles')
    .upsert(payload, { onConflict: 'map_slug,id' })
    .select('id, name, points, created_at, updated_at, created_by, created_by_login')
    .single()

  if (error) return NextResponse.json({ error }, { status: 500 })
  return NextResponse.json(profileFromRow(data))
}
