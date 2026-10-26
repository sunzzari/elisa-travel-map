import { NextResponse } from 'next/server'
import { searchPlaces, type SearchablePlace } from '@/lib/place-search'

/**
 * Around Town search for the Sunzzari app: `?q=jian bing in rowland heights`.
 *
 * Answers with the ids of the matching saved places, best first, plus what the
 * question asked for that only the phone can settle: "near me" (her location
 * never comes here) and the been / want / rated words (the phone's own copy of
 * those ticks is newer than this one).
 *
 * `&world=1` searches Elisa's Map, every area. With `&area=la` it also answers
 * `elsewhere`: how many matches are outside that area, which is what the
 * "Search everywhere" button counts. Elisa, 2026-10-25: "it should be harder
 * to expalnd my search but it should be possible".
 *
 * The rule itself is `lib/place-search.ts`, the same code the website's search
 * box runs. No Claude call, no paid lookup, no Notion read per search: it
 * searches the cached `/api/around-town`, which every save refreshes.
 */
export const dynamic = 'force-dynamic'

interface CachedPlace extends Omit<SearchablePlace, 'branchAddresses'> {
  branches: Array<{ address: string }>
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200)
  if (!q) return NextResponse.json({ error: 'Type something to search for.' }, { status: 400 })
  const world = url.searchParams.get('world') === '1'
  const area = url.searchParams.get('area')

  let places: CachedPlace[]
  try {
    // The world answer sits behind the site password (proxy.ts); this route
    // is a server, so it passes the password itself. The target is this
    // deployment's own fixed address, never one taken from the request's Host
    // header, so the password can only ever go to us.
    const self = process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : `http://localhost:${process.env.PORT ?? 3000}`
    const response = await fetch(new URL(world ? '/api/around-town/world' : '/api/around-town', world ? self : url.origin), {
      cache: 'no-store',
      headers: world ? { 'x-edit-passcode': process.env.AROUND_TOWN_PASSCODE ?? '' } : undefined,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    places = (await response.json()).places
  } catch (err) {
    console.error('Around Town search could not read the places:', err)
    return NextResponse.json({ error: 'Could not read the saved places. Try again.' }, { status: 502 })
  }

  const result = searchPlaces(
    q,
    places.map(p => ({ ...p, branchAddresses: p.branches.map(b => b.address) })),
    { applyStatus: false }
  )
  if (!world || !area) return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  const regionOf = new Map(places.map(p => [p.id, p.region]))
  const elsewhere = result.ids.filter(id => regionOf.get(id) !== area).length
  return NextResponse.json({ ...result, elsewhere }, { headers: { 'Cache-Control': 'no-store' } })
}
