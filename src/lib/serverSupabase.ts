import { NextRequest, NextResponse } from 'next/server'
import { createClient, type User } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export function createSupabaseAdmin() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase server environment variables are missing')
  }

  return createClient(supabaseUrl, serviceRoleKey)
}

export function hasSupabaseServerEnv() {
  return Boolean(supabaseUrl && serviceRoleKey)
}

function userHasGithubProvider(user: User) {
  const appMetadata = user.app_metadata as Record<string, unknown>
  const provider = appMetadata.provider
  const providers = appMetadata.providers

  return (
    provider === 'github' ||
    (Array.isArray(providers) && providers.some((item) => item === 'github'))
  )
}

async function getAuthenticatedUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]

  if (!token) {
    return {
      error: NextResponse.json({ error: 'Login is required' }, { status: 401 }),
    }
  }

  if (!supabaseUrl || !anonKey) {
    return {
      error: NextResponse.json(
        { error: 'Supabase auth environment variables are missing' },
        { status: 500 },
      ),
    }
  }

  const supabase = createClient(supabaseUrl, anonKey)
  const { data, error } = await supabase.auth.getUser(token)

  if (error || !data.user) {
    return {
      error: NextResponse.json({ error: 'Invalid session' }, { status: 401 }),
    }
  }

  return { user: data.user }
}

export async function requireGithubUser(req: NextRequest) {
  const auth = await getAuthenticatedUser(req)
  if ('error' in auth) return auth

  if (!userHasGithubProvider(auth.user)) {
    return {
      error: NextResponse.json({ error: 'GitHub login is required' }, { status: 403 }),
    }
  }

  return auth
}

export async function requireEditor(req: NextRequest) {
  const auth = await getAuthenticatedUser(req)
  if ('error' in auth) return auth

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
    !allowedEmails.includes((auth.user.email ?? '').toLowerCase())
  ) {
    return {
      error: NextResponse.json({ error: 'Editor permission is required' }, { status: 403 }),
    }
  }

  return auth
}
