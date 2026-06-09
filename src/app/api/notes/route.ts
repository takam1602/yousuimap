import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin, requireEditor } from '@/lib/serverSupabase'

export async function GET() {
  const supabase = createSupabaseAdmin()
  const { data, error } = await supabase
    .from('notes')
    .select('id, lat, lng, text, images(id,url)')
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

  const body = await req.json() 
  const supabase = createSupabaseAdmin()
  const { error } = await supabase.from('notes').upsert(body,{onConflict: 'id'})
  if (error) return NextResponse.json({ error }, { status: 500 })
  return NextResponse.json({ ok: true })
}
