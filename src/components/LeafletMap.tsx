'use client'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

import { useState, useEffect, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet'
import { v4 as uuidv4 } from 'uuid'
import markerIcon from '/leaflet/marker-icon.png'
import markerIcon2x from '/leaflet/marker-icon-2x.png'
import markerShadow from '/leaflet/marker-shadow.png'

L.Icon.Default.mergeOptions({
  iconUrl: markerIcon.src ?? markerIcon,          // Next 15 は拡張子付き import に .src が付く
  iconRetinaUrl: markerIcon2x.src ?? markerIcon2x,
  shadowUrl: markerShadow.src ?? markerShadow,
})

interface Note {
  id: string
  lat: number
  lng: number
  text?: string
  img_url?: string
}

export default function LeafletMap() {
  const [notes, setNotes] = useState<Note[]>([])
  const fileInput = useRef<HTMLInputElement | null>(null)

  /* 初期ロード */
  useEffect(() => {
    fetch('/api/notes')
      .then(r => r.json())
      .then(setNotes)
  }, [])

  /* クリックで新規ノート */
  function ClickHandler() {
    useMapEvents({
      click(e) {
        setNotes(n => [
          ...n,
          { id: uuidv4(), lat: e.latlng.lat, lng: e.latlng.lng }
        ])
      }
    })
    return null
  }

  async function handleSave(n: Note, idx: number, file?: File) {
    let img_url = n.img_url

    /* 1. 画像アップロード */
    if (file) {
      // 署名付き URL 取得
      const res1 = await fetch('/api/upload-url', {
        method: 'POST',
        body: JSON.stringify({ filename: `${n.id}-${file.name}` })
      })
      const { url, path } = await res1.json()

      // PUT で直接アップロード
      await fetch(url, { method: 'PUT', body: file })

      img_url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/photos/${path}`
    }

    /* 2. メタデータ保存 */
    const payload = { ...n, img_url }
    await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    // ローカル状態を確定
    setNotes(arr => {
      const cp = [...arr]
      cp[idx] = payload
      return cp
    })
  }

  return (
    <MapContainer center={[35, 135]} zoom={5} style={{ height: '100vh', width: '100%' }}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <ClickHandler />
      {notes.map((n, i) => (
        <Marker key={n.id} position={[n.lat, n.lng]}>
          <Popup minWidth={200}>
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
              ref={fileInput}
              className="mb-2"
            />
            <button
              className="px-3 py-1 bg-blue-600 text-white text-sm rounded"
              onClick={() => handleSave(n, i, fileInput.current?.files?.[0])}
            >
              保存
            </button>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}
