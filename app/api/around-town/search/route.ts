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

  let places: CachedPlace[]
  try {
    const response = await fetch(new URL('/api/around-town', url.origin), { cache: 'no-store' })
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
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
