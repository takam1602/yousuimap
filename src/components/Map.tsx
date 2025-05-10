'use client'

/* ───── Leaflet基本セットアップ ───── */
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMapEvents,
} from 'react-leaflet'
import type { Map as LeafletMap } from 'leaflet'

L.Icon.Default.mergeOptions({
  iconUrl:        '/leaflet/marker-icon.png',
  iconRetinaUrl:  '/leaflet/marker-icon-2x.png',
  shadowUrl:      '/leaflet/marker-shadow.png',
})

/* ───── そのほか UI/状態系 ───── */
import { IoTrashOutline, IoClose } from 'react-icons/io5'
import { useSwipeable }            from 'react-swipeable'
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

import { useAuth }      from '@/contexts/AuthContext'
import useFitBounds      from '@/components/useFitBounds'
import Toast             from '@/components/Toast'

/* ───────────────────────────────────── */
/* 型定義                                                                   */
/* ───────────────────────────────────── */
interface Image { id: string; url: string }
interface Note  { id: string; lat: number; lng: number; text: string; images: Image[] }

async function resizeImage(
  file: File,
  maxW = 1280,
  maxH = 960,
): Promise<Blob> {
  const tmpURL  = URL.createObjectURL(file)
  const imgElm  = await new Promise<HTMLImageElement>((ok, ng) => {
    const img = new Image()
    img.onload = () => ok(img)
    img.onerror = ng
    img.src = tmpURL
  })
  URL.revokeObjectURL(tmpURL)

  const scale = Math.min(maxW / imgElm.width, maxH / imgElm.height, 1)
  const cvs   = Object.assign(document.createElement('canvas'), {
    width : imgElm.width  * scale,
    height: imgElm.height * scale,
  })
  cvs.getContext('2d')!.drawImage(imgElm, 0, 0, cvs.width, cvs.height)

  return new Promise<Blob>((res) =>
    cvs.toBlob((b) => res(b!), 'image/webp', 0.8),
  )
}

/* ───────────────────────────────────── */
/* Re-usable FileButton                                                      */
/* ───────────────────────────────────── */
function FileButton({
  disabled,
  onSelect,
}: {
  disabled: boolean
  onSelect : (f: File) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <button
        disabled={disabled}
        className={`px-3 py-1 bg-gray-200 rounded w-full text-sm ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        }`}
        onClick={() => ref.current?.click()}
      >
        画像を登録
      </button>

      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0]
          if (!f) return
          const processed =
            f.size > 80 * 1024
              ? await resizeImage(f)
              : f
          onSelect(
            new File([processed], f.name, {
              type        : processed.type,
              lastModified: Date.now(),
            }),
          )
        }}
      />
    </>
  )
}

/* ───────────────────────────────────── */
/* 画像カルーセル（メモ化で再レンダー抑制）                                  */
/* ───────────────────────────────────── */
const Carousel = memo(function Carousel({
  canEdit,
  imgs,
  onDelete,
  onPreview,
}: {
  canEdit : boolean
  imgs    : Image[]
  onDelete: (img: Image) => void
  onPreview: (url: string) => void
}) {
  const [idx, setIdx] = useState(0)
  const img = imgs[idx]

  const swipeHandlers = useSwipeable({
    onSwipedLeft : () => setIdx((idx + 1) % imgs.length),
    onSwipedRight: () => setIdx((idx - 1 + imgs.length) % imgs.length),
  })

  return (
    <div {...swipeHandlers} className="relative mb-2">
      <img
        src={img.url}
        alt=""
        className="cursor-pointer w-36 h-28 object-cover"
        onClick={() => onPreview(img.url)}
      />

      {imgs.length > 1 && (
        <Fragment>
          <button
            className="absolute left-0 top-1/2 -translate-y-1/2
                       bg-black/60 text-white w-8 h-8 flex items-center
                       justify-center text-xl rounded-r"
            onClick={(e) => {
              e.stopPropagation()
              setIdx((idx - 1 + imgs.length) % imgs.length)
            }}
          >
            ‹
          </button>
          <button
            className="absolute right-0 top-1/2 -translate-y-1/2
                       bg-black/60 text-white w-8 h-8 flex items-center
                       justify-center text-xl rounded-l"
            onClick={(e) => {
              e.stopPropagation()
              setIdx((idx + 1) % imgs.length)
            }}
          >
            ›
          </button>
        </Fragment>
      )}

      {canEdit && (
        <button
          className="absolute top-1 right-1 bg-black/60 text-white
                     w-8 h-8 flex items-center justify-center rounded-full"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(img)
          }}
        >
          <IoTrashOutline />
        </button>
      )}
    </div>
  )
})

/* ───────────────────────────────────── */
/*                Main Map               */
/* ───────────────────────────────────── */
export default function Map() {
  const { user } = useAuth()
  const canEdit  = !!user

  const [notes , setNotes ] = useState<Note[]>([])
  const [toast , setToast ] = useState('')
  const [preview, setPreview] = useState<string | null>(null)

  const mapRef    = useRef<LeafletMap | null>(null)
  const popupRefs = useRef<Record<string, L.Popup>>({})

  /*  初回ロード  */
  useEffect(() => {
    fetch('/api/notes')
      .then((r) => r.json())
      .then((rows: Note[]) =>
        setNotes(
          rows.map((n) => ({ ...n, text: n.text ?? '' })),
        ),
      )
  }, [])

  /* 全体フィット（1回だけ） */
  useFitBounds(notes, mapRef)

  /* ── helper: 画像削除 ── */
  const deleteImg = useCallback(
    async (noteId: string, img: Image) => {
      if (!canEdit) return
      await fetch(`/api/images/${img.id}`, { method: 'DELETE' })
      setNotes((arr) =>
        arr.map((n) =>
          n.id === noteId
            ? { ...n, images: n.images.filter((i) => i.id !== img.id) }
            : n,
        ),
      )
    },
    [canEdit],
  )

  /* ── helper: ノート削除 ── */
  const deleteNote = useCallback(
    async (id: string) => {
      if (!canEdit) return
      if (!confirm('この地点を削除しますか？')) return
      await fetch(`/api/notes/${id}`, { method: 'DELETE' })
      setNotes((arr) => arr.filter((n) => n.id !== id))
    },
    [canEdit],
  )

  /* ── helper: ノート / 画像 保存 ── */
  const saveNote = useCallback(
    async (note: Note, file?: File) => {
      if (!canEdit) return

      /* 1) 先に notes を upsert (FK 先を確保) */
      const resNote = await fetch('/api/notes', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          id: note.id,
          lat: note.lat,
          lng: note.lng,
          text: note.text ?? '',
        }),
      })
      if (!resNote.ok) {
        setToast('ノート保存に失敗しました')
        console.error(await resNote.text())
        return
      }

      /* 2) 画像があればアップロード → images INSERT */
      if (file) {
        const blob = await resizeImage(file)
        const { signedUrl, path } = await fetch('/api/upload-url', {
          method: 'POST',
          body  : JSON.stringify({ filename: `${note.id}-${Date.now()}.webp` }),
        }).then((r) => r.json())

        await fetch(signedUrl, { method: 'PUT', body: blob })

        const img_url =
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}` +
          `/storage/v1/object/public/photos/${path}`

        const resImg = await fetch('/api/images', {
          method : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body   : JSON.stringify({ note_id: note.id, url: img_url }),
        })
        if (!resImg.ok) {
          setToast('画像保存に失敗しました')
          console.error(await resImg.text())
          return
        }
        const { id: imgId } = await resImg.json()

        setNotes((arr) =>
          arr.map((x) =>
            x.id === note.id
              ? { ...x, images: [...x.images, { id: imgId, url: img_url }] }
              : x,
          ),
        )
      }

      setToast('保存しました')
    },
    [canEdit],
  )

  /* ── 地図クリックで仮ノート ── */
  function ClickHandler() {
    useMapEvents({
      click(e) {
        if (!canEdit) return
        setNotes((arr) => [
          ...arr,
          {
            id: crypto.randomUUID(),
            lat: e.latlng.lat,
            lng: e.latlng.lng,
            text: '',
            images: [],
          },
        ])
      },
    })
    return null
  }

  /* ── 現在地ピン ── */
  const addCurrent = useCallback(() => {
    if (!canEdit) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords
        setNotes((arr) => [
          ...arr,
          {
            id: crypto.randomUUID(),
            lat: latitude,
            lng: longitude,
            text: '',
            images: [],
          },
        ])
        mapRef.current?.flyTo([latitude, longitude], 18)
      },
      () => alert('位置情報取得失敗'),
    )
  }, [canEdit])

  /* ── PopupContent を別コンポーネントに（Hooks 安全に使うため） ── */
  const PopupContent = ({
    note,
    close,
  }: {
    note : Note
    close: () => void
  }) => {
    const [pending, setPending] = useState<File | null>(null)

    return (
      <>
        {note.images.length > 0 && (
          <div onClick={() => setPreview(note.images[0].url)}>
            <Carousel
              canEdit={canEdit}
              imgs={note.images}
              onPreview={setPreview}
              onDelete={(img) => deleteImg(note.id, img)}
            />
          </div>
        )}

        {pending && (
          <p className="text-xs text-blue-600 mb-1">
            新しい画像が選択されました
          </p>
        )}

        <textarea
          defaultValue={note.text}
          placeholder={canEdit ? '説明を入力' : '閲覧モードでは編集不可'}
          className={`w-full border p-1 text-sm mb-2 ${
            canEdit ? '' : 'bg-gray-100'
          }`}
          readOnly={!canEdit}
          onBlur={(e) => (note.text = e.target.value)}
        />

        {canEdit ? (
          <>
            <FileButton disabled={!canEdit} onSelect={setPending} />
            <button
              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded w-full mt-2"
              onClick={async () => {
                await saveNote(note, pending ?? undefined)
                setPending(null)
                close()
              }}
            >
              保存して閉じる
            </button>
          </>
        ) : (
          <button
            className="px-3 py-1 bg-gray-400 text-white text-sm rounded w-full mt-2"
            onClick={close}
          >
            閉じる
          </button>
        )}

        {canEdit && (
          <button
            className="mt-2 w-full flex items-center justify-center gap-1 text-sm text-red-600"
            onClick={() => deleteNote(note.id)}
          >
            <IoTrashOutline />
            ノート削除
          </button>
        )}
      </>
    )
  }

  /* ───────────────────────────── JSX ───────────────────────────── */
  return (
    <>
      {/* ── プレビュー ── */}
      {preview && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[1000]">
          <img
            src={preview}
            alt=""
            className="max-h-[80vh] max-w-[90vw]"
          />

          {'canShare' in navigator && (
            <button
              className="absolute bottom-6 left-1/2 -translate-x-1/2
                         bg-white/90 px-4 py-1 rounded shadow text-sm"
              onClick={async () => {
                const blob = await fetch(preview).then((r) => r.blob())
                await navigator.share({
                  files: [new File([blob], 'photo.webp', { type: 'image/webp' })],
                  title: '画像',
                })
              }}
            >
              画像を共有/保存
            </button>
          )}

          <button
            className="absolute top-4 right-4 text-white text-3xl"
            onClick={() => setPreview(null)}
          >
            <IoClose />
          </button>
        </div>
      )}

      {/* ── Toast ── */}
      <Toast message={toast} onDone={() => setToast('')} />

      {/* ── 現在地ピン & Center ── */}
      {canEdit && (
        <button
          className="fixed bottom-16 right-4 z-[1000]
                     bg-green-600 hover:bg-green-700 text-white
                     w-16 h-16 text-3xl rounded-full shadow-lg
                     flex items-center justify-center"
          title="現在地にピンを追加"
          onClick={addCurrent}
        >
          📌
        </button>
      )}

      <button
        className="fixed bottom-4 right-4 z-[1000] bg-white p-2 rounded shadow"
        onClick={() =>
          navigator.geolocation.getCurrentPosition(
            (pos) =>
              mapRef.current?.flyTo(
                [pos.coords.latitude, pos.coords.longitude],
                15,
              ),
            () => alert('位置情報取得失敗'),
          )
        }
      >
        📍 Center
      </button>

      {/* ── 地図本体 ── */}
      <MapContainer
        ref={mapRef}
        center={[36.07, 140.11]}
        zoom={13}
        className="h-screen"
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {canEdit && <ClickHandler />}

        {notes.map((n) => (
          <Marker key={n.id} position={[n.lat, n.lng]}>
            <Popup
              /* ref: 型エラーを避けるため void を返すだけ */
              ref={(p) => {
                if (p) popupRefs.current[n.id] = p
                return undefined
              }}
              minWidth={260}
              maxWidth={320}
              autoClose={false}
              closeOnClick={false}
              className="max-w-[90vw] sm:max-w-[320px]"
            >
              <PopupContent
                note={n}
                close={() => popupRefs.current[n.id]?.close()}
              />
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </>
  )
}
