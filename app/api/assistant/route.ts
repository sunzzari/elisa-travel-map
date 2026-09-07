import { fetchAllTrips, fetchTripItems } from '@/lib/notion'
import { NextResponse } from 'next/server'
import type { TripItem } from '@/lib/types'

// Ask-about-this-trip, answered from the trip's OWN items.
//
// Routes through sunzzari-backend's /api/analyze rather than calling Anthropic
// directly. Elisa: "use the same anthropic key as the wine search function" -
// and that key lives on the backend, not in the iOS app, which calls the same
// proxy. So the key stays in exactly one place and rotating it is one change.
// This route holds only the shared proxy secret.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PROXY = 'https://sunzzari-backend.vercel.app/api/analyze'
const MODEL = 'claude-sonnet-5'

/** Compact per-item line. Keeps the prompt small and the ids exact. */
function itemLine(i: TripItem): string {
  return [
    `id=${i.id}`,
    i.name,
    i.type ?? 'Other',
    i.status ?? 'no status',
    i.legCity && `area: ${i.legCity}`,
    (i.assignedToDate ?? i.date) && `date: ${(i.assignedToDate ?? i.date)!.slice(0, 10)}`,
    i.timeText && `time: ${i.timeText}`,
    i.address && `addr: ${i.address}`,
    i.notes && `notes: ${i.notes.slice(0, 300)}`,
  ].filter(Boolean).join(' | ')
}

const SYSTEM = `You are helping Elisa use a trip she has already planned, while
she is on it. Speak TO her, as "you" and "your list", never about her.

Answer ONLY from the trip items given to you. These are her own saved places.
Never invent a restaurant, bar, hotel or activity that is not in the list, and
never recommend somewhere from general knowledge - if nothing in the list fits,
say so plainly and say what is closest.

She is usually asking a practical question with a short answer: where to eat
near a neighbourhood, what is already booked, what is near something else on the
list. Lead with the answer. Two or three sentences. Plain text, no markdown.

Status vocabulary, use it precisely and do not upgrade anything:
- Confirmed = actually booked
- Reservation Pending = she wants it, not booked yet
- Assigned = planned for a day, no booking needed
- Shortlisted / Researching = a candidate she has NOT committed to

Return STRICT JSON only, no prose outside it, no code fences:
{"answer": "<your reply>", "matchedItemIds": ["<ids you referred to>"]}
matchedItemIds must be ids copied exactly from the list, and only ones you
actually mention. Use [] if none apply.`

export async function POST(request: Request) {
  const secret = process.env.SUNZZARI_PROXY_SECRET
  if (!secret) {
    // Fail loud rather than returning a vague error: this is a config problem,
    // not a question the model could not answer.
    return NextResponse.json(
      { error: 'SUNZZARI_PROXY_SECRET is not set on this deployment.' },
      { status: 500 }
    )
  }

  let question: string
  let tripId: string
  try {
    const body = await request.json()
    question = String(body.question ?? '').trim()
    tripId = String(body.tripId ?? '')
  } catch {
    return NextResponse.json({ error: 'Bad request body.' }, { status: 400 })
  }
  if (!question) return NextResponse.json({ error: 'Ask a question first.' }, { status: 400 })
  if (!tripId) return NextResponse.json({ error: 'No trip.' }, { status: 400 })

  const trips = await fetchAllTrips()
  const trip = trips.find(t => t.id.replace(/-/g, '') === tripId.replace(/-/g, ''))
  if (!trip) return NextResponse.json({ error: 'Trip not found.' }, { status: 404 })

  const items = (await fetchTripItems(trip.id)).filter(i => i.status !== 'Cancelled')
  if (items.length === 0) {
    return NextResponse.json({ answer: 'This trip has no items yet.', matchedItemIds: [] })
  }

  const userContent = [
    `Trip: ${trip.name}${trip.location ? ` (${trip.location})` : ''}`,
    `Today on this trip: ${new Intl.DateTimeFormat('en-CA', {
      timeZone: trip.timeZone || undefined,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date())}`,
    '',
    'Her items:',
    ...items.map(itemLine),
    '',
    `Her question: ${question}`,
  ].join('\n')

  let proxyResponse: Response
  try {
    proxyResponse = await fetch(PROXY, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sunzzari-secret': secret },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        system: SYSTEM,
        // No assistant prefill here: this model returns thinking blocks, and
        // prefilling alongside them produced an empty response. Format
        // compliance is handled after the fact instead, by name matching.
        messages: [{ role: 'user', content: userContent }],
      }),
      signal: AbortSignal.timeout(30000),
    })
  } catch {
    return NextResponse.json({ error: 'Could not reach the assistant. Try again.' }, { status: 502 })
  }

  const raw = await proxyResponse.json().catch(() => null)
  if (!proxyResponse.ok) {
    // Surface the upstream status: a 401 here means the proxy secret is wrong,
    // which is a very different fix from a model error.
    const detail = raw?.error?.message ?? raw?.error ?? `HTTP ${proxyResponse.status}`
    return NextResponse.json({ error: `Assistant failed: ${detail}` }, { status: 502 })
  }

  // Take the first TEXT block, not content[0]. The model returns a thinking
  // block first, so indexing 0 silently yielded an empty string and the route
  // answered "No answer came back" on a perfectly good response.
  const text: string = (raw?.content ?? [])
    .filter((b: { type?: string }) => b?.type === 'text')
    .map((b: { text?: string }) => b.text ?? '')
    .join('\n')
    .trim()

  const parsed = safeParse(text)
  const known = new Set(items.map(i => i.id))

  // Prose instead of JSON is a real outcome, not an error: the model complies
  // most of the time and not always. Show its words either way, and never let
  // the map filtering depend on the model getting the format right.
  const answer = parsed ? String(parsed.answer ?? '') : (text || 'No answer came back.')

  // Only ids that actually exist, so a hallucinated one cannot reach the map.
  let matchedItemIds: string[] = (parsed?.matchedItemIds ?? []).filter((id: string) => known.has(id))

  // Deterministic fallback: find the items the answer actually names. This is
  // what makes the map filter reliably rather than intermittently.
  if (matchedItemIds.length === 0) matchedItemIds = idsNamedIn(answer, items)

  return NextResponse.json({ answer, matchedItemIds })
}

/**
 * Items whose name appears in the answer text.
 *
 * Longest names first, so "Cafe Sperl" is preferred over a shorter name that
 * happens to be a substring of it. Short names are skipped entirely: matching
 * on something like "Demel" is fine, but a two-character name would match
 * everywhere.
 */
function idsNamedIn(answer: string, items: TripItem[]): string[] {
  const haystack = answer.toLowerCase()
  return [...items]
    .filter(i => i.name.trim().length >= 5)
    .sort((a, b) => b.name.length - a.name.length)
    .filter(i => haystack.includes(i.name.toLowerCase().trim()))
    .slice(0, 8)
    .map(i => i.id)
}

/** Models sometimes wrap JSON in fences despite instructions. */
function safeParse(text: string): { answer?: string; matchedItemIds?: string[] } | null {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) return null
    try { return JSON.parse(match[0]) } catch { return null }
  }
}
