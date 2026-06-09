'use client'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import LoginButton from '@/components/LoginButton'

export default function HeaderBar() {
  const { user, loading } = useAuth()
  const loggedIn = !!user

  return (
    <header
      className={`shadow-md transition-colors duration-300
        ${loggedIn ? 'bg-indigo-600 text-yellow-100' : 'bg-gray-900 text-white'}`}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/" className="text-xl font-bold tracking-wide hover:opacity-80 sm:text-3xl">
              勘翁マップ
            </Link>
            {loggedIn && (
              <span className="rounded bg-yellow-100 px-2 py-1 text-xs font-semibold text-indigo-700">
                エディタ
              </span>
            )}
          </div>
          <p className="text-sm opacity-80">by&nbsp;takam1602</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/"
            className="rounded bg-white/10 px-3 py-2 text-sm hover:bg-white/20"
          >
            マップ一覧
          </Link>
          {!loading && <LoginButton />}
        </div>
      </div>
    </header>
  )
}
