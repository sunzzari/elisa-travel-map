import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

/**
 * Editing Around Town writes to Notion from a public site, so every write and
 * every paid lookup needs the passcode. Viewing stays open.
 *
 * Returns a response to send back when the request is refused, or null when
 * the passcode matches.
 */
export function refuseWithoutPasscode(request: Request): NextResponse | null {
  const expected = process.env.AROUND_TOWN_PASSCODE
  if (!expected) {
    return NextResponse.json(
      { error: 'Editing is not set up: AROUND_TOWN_PASSCODE is missing on this deployment.' },
      { status: 503 }
    )
  }
  const given = Buffer.from(request.headers.get('x-edit-passcode') ?? '')
  const want = Buffer.from(expected)
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return NextResponse.json({ error: 'Wrong passcode.' }, { status: 401 })
  }
  return null
}
