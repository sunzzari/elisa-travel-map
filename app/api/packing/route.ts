import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { authorize } from '@/lib/edit-auth'
import { notionFor } from '@/lib/places-write'
import { parsePackingItem, TRIP_PACKING_DATABASE_ID, TRAVEL_PLANNING_DATABASE_ID } from '@/lib/notion'

// Option lists are the Trip Packing schema's own; anything else is refused
// rather than coined as a new Notion option.
const CATEGORIES = ['Clothes', 'Tech', 'Toiletries', 'Liquids', 'First Aid', 'Misc', 'Family', 'Wedding']
const WHO = ['Each', 'Shared', 'Elisa', 'Cathy']
const BAGS = ['Backpack', 'Carry-On', 'Lole', 'Checked Bag', 'Wear']
const norm = (id: string) => id.replace(/-/g, '')

/**
 * Add an item to ONE trip's packing list: a new Trip Packing row linked to
 * that trip, both packed boxes unchecked. Never writes the Master Packing List
 * (that stays /notion-edit-packing's). Elisa, 2026-11-08: "also make an option
 * to add something".
 */
export async function POST(request: Request) {
  const auth = await authorize(request)
  if ('refused' in auth) return auth.refused
  const notion = notionFor(auth.caller)

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Bad request body' }, { status: 400 })
  }
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 200) return NextResponse.json({ error: 'Give the item a name' }, { status: 400 })
  if (!WHO.includes(body?.who)) return NextResponse.json({ error: 'Say who packs it' }, { status: 400 })
  if (!CATEGORIES.includes(body?.category)) return NextResponse.json({ error: 'Pick a category' }, { status: 400 })
  const bags: string[] = Array.isArray(body?.compartments) ? body.compartments : []
  if (bags.some(b => !BAGS.includes(b))) return NextResponse.json({ error: 'Unknown bag' }, { status: 400 })

  const tripId = typeof body?.tripId === 'string' ? body.tripId : ''
  try {
    const trip: any = await notion.pages.retrieve({ page_id: tripId })
    if (norm(trip.parent?.database_id ?? '') !== norm(TRAVEL_PLANNING_DATABASE_ID)) throw new Error('not a trip')
  } catch {
    return NextResponse.json({ error: 'Not a trip' }, { status: 404 })
  }

  let page: any
  try {
    page = await notion.pages.create({
      parent: { database_id: TRIP_PACKING_DATABASE_ID },
      properties: {
        'Item Name': { title: [{ text: { content: name } }] },
        Category: { select: { name: body.category } },
        Who: { select: { name: body.who } },
        Compartment: { multi_select: bags.map(b => ({ name: b })) },
        'Elisa packed': { checkbox: false },
        'Cathy packed': { checkbox: false },
        Trip: { relation: [{ id: tripId }] },
      },
    } as any)
  } catch (err) {
    console.error('Packing add failed:', err)
    return NextResponse.json({ error: 'Notion did not save this item.' }, { status: 502 })
  }

  revalidatePath(`/${norm(tripId)}/itinerary`)
  return NextResponse.json({ ok: true, item: parsePackingItem(page) })
}
