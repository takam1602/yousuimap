export type WaterwayMapConfig = {
  slug: string
  title: string
  shortTitle: string
  description: string
  area: string
  center: [number, number]
  zoom: number
}

export const DEFAULT_MAP_SLUG = 'tsuchiura-yosui'

export const waterwayMaps: WaterwayMapConfig[] = [
  {
    slug: 'tsuchiura-yosui',
    title: '土浦用水',
    shortTitle: '土浦用水',
    description: '土浦用水と周辺施設・分水・水路跡を記録するマップです。',
    area: '茨城県 土浦・つくば周辺',
    center: [36.07, 140.11],
    zoom: 13,
  },
  {
    slug: 'kasumigaura-yosui',
    title: '霞ヶ浦用水',
    shortTitle: '霞ヶ浦用水',
    description: '霞ヶ浦用水に関する地点を記録するマップです。',
    area: '茨城県 霞ヶ浦用水地域',
    center: [36.12, 140.05],
    zoom: 11,
  },
  {
    slug: 'minuma-daiyosui',
    title: '見沼代用水',
    shortTitle: '見沼代用水',
    description: '見沼代用水の水路・分水・関連地点を記録するマップです。',
    area: '埼玉県 見沼代用水流域',
    center: [35.91, 139.66],
    zoom: 11,
  },
  {
    slug: 'ishioka-daichi-yosui',
    title: '石岡台地用水',
    shortTitle: '石岡台地用水',
    description: '石岡台地用水に関する地点を記録するマップです。',
    area: '茨城県 石岡台地周辺',
    center: [36.20, 140.25],
    zoom: 11,
  },
]

export function getWaterwayMap(slug: string) {
  return waterwayMaps.find((map) => map.slug === slug) ?? null
}

export function isWaterwayMapSlug(slug: string) {
  return waterwayMaps.some((map) => map.slug === slug)
}
