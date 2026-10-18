import { NextResponse, type NextRequest } from 'next/server'
import { hasSiteCookie, passwordMatches, sitePassword } from '@/lib/site-auth'
import { notionKeyOpensOurTable } from '@/lib/edit-auth'

/**
 * The whole travel map sits behind one password (lib/site-auth.ts). Every
 * page and API answers only to:
 *   - a browser signed in with the password (cookie);
 *   - the Sunzzari app, which sends its own Notion key (`x-notion-token`).
 *     It is checked against Notion here, so a made-up header reads nothing;
 *   - a request carrying the password itself (`x-edit-passcode`).
 * Open: the sign-in page and route, and the Notion webhook (it acknowledges
 * and drops, see app/api/webhook).
 */

const OPEN_PATHS = new Set(['/login', '/api/login', '/api/webhook'])

// TEMPORARY: three reads the installed Sunzzari app makes WITHOUT its Notion
// key (TravelService.geocodeItems, AroundTownService's fallback read and its
// search). Locking them would blank the phone's pins until an app update.
// Remove once sunzzari-app sends `x-notion-token` on all three. Reads only.
const PHONE_READS_WITHOUT_KEY = [/^\/api\/trips\/[0-9a-f]{32}\/pins$/, /^\/api\/around-town$/, /^\/api\/around-town\/search$/]

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  if (OPEN_PATHS.has(pathname)) return NextResponse.next()
  if (request.method === 'GET' && PHONE_READS_WITHOUT_KEY.some(re => re.test(pathname))) return NextResponse.next()

  if (hasSiteCookie(request.headers.get('cookie'))) return NextResponse.next()
  if (passwordMatches(request.headers.get('x-edit-passcode'))) return NextResponse.next()
  const notionToken = request.headers.get('x-notion-token')
  if (notionToken && (await notionKeyOpensOurTable(notionToken))) return NextResponse.next()

  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: sitePassword() ? 'Sign in to the travel map first.' : 'The travel map password is not set on this deployment.' },
      { status: sitePassword() ? 401 : 503 }
    )
  }
  const login = request.nextUrl.clone()
  login.pathname = '/login'
  login.search = `?next=${encodeURIComponent(pathname + search)}`
  return NextResponse.redirect(login)
}

export const config = {
  // Static files the browser fetches before any sign-in: built assets, the
  // web app manifest, its icons and the offline service worker.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|icon-192.png|icon-512.png|apple-touch-icon.png).*)'],
}
