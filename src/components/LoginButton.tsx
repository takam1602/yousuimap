'use client'

import { supabase } from '@/lib/supabaseClient'
import { useEffect, useState } from 'react'

export default function LoginButton() {
  const [user, setUser] = useState<null | { email?: string }>(null)

  /* セッション確認 */
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)

      /* ヘッダー配色切替用クラス */
      if (data.session?.user) {
        document.body.classList.add('logged-in')
      } else {
        document.body.classList.remove('logged-in')
      }
    })
  }, [])

  /* ログアウトボタン */
  if (user)
    return (
      <button
        onClick={() =>
          supabase.auth.signOut().then(() => location.reload())
        }
        className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white rounded"
      >
        Log&nbsp;out
      </button>
    )

  /* GitHub ログインボタン */
  return (
    <button
      onClick={() =>
        supabase.auth.signInWithOAuth({ provider: 'github' })
      }
      className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded flex items-center gap-1"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 16 16"
        fill="currentColor"
        className="w-4 h-4"
      >
        <path d="M8 .198a8 8 0 0 0-2.557 15.6c.4.074.547-.174.547-.386 0-.19-.007-.693-.01-1.36-2.226.483-2.695-1.073-2.695-1.073-.364-.924-.89-1.17-.89-1.17-.727-.497.055-.487.055-.487.804.056 1.228.827 1.228.827.715 1.226 1.873.872 2.329.667.072-.518.28-.873.508-1.074-1.776-.201-3.644-.888-3.644-3.953 0-.873.312-1.588.823-2.147-.083-.202-.357-1.015.077-2.116 0 0 .67-.215 2.2.82a7.66 7.66 0 0 1 2.003-.27 7.66 7.66 0 0 1 2.003.27c1.53-1.035 2.199-.82 2.199-.82.435 1.101.161 1.914.078 2.116.513.559.822 1.274.822 2.147 0 3.074-1.87 3.75-3.65 3.949.288.249.543.739.543 1.49 0 1.075-.01 1.942-.01 2.205 0 .214.145.463.55.384A8 8 0 0 0 8 .198Z" />
      </svg>
      GitHub&nbsp;Login
    </button>
  )
}
