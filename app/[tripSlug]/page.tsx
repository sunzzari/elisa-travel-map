import { fetchAllTrips, fetchTripItems, fetchTripLegCount } from '@/lib/notion'
import { geocodeVenue } from '@/lib/geocode'
import TripPageClient from '@/components/TripPageClient'
import { notFound } from 'next/navigation'

export const revalidate = 60

export async function generateStaticParams() {
  const trips = await fetchAllTrips()
  return trips.map(t => ({ tripSlug: t.id.replace(/-/g, '') }))
}

export default async function TripPage({ params }: { params: Promise<{ tripSlug: string }> }) {
  const { tripSlug } = await params
  const trips = await fetchAllTrips()
  const trip = trips.find(t => t.id.replace(/-/g, '') === tripSlug)

  if (!trip) notFound()

  const [rawItems, legCount] = await Promise.all([
    fetchTripItems(trip.id),
    fetchTripLegCount(trip.id),
  ])

  const items = await Promise.all(
    rawItems.map(async item => {
      const coords = await geocodeVenue(item.venue, item.legCity)
        ?? (item.name !== item.venue ? await geocodeVenue(item.name, item.legCity) : null)
      return { ...item, coordinates: coords ?? undefined }
    })
  )

  const mapped = items.filter(i => i.coordinates)
  const unmapped = items.filter(i => !i.coordinates)
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!

  return (
    <TripPageClient
      trip={trip}
      items={items}
      apiKey={apiKey}
      mappedCount={mapped.length}
      unmappedCount={unmapped.length}
      legLabel={legCount === 1 ? 'Neighborhood' : 'Leg'}
    />
  )
}
