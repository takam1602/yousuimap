import './globals.css'
// import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import HeaderBar from '@/components/HeaderBar'
import { AuthProvider } from '@/contexts/AuthContext'

export const metadata = {
  title: '勘翁マップアプリ',
  description: 'map app by takam1602',
  verification:{
      google:"3ITIM0eNhLXG7UpZW7hjxVztQhiSe9Ajga0j3aIicIw",
    },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen flex flex-col">
        {/* ここで全コンポーネントを AuthProvider でラップ */}
        <AuthProvider>
          <HeaderBar />
          <main className="flex-1">{children}</main>
        </AuthProvider>
      </body>
    </html>
  )
}
