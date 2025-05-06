'use client'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useState, useEffect, useRef } from 'react'
import {
  MapContainer, TileLayer, Marker, Popup, useMapEvents,
} from 'react-leaflet'
import { IoTrashOutline, IoClose } from 'react-icons/io5'

L.Icon.Default.mergeOptions({
  iconUrl: '/leaflet/marker-icon.png',
  iconRetinaUrl: '/leaflet/marker-icon-2x.png',
  shadowUrl: '/leaflet/marker-shadow.png',
})

interface Note {
  id: string
  lat: number
  lng: number
  text?: string
  img_url?: string
}

export default function Map() {
  const [notes, setNotes] = useState<Note[]>([])
  const [preview, setPreview] = useState<string | null>(null)  // モーダル用

  /* 初回ロード */
  useEffect(() => {
    fetch('/api/notes').then(r => r.json()).then(setNotes)
  }, [])

  /* クリックで新規ノート & ポップアップ自動オープン */
  function ClickHandler() {
    useMapEvents({
      click(e) {
        const newNote = {
          id: crypto.randomUUID(),
          lat: e.latlng.lat,
          lng: e.latlng.lng,
        }
        setNotes(n => [...n, newNote])
      },
    })
    return null
  }

  /* --- 画像＋ノート保存 (upsert) --- */
  async function saveNote(note: Note, file?: File) {
    let img_url = note.img_url
    if (file) {
      const res1 = await fetch('/api/upload-url', {
        method: 'POST',
        body: JSON.stringify({ filename: `${note.id}-${file.name}` }),
      })
      const { signedUrl, path } = await res1.json()
      if (!signedUrl) return alert('アップロード URL 取得失敗')

      await fetch(signedUrl, { method: 'PUT', body: file })
      img_url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/photos/${path}`
    }

    const payload = { ...note, img_url }
    await fetch('/api/notes', {
      method: 'POST',               // upsert を使っている
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setNotes(arr => arr.map(x => x.id === note.id ? payload : x))
  }

  /* --- 削除 --- */
  async function deleteNote(id: string) {
    if (!confirm('本当に削除しますか？')) return
    await fetch(`/api/notes/${id}`, { method: 'DELETE' })
    setNotes(arr => arr.filter(n => n.id !== id))
  }

  /* --- ファイル入力をボタン化 --- */
  const FileButton = ({ onSelect }: { onSelect: (f: File) => void }) => {
    const inputRef = useRef<HTMLInputElement>(null)
    return (
      <>
        <button
          className="px-3 py-1 bg-gray-200 rounded w-full text-sm"
          onClick={() => inputRef.current?.click()}
        >
          画像を選択
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) onSelect(f)
          }}
        />
      </>
    )
  }

  return (
    <>
      {/* 画像プレビュー モーダル */}
      {preview && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[1000]">
          <img src={preview} alt="" className="max-h-[80vh] max-w-[90vw]" />
          <button
            className="absolute top-4 right-4 text-white text-3xl"
            onClick={() => setPreview(null)}
          >
            <IoClose />
          </button>
        </div>
      )}

      <MapContainer center={[36.07, 140.11]} zoom={15} className="h-screen">
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <ClickHandler />

        {notes.map(n => (
          <Marker key={n.id} position={[n.lat, n.lng]}>
            <Popup minWidth={240} autoClose={false} closeOnClick={false}>
              {/* 画像サムネイル */}
              {n.img_url && (
                <img
                  src={n.img_url}
                  alt=""
                  className="mb-2 cursor-pointer"
                  onClick={() => setPreview(n.img_url!)}
                />
              )}

              {/* テキスト入力 */}
              <textarea
                defaultValue={n.text}
                placeholder="説明を入力"
                className="w-full border p-1 text-sm mb-2"
                onBlur={e => (n.text = e.target.value)}
              />

              {/* 画像選択ボタン */}
              <FileButton onSelect={file => saveNote(n, file)} />

              {/* 保存ボタン */}
              <button
                className="px-3 py-1 bg-blue-600 text-white text-sm rounded w-full mt-2"
                onClick={() => saveNote(n)}
              >
                保存
              </button>

              {/* 削除ボタン */}
              <button
                className="mt-2 w-full flex items-center justify-center gap-1 text-sm text-red-600"
                onClick={() => deleteNote(n.id)}
              >
                <IoTrashOutline /> 削除
              </button>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </>
  )
}
