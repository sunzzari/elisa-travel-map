import { NextResponse } from 'next/server'
import { refuseWithoutPasscode } from '@/lib/edit-auth'
import { areaFor, lookupPlace } from '@/lib/place-lookup'

/**
 * Candidate places for Elisa to pick from before saving, for the website and
 * the phone alike. Free sources only (lib/place-lookup.ts); nothing is written
 * here. Gated like the writes, because it only exists to feed them.
 *
 *   GET /api/places/lookup?q=Bestia&kind=restaurant&neighborhood=Arts%20District&location=LA
 */
export async function GET(request: Request) {
  const refused = await refuseWithoutPasscode(request)
  if (refused) return refused

  const params = new URL(request.url).searchParams
  const q = (params.get('q') ?? '').trim().slice(0, 200)
  const kind = params.get('kind') === 'activity' ? 'activity' : 'restaurant'
  const neighborhood = (params.get('neighborhood') ?? '').trim().slice(0, 200)
  const location = (params.get('location') ?? '').trim().slice(0, 200)
  if (!q) return NextResponse.json({ error: 'q required' }, { status: 400 })

  const area = await areaFor(kind, neighborhood, location)
  if (!area) {
    return NextResponse.json({
      matches: [],
      note: 'Map pins cover Los Angeles and the Bay Area. Set Location to one of those, or save without a pin.',
    })
  }
  const matches = await lookupPlace(q, area)
  return NextResponse.json({ matches })
}
