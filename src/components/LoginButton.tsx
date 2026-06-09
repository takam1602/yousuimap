'use client'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/navigation'
import { IoLogoGithub } from 'react-icons/io5'
import { useAuth } from '@/contexts/AuthContext'

export default function LoginButton() {
  const { user } = useAuth()
  const router = useRouter()

  if (user) {
    return (
      <button
        type="button"
        onClick={() =>
          supabase.auth.signOut().then(() => router.refresh())
        }
        className="w-fit rounded bg-red-500 px-3 py-2 text-sm text-white hover:bg-red-600"
      >
        Log out
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() =>
        supabase.auth.signInWithOAuth({
          provider: 'github',
          options: { redirectTo: window.location.origin },
        })
      }
      className="flex w-fit items-center gap-2 rounded bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700"
    >
      <IoLogoGithub className="text-base" />
      GitHub Login
    </button>
  )
}
