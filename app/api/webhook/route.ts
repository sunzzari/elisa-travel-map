import { NextResponse } from 'next/server'

/**
 * Notion page-event receiver.
 *
 * It used to fire `POST /api/sync` on ANY `page.*` event, and sync geocodes
 * every trip item in the workspace - 668 of them. The endpoint is public, the
 * database check below was computed and then never applied, and the cache it
 * relied on was dead, so a single Notion edit (or a single stranger with curl)
 * cost roughly $20 of Google Geocoding. That fan-out is gone: 2026-09-08.
 *
 * Nothing needs it now. Coordinates live in `data/geocache.json`, and the
 * itinerary pages revalidate from Notion every 60 seconds on their own, so a
 * Notion edit still reaches the map without anyone paying per edit for it.
 *
 * The verification-challenge branch stays, because that is how Notion proves a
 * webhook URL belongs to you, and re-verification is otherwise a code change.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()

    if (body.verification_token) {
      console.log('NOTION_VERIFY_TOKEN:', body.verification_token)
      return NextResponse.json({ verification_token: body.verification_token })
    }

    // Acknowledged and dropped. Pages pick the change up on their next
    // revalidation; no work is triggered from an unauthenticated request.
    return NextResponse.json({ ok: true, acknowledged: true })
  } catch (err) {
    console.error('Webhook error:', err)
    return NextResponse.json({ error: 'Webhook failed' }, { status: 500 })
  }
}
