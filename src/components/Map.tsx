'use client'

import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useState, useEffect, useRef } from 'react'
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMapEvents,
} from 'react-leaflet'
import type { Map as LeafletMap } from 'leaflet'
import { useSwipeable } from 'react-swipeable'
import { IoTrashOutline, IoClose } from 'react-icons/io5'

L.Icon.Default.mergeOptions({
  iconUrl: '/leaflet/marker-icon.png',
  iconRetinaUrl: '/leaflet/marker-icon-2x.png',
  shadowUrl: '/leaflet/marker-shadow.png',
})

type NoteRow = {
  id: string
  lat: number
  lng: number
  text: string | null
  images?: { id: string; url: string }[]
}

interface Image {
  id: string
  url: string
}
interface Note {
  id: string
  lat: number
  lng: number
  text?: string
  images: Image[]
}

/* ---------- 画像リサイズ関数 ---------- */
async function resizeImage(
  file: File,
  maxW = 640,
  maxH = 480,
  mime = 'image/webp',
  quality = 0.8,
): Promise<Blob> {
  const url = URL.createObjectURL(file)
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const image = new Image()
    image.onload = () => res(image)
    image.onerror = rej
    image.src = url
  })
  URL.revokeObjectURL(url)

  const scale = Math.min(maxW / img.width, maxH / img.height, 1)
  const w = Math.round(img.width * scale)
  const h = Math.round(img.height * scale)

  const canvas = Object.assign(document.createElement('canvas'), {
    width: w,
    height: h,
  })
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, w, h)

  const blob: Blob | null = await new Promise((res) =>
    canvas.toBlob((b) => res(b), mime, quality),
  )
  if (!blob) throw new Error('toBlob failed')
  return blob
}

/* ---------- メインコンポーネント ---------- */
export default function Map() {
  const [notes, setNotes] = useState<Note[]>([])
  const [preview, setPreview] = useState<string | null>(null)
  const mapRef = useRef<LeafletMap | null>(null)

  /* ---- 1. 初期ロード ---- */
  useEffect(() => {
    fetch('/api/notes')
      .then((r) => r.json())
      .then((raw: unknown) => {
        const rows = raw as NoteRow[]
        setNotes(
          rows.map((n) => ({
            id: n.id,
            lat: n.lat,
            lng: n.lng,
            text: n.text ?? '',
            images: n.images ?? [],
          })),
        )
      })
      .catch(console.error)
  }, [])

  /* ---- 2. 地図クリックで仮ノート追加＋即DB保存 ---- */
  function ClickHandler() {
    useMapEvents({
      click(e) {
        const newNote: Note = {
          id: crypto.randomUUID(),
          lat: e.latlng.lat,
          lng: e.latlng.lng,
          images: [],
        }
        setNotes((arr) => [...arr, newNote])

        fetch('/api/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: newNote.id,
            lat: newNote.lat,
            lng: newNote.lng,
            text: '',
          }),
        }).catch(console.error)
      },
    })
    return null
  }

  /* ---- 3. ノート & 画像保存 ---- */
  async function saveNote(note: Note, file?: File) {
    let img_url: string | undefined

    /* 3‑1 画像をリサイズしてアップロード */
    if (file) {
      const resized = await resizeImage(file, 640, 480, 'image/webp', 0.8)

      const res1 = await fetch('/api/upload-url', {
        method: 'POST',
        body: JSON.stringify({
          filename: `${note.id}-${Date.now()}.webp`,
        }),
      })
      const { signedUrl, path } = await res1.json()
      if (!signedUrl) return alert('画像アップロード用 URL 取得失敗')

      await fetch(signedUrl, { method: 'PUT', body: resized })
      img_url =
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}` +
        `/storage/v1/object/public/photos/${path}`

      /* images テーブルへ INSERT */
      const resImg = await fetch('/api/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note_id: note.id, url: img_url }),
      })
      const { id: imgId } = await resImg.json()

      setNotes((arr) =>
        arr.map((x) =>
          x.id === note.id
            ? {
                ...x,
                images: [
                  ...x.images,
                  { id: imgId ?? crypto.randomUUID(), url: img_url! },
                ],
              }
            : x,
        ),
      )
    }

    /* 3‑2 notes upsert */
    await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: note.id,
        lat: note.lat,
        lng: note.lng,
        text: note.text ?? '',
      }),
    })
  }

  /* ---- 4. ノート削除 ---- */
  async function deleteNote(id: string) {
    if (!confirm('この地点のノートを削除しますか？')) return
    await fetch(`/api/notes/${id}`, { method: 'DELETE' })
    setNotes((arr) => arr.filter((n) => n.id !== id))
  }

  /* ---- 5. 画像削除 ---- */
  async function deleteImage(noteId: string, img: Image) {
    await fetch(`/api/images/${img.id}`, { method: 'DELETE' })
    setNotes((arr) =>
      arr.map((n) =>
        n.id === noteId
          ? { ...n, images: n.images.filter((i) => i.id !== img.id) }
          : n,
      ),
    )
  }

  /* ---- 6. カルーセル ---- */
  function Carousel({ noteId, imgs }: { noteId: string; imgs: Image[] }) {
    const [idx, setIdx] = useState(0)
    const img = imgs[idx]
    const swipe = useSwipeable({
      onSwipedLeft: () => setIdx((idx + 1) % imgs.length),
      onSwipedRight: () => setIdx((idx - 1 + imgs.length) % imgs.length),
    })
    return (
      <div {...swipe} className="relative mb-2">
        <img
          src={img.url}
          alt=""
          className="cursor-pointer"
          onClick={(e) => {
            e.stopPropagation()
            setPreview(img.url)
          }}
        />

        {imgs.length > 1 && (
          <>
            <button
              className="absolute left-0 top-1/2 -translate-y-1/2 bg-black/60 text-white w-8 h-8 flex items-center justify-center text-xl rounded-r"
              onClick={(e) => {
                e.stopPropagation()
                setIdx((idx - 1 + imgs.length) % imgs.length)
              }}
            >
              ‹
            </button>
            <button
              className="absolute right-0 top-1/2 -translate-y-1/2 bg-black/60 text-white w-8 h-8 flex items-center justify-center text-xl rounded-l"
              onClick={(e) => {
                e.stopPropagation()
                setIdx((idx + 1) % imgs.length)
              }}
            >
              ›
            </button>
          </>
        )}

        <button
          className="absolute top-1 right-1 bg-black/60 text-white w-8 h-8 flex items-center justify-center rounded-full"
          onClick={(e) => {
            e.stopPropagation()
            deleteImage(noteId, img)
          }}
        >
          <IoTrashOutline />
        </button>
      </div>
    )
  }

  /* ---- 7. ファイル選択ボタン ---- */
  function FileButton({ onSelect }: { onSelect: (f: File) => void }) {
    const ref = useRef<HTMLInputElement>(null)
    return (
      <>
        <button
          className="px-3 py-1 bg-gray-200 rounded w-full text-sm"
          onClick={() => ref.current?.click()}
        >
          画像を選択
        </button>
        <input
          ref={ref}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onSelect(f)
          }}
        />
      </>
    )
  }

  /* ---------- JSX ---------- */
  return (
    <>
      {/* モーダル */}
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

      {/* 現在地ボタン */}
      <button
        className="fixed bottom-4 right-4 z-[1000] bg-white p-2 rounded shadow"
        onClick={() => {
          if (!navigator.geolocation)
            return alert('位置情報非対応')
          navigator.geolocation.getCurrentPosition(
            (pos) =>
              mapRef.current?.flyTo(
                [pos.coords.latitude, pos.coords.longitude],
                15,
              ),
            () => alert('位置情報取得失敗'),
          )
        }}
      >
        📍 Center
      </button>

      {/* 地図 */}
      <MapContainer
        ref={mapRef}
        center={[36.07, 140.11]}
        zoom={15}
        className="h-screen"
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <ClickHandler />

        {notes.map((n) => (
          <Marker key={n.id} position={[n.lat, n.lng]}>
            <Popup minWidth={260} autoClose={false} closeOnClick={false}>
              {n.images.length > 0 && (
                <Carousel noteId={n.id} imgs={n.images} />
              )}

              <textarea
                defaultValue={n.text ?? ''}
                placeholder="説明を入力"
                className="w-full border p-1 text-sm mb-2"
                onBlur={(e) => (n.text = e.target.value)}
              />

              <FileButton onSelect={(file) => saveNote(n, file)} />

              <button
                className="px-3 py-1 bg-blue-600 text-white text-sm rounded w-full mt-2"
                onClick={() => saveNote(n)}
              >
                保存
              </button>

              <button
                className="mt-2 w-full flex items-center justify-center gap-1 text-sm text-red-600"
                onClick={() => deleteNote(n.id)}
              >
                <IoTrashOutline /> ノート削除
              </button>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </>
  )
}
