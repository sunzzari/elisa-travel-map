import { fetchAroundTown } from '@/lib/aroundtown'
import AroundTownClient from '@/components/AroundTownClient'

// Elisa's Map: LA, the Bay and every travel area, on the trips' own map. It
// opens on LA (AroundTownClient). It has no dates and no trip, so it is its
// own route rather than a mode inside an itinerary; the URL keeps its old name.
//
// Pins come from Notion (saved, free sources) or the saved table; nothing here
// calls a geocoder. See lib/geocode.ts.
export const revalidate = 300

export const metadata = { title: "Elisa's Map" }

export default async function AroundTownPage() {
  const { items, meta } = await fetchAroundTown({ world: true })

  return (
    <AroundTownClient
      items={items}
      meta={meta}
      apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!}
    />
  )
}
