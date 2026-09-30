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

## Logic that is duplicated in the sunzzari-app repo

These files have a hand-maintained twin in the iOS app. Nothing checks that they agree,
so **editing one means editing the other in the same pass, or saying out loud that you
did not**:

| This repo | sunzzari-app |
|---|---|
| `lib/aroundtown-shared.ts` (region lists, bounding boxes, preference colours) | `Sunzzari/Models/AroundTownItem.swift` |
| `lib/time.ts` | `Sunzzari/Services/TripTime.swift` |
| `lib/day.ts` | `Sunzzari/Services/TripDayPlanner.swift` |

The region word lists are 105 tokens long on each side. They were verified identical on
2026-09-14; that is a snapshot, not a guarantee.

The iOS app calls this repo's `/api/geocode` for all its geocoding, so **a change to
`lib/geocode.ts` or that route changes the phone too, with no app release.** That cuts
both ways: it is the one piece of shared logic that already works, and it is also a way
to break the phone from here.

## Before pushing

1. `git pull --rebase` - Cathy pushes here too
2. `npm run build` must pass clean
3. Update `CHANGELOG.md`
4. Ask before pushing - a push to master deploys production immediately, no staging gate
