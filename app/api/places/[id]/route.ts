import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { refuseWithoutPasscode } from '@/lib/edit-auth'
import { kindOfPage, parsePatch, updatePlace, PlaceInputError } from '@/lib/places-write'

/** Edit an Around Town place. The website and the phone both save here. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = await refuseWithoutPasscode(request)
  if (refused) return refused

  const { id } = await params
  let patch
  try {
    patch = parsePatch(await request.json())
  } catch (err) {
    const message = err instanceof PlaceInputError ? err.message : 'Bad request body'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const page = await kindOfPage(id)
  if (!page) return NextResponse.json({ error: 'Not an Around Town place' }, { status: 404 })

  let location
  try {
    location = await updatePlace(id, page, patch)
  } catch (err) {
    if (err instanceof PlaceInputError) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('Around Town update failed:', err)
    return NextResponse.json({ error: 'Notion did not accept the change' }, { status: 502 })
  }
  revalidatePath('/around-town')
  return NextResponse.json({ ok: true, location })
}
