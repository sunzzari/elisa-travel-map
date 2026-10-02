import { NextResponse } from 'next/server'
import { aroundTownPlaces } from '@/lib/aroundtown'

/**
 * Around Town for the Sunzzari app: the same places, pins, branches, colours
 * and areas the /around-town page draws, computed by the same code.
 *
 * This copy is public and cached: refreshed at most every 5 minutes, and
 * immediately after any save through /api/places. A cached copy can be much
 * older than 5 minutes when nobody has asked for a while (the first request
 * after a quiet spell is handed the old answer), so the app reads
 * /api/around-town/live and only falls back to this one.
 */
export const revalidate = 300

export async function GET() {
  return NextResponse.json(await aroundTownPlaces())
}
