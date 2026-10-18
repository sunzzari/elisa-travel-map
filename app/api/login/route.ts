import { NextResponse } from 'next/server'
import { passwordMatches, safeNext, siteCookieValue, SITE_COOKIE, SITE_COOKIE_MAX_AGE } from '@/lib/site-auth'

/** The sign-in form posts here. A plain form, so it works with no JavaScript. */
export async function POST(request: Request) {
  const form = await request.formData()
  const next = safeNext(String(form.get('next') ?? '/'))
  const back = new URL('/login', request.url)
  back.searchParams.set('next', next)

  const value = siteCookieValue()
  if (!value) {
    back.searchParams.set('error', 'unset')
    return NextResponse.redirect(back, 303)
  }
  if (!passwordMatches(String(form.get('password') ?? ''))) {
    // A pause per wrong guess makes guessing slow.
    await new Promise(r => setTimeout(r, 700))
    back.searchParams.set('error', 'wrong')
    return NextResponse.redirect(back, 303)
  }

  const response = NextResponse.redirect(new URL(next, request.url), 303)
  response.cookies.set(SITE_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SITE_COOKIE_MAX_AGE,
  })
  return response
}
