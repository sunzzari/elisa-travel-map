import { NextResponse } from 'next/server'
import { fetchAroundTown } from '@/lib/aroundtown'
import { colorFor, fitAreaContains } from '@/lib/aroundtown-shared'

/**
 * Around Town for the Sunzzari app: the same places, pins, branches, colours
 * and areas the /around-town page draws, computed by the same code. The phone
 * draws this and keeps its last copy on disk for offline; it no longer reads
 * these Notion tables or places anything itself.
 *
 * Public like the page it mirrors. Refreshed at most every 5 minutes, and
 * immediately after any save through /api/places.
 */
export const revalidate = 300

// Which area's "fit all" frame a pin belongs to (LA proper or the Bay), or null
// for a pin that stays on the map but never stretches the frame (San Diego).
const fitArea = (c: { lat: number; lng: number }) =>
  fitAreaContains('la', c.lat, c.lng) ? 'la' : fitAreaContains('sfBay', c.lat, c.lng) ? 'sfBay' : null

export async function GET() {
  const { items, meta } = await fetchAroundTown()
  const places = items.map(item => {
    const m = meta[item.id]
    const c = item.coordinates
    return {
      id: item.id,
      url: item.url,
      name: item.name,
      kind: m.kind,
      region: m.region,
      neighborhood: m.neighborhood,
      location: m.locationText,
      preference: m.preference,
      goodFor: m.goodFor,
      topDishes: m.topDishes,
      comments: m.comments,
      wantToTry: m.thinkingAbout,
      beenThere: m.done,
      address: m.address,
      color: m.color,
      // The colour before "been there" greys it, so the phone can un-grey a place
      // the moment she unticks it, without its own copy of the colour table.
      baseColor: colorFor({ ...m, done: false }),
      lat: c?.lat ?? null,
      lng: c?.lng ?? null,
      fitArea: c ? fitArea(c) : null,
      branches: (item.branches ?? []).map(b => ({ address: b.address, lat: b.lat, lng: b.lng, fitArea: fitArea(b) })),
    }
  })
  return NextResponse.json({ generatedAt: new Date().toISOString(), places })
}
