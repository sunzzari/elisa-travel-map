import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * One password for the whole travel map, for Elisa and Cathy. Elisa,
 * 2026-10-18: "there should be a whole password to the travel map that cathy
 * and i can use to view and enter".
 *
 * It is the same secret as the Around Town edit passcode (`AROUND_TOWN_PASSCODE`),
 * so there is one password to remember and nothing new to set up on
 * Production: signing in to view also unlocks every edit.
 *
 * The cookie holds an HMAC of the password, never the password. Changing the
 * password in Vercel signs every browser out.
 *
 * Fails CLOSED: with no password set, nobody gets in. A missing env var must
 * never quietly turn the gate off.
 */

export const SITE_COOKIE = 'tm_site'
export const SITE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export function sitePassword(): string | undefined {
  return process.env.AROUND_TOWN_PASSCODE || undefined
}

function sign(password: string): string {
  return createHmac('sha256', password).update('elisa-travel-map site v1').digest('hex')
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function passwordMatches(given: string | null | undefined): boolean {
  const password = sitePassword()
  return !!password && !!given && same(given, password)
}

/** The cookie value to set once the password checks out. */
export function siteCookieValue(): string | null {
  const password = sitePassword()
  return password ? sign(password) : null
}

/** Whether a request carries a valid sign-in cookie. */
export function hasSiteCookie(cookieHeader: string | null): boolean {
  const password = sitePassword()
  if (!password || !cookieHeader) return false
  const match = cookieHeader.split(/;\s*/).find(c => c.startsWith(`${SITE_COOKIE}=`))
  if (!match) return false
  return same(match.slice(SITE_COOKIE.length + 1), sign(password))
}

/** Only same-site paths, so the login form cannot bounce anyone off the site. */
// Resolved as a URL rather than checked as text: a browser strips tabs and
// newlines, so "/\t/evil.com" becomes "//evil.com" and leaves the site.
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || /[\u0000-\u001F\u007F\\]/.test(next)) return '/'
  try {
    const url = new URL(next, 'http://site.invalid')
    return url.origin === 'http://site.invalid' ? url.pathname + url.search + url.hash : '/'
  } catch {
    return '/'
  }
}
