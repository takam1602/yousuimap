import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  const { filename } = await req.json()   // 例: "abc.jpg"

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Storage バケット photos に 5 分有効のアップロード URL
  const { data, error } = await supabase.storage
    .from('photos')
    .createSignedUploadUrl(filename, 300)

  if (error) return NextResponse.json({ error }, { status: 500 })
  return NextResponse.json(data)          // { url, path, token }
}
