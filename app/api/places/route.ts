import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { refuseWithoutPasscode } from '@/lib/edit-auth'
import { createPlace, parseNewPlace, PlaceInputError } from '@/lib/places-write'

export async function POST(request: Request) {
  const refused = refuseWithoutPasscode(request)
  if (refused) return refused

  let place
  try {
    place = parseNewPlace(await request.json())
  } catch (err) {
    const message = err instanceof PlaceInputError ? err.message : 'Bad request body'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  try {
    const id = await createPlace(place)
    revalidatePath('/around-town')
    return NextResponse.json({ ok: true, id })
  } catch (err) {
    console.error('Around Town create failed:', err)
    return NextResponse.json({ error: 'Notion did not accept the new place' }, { status: 502 })
  }
}
