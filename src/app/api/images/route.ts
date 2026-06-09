// src/app/api/images/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin, requireEditor } from '@/lib/serverSupabase'
export async function POST(req: NextRequest) {
  const auth = await requireEditor(req)
  if ('error' in auth) return auth.error

  const body = await req.json()   
  const supabase = createSupabaseAdmin()
  const { data,error } = await supabase
  .from('images')
  .insert(body)
  .select('id')
  .maybeSingle()
 
  if (error) return NextResponse.json({ error }, { status: 500 })
  return NextResponse.json({ id: data?.id }) //ok: true })
}
