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
import {
  IoAdd,
  IoClose,
  IoImageOutline,
  IoLinkOutline,
  IoListOutline,
  IoLocateOutline,
  IoSearchOutline,
  IoTrashOutline,
} from 'react-icons/io5'
import { useSwipeable }            from 'react-swipeable'
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { useAuth }      from '@/contexts/AuthContext'
import useFitBounds      from '@/components/useFitBounds'
import Toast             from '@/components/Toast'
import { DEFAULT_MAP_SLUG } from '@/lib/waterwayMaps'

/* ───────────────────────────────────── */
/* 型定義                                                                   */
/* ───────────────────────────────────── */
interface Image { id: string; url: string }
interface Note  { id: string; lat: number; lng: number; text: string; images: Image[] }

type MapProps = {
  mapSlug?: string
  mapTitle?: string
  initialCenter?: [number, number]
  initialZoom?: number
}

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

async function responseError(res: Response) {
  const text = await res.text()
  try {
    const body = JSON.parse(text)
    return body?.error?.message ?? body?.error ?? body?.selErr?.message ?? body?.delErr?.message ?? res.statusText
  } catch {
    return text || res.statusText
  }
}

const NOTE_IMPORT_SAVE_BATCH_SIZE = 500

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
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
        type="button"
        disabled={disabled}
        className={`flex w-full items-center justify-center gap-2 rounded bg-gray-200 px-3 py-2 text-sm hover:bg-gray-300 ${
          disabled ? 'cursor-not-allowed opacity-50' : ''
        }`}
        onClick={() => ref.current?.click()}
      >
        <IoImageOutline />
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
          e.currentTarget.value = ''
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
    <div {...swipeHandlers} className="relative mb-2 overflow-hidden rounded border bg-gray-50">
      <img
        src={img.url}
        alt="地点写真"
        className="h-40 w-full cursor-pointer object-cover"
        onClick={() => onPreview(img.url)}
      />

      {imgs.length > 1 && (
        <Fragment>
          <button
            type="button"
            aria-label="前の画像"
            className="absolute left-0 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-r bg-black/60 text-xl text-white"
            onClick={(e) => {
              e.stopPropagation()
              setIdx((idx - 1 + imgs.length) % imgs.length)
            }}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="次の画像"
            className="absolute right-0 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-l bg-black/60 text-xl text-white"
            onClick={(e) => {
              e.stopPropagation()
              setIdx((idx + 1) % imgs.length)
            }}
          >
            ›
          </button>
          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">
            {idx + 1} / {imgs.length}
          </span>
        </Fragment>
      )}

      {canEdit && (
        <button
          type="button"
          aria-label="画像を削除"
          className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-red-600"
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
export default function Map({
  mapSlug = DEFAULT_MAP_SLUG,
  mapTitle = '土浦用水',
  initialCenter = [36.07, 140.11],
  initialZoom = 13,
}: MapProps) {
  const { session, user } = useAuth()
  const canEdit  = !!user

  const [notes , setNotes ] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [toast , setToast ] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [showList, setShowList] = useState(false)
  const [query, setQuery] = useState('')
  const [googleMapUrl, setGoogleMapUrl] = useState('')
  const [googleImporting, setGoogleImporting] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)

  const mapRef    = useRef<LeafletMap | null>(null)
  const popupRefs = useRef<Record<string, L.Popup>>({})
  const notesEndpoint = useMemo(
    () => `/api/notes?map=${encodeURIComponent(mapSlug)}`,
    [mapSlug],
  )

  const authHeaders = useCallback((json = false) => {
    if (!session?.access_token) throw new Error('ログインが必要です')
    return {
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${session.access_token}`,
    }
  }, [session])

  const openNote = useCallback((note: Note) => {
    mapRef.current?.flyTo([note.lat, note.lng], Math.max(mapRef.current.getZoom(), 16))
    popupRefs.current[note.id]?.openOn(mapRef.current!)
    setShowList(false)
  }, [])

  /*  初回ロード  */
  useEffect(() => {
    let ignore = false

    async function load() {
      setLoading(true)
      try {
        const res = await fetch(notesEndpoint)
        if (!res.ok) throw new Error(await responseError(res))
        const rows: Note[] = await res.json()
        if (ignore) return
        setNotes(rows.map((n) => ({ ...n, text: n.text ?? '', images: n.images ?? [] })))
      } catch (error) {
        console.error(error)
        if (!ignore) setToast('地点データを読み込めませんでした')
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    load()
    return () => { ignore = true }
  }, [notesEndpoint])

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return notes
    return notes.filter((note) => note.text.toLowerCase().includes(q))
  }, [notes, query])

  /* 全体フィット（1回だけ） */
  useFitBounds(notes, mapRef)

  /* ── helper: 画像削除 ── */
  const deleteImg = useCallback(
    async (noteId: string, img: Image) => {
      if (!canEdit) return
      setSavingId(noteId)
      try {
        const res = await fetch(`/api/images/${img.id}`, {
          method: 'DELETE',
          headers: authHeaders(),
        })
        if (!res.ok) throw new Error(await responseError(res))
        setNotes((arr) =>
          arr.map((n) =>
            n.id === noteId
              ? { ...n, images: n.images.filter((i) => i.id !== img.id) }
              : n,
          ),
        )
        setToast('画像を削除しました')
      } catch (error) {
        console.error(error)
        setToast('画像削除に失敗しました')
      } finally {
        setSavingId(null)
      }
    },
    [authHeaders, canEdit, notesEndpoint],
  )

  /* ── helper: ノート削除 ── */
  const deleteNote = useCallback(
    async (id: string) => {
      if (!canEdit) return
      if (!confirm('この地点を削除しますか？')) return
      setSavingId(id)
      try {
        const res = await fetch(`/api/notes/${id}`, {
          method: 'DELETE',
          headers: authHeaders(),
        })
        if (!res.ok) throw new Error(await responseError(res))
        setNotes((arr) => arr.filter((n) => n.id !== id))
        setToast('地点を削除しました')
      } catch (error) {
        console.error(error)
        setToast('地点削除に失敗しました')
      } finally {
        setSavingId(null)
      }
    },
    [authHeaders, canEdit],
  )

  /* ── helper: ノート / 画像 保存 ── */
  const saveNote = useCallback(
    async (note: Note, file?: File) => {
      if (!canEdit) return false
      setSavingId(note.id)

      try {
        const resNote = await fetch(notesEndpoint, {
          method : 'POST',
          headers: authHeaders(true),
          body   : JSON.stringify({
            id: note.id,
            lat: note.lat,
            lng: note.lng,
            text: note.text ?? '',
          }),
        })
        if (!resNote.ok) throw new Error(await responseError(resNote))

        setNotes((arr) => arr.map((x) => x.id === note.id ? { ...x, text: note.text ?? '' } : x))

        if (file) {
          const blob = await resizeImage(file)
          const uploadRes = await fetch('/api/upload-url', {
            method: 'POST',
            headers: authHeaders(true),
            body  : JSON.stringify({ filename: `${note.id}-${Date.now()}.webp` }),
          })
          if (!uploadRes.ok) throw new Error(await responseError(uploadRes))
          const { signedUrl, path } = await uploadRes.json()

          const putRes = await fetch(signedUrl, { method: 'PUT', body: blob })
          if (!putRes.ok) throw new Error('画像アップロードに失敗しました')

          const imgUrl =
            `${process.env.NEXT_PUBLIC_SUPABASE_URL}` +
            `/storage/v1/object/public/photos/${path}`

          const resImg = await fetch('/api/images', {
            method : 'POST',
            headers: authHeaders(true),
            body   : JSON.stringify({ note_id: note.id, url: imgUrl }),
          })
          if (!resImg.ok) throw new Error(await responseError(resImg))
          const { id: imgId } = await resImg.json()

          setNotes((arr) =>
            arr.map((x) =>
              x.id === note.id
                ? { ...x, images: [...x.images, { id: imgId, url: imgUrl }] }
                : x,
            ),
          )
        }

        setToast('保存しました')
        return true
      } catch (error) {
        console.error(error)
        setToast(error instanceof Error && error.message === 'ログインが必要です'
          ? 'ログインし直してください'
          : '保存に失敗しました')
        return false
      } finally {
        setSavingId(null)
      }
    },
    [authHeaders, canEdit, notesEndpoint],
  )

  const addDraftNote = useCallback((lat: number, lng: number, text = '') => {
    if (!canEdit) return null
    const note = { id: crypto.randomUUID(), lat, lng, text, images: [] }
    setNotes((arr) => [...arr, note])
    setTimeout(() => popupRefs.current[note.id]?.openOn(mapRef.current!), 0)
    return note
  }, [canEdit])

  const importGoogleMapLink = useCallback(async () => {
    if (!canEdit || googleImporting) return
    const url = googleMapUrl.trim()
    if (!url) {
      setToast('Google Maps のリンクを貼り付けてください')
      return
    }

    setGoogleImporting(true)
    try {
      const res = await fetch('/api/google-map-link', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ url }),
      })
      if (!res.ok) throw new Error(await responseError(res))

      const result: {
        listName: string | null
        places: Array<{ lat: number; lng: number; name: string | null }>
        resolvedUrl: string
        totalCount?: number | null
      } = await res.json()

      const existing = new Set(notes.map((note) => `${note.lat.toFixed(7)},${note.lng.toFixed(7)}`))
      const imported = result.places
        .filter((place) => !existing.has(`${place.lat.toFixed(7)},${place.lng.toFixed(7)}`))
        .map((place) => {
          return {
            id: crypto.randomUUID(),
            lat: place.lat,
            lng: place.lng,
            text: place.name?.trim() ?? '',
            images: [],
          }
        })

      if (imported.length === 0) {
        setToast('追加できる新しい地点がありませんでした')
        return
      }

      for (const batch of chunkArray(imported, NOTE_IMPORT_SAVE_BATCH_SIZE)) {
        const saveRes = await fetch(notesEndpoint, {
          method: 'POST',
          headers: authHeaders(true),
          body: JSON.stringify(batch.map(({ id, lat, lng, text }) => ({ id, lat, lng, text }))),
        })
        if (!saveRes.ok) throw new Error(await responseError(saveRes))
      }

      setNotes((arr) => [...arr, ...imported])
      setGoogleMapUrl('')

      const first = imported[0]
      mapRef.current?.flyTo([first.lat, first.lng], result.places.length > 1 ? 12 : 17)
      setTimeout(() => popupRefs.current[first.id]?.openOn(mapRef.current!), 100)
      const skippedCount = result.places.length - imported.length
      const partialCount = result.totalCount && result.places.length < result.totalCount
        ? `（Google Maps 側の${result.totalCount}件中${result.places.length}件を取得）`
        : ''
      const skippedText = skippedCount > 0 ? `（既存${skippedCount}件を除外）` : ''
      setToast(`${imported.length}件の地点を追加しました${skippedText}${partialCount}`)
    } catch (error) {
      console.error(error)
      setToast(error instanceof Error ? error.message : 'Google Maps リンクを読み取れませんでした')
    } finally {
      setGoogleImporting(false)
    }
  }, [authHeaders, canEdit, googleImporting, googleMapUrl, notes, notesEndpoint])

  /* ── 地図クリックで仮ノート ── */
  function ClickHandler() {
    useMapEvents({
      click(e) {
        addDraftNote(e.latlng.lat, e.latlng.lng)
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
        addDraftNote(latitude, longitude)
        mapRef.current?.flyTo([latitude, longitude], 18)
      },
      () => setToast('位置情報を取得できませんでした'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }, [addDraftNote, canEdit])

  const centerCurrent = useCallback(() => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        mapRef.current?.flyTo(
          [pos.coords.latitude, pos.coords.longitude],
          15,
        ),
      () => setToast('位置情報を取得できませんでした'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }, [])

  /* ── PopupContent を別コンポーネントに（Hooks 安全に使うため） ── */
  const PopupContent = ({
    note,
    close,
  }: {
    note : Note
    close: () => void
  }) => {
    const [pending, setPending] = useState<File | null>(null)
    const [text, setText] = useState(note.text)
    const busy = savingId === note.id

    return (
      <div className="w-[min(78vw,300px)]">
        {note.images.length > 0 ? (
          <Carousel
            canEdit={canEdit && !busy}
            imgs={note.images}
            onPreview={setPreview}
            onDelete={(img) => deleteImg(note.id, img)}
          />
        ) : (
          <div className="mb-2 flex h-24 items-center justify-center rounded border border-dashed bg-gray-50 text-sm text-gray-500">
            画像なし
          </div>
        )}

        {pending && (
          <p className="mb-1 text-xs text-blue-600">
            選択中: {pending.name}
          </p>
        )}

        <textarea
          value={text}
          placeholder={canEdit ? '説明を入力' : '閲覧モードでは編集不可'}
          className={`mb-2 min-h-24 w-full resize-y rounded border p-2 text-sm ${
            canEdit ? '' : 'bg-gray-100'
          }`}
          readOnly={!canEdit || busy}
          onChange={(e) => setText(e.target.value)}
        />

        {canEdit ? (
          <>
            <FileButton disabled={busy} onSelect={setPending} />
            <button
              type="button"
              disabled={busy}
              className="mt-2 w-full rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
              onClick={async () => {
                const ok = await saveNote({ ...note, text }, pending ?? undefined)
                if (!ok) return
                setPending(null)
                close()
              }}
            >
              {busy ? '保存中...' : '保存して閉じる'}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="mt-2 w-full rounded bg-gray-500 px-3 py-2 text-sm text-white"
            onClick={close}
          >
            閉じる
          </button>
        )}

        {canEdit && (
          <button
            type="button"
            disabled={busy}
            className="mt-2 flex w-full items-center justify-center gap-1 text-sm text-red-600 disabled:opacity-50"
            onClick={() => deleteNote(note.id)}
          >
            <IoTrashOutline />
            地点削除
          </button>
        )}
      </div>
    )
  }

  /* ───────────────────────────── JSX ───────────────────────────── */
  return (
    <div className="relative h-full min-h-[calc(100vh-96px)] overflow-hidden">
      {/* ── プレビュー ── */}
      {preview && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/85 p-4">
          <img
            src={preview}
            alt="地点写真の拡大表示"
            className="max-h-[86vh] max-w-[94vw] object-contain"
          />

          {'share' in navigator && 'canShare' in navigator && (
            <button
              type="button"
              className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded bg-white/90 px-4 py-2 text-sm shadow"
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
            type="button"
            aria-label="プレビューを閉じる"
            className="absolute right-4 top-4 text-3xl text-white"
            onClick={() => setPreview(null)}
          >
            <IoClose />
          </button>
        </div>
      )}

      <Toast message={toast} onDone={() => setToast('')} />

      <div className="absolute left-3 top-3 z-[1000] flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center gap-2">
        <span className="rounded bg-white px-3 py-2 text-sm font-semibold shadow">
          {mapTitle}
        </span>
        <button
          type="button"
          className="flex items-center gap-2 rounded bg-white px-3 py-2 text-sm shadow hover:bg-gray-50"
          onClick={() => setShowList((v) => !v)}
        >
          <IoListOutline />
          地点 {notes.length}
        </button>
        <span className={`rounded px-3 py-2 text-xs shadow ${canEdit ? 'bg-indigo-600 text-yellow-100' : 'bg-white text-gray-700'}`}>
          {canEdit ? '編集モード' : '閲覧モード'}
        </span>
        {loading && <span className="rounded bg-white px-3 py-2 text-xs shadow">読み込み中...</span>}
      </div>

      {canEdit && (
        <form
          className="absolute right-3 top-28 z-[1000] w-[min(92vw,420px)] rounded bg-white p-3 shadow-xl sm:top-3"
          onSubmit={(e) => {
            e.preventDefault()
            importGoogleMapLink()
          }}
        >
          <label className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
            <IoLinkOutline />
            Google Maps リンクから追加
          </label>
          <div className="flex gap-2">
            <input
              value={googleMapUrl}
              onChange={(e) => setGoogleMapUrl(e.target.value)}
              className="min-w-0 flex-1 rounded border px-3 py-2 text-sm outline-none focus:border-blue-500"
              placeholder="https://maps.app.goo.gl/..."
              disabled={googleImporting}
            />
            <button
              type="submit"
              disabled={googleImporting}
              className="shrink-0 rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
            >
              {googleImporting ? '読取中' : '追加'}
            </button>
          </div>
        </form>
      )}

      {showList && (
        <aside className="absolute left-3 top-16 z-[1000] flex max-h-[min(70vh,520px)] w-[min(92vw,360px)] flex-col rounded bg-white shadow-xl">
          <div className="border-b p-3">
            <label className="flex items-center gap-2 rounded border px-2 py-1 text-sm">
              <IoSearchOutline className="text-gray-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full outline-none"
                placeholder="メモを検索"
              />
            </label>
          </div>
          <div className="overflow-y-auto p-2">
            {filteredNotes.length === 0 ? (
              <p className="p-3 text-sm text-gray-500">該当する地点がありません</p>
            ) : filteredNotes.map((note) => (
              <button
                type="button"
                key={note.id}
                className="mb-1 block w-full rounded px-3 py-2 text-left hover:bg-gray-100"
                onClick={() => openNote(note)}
              >
                <span className="block truncate text-sm font-medium">
                  {note.text.trim() || '説明なしの地点'}
                </span>
                <span className="text-xs text-gray-500">
                  {note.images.length}枚 / {note.lat.toFixed(5)}, {note.lng.toFixed(5)}
                </span>
              </button>
            ))}
          </div>
        </aside>
      )}

      {/* ── 現在地ピン & Center ── */}
      <div className="absolute bottom-4 right-4 z-[1000] flex flex-col gap-2">
        {canEdit && (
          <button
            type="button"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-green-600 text-2xl text-white shadow-lg hover:bg-green-700"
            title="現在地にピンを追加"
            aria-label="現在地にピンを追加"
            onClick={addCurrent}
          >
            <IoAdd />
          </button>
        )}

        <button
          type="button"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-2xl text-gray-800 shadow-lg hover:bg-gray-50"
          title="現在地へ移動"
          aria-label="現在地へ移動"
          onClick={centerCurrent}
        >
          <IoLocateOutline />
        </button>
      </div>

      {/* ── 地図本体 ── */}
      <MapContainer
        ref={mapRef}
        center={initialCenter}
        zoom={initialZoom}
        className="h-full min-h-[calc(100vh-96px)]"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {canEdit && <ClickHandler />}

        {notes.map((n) => (
          <Marker key={n.id} position={[n.lat, n.lng]}>
            <Popup
              ref={(p) => {
                if (p) popupRefs.current[n.id] = p
                return undefined
              }}
              minWidth={260}
              maxWidth={340}
              autoClose={false}
              closeOnClick={false}
              className="max-w-[90vw] sm:max-w-[340px]"
            >
              <PopupContent
                note={n}
                close={() => popupRefs.current[n.id]?.close()}
              />
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}
