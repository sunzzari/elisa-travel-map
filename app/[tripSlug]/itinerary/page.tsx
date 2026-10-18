import { fetchAllTrips, fetchTripLegs, fetchTripTasks } from '@/lib/notion'
import { loadTripItems } from '@/lib/trip-items'
import ItineraryClient from '@/components/ItineraryClient'
import { notFound } from 'next/navigation'

// The during-the-trip view: a map you can filter by day and by type, with the
// day's plan alongside it.
//
// This was a zero-JavaScript page until 2026-09-06, so the Sunzzari webview
// could cache the HTML and read it with no signal. That constraint retired
// itself: the iOS app now has a native Today screen with its own map and its
// own disk cache, so it no longer depends on this page for offline. This is the
// laptop surface now, and Elisa asked for it to be "a map too, maybe even more
// of a map actually".
export const revalidate = 60

export async function generateStaticParams() {
  const trips = await fetchAllTrips()
  return trips.map(t => ({ tripSlug: t.id.replace(/-/g, '') }))
}

export default async function ItineraryPage({ params }: { params: Promise<{ tripSlug: string }> }) {
  const { tripSlug } = await params
  const trips = await fetchAllTrips()
  const trip = trips.find(t => t.id.replace(/-/g, '') === tripSlug)
  if (!trip) notFound()

  // Legs and tasks feed the Plan tab. Each can fail on its own and says so on
  // the page; neither failure takes the map down with it.
  const [items, legs, tasks] = await Promise.all([
    loadTripItems(trip),
    fetchTripLegs(trip.id),
    fetchTripTasks(trip.id),
  ])

  return <ItineraryClient trip={trip} items={items} legs={legs} tasks={tasks} apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!} />
}
