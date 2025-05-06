// src/app/api/images/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  const body = await req.json()   
  const { data,error } = await supabase
  .from('images')
  .insert(body)
  .select('id')
  .maybeSingle()
 
  if (error) return NextResponse.json({ error }, { status: 500 })
  return NextResponse.json({ id: data?.id }) //ok: true })
}
