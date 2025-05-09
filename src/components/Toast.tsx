'use client'
import { useEffect, useState } from 'react'

export default function Toast({
  message,
  onDone,
}: {
  message: string
  onDone: () => void
}) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!message) return
    setShow(true)
    const t = setTimeout(() => {
      setShow(false)
      onDone()
    }, 2500)
    return () => clearTimeout(t)
  }, [message, onDone])

  if (!show) return null
  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2
                    bg-black text-white px-4 py-2 rounded shadow-md
                    z-[1100] animate-fade">
      {message}
    </div>
  )
}
