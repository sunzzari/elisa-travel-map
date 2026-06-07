import { fetchAllTrips, fetchTripItems } from '@/lib/notion'
import { geocodeVenue } from '@/lib/geocode'
import { groupDays, formatLongDate } from '@/lib/day'
import type { TripItem } from '@/lib/types'
import { notFound } from 'next/navigation'

// Live, always-current itinerary. Renders straight from Notion on each request
// (revalidated hourly). Replaces the retired per-day newsletter system and the
// Sunzzari in-app Day view. The Sunzzari app opens this URL in a web view and
// caches the rendered HTML to disk for offline viewing.
export const revalidate = 3600

export async function generateStaticParams() {
  const trips = await fetchAllTrips()
  return trips.map(t => ({ tripSlug: t.id.replace(/-/g, '') }))
}

const SCHEDULED = new Set(['Confirmed', 'Assigned', 'Reservation Pending'])

function timeSlot(item: TripItem): string | null {
  const raw = item.assignedToDate ?? item.date
  if (!raw || !raw.includes('T')) return null
  const hhmm = raw.split('T')[1]?.slice(0, 5)
  return hhmm ?? null
}

function mapLink(item: TripItem): { href: string; approx: boolean } {
  if (item.coordinates) {
    return {
      href: `https://www.google.com/maps/search/?api=1&query=${item.coordinates.lat},${item.coordinates.lng}`,
      approx: false,
    }
  }
  const query = [item.venue || item.name, item.legCity].filter(Boolean).join(', ')
  return {
    href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
    approx: true,
  }
}

function statusDotColor(status: string | null): string {
  switch (status) {
    case 'Confirmed': return '#34C759'
    case 'Assigned': return '#0A84FF'
    case 'Reservation Pending': return '#FF9F0A'
    case 'Shortlisted': return '#FFD60A'
    default: return '#8E8E93'
  }
}

export default async function ItineraryPage({ params }: { params: Promise<{ tripSlug: string }> }) {
  const { tripSlug } = await params
  const trips = await fetchAllTrips()
  const trip = trips.find(t => t.id.replace(/-/g, '') === tripSlug)
  if (!trip) notFound()

  const rawItems = await fetchTripItems(trip.id)
  const items = await Promise.all(
    rawItems.map(async item => {
      const coords = await geocodeVenue(item.venue, item.legCity)
        ?? (item.name !== item.venue ? await geocodeVenue(item.name, item.legCity) : null)
      return { ...item, coordinates: coords ?? undefined }
    })
  )

  const days = groupDays(items)

  const dateRange = [trip.departureDate, trip.returnDate]
    .filter(Boolean)
    .map(d => formatLongDate(d as string, { month: 'short', day: 'numeric' }))
    .join(' - ')

  return (
    <main className="itin">
      <style>{css}</style>
      <header className="itin-head">
        <h1>{trip.name}</h1>
        <p className="sub">{[trip.location, dateRange].filter(Boolean).join('  -  ')}</p>
      </header>

      {days.length === 0 && (
        <p className="empty">No scheduled days yet. Items need a status of Confirmed or Assigned with a date to appear here.</p>
      )}

      {days.map(day => {
        const scheduled = [...day.confirmed, ...day.possibilities.filter(i => SCHEDULED.has(i.status ?? ''))]
          .sort((a, b) => (timeSlot(a) ?? '99').localeCompare(timeSlot(b) ?? '99'))
        const options = day.possibilities.filter(i => i.status === 'Shortlisted' || i.status === 'Researching')
        const leg = scheduled[0]?.legCity || day.possibilities[0]?.legCity || ''

        return (
          <section className="day" key={day.id}>
            <div className="day-head">
              <h2>{formatLongDate(day.dateString)}</h2>
              {leg && <span className="leg">{leg}</span>}
            </div>

            {scheduled.length === 0 && <p className="open">Open day.</p>}

            <ul className="rows">
              {scheduled.map(item => {
                const t = timeSlot(item)
                const { href, approx } = mapLink(item)
                return (
                  <li className="row" key={item.id}>
                    <span className="time">{t ?? ''}</span>
                    <span className="dot" style={{ background: statusDotColor(item.status) }} />
                    <span className="body">
                      <a className="name" href={href} target="_blank" rel="noreferrer">{item.name}</a>
                      <span className="meta">
                        {item.type}{item.venue && item.venue !== item.name ? ` - ${item.venue}` : ''}
                        {approx ? ' - map approx' : ''}
                      </span>
                      {item.notes && <span className="notes">{item.notes}</span>}
                    </span>
                  </li>
                )
              })}
            </ul>

            {options.length > 0 && (
              <div className="options">
                <span className="opt-label">If you have time</span>
                {options.map(item => {
                  const { href } = mapLink(item)
                  return (
                    <a className="opt" href={href} target="_blank" rel="noreferrer" key={item.id}>{item.name}</a>
                  )
                })}
              </div>
            )}
          </section>
        )
      })}

      <footer className="itin-foot">Live from Notion. Always current.</footer>
    </main>
  )
}

const css = `
.itin { max-width: 720px; margin: 0 auto; padding: 20px 16px 64px; background: #000; color: #fff;
  font-family: var(--font-body), -apple-system, system-ui, sans-serif; min-height: 100vh; }
.itin-head { padding: 8px 0 20px; border-bottom: 1px solid #1C1C1E; margin-bottom: 8px; }
.itin-head h1 { font-family: var(--font-display), Georgia, serif; font-size: 28px; margin: 0 0 4px; color: #fff; }
.itin-head .sub { margin: 0; color: #8E8E93; font-size: 14px; }
.empty, .open { color: #8E8E93; font-size: 14px; }
.day { padding: 20px 0; border-bottom: 1px solid #1C1C1E; }
.day-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; }
.day-head h2 { font-size: 17px; margin: 0; color: #E8B86D; font-weight: 600; }
.leg { font-size: 12px; color: #8E8E93; background: #1C1C1E; padding: 2px 8px; border-radius: 10px; }
.rows { list-style: none; margin: 0; padding: 0; }
.row { display: grid; grid-template-columns: 48px 10px 1fr; align-items: start; gap: 8px; padding: 7px 0; }
.time { font-size: 13px; color: #8E8E93; font-variant-numeric: tabular-nums; padding-top: 1px; }
.dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; }
.body { display: flex; flex-direction: column; }
.name { color: #fff; font-size: 15px; text-decoration: none; border-bottom: 1px solid #333; width: fit-content; }
.meta { color: #8E8E93; font-size: 12px; margin-top: 1px; }
.notes { color: #a9a9ae; font-size: 12px; margin-top: 3px; line-height: 1.35; }
.options { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.opt-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #8E8E93; margin-right: 2px; }
.opt { font-size: 13px; color: #E8B86D; text-decoration: none; background: #1C1C1E; padding: 3px 9px; border-radius: 12px; }
.itin-foot { margin-top: 24px; text-align: center; color: #48484A; font-size: 12px; }
`
