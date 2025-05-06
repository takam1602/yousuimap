// src/app/api/images/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  // 画像URL取得 → Storage ファイルも削除
  const { data, error: selErr } = await supabase
    .from('images')
    .select('url')
    .eq('id', id)
    .single()
  if (selErr) return NextResponse.json({ selErr }, { status: 500 })

  const path = data.url.split('/photos/')[1]
  await supabase.storage.from('photos').remove([path])

  const { error: delErr } = await supabase.from('images').delete().eq('id', id)
  if (delErr) return NextResponse.json({ delErr }, { status: 500 })
  return NextResponse.json({ ok: true })
}
