'use client'
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

import { supabase } from '@/lib/supabaseClient'
import type { Session, User } from '@supabase/supabase-js'

interface AuthCtx {
  session: Session | null
  user: User | null
  loading: boolean
}
const Context = createContext<AuthCtx>({
  session: null,
  user: null,
  loading: true,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // 初期セッション取得
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null)
      setLoading(false)
    })
    // ログイン・ログアウト監視
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) =>
      setSession(s ?? null),
    )
    return () => sub.subscription.unsubscribe()
  }, [])

  const value = { session, user: session?.user ?? null, loading }
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export const useAuth = () => useContext(Context)
