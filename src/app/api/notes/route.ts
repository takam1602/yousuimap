import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin, hasSupabaseServerEnv, requireEditor } from '@/lib/serverSupabase'
import { DEFAULT_MAP_SLUG, isWaterwayMapSlug } from '@/lib/waterwayMaps'

function mapSlugFromRequest(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('map') || DEFAULT_MAP_SLUG
  return isWaterwayMapSlug(slug) ? slug : null
}

export async function GET(req: NextRequest) {
  const mapSlug = mapSlugFromRequest(req)
  if (!mapSlug) return NextResponse.json({ error: 'Unknown map' }, { status: 404 })

  if (!hasSupabaseServerEnv()) {
    return NextResponse.json([])
  }

  const supabase = createSupabaseAdmin()
  const { data, error } = await supabase
    .from('notes')
    .select('id, lat, lng, text, map_slug, images(id,url)')
    .eq('map_slug', mapSlug)
    .order('inserted_at', { ascending: true })
  if (error){
      console.error('NOTES INSERT ERR',error)
      return NextResponse.json({ error }, { status: 500 })
  }
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const auth = await requireEditor(req)
  if ('error' in auth) return auth.error

  const mapSlug = mapSlugFromRequest(req)
  if (!mapSlug) return NextResponse.json({ error: 'Unknown map' }, { status: 404 })

  const body = await req.json()
  const payload = Array.isArray(body)
    ? body.map(({ id, lat, lng, text }) => ({ id, lat, lng, text: text ?? '', map_slug: mapSlug }))
    : { id: body.id, lat: body.lat, lng: body.lng, text: body.text ?? '', map_slug: mapSlug }
  const supabase = createSupabaseAdmin()
  const { error } = await supabase.from('notes').upsert(payload,{onConflict: 'id'})
  if (error) return NextResponse.json({ error }, { status: 500 })
  return NextResponse.json({ ok: true })
}
