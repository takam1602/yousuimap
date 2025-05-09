'use client'
import { useAuth } from '@/contexts/AuthContext'
import LoginButton from '@/components/LoginButton'

export default function HeaderBar() {
  const { user, loading } = useAuth()
  const loggedIn = !!user

  return (
    <header
      className={`py-4 shadow-md relative transition-colors duration-300
        ${loggedIn ? 'bg-indigo-600 text-yellow-100' : 'bg-gray-900 text-white'}`}
    >
      <div className="max-w-5xl mx-auto px-4">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-wide">
          {loggedIn
            ? '勘翁マップ ~巡って理解・土浦用水~ (エディタモード)'
            : '勘翁マップ ~巡って理解・土浦用水~'}
        </h1>
        <p className="text-sm sm:text-base opacity-80">by&nbsp;takam1602</p>
      </div>

      {!loading && (
        <div className="absolute top-4 right-4">
          <LoginButton />
        </div>
      )}
    </header>
  )
}
