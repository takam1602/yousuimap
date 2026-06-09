import { NextRequest, NextResponse } from 'next/server'
import { requireEditor } from '@/lib/serverSupabase'

type ParsedPlace = {
  lat: number
  lng: number
  name: string | null
  address?: string | null
  resolvedUrl: string
}

type ParsedGoogleMapLink = {
  listName: string | null
  places: ParsedPlace[]
  resolvedUrl: string
}

function validCoordinate(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
}

function pickCoordinate(source: string) {
  const decoded = decodeURIComponent(source)
  const patterns = [
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:[,/?]|$)/,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /[?&](?:ll|q)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:[&]|$)/,
  ]

  for (const pattern of patterns) {
    const match = decoded.match(pattern)
    if (!match) continue
    const lat = Number(match[1])
    const lng = Number(match[2])
    if (validCoordinate(lat, lng)) return { lat, lng }
  }

  return null
}

function cleanupName(name: string | null) {
  if (!name) return null
  const cleaned = name
    .replace(/\s+-\s+Google\s+Maps\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || null
}

function pickNameFromUrl(url: string) {
  try {
    const parsed = new URL(url)
    const place = parsed.pathname.match(/\/maps\/place\/([^/@?]+)/)
    if (!place) return null
    return cleanupName(decodeURIComponent(place[1]).replace(/\+/g, ' '))
  } catch {
    return null
  }
}

function pickNameFromHtml(html: string) {
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
  if (ogTitle) return cleanupName(ogTitle[1])

  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  if (title) return cleanupName(title[1])

  return null
}

function htmlDecode(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function extractGetListUrl(html: string) {
  const match = html.match(/href=["']([^"']*\/maps\/preview\/entitylist\/getlist[^"']+)["']/i)
  if (!match) return null
  return new URL(htmlDecode(match[1]), 'https://www.google.com').toString()
}

function stripGoogleJsonPrefix(text: string) {
  if (!text.startsWith(")]}'")) return text
  const newline = text.indexOf('\n')
  return newline >= 0 ? text.slice(newline + 1) : text.slice(4)
}

function itemText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function extractListName(payload: unknown) {
  let found: string | null = null

  function visit(value: unknown) {
    if (found || !Array.isArray(value)) return
    if (typeof value[4] === 'string' && Array.isArray(value[8])) {
      found = cleanupName(value[4])
      return
    }
    for (const child of value) visit(child)
  }

  visit(payload)
  return found
}

function extractPlacesFromListPayload(payload: unknown, resolvedUrl: string) {
  const places: ParsedPlace[] = []
  const seen = new Set<string>()

  function visit(value: unknown) {
    if (!Array.isArray(value)) return

    const details = value[1]
    const coordinate = Array.isArray(details) && Array.isArray(details[5]) ? details[5] : null
    const lat = Number(coordinate?.[2])
    const lng = Number(coordinate?.[3])

    if (validCoordinate(lat, lng)) {
      const rawName = itemText(value[2])
      const memo = Array.isArray(details) ? itemText(details[2]) : null
      const address = Array.isArray(details) ? itemText(details[4]) : null
      const name = rawName && rawName !== 'Dropped pin'
        ? rawName
        : memo ?? address ?? rawName ?? 'Google Maps saved place'
      const key = `${lat.toFixed(7)},${lng.toFixed(7)},${name}`

      if (!seen.has(key)) {
        seen.add(key)
        places.push({ lat, lng, name, address, resolvedUrl })
      }
    }

    for (const child of value) visit(child)
  }

  visit(payload)
  return places
}

async function fetchText(url: string) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; YousuiMapImporter/1.0)',
      accept: 'text/html,application/xhtml+xml,application/json',
    },
  })

  if (!res.ok) throw new Error(`Google Maps からデータを取得できませんでした (${res.status})`)
  return { text: await res.text(), resolvedUrl: res.url || url }
}

async function parseGoogleMapUrl(rawUrl: string): Promise<ParsedGoogleMapLink> {
  let input: URL
  try {
    input = new URL(rawUrl.trim())
  } catch {
    throw new Error('URLとして読み取れません')
  }

  const allowedHosts = ['maps.app.goo.gl', 'goo.gl', 'www.google.com', 'google.com', 'maps.google.com']
  if (!allowedHosts.some((host) => input.hostname === host || input.hostname.endsWith(`.${host}`))) {
    throw new Error('Google Maps のリンクを貼り付けてください')
  }

  const directCoordinate = pickCoordinate(input.toString())
  const directName = pickNameFromUrl(input.toString())
  if (directCoordinate) {
    return {
      listName: null,
      places: [{ ...directCoordinate, name: directName, resolvedUrl: input.toString() }],
      resolvedUrl: input.toString(),
    }
  }

  const page = await fetchText(input.toString())
  const urlCoordinate = pickCoordinate(page.resolvedUrl)
  const urlName = pickNameFromUrl(page.resolvedUrl) ?? directName
  if (urlCoordinate) {
    return {
      listName: null,
      places: [{ ...urlCoordinate, name: urlName, resolvedUrl: page.resolvedUrl }],
      resolvedUrl: page.resolvedUrl,
    }
  }

  const getListUrl = extractGetListUrl(page.text)
  if (getListUrl) {
    const list = await fetchText(getListUrl)
    const payload = JSON.parse(stripGoogleJsonPrefix(list.text))
    const places = extractPlacesFromListPayload(payload, page.resolvedUrl)
    const listName = extractListName(payload)

    if (places.length > 0) {
      return { listName, places, resolvedUrl: page.resolvedUrl }
    }
  }

  const htmlCoordinate = pickCoordinate(page.text)
  if (htmlCoordinate) {
    return {
      listName: null,
      places: [{
        ...htmlCoordinate,
        name: urlName ?? pickNameFromHtml(page.text),
        resolvedUrl: page.resolvedUrl,
      }],
      resolvedUrl: page.resolvedUrl,
    }
  }

  throw new Error('このリンクから緯度・経度を抽出できませんでした。リストが非公開、または Google 側の形式が変わった可能性があります。')
}

export async function POST(req: NextRequest) {
  const auth = await requireEditor(req)
  if ('error' in auth) return auth.error

  const { url } = await req.json()
  if (typeof url !== 'string' || !url.trim()) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 })
  }

  try {
    const result = await parseGoogleMapUrl(url)
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to parse Google Maps link' },
      { status: 422 },
    )
  }
}
