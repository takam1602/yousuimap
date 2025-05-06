import './globals.css'            
import type { ReactNode } from 'react'
import LoginButton from '@/components/LoginButton'

export const metadata = {
  title: '勘翁マップアプリ',        
  description: 'map app by takam1602',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen flex flex-col">
        <header className="bg-gray-900 text-white py-4 shadow-md">
          <div className="max-w-5xl mx-auto px-4">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-wide">
            勘翁マップ ~巡って理解・土浦用水~
            </h1>
            <p className="text-sm sm:text-base opacity-80">
              by takam1602
            </p>
          </div>

          <div className="absolute top-4 right-4">
            <LoginButton />
          </div>
        </header>

        {/* ── メイン（地図ページが入る）────────── */}
        <main className="flex-1">{children}</main>

        {/* ── フッター（任意）────────────────── */}
        {/* <footer className="bg-gray-100 text-center py-2 text-sm">
          2025 takam1602
        </footer> */}
      </body>
    </html>
  )
}
