import { NextResponse } from 'next/server'
import { fetchAllTrips, fetchAllTripItems } from '@/lib/notion'
import { geocodeVenue } from '@/lib/geocode'

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

    // Geocode all items that have a venue or city (in parallel batches)
    const BATCH_SIZE = 5
    const geocoded = [...items]

    for (let i = 0; i < geocoded.length; i += BATCH_SIZE) {
      const batch = geocoded.slice(i, i + BATCH_SIZE)
      await Promise.all(
        batch.map(async (item, j) => {
          const coords = await geocodeVenue(item.venue, item.legCity)
            ?? (item.name !== item.venue ? await geocodeVenue(item.name, item.legCity) : null)
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
