import { NextResponse } from 'next/server'
import { aroundTownPlaces } from '@/lib/aroundtown'

/**
 * Elisa's Map for the Sunzzari app: every area, LA and the Bay plus each travel
 * area, with the `areas` list the area menu is built from. The same answer as
 * /api/around-town otherwise, cached the same way and refreshed on every save.
 *
 * Its own route rather than a query flag, so the cached answer stays cached and
 * phones on an older build, which read /api/around-town, see no change.
 */
export const revalidate = 300

export async function GET() {
  return NextResponse.json(await aroundTownPlaces({ world: true }))
}
