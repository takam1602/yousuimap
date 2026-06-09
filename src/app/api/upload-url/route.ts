import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin, requireEditor } from '@/lib/serverSupabase'

export async function POST(req: NextRequest) {
  const auth = await requireEditor(req)
  if ('error' in auth) return auth.error

  const { filename } = await req.json() 

  const supabase = createSupabaseAdmin()

  const { data, error } = await supabase.storage
    .from('photos')
    .createSignedUploadUrl(filename) // , { expiresIn: 300 })

  if (error) return NextResponse.json({ error }, { status: 500 })
  return NextResponse.json(data)          // { url, path, token }
}
