import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  const { filename } = await req.json() 

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await supabase.storage
    .from('photos')
    .createSignedUploadUrl(filename) // , { expiresIn: 300 })

  if (error) return NextResponse.json({ error }, { status: 500 })
  return NextResponse.json(data)          // { url, path, token }
}
