'use client'
import { supabase } from '@/lib/supabaseClient'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginButton() {
  const [user, setUser] = useState<null | { id: string }>(null)
  const router = useRouter()

  /* --- ① すべてのセッション変化イベントを捕捉 ----------------------- */
  useEffect(() => {
    /* initialSession はページロード後必ず 1 回飛んで来る */
    const { data: sub } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setUser(session?.user ?? null) // signIn / signOut / initialSession
        router.refresh()               // <== Server Components も即更新
      },
    )
    return () => sub.subscription.unsubscribe()
  }, [router])

  /* --- UI -------------------------------------------------------------- */
  if (user) {
    return (
      <button
        onClick={() =>
          supabase.auth.signOut().then(() => router.refresh())
        }
        className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white rounded"
      >
        Log&nbsp;out
      </button>
    )
  }

  return (
    <button
      onClick={() =>
        supabase.auth.signInWithOAuth({
          provider: 'github',
          options: { redirectTo: window.location.origin },
        })
      }
      className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded flex items-center gap-1"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"
           className="w-4 h-4 fill-current">
        <path d="M8 .198a8 8 0 0 0-2.557 15.6c..."/>
      </svg>
      GitHub&nbsp;Login
    </button>
  )
}
