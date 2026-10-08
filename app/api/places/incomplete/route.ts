import { NextResponse } from 'next/server'
import { refuseWithoutPasscode } from '@/lib/edit-auth'
import { incompleteRestaurants } from '@/lib/places-write'

export const dynamic = 'force-dynamic'

/**
 * Restaurant Guide rows that are missing a Location, an Address or a pin, or
 * are waiting on Elisa's review (`To Verify`). One answer for the weekly check,
 * the fix skill, the Sunzzari session hook and the phone. Writes nothing.
 *
 *   GET /api/places/incomplete
 *   -> { missing: 3, toVerify: 12, rows: [{ id, name, location, missing: ["pin"], toVerify, ... }] }
 */
export async function GET(request: Request) {
  const refused = await refuseWithoutPasscode(request)
  if (refused) return refused
  try {
    const rows = await incompleteRestaurants()
    return NextResponse.json({
      missing: rows.filter(r => r.missing.length > 0).length,
      toVerify: rows.filter(r => r.toVerify).length,
      rows,
    })
  } catch (err) {
    console.error('Incomplete restaurants read failed:', err)
    return NextResponse.json({ error: 'Notion could not be read' }, { status: 502 })
  }
}
