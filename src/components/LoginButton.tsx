'use client'

import { supabase } from '@/lib/supabaseClient'
import { useEffect, useState } from 'react'

export default function LoginButton() {
  const [user, setUser] = useState<null | { email?: string }>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
    })
  }, [])

  if (user)
    return (
      <button
        onClick={() => supabase.auth.signOut().then(() => location.reload())}
        className="text-sm hover:underline"
      >
        Log&nbsp;out
      </button>
    )

  return (
    <button
      onClick={() => supabase.auth.signInWithOAuth({ provider: 'github' })}
      className="text-sm hover:underline"
    >
      GitHub&nbsp;Login
    </button>
  )
}
