# Project Instructions

## Changelog (MANDATORY)

**Every time you commit and push to master, you MUST update `CHANGELOG.md`** in the same
commit. Format:
- Add a new date heading (`## YYYY-MM-DD`) if one doesn't exist for today
- Each entry gets a timestamp prefix: `` `H:MMam/pm` ``
- Newest entries go at the TOP of the day's section
- Include "- Cathy" attribution on entries Cathy wrote
- This is not optional - do it before telling the user you're done.

The changelog used to live in `README.md`; it moved to `CHANGELOG.md` on 2026-09-14 so
both this repo and `sunzzari-app` work the same way.

A pre-push hook in `.githooks/pre-push` enforces this. If it isn't firing, run:
`git config core.hooksPath .githooks`

## One map only

`components/TripMap.tsx` is the app's only map. Both `ItineraryClient` (trips) and
`AroundTownClient` render it, and both render the shared `components/UnmappedList.tsx`.
A change to either reaches both pages - say so in the same pass. Never add another map.

## Where things are: one copy, on this server

Elisa, 2026-09-30: "the same data is used for both and the same features should be used
for both". Anything about WHERE a place is lives here and nowhere else: reading pins
(`lib/saved-pins.ts`), the lookup (`lib/place-lookup.ts`, `lib/place-areas.ts`), saving
(`lib/places-write.ts`), areas and colours (`lib/aroundtown-shared.ts`). The Sunzzari app
draws `/api/around-town` and `/api/trips/[tripId]/pins` and saves through `/api/places*`.

- **A change to any of those files or routes changes the phone too, with no app release.**
  Say so in the same pass.
- **Never add a paid lookup.** No Google Geocoding, Google Places or Anthropic call on
  this path. Her rule, 2026-09-28: "make sure YOU DO NOT MAKE ME PAY MORE THAN THE $100
  CREDIT". Free sources only (OpenStreetMap, US Census).
- **Build a location feature here first**, then have each app draw it. Do not add a Swift
  twin.

Still duplicated by hand in sunzzari-app, and not location code:

| This repo | sunzzari-app |
|---|---|
| `lib/time.ts` | `Sunzzari/Services/TripTime.swift` |
| `lib/day.ts` | `Sunzzari/Services/TripDayPlanner.swift` |

Editing one means editing the other in the same pass, or saying out loud that you did not.

## Before pushing

1. `git pull --rebase` - Cathy pushes here too
2. `npm run build` must pass clean
3. Update `CHANGELOG.md`
4. Ask before pushing - a push to master deploys production immediately, no staging gate
