'use client'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useState, useEffect } from 'react'
import {
  MapContainer, TileLayer, Marker, Popup, useMapEvents,
} from 'react-leaflet'
/* import { v4 as uuid } from 'uuid'*/

L.Icon.Default.mergeOptions({
  iconUrl: '/leaflet/marker-icon.png',
  iconRetinaUrl: '/leaflet/marker-icon-2x.png',
  shadowUrl: '/leaflet/marker-shadow.png',
})

export interface Note {
  id: string
  lat: number
  lng: number
  text?: string
  img_url?: string      
}

export default function Map() {
  const [notes, setNotes] = useState<Note[]>([])

  /* 初期ロード：DB から既存ノート取得 */
  useEffect(() => {
    fetch('/api/notes').then(r => r.json()).then(setNotes)
  }, [])

  /* クリックで新規ノート */
  function ClickHandler() {
    useMapEvents({
      click(e) {
        setNotes(n => [...n, {
          id: crypto.randomUUID(),
          lat: e.latlng.lat,
          lng: e.latlng.lng,
        }])
      },
    })
    return null
  }

  async function handleSave(note: Note, file?: File) {
    let img_url = note.img_url

    if (file) {
      const res1 = await fetch('/api/upload-url', {
        method: 'POST',
        body: JSON.stringify({ filename: `${note.id}-${file.name}` }),
      })
      const json = await res1.json()
      console.log('[upload-url response]', json)    
      const { signedUrl, path } = json
      if (!signedUrl) 
          {
              console.error('upload-url failed',await res1.text()); return 
          }

      await fetch(signedUrl, { method: 'PUT', body: file })

      img_url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}` +
                `/storage/v1/object/public/photos/${path}`
    }

    const payload = { ...note, img_url }
    const res2 = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res2.ok) {
      console.error('POST /api/notes failed', await res2.text())
      return
    }

    setNotes(arr => arr.map(x => x.id === note.id ? payload : x))
  }

  return (
    <MapContainer center={[36.07, 140.11]} zoom={15} className="h-screen">
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <ClickHandler />

      {notes.map(n => (
        <Marker key={n.id} position={[n.lat, n.lng]}>
          <Popup minWidth={220}>
            {n.img_url && <img src={n.img_url} alt="" className="mb-2" />}
            <textarea
              defaultValue={n.text}
              placeholder="説明を入力"
              className="w-full border p-1 text-sm mb-2"
              onBlur={e => (n.text = e.target.value)}
            />
            <input
              type="file"
              accept="image/*"
              className="mb-2"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) handleSave(n, file)
              }}
            />
            <button
              className="px-3 py-1 bg-blue-600 text-white text-sm rounded"
              onClick={() => handleSave(n)}
            >
              保存
            </button>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}
