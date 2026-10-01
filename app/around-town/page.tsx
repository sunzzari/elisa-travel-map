import { fetchAroundTown } from '@/lib/aroundtown'
import AroundTownClient from '@/components/AroundTownClient'

// The LA and SF Bay places, on the trips' own map. Around Town has no dates
// and no trip, so it is its own route rather than a mode inside an itinerary.
//
// Pins come from Notion (saved, free sources) or the saved table; nothing here
// calls a geocoder. See lib/geocode.ts.
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
