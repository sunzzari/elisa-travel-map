import { NextResponse } from 'next/server'
import { refuseWithoutPasscode } from '@/lib/edit-auth'

// Lets the page check a passcode before it unlocks the edit controls.
export async function POST(request: Request) {
  return (await refuseWithoutPasscode(request)) ?? NextResponse.json({ ok: true })
}
