import { NextResponse } from 'next/server'
import { fetchAllTrips, fetchAllTripItems } from '@/lib/notion'
import { geocodeItem } from '@/lib/geocode'

export const maxDuration = 60

export async function POST(request: Request) {
  // Verify sync secret to prevent unauthorized calls
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.SYNC_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const [trips, items] = await Promise.all([
      fetchAllTrips(),
      fetchAllTripItems(),
    ])

    // Geocode all items that have a venue or city (in parallel batches).
    // Each item is anchored to its own trip's location so a blank leg cannot
    // send a venue name to the wrong country.
    const locationByTripUrl = new Map(trips.map(t => [t.url, t.location]))
    const BATCH_SIZE = 5
    const geocoded = [...items]

    for (let i = 0; i < geocoded.length; i += BATCH_SIZE) {
      const batch = geocoded.slice(i, i + BATCH_SIZE)
      await Promise.all(
        batch.map(async (item, j) => {
          const coords = await geocodeItem(item, locationByTripUrl.get(item.tripUrl) ?? '')
          if (coords) geocoded[i + j].coordinates = coords
        })
      )
    }

    return NextResponse.json({
      ok: true,
      trips: trips.length,
      items: geocoded.length,
      geocoded: geocoded.filter(i => i.coordinates).length,
    })
  } catch (err) {
    console.error('Sync error:', err)
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 })
  }
}

// Allow GET for easy manual triggering in browser (dev only)
export async function GET() {
  return NextResponse.json({ message: 'POST to this endpoint to sync' })
}
