import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { authorize } from '@/lib/edit-auth'
import { notionFor } from '@/lib/places-write'
import { todayInZone } from '@/lib/day'
import { applyStatusChange, parseStatusChange, tripItemPage, StatusInputError } from '@/lib/trip-item-write'

/** Change a Trip Item's status from the Plan tab. Same passcode as Around Town. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(request)
  if ('refused' in auth) return auth.refused
  const notion = notionFor(auth.caller)

  const { id } = await params
  let change
  try {
    change = parseStatusChange(await request.json())
  } catch (err) {
    const message = err instanceof StatusInputError ? err.message : 'Bad request body'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const target = await tripItemPage(notion, id)
  if (!target) return NextResponse.json({ error: 'Not a trip item' }, { status: 404 })

  let trip: { departureDate: string | null; returnDate: string | null } | null = null
  let timeZone = ''
  if (target.tripId) {
    try {
      const page: any = await notion.pages.retrieve({ page_id: target.tripId })
      trip = {
        departureDate: page.properties?.['Departure Date']?.date?.start ?? null,
        returnDate: page.properties?.['Return Date']?.date?.start ?? null,
      }
      timeZone = (page.properties?.['Time Zone']?.rich_text ?? []).map((t: any) => t.plain_text).join('')
    } catch (err) {
      console.error('Trip lookup failed:', err)
      return NextResponse.json({ error: 'Could not read the trip from Notion' }, { status: 502 })
    }
  }

  let item
  try {
    item = await applyStatusChange(notion, target, change, trip, todayInZone(timeZone))
  } catch (err) {
    if (err instanceof StatusInputError) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('Trip item status change failed:', err)
    return NextResponse.json({ error: 'Notion did not save this. Check the row in Notion.' }, { status: 502 })
  }

  if (target.tripId) revalidatePath(`/${target.tripId.replace(/-/g, '')}/itinerary`)
  return NextResponse.json({ ok: true, item })
}
