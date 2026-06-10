import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin, hasSupabaseServerEnv, requireGithubUser } from '@/lib/serverSupabase'
import { DEFAULT_MAP_SLUG, isWaterwayMapSlug } from '@/lib/waterwayMaps'

function mapSlugFromRequest(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('map') || DEFAULT_MAP_SLUG
  return isWaterwayMapSlug(slug) ? slug : null
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireGithubUser(req)
  if ('error' in auth) return auth.error

  const mapSlug = mapSlugFromRequest(req)
  if (!mapSlug) return NextResponse.json({ error: 'Unknown map' }, { status: 404 })
  if (!hasSupabaseServerEnv()) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 })

  const { id } = await params
  const supabase = createSupabaseAdmin()
  const { data: existing, error: selectError } = await supabase
    .from('terrain_profiles')
    .select('id, created_by')
    .eq('id', id)
    .eq('map_slug', mapSlug)
    .maybeSingle()

  if (selectError) return NextResponse.json({ error: selectError }, { status: 500 })
  if (!existing) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  if (existing.created_by !== auth.user.id) {
    return NextResponse.json({ error: 'Only the creator can delete this profile' }, { status: 403 })
  }

  const { error } = await supabase
    .from('terrain_profiles')
    .delete()
    .eq('id', id)
    .eq('map_slug', mapSlug)

  if (error) return NextResponse.json({ error }, { status: 500 })
  return NextResponse.json({ ok: true })
}
