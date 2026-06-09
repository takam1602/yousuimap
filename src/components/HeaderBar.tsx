'use client'
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
            <h1 className="text-xl font-bold tracking-wide sm:text-3xl">
              勘翁マップ ~巡って理解・土浦用水~
            </h1>
            {loggedIn && (
              <span className="rounded bg-yellow-100 px-2 py-1 text-xs font-semibold text-indigo-700">
                エディタ
              </span>
            )}
          </div>
          <p className="text-sm opacity-80">by&nbsp;takam1602</p>
        </div>

        {!loading && <LoginButton />}
      </div>
    </header>
  )
}
