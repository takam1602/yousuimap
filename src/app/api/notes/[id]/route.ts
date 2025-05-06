import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function DELETE(_: NextRequest, context: { params: { id: string } }) {
    const {id} = await context.params 
    const { data, error: selErr } = await supabase
    .from('notes')
    .select('img_url')
    .eq('id', id)
    .single()

  if (selErr) return NextResponse.json({ selErr }, { status: 500 })

  if (data?.img_url) {
    const path = data.img_url.split('/photos/')[1]
    await supabase.storage.from('photos').remove([path])
  }

  // 3. レコードを削除
  const { error: delErr } = await supabase
    .from('notes')
    .delete()
    .eq('id', id)

  if (delErr) return NextResponse.json({ delErr }, { status: 500 })
  return NextResponse.json({ ok: true })
}
