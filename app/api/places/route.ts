import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { authorize } from '@/lib/edit-auth'
import { createPlace, notionFor, parseNewPlace, PlaceInputError } from '@/lib/places-write'

/** Add an Around Town place. The website and the phone both save here. */
export async function POST(request: Request) {
  const auth = await authorize(request)
  if ('refused' in auth) return auth.refused

  let place
  try {
    place = parseNewPlace(await request.json())
  } catch (err) {
    const message = err instanceof PlaceInputError ? err.message : 'Bad request body'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  try {
    const { id, location } = await createPlace(notionFor(auth.caller), place)
    revalidatePath('/around-town')
    return NextResponse.json({ ok: true, id, location })
  } catch (err) {
    if (err instanceof PlaceInputError) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('Around Town create failed:', err)
    return NextResponse.json({ error: 'Notion did not accept the new place' }, { status: 502 })
  }
}
