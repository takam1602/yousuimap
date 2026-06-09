import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin, requireEditor } from '@/lib/serverSupabase'

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireEditor(req)
  if ('error' in auth) return auth.error

  const { id } = await params
  const supabase = createSupabaseAdmin()

  const { data: images, error: selErr } = await supabase
    .from('images')
    .select('url')
    .eq('note_id', id)

  if (selErr)
    return NextResponse.json({ selErr }, { status: 500 })

  const paths = (images ?? [])
    .map((img) => img.url.split('/photos/')[1])
    .filter(Boolean)

  if (paths.length > 0) await supabase.storage.from('photos').remove(paths)

  const { error: delErr } = await supabase
    .from('notes')
    .delete()
    .eq('id', id)

  if (delErr)
    return NextResponse.json({ delErr }, { status: 500 })

  return NextResponse.json({ ok: true })
}
