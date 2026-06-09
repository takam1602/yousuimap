// src/app/api/images/[id]/route.ts
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
  // 画像URL取得 → Storage ファイルも削除
  const { data, error: selErr } = await supabase
    .from('images')
    .select('url')
    .eq('id', id)
    .single()
  if (selErr) return NextResponse.json({ selErr }, { status: 500 })

  const path = data.url.split('/photos/')[1]
  if (path) await supabase.storage.from('photos').remove([path])

  const { error: delErr } = await supabase.from('images').delete().eq('id', id)
  if (delErr) return NextResponse.json({ delErr }, { status: 500 })
  return NextResponse.json({ ok: true })
}
