import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

/**
 * Editing Around Town writes to Notion from a public site, so every write and
 * lookup needs a secret. Viewing stays open.
 *
 * Two ways in, one set of routes (so the phone and the website run the same
 * code):
 *   - the website sends `x-edit-passcode` = AROUND_TOWN_PASSCODE, typed once
 *     per browser;
 *   - the phone sends `x-app-secret` = PHONE_APP_SECRET, the secret it already
 *     carries (`Secrets.Push.secret`), so the app needs no new key.
 *
 * Returns a response to send back when the request is refused, or null when
 * one of the two matches. A secret that is not configured never matches.
 */
function matches(given: string | null, expected: string | undefined): boolean {
  if (!expected || !given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function refuseWithoutPasscode(request: Request): NextResponse | null {
  const passcode = process.env.AROUND_TOWN_PASSCODE
  const appSecret = process.env.PHONE_APP_SECRET
  if (!passcode && !appSecret) {
    return NextResponse.json(
      { error: 'Editing is not set up: AROUND_TOWN_PASSCODE is missing on this deployment.' },
      { status: 503 }
    )
  }
  if (matches(request.headers.get('x-edit-passcode'), passcode)) return null
  if (matches(request.headers.get('x-app-secret'), appSecret)) return null
  return NextResponse.json({ error: 'Wrong passcode.' }, { status: 401 })
}
