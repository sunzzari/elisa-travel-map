import { fetchAllTrips, fetchTripItems } from '@/lib/notion'
import { geocodeVenue } from '@/lib/geocode'
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

  const rawItems = await fetchTripItems(trip.id)
  const items = await Promise.all(
    rawItems.map(async item => {
      const coords = await geocodeVenue(item.venue, item.legCity)
        ?? (item.name !== item.venue ? await geocodeVenue(item.name, item.legCity) : null)
      return { ...item, coordinates: coords ?? undefined }
    })
  )

  return <ItineraryClient trip={trip} items={items} apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!} />
}
