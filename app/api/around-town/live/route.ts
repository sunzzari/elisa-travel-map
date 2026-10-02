import { NextResponse } from 'next/server'
import { refuseWithoutPasscode } from '@/lib/edit-auth'
import { aroundTownPlaces } from '@/lib/aroundtown'

/**
 * Around Town read straight from Notion on every request, for the Sunzzari app.
 *
 * The phone saves "Want to Try", "Been There" and reviews to Notion itself, so
 * it has to read back what it just wrote. The cached /api/around-town cannot
 * promise that: seen 2026-10-02 serving an answer 64 minutes old, which would
 * have made a saved review look unsaved on the next open.
 *
 * Every request here costs Notion reads, so it is not public: the same proof
 * as the edit routes (lib/edit-auth.ts). The phone paints its disk copy first,
 * so the few seconds this takes are not a blank screen.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const refused = await refuseWithoutPasscode(request)
  if (refused) return refused
  return NextResponse.json(await aroundTownPlaces(), { headers: { 'Cache-Control': 'no-store' } })
}
