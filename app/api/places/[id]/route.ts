import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { refuseWithoutPasscode } from '@/lib/edit-auth'
import { kindOfPage, parsePatch, updatePlace, PlaceInputError } from '@/lib/places-write'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = refuseWithoutPasscode(request)
  if (refused) return refused

  const { id } = await params
  let patch
  try {
    patch = parsePatch(await request.json())
  } catch (err) {
    const message = err instanceof PlaceInputError ? err.message : 'Bad request body'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const kind = await kindOfPage(id)
  if (!kind) return NextResponse.json({ error: 'Not an Around Town place' }, { status: 404 })

  try {
    await updatePlace(id, kind, patch)
  } catch (err) {
    console.error('Around Town update failed:', err)
    return NextResponse.json({ error: 'Notion did not accept the change' }, { status: 502 })
  }
  revalidatePath('/around-town')
  return NextResponse.json({ ok: true })
}
