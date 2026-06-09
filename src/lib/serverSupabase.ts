import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export function createSupabaseAdmin() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase server environment variables are missing')
  }

  return createClient(supabaseUrl, serviceRoleKey)
}

export async function requireEditor(req: NextRequest) {
  if (!supabaseUrl || !anonKey) {
    return {
      error: NextResponse.json(
        { error: 'Supabase auth environment variables are missing' },
        { status: 500 },
      ),
    }
  }

  const authHeader = req.headers.get('authorization')
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]

  if (!token) {
    return {
      error: NextResponse.json({ error: 'Login is required' }, { status: 401 }),
    }
  }

  const supabase = createClient(supabaseUrl, anonKey)
  const { data, error } = await supabase.auth.getUser(token)

  if (error || !data.user) {
    return {
      error: NextResponse.json({ error: 'Invalid session' }, { status: 401 }),
    }
  }

  const allowedEmails = (
    process.env.SUPABASE_EDITOR_EMAILS ??
    process.env.EDITOR_EMAILS ??
    ''
  )
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)

  if (
    allowedEmails.length > 0 &&
    !allowedEmails.includes((data.user.email ?? '').toLowerCase())
  ) {
    return {
      error: NextResponse.json({ error: 'Editor permission is required' }, { status: 403 }),
    }
  }

  return { user: data.user }
}
