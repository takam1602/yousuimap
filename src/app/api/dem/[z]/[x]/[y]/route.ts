import { NextRequest, NextResponse } from 'next/server'

function parseTileParam(value: string) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ z: string; x: string; y: string }> }
) {
  const { z, x, y } = await params
  const zoom = parseTileParam(z)
  const tileX = parseTileParam(x)
  const tileY = parseTileParam(y)

  if (zoom === null || tileX === null || tileY === null || zoom < 5 || zoom > 15) {
    return NextResponse.json({ error: 'Invalid DEM tile' }, { status: 400 })
  }

  const url = `https://cyberjapandata.gsi.go.jp/xyz/dem/${zoom}/${tileX}/${tileY}.txt`
  const response = await fetch(url, { next: { revalidate: 60 * 60 * 24 * 7 } })

  if (!response.ok) {
    return NextResponse.json({ error: 'DEM tile not found' }, { status: response.status })
  }

  return new NextResponse(await response.text(), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=86400, stale-while-revalidate=604800',
    },
  })
}
