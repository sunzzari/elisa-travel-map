import { fetchAroundTown } from '@/lib/aroundtown'
import AroundTownClient from '@/components/AroundTownClient'

// The LA and SF Bay places, on the trips' own map. Around Town has no dates
// and no trip, so it is its own route rather than a mode inside an itinerary.
//
// Coordinates come from data/geocache.json, filled locally with
// `npm run geocache:fill` and committed. Nothing here geocodes at scale in
// production: builds are refused outright and runtime is capped. See the
// 2026-09-08 incident note at the top of lib/geocode.ts.
export const revalidate = 300

export default async function AroundTownPage() {
  const { items, meta } = await fetchAroundTown()

  return (
    <AroundTownClient
      items={items}
      meta={meta}
      apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!}
    />
  )
}
