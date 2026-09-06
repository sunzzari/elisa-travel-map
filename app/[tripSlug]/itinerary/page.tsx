import { fetchAllTrips, fetchTripItems } from '@/lib/notion'
import { geocodeVenue } from '@/lib/geocode'
import { groupDays, planDay, formatLongDate, type DayPlan, type PlannedItem } from '@/lib/day'
import type { TripItem } from '@/lib/types'
import { notFound } from 'next/navigation'

// The during-the-trip view. Opens on today, one day at a time, with the whole
// trip a tap away.
//
// DELIBERATELY ZERO-JAVASCRIPT-DEPENDENT. The Sunzzari iOS app fetches this
// page's HTML and re-renders it with WKWebView's loadHTMLString for offline
// use, which means Next's JS chunks are not available. So:
//   - every day is server-rendered into the DOM up front (offline-complete)
//   - switching days is a radio input plus CSS sibling selectors, no JS
//   - one small INLINE script picks today's radio, because only the browser
//     knows the viewer's timezone (Vercel runs UTC; at 6pm in Park City the
//     server already thinks it is tomorrow)
// If that inline script is blocked, the server's best guess stays selected and
// the page is still fully usable. Nothing here may depend on hydration.
export const revalidate = 60

export async function generateStaticParams() {
  const trips = await fetchAllTrips()
  return trips.map(t => ({ tripSlug: t.id.replace(/-/g, '') }))
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

/**
 * Best available map link. An address is the most reliable, then a geocoded
 * pin, then a name search. `approx` is shown to the user so a name-search
 * guess is never passed off as a known location.
 */
function mapLink(item: TripItem): { href: string; approx: boolean } {
  if (item.address) {
    return { href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address)}`, approx: false }
  }
  if (item.coordinates) {
    return {
      href: `https://www.google.com/maps/search/?api=1&query=${item.coordinates.lat},${item.coordinates.lng}`,
      approx: false,
    }
  }
  const query = [item.venue || item.name, item.legCity].filter(Boolean).join(', ')
  return { href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`, approx: true }
}

function Row({ planned }: { planned: PlannedItem }) {
  const { item, time } = planned
  const { href, approx } = mapLink(item)
  const meta = [
    item.type,
    item.venue && item.venue !== item.name ? item.venue : null,
  ].filter(Boolean).join(' - ')

  return (
    <li className="row">
      {/* A rough word ("Morning") renders as the word. It is never shown as
          the clock time we anchored it to for sorting. */}
      <span className={time.exact ? 'time' : 'time rough'}>{time.label ?? ''}</span>
      <span className="dot" style={{ background: statusDotColor(item.status) }} />
      <span className="body">
        <a className="name" href={href} target="_blank" rel="noreferrer">{item.name}</a>
        {meta && <span className="meta">{meta}{approx ? ' - map approx' : ''}</span>}
        {item.address && <span className="addr">{item.address}</span>}
        {item.notes && <span className="notes">{item.notes}</span>}
        {(item.confirmationNumber || item.bookedVia) && (
          <span className="conf">
            {item.confirmationNumber && <b>{item.confirmationNumber}</b>}
            {item.confirmationNumber && item.bookedVia ? ' - ' : ''}
            {item.bookedVia}
          </span>
        )}
      </span>
    </li>
  )
}

function DayPanel({ plan, tomorrow }: { plan: DayPlan; tomorrow: DayPlan | null }) {
  const empty = plan.timeline.length === 0 && plan.anytime.length === 0

  return (
    <section className="day" id={`d-${plan.dateString}`}>
      <div className="day-head">
        <h2>{formatLongDate(plan.dateString)}</h2>
        <span className="daynum">
          {plan.dayNumber && plan.totalDays ? `Day ${plan.dayNumber} of ${plan.totalDays}` : ''}
          {plan.legCity ? ` - ${plan.legCity}` : ''}
        </span>
      </div>

      {plan.needsBooking.length > 0 && (
        <div className="alert">
          <span className="alert-label">Still needs booking</span>
          <ul>
            {plan.needsBooking.map(item => (
              <li key={item.id}>{item.name}{item.venue && item.venue !== item.name ? ` - ${item.venue}` : ''}</li>
            ))}
          </ul>
        </div>
      )}

      {plan.hotel && (
        <div className="hotel">
          <span className="hotel-label">Sleeping tonight</span>
          <a className="hotel-name" href={mapLink(plan.hotel).href} target="_blank" rel="noreferrer">{plan.hotel.name}</a>
          {plan.hotel.address && <span className="addr">{plan.hotel.address}</span>}
          {plan.hotel.confirmationNumber && <span className="conf"><b>{plan.hotel.confirmationNumber}</b>{plan.hotel.bookedVia ? ` - ${plan.hotel.bookedVia}` : ''}</span>}
        </div>
      )}

      {empty && <p className="open">Nothing scheduled. Anything below is fair game.</p>}

      {plan.timeline.length > 0 && (
        <ul className="rows">
          {plan.timeline.map(p => <Row key={p.item.id} planned={p} />)}
        </ul>
      )}

      {plan.anytime.length > 0 && (
        <>
          {/* Only worth a heading when there is a timeline to distinguish it
              from. With no times entered, everything lands here and the label
              would just be noise above the whole day. */}
          {plan.timeline.length > 0 && <p className="group-label">Anytime today</p>}
          <ul className="rows">
            {plan.anytime.map(p => <Row key={p.item.id} planned={p} />)}
          </ul>
        </>
      )}

      {plan.options.length > 0 && (
        <div className="options">
          <span className="opt-label">If you have time</span>
          {plan.options.map(item => (
            <a className="opt" href={mapLink(item).href} target="_blank" rel="noreferrer" key={item.id}>{item.name}</a>
          ))}
        </div>
      )}

      {tomorrow && (
        <p className="tomorrow">
          <span>Tomorrow</span>
          {[...tomorrow.timeline, ...tomorrow.anytime].slice(0, 3).map(p => p.item.name).join(', ') || 'nothing scheduled yet'}
        </p>
      )}
    </section>
  )
}

export default async function ItineraryPage({ params }: { params: Promise<{ tripSlug: string }> }) {
  const { tripSlug } = await params
  const trips = await fetchAllTrips()
  const trip = trips.find(t => t.id.replace(/-/g, '') === tripSlug)
  if (!trip) notFound()

  const rawItems = await fetchTripItems(trip.id)
  const items = await Promise.all(
    rawItems.map(async item => {
      // An address beats a geocode, so skip the API call when we have one.
      if (item.address) return item
      const coords = await geocodeVenue(item.venue, item.legCity)
        ?? (item.name !== item.venue ? await geocodeVenue(item.name, item.legCity) : null)
      return { ...item, coordinates: coords ?? undefined }
    })
  )

  const days = groupDays(items)
  const allDates = days.map(d => d.dateString)
  const plans = days.map(day => planDay(day, allDates))

  // Undated shortlisted items fan out into every day of their leg, so in the
  // whole-trip view the same 20 chips would repeat under all four days. Show
  // them once at the bottom instead.
  const allOptions = plans
    .flatMap(p => p.options)
    .filter((item, i, list) => list.findIndex(c => c.id === item.id) === i)

  // Server-side default only. The inline script below overrides it with the
  // viewer's real local date; this is the fallback if that never runs.
  const serverToday = new Date().toISOString().slice(0, 10)
  const defaultIndex = Math.max(0, plans.findIndex(p => p.dateString >= serverToday))

  const dateRange = [trip.departureDate, trip.returnDate]
    .filter(Boolean)
    .map(d => formatLongDate(d as string, { month: 'short', day: 'numeric' }))
    .join(' - ')

  return (
    <main className="itin">
      <style>{css}</style>
      <style>{dayRules(allDates)}</style>

      <header className="itin-head">
        <h1>{trip.name}</h1>
        <p className="sub">{[trip.location, dateRange].filter(Boolean).join('  -  ')}</p>
      </header>

      {plans.length === 0 ? (
        <p className="empty">No scheduled days yet. Items need a date and a status of Confirmed, Assigned or Reservation Pending to appear here.</p>
      ) : (
        <div className="switcher">
          {/* One radio per day, plus the CSS that reveals its panel. Radios sit
              before the nav and the panels so `~` can reach both. */}
          {plans.map((plan, i) => (
            <input
              key={plan.dateString}
              type="radio"
              name="day"
              id={`r-${plan.dateString}`}
              className="dayradio"
              data-date={plan.dateString}
              defaultChecked={i === defaultIndex}
            />
          ))}
          <input type="radio" name="day" id="allday" className="allradio" />

          <nav className="daynav">
            {plans.map(plan => (
              <label key={plan.dateString} htmlFor={`r-${plan.dateString}`} className={`chip c-${plan.dateString}`}>
                <span className="wd">{formatLongDate(plan.dateString, { weekday: 'short' })}</span>
                <span className="md">{formatLongDate(plan.dateString, { month: 'short', day: 'numeric' })}</span>
              </label>
            ))}
            <label htmlFor="allday" className="chip chip-all">Whole trip</label>
          </nav>

          <div className="panels">
            {plans.map((plan, i) => (
              <div key={plan.dateString} className={`panel p-${plan.dateString}`}>
                <DayPanel plan={plan} tomorrow={plans[i + 1] ?? null} />
              </div>
            ))}

            {allOptions.length > 0 && (
              <div className="options trip-options">
                <span className="opt-label">If you have time, anywhere on this trip</span>
                {allOptions.map(item => (
                  <a className="opt" href={mapLink(item).href} target="_blank" rel="noreferrer" key={item.id}>{item.name}</a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <footer className="itin-foot">Live from Notion. Always current.</footer>

      {/* Inline, so it survives the offline WKWebView that has no JS chunks. */}
      <script dangerouslySetInnerHTML={{ __html: todayScript }} />
    </main>
  )
}

/**
 * One reveal rule per day. CSS has no way to match "the panel whose date
 * equals the checked radio's date", so the pairing is emitted explicitly.
 * Two rules per day: show the panel, light up the chip.
 */
function dayRules(dates: string[]): string {
  return dates.map(d =>
    `#r-${d}:checked ~ .panels .p-${d} { display: block; }\n` +
    `#r-${d}:checked ~ .daynav .c-${d} { background: #E8B86D; color: #000; border-color: #E8B86D; }`
  ).join('\n')
}

// Selects today's radio using the DEVICE's date, and scrolls its chip into
// view. Server-rendered defaults use UTC, which is the wrong day for most of
// an evening in the Americas.
const todayScript = `
(function () {
  try {
    var d = new Date();
    var today = d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
    var radio = document.getElementById('r-' + today);
    if (radio) radio.checked = true;
    var chip = document.querySelector('label[for="r-' + today + '"]');
    if (chip) {
      chip.classList.add('is-today');
      chip.scrollIntoView({ inline: 'center', block: 'nearest' });
    }
  } catch (e) { /* server default stands */ }
})();
`

// Static half of the stylesheet. The per-day reveal rules are generated by
// dayRules() above and emitted in a second <style>.
const css = `
.itin { max-width: 720px; margin: 0 auto; padding: 20px 16px 64px; background: #000; color: #fff;
  font-family: var(--font-body), -apple-system, system-ui, sans-serif; min-height: 100vh; }
.itin-head { padding: 8px 0 16px; border-bottom: 1px solid #1C1C1E; }
.itin-head h1 { font-family: var(--font-display), Georgia, serif; font-size: 28px; margin: 0 0 4px; color: #fff; }
.itin-head .sub { margin: 0; color: #8E8E93; font-size: 14px; }
.empty, .open { color: #8E8E93; font-size: 14px; }

.dayradio, .allradio { position: absolute; opacity: 0; pointer-events: none; }

.daynav { display: flex; gap: 6px; overflow-x: auto; padding: 12px 0; margin-bottom: 4px;
  scrollbar-width: none; -webkit-overflow-scrolling: touch; position: sticky; top: 0; background: #000; z-index: 5; }
.daynav::-webkit-scrollbar { display: none; }
.chip { flex: 0 0 auto; display: flex; flex-direction: column; align-items: center; gap: 1px;
  padding: 6px 11px; border-radius: 12px; background: #1C1C1E; border: 1px solid transparent;
  color: #8E8E93; font-size: 13px; cursor: pointer; line-height: 1.15; user-select: none; }
.chip .wd { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.7; }
.chip .md { font-weight: 600; }
.chip.is-today { border-color: #E8B86D66; }
.chip-all { justify-content: center; font-weight: 600; }

/* Panels are hidden by default; dayRules() reveals the one whose radio is
   checked. "Whole trip" is a radio in the same group, so picking a day
   deselects it without any JS. */
.panel { display: none; }
#allday:checked ~ .panels .panel { display: block; }
#allday:checked ~ .panels .panel + .panel { border-top: 1px solid #1C1C1E; }
#allday:checked ~ .daynav .chip-all { background: #E8B86D; color: #000; border-color: #E8B86D; }

.day { padding: 4px 0 20px; }
.day-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.day-head h2 { font-size: 19px; margin: 0; color: #E8B86D; font-weight: 600; }
.daynum { font-size: 12px; color: #8E8E93; }

.alert { background: #FF9F0A18; border: 1px solid #FF9F0A44; border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; }
.alert-label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #FF9F0A; margin-bottom: 5px; }
.alert ul { margin: 0; padding-left: 16px; }
.alert li { font-size: 13px; color: #fff; line-height: 1.5; }

.hotel { background: #0A84FF14; border: 1px solid #0A84FF33; border-radius: 10px; padding: 10px 12px; margin-bottom: 14px;
  display: flex; flex-direction: column; gap: 2px; }
.hotel-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #0A84FF; }
.hotel-name { color: #fff; font-size: 15px; font-weight: 600; text-decoration: none; width: fit-content; border-bottom: 1px solid #333; }

.group-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #8E8E93; margin: 14px 0 2px; }
.rows { list-style: none; margin: 0; padding: 0; }
.row { display: grid; grid-template-columns: 62px 10px 1fr; align-items: start; gap: 8px; padding: 8px 0; }
.time { font-size: 13px; color: #fff; font-variant-numeric: tabular-nums; padding-top: 1px; }
.time.rough { color: #8E8E93; font-size: 12px; }
.dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; }
.body { display: flex; flex-direction: column; min-width: 0; }
.name { color: #fff; font-size: 15px; text-decoration: none; border-bottom: 1px solid #333; width: fit-content; }
.meta { color: #8E8E93; font-size: 12px; margin-top: 1px; }
.addr { color: #8E8E93; font-size: 12px; margin-top: 2px; }
.notes { color: #a9a9ae; font-size: 12px; margin-top: 4px; line-height: 1.4; }
.conf { color: #34C759; font-size: 12px; margin-top: 4px; font-variant-numeric: tabular-nums; }

.options { margin-top: 14px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.opt-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #8E8E93; margin-right: 2px; }
.opt { font-size: 13px; color: #E8B86D; text-decoration: none; background: #1C1C1E; padding: 4px 10px; border-radius: 12px; }

.tomorrow { margin: 18px 0 0; padding-top: 12px; border-top: 1px solid #1C1C1E; color: #8E8E93; font-size: 12px; }
.tomorrow span { text-transform: uppercase; letter-spacing: 0.5px; font-size: 10px; color: #48484A; margin-right: 8px; }
#allday:checked ~ .panels .tomorrow { display: none; }

/* The per-day option chips are identical on every day (undated shortlist),
   so whole-trip mode swaps them for one consolidated block. */
#allday:checked ~ .panels .day .options { display: none; }
.trip-options { display: none; padding-top: 16px; border-top: 1px solid #1C1C1E; }
#allday:checked ~ .panels .trip-options { display: flex; }

.itin-foot { margin-top: 24px; text-align: center; color: #48484A; font-size: 12px; }
`
