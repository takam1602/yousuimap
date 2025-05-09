'use client'
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
import { useSwipeable } from 'react-swipeable'
import { IoTrashOutline, IoClose } from 'react-icons/io5'
import {
  useState, useEffect, useRef, Fragment,
} from 'react'
import { supabase } from '@/lib/supabaseClient'
import useFitBounds from '@/components/useFitBounds'
import Toast from '@/components/Toast'

/* Leaflet デフォルトアイコン */
L.Icon.Default.mergeOptions({
  iconUrl: '/leaflet/marker-icon.png',
  iconRetinaUrl: '/leaflet/marker-icon-2x.png',
  shadowUrl: '/leaflet/marker-shadow.png',
})

/* 型 */
interface Image { id: string; url: string }
interface Note  { id: string; lat: number; lng: number; text?: string; images: Image[] }

/* 画像リサイズ (撮影画像は 640x480 に縮小) */
async function resizeImage(file: File, maxW=640, maxH=480) {
  const url = URL.createObjectURL(file)
  const img = await new Promise<HTMLImageElement>((ok, ng) => {
    const i = new Image()
    i.onload = () => ok(i)
    i.onerror = ng
    i.src = url
  })
  URL.revokeObjectURL(url)
  const scale = Math.min(maxW/img.width, maxH/img.height, 1)
  const cvs = Object.assign(document.createElement('canvas'), {
    width: img.width*scale, height: img.height*scale,
  })
  cvs.getContext('2d')!.drawImage(img,0,0,cvs.width,cvs.height)
  return new Promise<Blob>((res)=>
    cvs.toBlob(b=>res(b!), 'image/webp', .8))
}

export default function Map() {
  /* state */
  const [notes,setNotes]=useState<Note[]>([])
  const [preview,setPreview]=useState<string|null>(null)
  const [toast,setToast]=useState('')
  const [canEdit,setCanEdit]=useState(false)
  const mapRef=useRef<LeafletMap|null>(null)
  const popupRefs=useRef<Record<string,L.Popup>>({})

  /* 認証監視 */
  useEffect(()=>{
    supabase.auth.getSession().then(({data})=>setCanEdit(!!data.session?.user))
    const { data: sub } =
      supabase.auth.onAuthStateChange((_e,s)=>setCanEdit(!!s?.user))
    return ()=>sub.subscription.unsubscribe()
  },[])

  /* 初期ロード */
  useEffect(()=>{
    fetch('/api/notes').then(r=>r.json()).then((rows:Note[])=>{
      setNotes(rows.map(n=>({...n,text:n.text??''})))
    })
  },[])

  /* 初回だけ全体フィット */
  useFitBounds(notes,mapRef)

  /* 地図クリック */
  function ClickHandler(){
    useMapEvents({
      click(e){
        if(!canEdit) return
        setNotes(arr=>[...arr,{
          id:crypto.randomUUID(),lat:e.latlng.lat,lng:e.latlng.lng,images:[],text:''
        }])
      },
    })
    return null
  }

  /* 現在地ピン */
  async function addCurrent(){
    if(!canEdit) return
    navigator.geolocation.getCurrentPosition(pos=>{
      const {latitude,longitude}=pos.coords
      setNotes(arr=>[...arr,{
        id:crypto.randomUUID(),lat:latitude,lng:longitude,images:[],text:''
      }])
      mapRef.current?.flyTo([latitude,longitude],18)
    },()=>alert('位置情報取得失敗'))
  }

  /* 保存 */
  async function saveNote(note:Note,file?:File,close?:()=>void){
    if(!canEdit) return
    let img_url:string|undefined
    if(file){
      const blob= await resizeImage(file)
      const res1= await fetch('/api/upload-url',{method:'POST',
        body:JSON.stringify({filename:`${note.id}-${Date.now()}.webp`})})
      const {signedUrl,path}=await res1.json()
      await fetch(signedUrl,{method:'PUT',body:blob})
      img_url=`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/photos/${path}`
      const resImg=await fetch('/api/images',{method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({note_id:note.id,url:img_url})})
      const {id:imgId}=await resImg.json()
      setNotes(arr=>arr.map(x=>x.id===note.id?({...x,
        images:[...x.images,{id:imgId,url:img_url!}]}):x))
    }

    await fetch('/api/notes',{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id:note.id,lat:note.lat,lng:note.lng,text:note.text??''})})
    setToast('保存しました')
    close?.()
  }

  /* 削除 */
  async function deleteNote(id:string){
    if(!canEdit) return
    if(!confirm('この地点を削除?')) return
    await fetch(`/api/notes/${id}`,{method:'DELETE'})
    setNotes(arr=>arr.filter(n=>n.id!==id))
  }
  async function deleteImg(noteId:string,img:Image){
    if(!canEdit) return
    await fetch(`/api/images/${img.id}`,{method:'DELETE'})
    setNotes(arr=>arr.map(n=>n.id===noteId?({...n,images:n.images.filter(i=>i.id!==img.id)}):n))
  }

  /* Carousel */
  function Carousel({noteId,imgs}:{noteId:string;imgs:Image[]}){
    const [idx,setIdx]=useState(0)
    const img=imgs[idx]
    const swipe=useSwipeable({
      onSwipedLeft :()=>setIdx((idx+1)%imgs.length),
      onSwipedRight:()=>setIdx((idx-1+imgs.length)%imgs.length),
    })
    return(
      <div {...swipe} className="relative mb-2">
        <img src={img.url} alt="" className="cursor-pointer w-36 h-28 object-cover"
          onClick={e=>{e.stopPropagation();setPreview(img.url)}}/>
        {imgs.length>1&&(
          <Fragment>
            <button className="absolute left-0 top-1/2 -translate-y-1/2 bg-black/60 text-white w-8 h-8 flex items-center justify-center text-xl rounded-r"
              onClick={e=>{e.stopPropagation();setIdx((idx-1+imgs.length)%imgs.length)}}>‹</button>
            <button className="absolute right-0 top-1/2 -translate-y-1/2 bg-black/60 text-white w-8 h-8 flex items-center justify-center text-xl rounded-l"
              onClick={e=>{e.stopPropagation();setIdx((idx+1)%imgs.length)}}>›</button>
          </Fragment>
        )}
        {canEdit&&(
          <button className="absolute top-1 right-1 bg-black/60 text-white w-8 h-8 flex items-center justify-center rounded-full"
            onClick={e=>{e.stopPropagation();deleteImg(noteId,img)}}>
            <IoTrashOutline/>
          </button>
        )}
      </div>
    )
  }

  /* FileButton: capture 属性を外し撮影/アルバム選択をユーザーに委ねる */
  function FileButton({onSelect}:{onSelect:(f:File)=>void}){
    const ref=useRef<HTMLInputElement>(null)
    return(
      <>
        <button disabled={!canEdit}
          className={`px-3 py-1 bg-gray-200 rounded w-full text-sm ${canEdit?'':'opacity-50 cursor-not-allowed'}`}
          onClick={()=>ref.current?.click()}>
          画像を選択
        </button>
        <input ref={ref} type="file" accept="image/*" className="hidden"
          onChange={e=>{
            const f=e.target.files?.[0]
            if(!f) return
            /* 200KB 超は縮小 */
            const handle = async () => {
              const file = f.size>200*1024 ? await resizeImage(f) : f
              onSelect(new File([file],f.name,{type:file.type,lastModified:Date.now()}))
            }
            handle().catch(console.error)
          }}/>
      </>
    )
  }

  /* ---------- JSX ---------- */
  return(
    <>
      {/* プレビュー */}
      {preview&&(
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[1000]">
          <img src={preview} alt="" className="max-h-[80vh] max-w-[90vw]" />
          <button className="absolute top-4 right-4 text-white text-3xl" onClick={()=>setPreview(null)}>
            <IoClose/>
          </button>
        </div>
      )}

      {/* Toast */}
      <Toast message={toast} onDone={()=>setToast('')}/>

      {/* 現在地ピン */}
      {canEdit&&(
        <button className="fixed bottom-16 right-4 z-[1000] bg-green-600 hover:bg-green-700 text-white w-16 h-16 text-3xl rounded-full shadow-lg flex items-center justify-center"
          title="現在地にピンを追加" onClick={addCurrent}>📌</button>
      )}

      {/* Center */}
      <button className="fixed bottom-4 right-4 z-[1000] bg-white p-2 rounded shadow"
        onClick={()=>{
          navigator.geolocation.getCurrentPosition(
            pos=>mapRef.current?.flyTo([pos.coords.latitude,pos.coords.longitude],15),
            ()=>alert('位置情報取得失敗'))
        }}>📍 Center</button>

      <MapContainer
        ref={mapRef}
        center={[36.07,140.11]}
        zoom={13}
        className="h-screen"
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
        {canEdit&&<ClickHandler/>}

        {notes.map(n=>(
          <Marker key={n.id} position={[n.lat,n.lng]}>
            <Popup ref={p=>{if(p) popupRefs.current[n.id]=p}}
              minWidth={260} maxWidth={320} autoClose={false} closeOnClick={false}
              className="max-w-[90vw] sm:max-w-[320px]">
              {n.images.length>0&&<Carousel noteId={n.id} imgs={n.images}/>}

              <textarea defaultValue={n.text}
                placeholder={canEdit?'説明を入力':'閲覧モードでは編集不可'}
                className={`w-full border p-1 text-sm mb-2 ${canEdit?'':'bg-gray-100'}`}
                readOnly={!canEdit}
                onBlur={e=>n.text=e.target.value}/>

              {canEdit?(
                <>
                  <FileButton onSelect={f=>saveNote(n,f,()=>popupRefs.current[n.id]?.close())}/>
                  <button disabled={!canEdit}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded w-full mt-2"
                    onClick={()=>saveNote(n,undefined,()=>popupRefs.current[n.id]?.close())}>
                    保存して閉じる
                  </button>
                </>
              ):(
                <button className="px-3 py-1 bg-gray-400 text-white text-sm rounded w-full mt-2"
                  onClick={()=>popupRefs.current[n.id]?.close()}>
                  閉じる
                </button>
              )}

              {canEdit&&(
                <button className="mt-2 w-full flex items-center justify-center gap-1 text-sm text-red-600"
                  onClick={()=>deleteNote(n.id)}>
                  <IoTrashOutline/> ノート削除
                </button>
              )}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </>
  )
}
