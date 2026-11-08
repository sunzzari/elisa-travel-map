import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { authorize } from '@/lib/edit-auth'
import { notionFor } from '@/lib/places-write'
import { parsePackingItem, TRIP_PACKING_DATABASE_ID } from '@/lib/notion'

const norm = (id: string) => id.replace(/-/g, '')

/**
 * Tick or untick one packing item from the Plan tab. Same passcode as status
 * edits. Writes exactly one checkbox, `Elisa packed` or `Cathy packed`, on a
 * Trip Packing row; never creates, renames or deletes a row, and never touches
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
  const person = body?.person
  if (person !== 'Elisa' && person !== 'Cathy') return NextResponse.json({ error: 'person must be Elisa or Cathy' }, { status: 400 })
  if (typeof body?.packed !== 'boolean') return NextResponse.json({ error: 'packed must be true or false' }, { status: 400 })

  let page: any
  try {
    page = await notion.pages.retrieve({ page_id: id })
  } catch {
    return NextResponse.json({ error: 'Not a packing item' }, { status: 404 })
  }
  if (norm(page.parent?.database_id ?? '') !== norm(TRIP_PACKING_DATABASE_ID)) {
    return NextResponse.json({ error: 'Not a packing item' }, { status: 404 })
  }

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

  for (const trip of page.properties?.['Trip']?.relation ?? []) revalidatePath(`/${norm(trip.id)}/itinerary`)
  return NextResponse.json({ ok: true, item: parsePackingItem(updated) })
}
