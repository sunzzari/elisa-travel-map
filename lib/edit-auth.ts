import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

/**
 * Editing Around Town writes to Notion from a public site, so every write and
 * lookup has to prove who is asking. Viewing stays open.
 *
 * Two ways in, one set of routes (so the phone and the website run the same
 * code):
 *   - the website sends `x-edit-passcode` = AROUND_TOWN_PASSCODE, typed once
 *     per browser;
 *   - the Sunzzari app sends `x-notion-token`, the Notion key it already
 *     carries. It is accepted only if Notion itself says that key can open the
 *     Restaurant Guide, and it needs no extra secret set up anywhere. Approved
 *     by Elisa, 2026-10-01: "use the notion key".
 *
 * A key that can READ the table must not gain the power to WRITE it by coming
 * through here. So a save from the app is performed with the APP'S OWN key
 * (`Caller.token`, see lib/places-write.ts `notionFor`), never the server's:
 * Notion then enforces exactly what that key may do, on every save, and a
 * read-only key gets Notion's own refusal. The readable-table check below only
 * gates the free lookup and saves a doomed request.
 *
 * The app's key lives for one request: never logged, never stored. Only a hash
 * of it is remembered, for ten minutes, so each lookup is not two Notion calls.
 */

/** Who is asking, once they have proved it. */
export type Caller = { via: 'passcode' } | { via: 'notion'; token: string }

const RESTAURANT_GUIDE_DB = '9078462d-842a-4233-82d9-dbd07014782b'
const REMEMBER_MS = 10 * 60 * 1000
const checked = new Map<string, { ok: boolean; at: number }>()

function sameSecret(given: string | null, expected: string | undefined): boolean {
  if (!expected || !given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function notionKeyOpensOurTable(token: string): Promise<boolean> {
  // Shape first, so junk never becomes a request to Notion.
  if (!/^(secret_|ntn_)[A-Za-z0-9_]{30,200}$/.test(token)) return false
  const key = createHash('sha256').update(token).digest('hex')
  const seen = checked.get(key)
  if (seen && Date.now() - seen.at < REMEMBER_MS) return seen.ok
  let ok = false
  try {
    const res = await fetch(`https://api.notion.com/v1/databases/${RESTAURANT_GUIDE_DB}`, {
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28' },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    })
    ok = res.ok
    // A refusal is remembered too; a network failure is not an answer.
    if (res.ok || res.status === 401 || res.status === 403 || res.status === 404) {
      if (checked.size > 500) checked.clear()
      checked.set(key, { ok, at: Date.now() })
    }
  } catch {
    ok = false
  }
  return ok
}

/** The caller, or the response to send back when the request is refused. */
export async function authorize(request: Request): Promise<{ caller: Caller } | { refused: NextResponse }> {
  const passcode = process.env.AROUND_TOWN_PASSCODE
  if (sameSecret(request.headers.get('x-edit-passcode'), passcode)) return { caller: { via: 'passcode' } }

  const notionToken = request.headers.get('x-notion-token')
  if (notionToken && (await notionKeyOpensOurTable(notionToken))) {
    return { caller: { via: 'notion', token: notionToken } }
  }

  if (!passcode && !notionToken) {
    return {
      refused: NextResponse.json(
        { error: 'Editing is not set up: AROUND_TOWN_PASSCODE is missing on this deployment.' },
        { status: 503 }
      ),
    }
  }
  return { refused: NextResponse.json({ error: 'Wrong passcode.' }, { status: 401 }) }
}

/** For routes that write nothing (lookup, passcode check): refused response, or null. */
export async function refuseWithoutPasscode(request: Request): Promise<NextResponse | null> {
  const result = await authorize(request)
  return 'refused' in result ? result.refused : null
}
