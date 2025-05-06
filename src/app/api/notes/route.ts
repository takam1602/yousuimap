import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  // const { data, error } = await supabase.from('notes').select('*').order('inserted_at')
  const { data, error } = await supabase.from('notes').select('id, lat, lng, text, images(id,url)') //.single()
  if (error){
      console.error('NOTES INSERT ERR',error)
      return NextResponse.json({ error }, { status: 500 })
  }
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json() 
  // const { error } = await supabase.from('notes').insert(body)
  const { error } = await supabase.from('notes').upsert(body,{onConflict: 'id'})
  if (error) return NextResponse.json({ error }, { status: 500 })
  return NextResponse.json({ ok: true })
}
