import './globals.css'            
import type { ReactNode } from 'react'
import HeaderBar   from '@/components/HeaderBar'

export const metadata = {
  title: '勘翁マップアプリ',        
  description: 'map app by takam1602',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen flex flex-col">
      <HeaderBar />
      <main className="flex-1">{children}</main>
      </body>
    </html>
  )
}
