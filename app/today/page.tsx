import { fetchAllTrips } from '@/lib/notion'
import { findLiveTrip, findNextTrip, tripSlug } from '@/lib/trip'
import { redirect } from 'next/navigation'

// Bookmarkable shortcut: elisa-travel-map.vercel.app/today always lands on the
// day view of whatever trip is running, so the URL never has to change mid-trip.
// Short revalidate because the answer changes at a date boundary, not on an edit.
export const revalidate = 300

export default async function TodayRedirect() {
  const trips = await fetchAllTrips()
  const today = new Date().toISOString().slice(0, 10)

  const trip = findLiveTrip(trips, today) ?? findNextTrip(trips, today)
  redirect(trip ? `/${tripSlug(trip)}/itinerary` : '/')
}
