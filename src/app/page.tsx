import Link from 'next/link'
import { IoCubeOutline, IoMapOutline, IoOpenOutline, IoStatsChartOutline } from 'react-icons/io5'
import { waterwayMaps } from '@/lib/waterwayMaps'

export default function Home() {
  return (
    <div className="min-h-[calc(100vh-96px)] bg-slate-50 text-gray-900">
      <section className="border-b bg-white">
        <div className="mx-auto max-w-5xl px-4 py-8">
          <h2 className="text-2xl font-bold sm:text-3xl">用水路のピン</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
            閲覧したい用水路を選択してください。ピンをクリックすると、写真やメモを閲覧できます。追加は管理者のみです。
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-3 px-4 py-6">
        <Link
          href="/terrain/tsuchiura-yosui"
          className="group rounded border bg-white p-4 shadow-sm transition hover:border-teal-500 hover:shadow-md"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 gap-3">
              <span className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded bg-teal-50 text-xl text-teal-700">
                <IoCubeOutline />
              </span>
              <div className="min-w-0">
                <h3 className="text-lg font-semibold">土浦用水 3D地形・標高断面</h3>
                <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                  <IoStatsChartOutline />
                  DEM試作
                </p>
              </div>
            </div>
            <IoOpenOutline className="mt-1 shrink-0 text-gray-400 transition group-hover:text-teal-700" />
          </div>
          <p className="mt-3 text-sm leading-6 text-gray-600">
            保存済みピンを3D地形に重ね、複数地点を結ぶ測線の標高断面を確認できます。
          </p>
        </Link>
      </section>

      <section className="mx-auto grid max-w-5xl gap-3 px-4 pb-6 sm:grid-cols-2">
        {waterwayMaps.map((map) => (
          <Link
            key={map.slug}
            href={`/maps/${map.slug}`}
            className="group rounded border bg-white p-4 shadow-sm transition hover:border-blue-400 hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 gap-3">
                <span className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded bg-blue-50 text-xl text-blue-700">
                  <IoMapOutline />
                </span>
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold">{map.title}</h3>
                  <p className="mt-1 text-xs text-gray-500">{map.area}</p>
                </div>
              </div>
              <IoOpenOutline className="mt-1 shrink-0 text-gray-400 transition group-hover:text-blue-600" />
            </div>
            <p className="mt-3 text-sm leading-6 text-gray-600">{map.description}</p>
          </Link>
        ))}
      </section>
    </div>
  )
}
