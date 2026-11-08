import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { authorize } from '@/lib/edit-auth'
import { notionFor } from '@/lib/places-write'
import { parsePackingItem, TRIP_PACKING_DATABASE_ID } from '@/lib/notion'

const norm = (id: string) => id.replace(/-/g, '')

/** The Trip Packing page with this id, or null when it is not one. */
async function packingPage(notion: any, id: string): Promise<any | null> {
  try {
    const page: any = await notion.pages.retrieve({ page_id: id })
    return norm(page.parent?.database_id ?? '') === norm(TRIP_PACKING_DATABASE_ID) ? page : null
  } catch {
    return null
  }
}

function revalidateTrips(page: any) {
  for (const trip of page.properties?.['Trip']?.relation ?? []) revalidatePath(`/${norm(trip.id)}/itinerary`)
}

/**
 * Remove one item from THIS trip's packing list: moves its Trip Packing row to
 * Notion's Trash (recoverable there, and by the page's Undo). Never touches the
 * Master Packing List. Elisa, 2026-11-08: "make an option to delte something
 * from the packing list".
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(request)
  if ('refused' in auth) return auth.refused
  const notion = notionFor(auth.caller)
  const { id } = await params
  const page = await packingPage(notion, id)
  if (!page) return NextResponse.json({ error: 'Not a packing item' }, { status: 404 })
  try {
    await notion.pages.update({ page_id: id, in_trash: true } as any)
  } catch (err) {
    console.error('Packing remove failed:', err)
    return NextResponse.json({ error: 'Notion did not remove this. Check the row in Notion.' }, { status: 502 })
  }
  revalidateTrips(page)
  return NextResponse.json({ ok: true })
}

/**
 * Tick or untick one packing item from the Packing page, or `{ restore: true }`
 * to bring back an item removed by mistake (the Undo). Same passcode as status
 * edits. Writes exactly one checkbox, `Elisa packed` or `Cathy packed`, on a
 * Trip Packing row; never creates or renames a row, and never touches
 * the Master Packing List.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(request)
  if ('refused' in auth) return auth.refused
  const notion = notionFor(auth.caller)

  const { id } = await params
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Bad request body' }, { status: 400 })
  }
  if (body?.restore === true) {
    const page = await packingPage(notion, id)
    if (!page) return NextResponse.json({ error: 'Not a packing item' }, { status: 404 })
    try {
      const restored = await notion.pages.update({ page_id: id, in_trash: false } as any)
      revalidateTrips(page)
      return NextResponse.json({ ok: true, item: parsePackingItem(restored) })
    } catch (err) {
      console.error('Packing restore failed:', err)
      return NextResponse.json({ error: 'Notion did not restore this. It is in Notion Trash.' }, { status: 502 })
    }
  }

  const person = body?.person
  if (person !== 'Elisa' && person !== 'Cathy') return NextResponse.json({ error: 'person must be Elisa or Cathy' }, { status: 400 })
  if (typeof body?.packed !== 'boolean') return NextResponse.json({ error: 'packed must be true or false' }, { status: 400 })

  const page = await packingPage(notion, id)
  if (!page) return NextResponse.json({ error: 'Not a packing item' }, { status: 404 })

  let updated: any
  try {
    updated = await notion.pages.update({
      page_id: id,
      properties: { [person === 'Elisa' ? 'Elisa packed' : 'Cathy packed']: { checkbox: body.packed } },
    })
  } catch (err) {
    console.error('Packing tick failed:', err)
    return NextResponse.json({ error: 'Notion did not save this. Check the row in Notion.' }, { status: 502 })
  }

  revalidateTrips(page)
  return NextResponse.json({ ok: true, item: parsePackingItem(updated) })
}
