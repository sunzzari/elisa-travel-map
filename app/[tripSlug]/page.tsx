import { redirect } from 'next/navigation'

// The trip map and the day view were three separate map surfaces: this page's
// "Map" mode, this page's "Day" mode (its own second map), and the itinerary.
// None was a superset of the others, which is why none of them was good.
//
// Elisa, 2026-09-07: "instead of building one solid map function you are
// building 3 subpar ones... one per platform with max functionality and
// toggle-able." So there is now exactly one, and this route sends you to it.
export default async function TripPage({ params }: { params: Promise<{ tripSlug: string }> }) {
  const { tripSlug } = await params
  redirect(`/${tripSlug}/itinerary`)
}
