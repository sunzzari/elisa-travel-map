# Travel Map

An interactive trip planner that pulls trips from Notion and displays them on a Google Map. Built with Next.js, Tailwind CSS, and deployed on Vercel.

**Live site:** [elisa-travel-map.vercel.app](https://elisa-travel-map.vercel.app)

## Stack

- **Next.js 16** (App Router, server components)
- **Google Maps** via `@vis.gl/react-google-maps`
- **Notion** as the backend database
- **A committed JSON lookup table** (`data/geocache.json`) for coordinates - see the 2026-09-08 5:47pm changelog entry before changing it
- **Tailwind CSS** for styling
- **Vercel** for hosting + auto-deploys

## Contributors

- **Elisa Fazzari** ([@elisafazz](https://github.com/elisafazz)) - creator
- **Cathy Sun** ([@nutellafan](https://github.com/nutellafan)) - contributor

## Changelog

### 2026-09-08

- `5:47pm` **$97 of Google Geocoding in two days - the cache was a service that had been deleted** - the coordinate cache was a Redis Cloud instance whose host no longer resolves in DNS (`NXDOMAIN`). `withRedis` swallowed the failure by design so the app would survive a cache outage, so every read missed, every miss called Google, and nothing anywhere counted. Eleven production deploys in two days, each prerendering seven itinerary pages over all 668 trip items, at up to two paid requests per item. Two other paths made it worse: `/api/webhook` was public and fired a full 668-item sync on ANY Notion page event (its database allowlist was computed and then never applied), and `/api/geocode` is public with no cap.
  - **The cache is now a file in this repo**, `data/geocache.json`, static-imported. A coordinate for a named place never changes, so this was never really a cache - it is a lookup table that happens to be filled by an API. A file cannot be deleted out from under the app, costs nothing, needs no credentials, and shows up in `git diff`.
  - **A production build can no longer call Google at all.** That single gate is what killed the $20-per-deploy class. Runtime lookups are capped per process (`GEOCODE_LIVE_BUDGET`, default 40), logged individually, and killable with `GEOCODE_DISABLED=1`.
  - **Failures are cached too.** A place Google cannot resolve, or resolves into the wrong country, stores `null` and is never asked about again. Transport failures and `REQUEST_DENIED` are NOT stored, so a disabled API key cannot poison the table with permanent nulls.
  - **The webhook no longer fans out to sync.** It acknowledges and drops; pages already revalidate from Notion every 60s, so a Notion edit still reaches the map without anyone paying per edit for it.
  - To fill the table: enable the Geocoding API, run `npm run geocache:fill` locally, commit `data/geocache.json`. Upper bound for the current 668 items is 888 requests (~$4.44); after that the app needs the API only for items added later.

- `8:45am` **Never geocode a place into the wrong country** - the Vienna trip had a pin in Adelaide, South Australia. "Mozart Dinner Concert" has a blank leg, so its venue "Baroque Hall - St. Peter restaurant" went to Google with no geography attached and nothing on the way back checked the answer. Three guards, all in `lib/geocode.ts` so the iOS app gets them by calling the same endpoint: every lookup is anchored to a country (leg city, else the trip's own location) and constrained with `components=country:XX`; the trip location picks the country and never enters the query text, because "Park Hyatt Vienna, Salzburg + Vienna, Austria" resolves to plain Vienna while the same name constrained to AT is Am Hof 2; and an answer made only of area types is rejected, because a constrained query that finds nothing hands back the city named in the query, which is how "Shibuya Crossing" resolved to Vienna. Vienna went from 100 pins including one in Australia to 94 pins all in Austria, with 7 reported as having no location rather than faked.
- `8:45am` **The itinerary opens on the whole map, not on today** - it opened pre-filtered to today, so a trip with nothing scheduled showed an empty day and the day decided what the map showed. Now it opens on All days and Today is a chip. On All the pool is every item still in play instead of the union of the day plans: an item with no date AND no leg belongs to no plan and could never reach the map. The day panel is untouched. Items the map cannot place are listed under it instead of only being counted.


### 2026-09-06

- `10:55pm` **Fix: items with no venue were never really geocoded** - callers did `geocodeVenue(venue, city) ?? geocodeVenue(name, city)`, but a BLANK venue does not fail: it geocodes the bare city and returns the city centre. So the `??` never fell through and the item's own name was never looked up. Every China 2027 item has a blank `Provider / Venue`, so all 62 collapsed onto three city-centre pins. New `geocodeItem()` tries address, then venue, then name, and `geocodeVenue` now refuses a city on its own. China went from 0 usable pins to 60, with 2 reported as unlocatable rather than faked.
- `10:55pm` **Trips with no dates now group by leg** - nothing gets a date without Elisa's approval, so a trip she has not scheduled yet has zero dated items. `groupDays` returned `[]` for those, which collapsed the page: no chips, no list, and a map on its fallback centre (China rendered over Tokyo). `groupLegs` buckets by leg instead, so an all-candidates trip is still fully usable.

- `9:20pm` **Ask about this trip** - a write-in on the itinerary. "Where should I eat that's close to Main Street?" is answered from the places already on the trip, never from the internet, and the items it names are the only ones left on the map until you clear it.
  - Uses NO new API key. It posts through `sunzzari-backend/api/analyze`, the same authenticated proxy the iOS app uses, so the Anthropic key stays in exactly one place and rotating it is one change. This deployment holds only `SUNZZARI_PROXY_SECRET`.
  - Bug caught by testing the route rather than trusting it: the reply was read from `content[0].text`, but the model returns a thinking block first, so a perfectly good answer came back as "No answer came back". It now takes the first text block.

- `8:40pm` **Status toggles, and the day panel now honours the filters** - a second chip row filters by Confirmed / Assigned / Reservation Pending / Shortlisted / Researching, showing only the statuses actually present. The bigger fix is that the map and the day panel now share ONE predicate: before this, toggling Restaurant filtered the pins and left the list showing everything, which made the filters look broken.

- `8:05pm` **Finished days dim, in the trip's timezone** - an item goes dim and struck through only when it is `Confirmed` and its day is over. Assigned and Shortlisted never dim; a plan is not evidence it happened. Day boundaries resolve from a new `Time Zone` property on the trip (IANA id), not from the browser, because checking the plan from LA the night before a flight gives the wrong day. Blank falls back to the device zone.

- `6:55pm` **Itinerary is now a map** - `/[tripSlug]/itinerary` is a map-first day view: "All days" plus one chip per day, type chips for only the types actually present, a large map (beside the day panel on a laptop, above it on a phone), and the panel keeping still-needs-booking, sleeping-tonight and the timeline with notes and confirmation numbers. Reuses the existing `TripMap`, so clusters expand on click.
  - **The zero-JS design is retired**, and it retired itself: it existed so the Sunzzari webview could cache this HTML for offline, and the iOS app now has a native Today screen with its own map and disk cache. Consequently the app's itinerary viewer now loads the live URL instead of a saved HTML string, which would have rendered as a dead page with no map.
  - Supersedes the 5:15pm entry below, which lasted about ninety minutes.

- `5:15pm` **"If you have time" regrouped by type** - the flat wall of pills is gone. Candidates now list one row per type (Restaurant / Activity / Car Rental) with a "See these on the map" link to the trip's map page. The Sunzzari app got a real inline map for this; the itinerary page deliberately did NOT, because it has to keep working with no JavaScript and no signal, where a Google map is just a blank box.

- `12:45pm` **Itinerary rebuilt as a during-the-trip day view** - `/[tripSlug]/itinerary` now opens on TODAY instead of dumping the whole trip as one scroll. Per day: what still needs booking, where you are sleeping tonight, the day's items in time order with notes, addresses and confirmation numbers, the "if you have time" pool, and a next-day preview. A day switcher runs along the top and "Whole trip" still shows everything at once.
  - **Zero JS dependency, on purpose.** The Sunzzari app fetches this page and re-renders it with `loadHTMLString` for offline use, where Next's JS chunks are gone. Every day is server-rendered up front, day switching is radio inputs plus CSS sibling selectors, and one small INLINE script picks today's chip using the device's date (Vercel runs UTC, so at 6pm in Park City the server already thinks it is tomorrow). If that script never runs the server default stands and the page still works.
- `12:45pm` **New Notion fields surfaced** - `Confirmation #` and `Booked Via` existed in Trip Items and were displayed nowhere; both now render on the item. Added `Time` (free text: `9:30am` or `morning`, both valid, blank valid) and `Address` (drives the map link, and beats a geocode when present).
  - A rough time renders as the WORD ("Morning"), never as the clock time it was anchored to for sorting.
- `12:45pm` **`/today`** - a stable bookmark that redirects to whatever trip is running, so the URL never changes mid-trip. The home page also pins the live trip above the grid.
- `12:45pm` **Live trip detected by DATE, not status** - Park City was mid-trip on Sep 6 with its Notion Trip Status still reading "Planning". Nothing flips a trip to "In Progress", so anything keying off status showed no live trip while she was standing in it.
- `12:45pm` **Fixes** - `TripStatus` was missing `Cancelled`, so cancelled trips rendered with the amber Planning badge. Removed the retired Trip Newsletters read path, which was costing a Notion round trip on every trip page load.

### 2026-07-09

- `4:16pm` **Itinerary revalidate 3600s -> 60s** - the "live" itinerary was ISR-cached for an hour (stale-while-revalidate, so worst case two opens over an hour to see a Notion edit); now matches the trip map page's 60s so mid-planning edits appear within about a minute.

### 2026-06-07

- `11:25am` **Live itinerary route** - added `/[tripSlug]/itinerary`, a server-rendered day-by-day plan read straight from Notion (revalidated hourly). Time slots on Confirmed/Assigned/Reservation-Pending items, deterministic Google Maps links (precise pin from the shared geocode cache, flagged name-search fallback otherwise). Opened from the Sunzzari app trip page and cached there for offline. Replaces the retired per-day newsletter system.

### 2026-03-21

- `12:00pm` **Sync with new Notion DB status schema** - Cathy
  - Added `Assigned` (blue) and `Reservation Pending` (orange) as first-class statuses in filter chips and sidebar borders
  - Added `assignedToDate` field (reads `Assigned to Date` from Notion); used as primary itinerary date throughout (date filter, sort, display) with fallback to legacy `Date` field

### 2026-03-09

- `7:15pm` **Warm Wanderer design refresh** - Cathy
  - Typography: DM Serif Display for titles/headings, DM Sans for body text (loaded via next/font)
  - Home page: amber accent bar under header, staggered fade-up card animations, cards hover with translateY lift, circular arrow button glows amber on hover, Planning badge now amber-tinted
  - Trip view: serif font for trip name header and info window place names, search focus glows amber, sidebar selected item border amber, map controls hover amber, back arrow hovers amber
  - Global: film grain texture overlay, warm ambient radial glow from bottom-left corner
  - Bottom sheet detail title uses serif font, info window uses DM Sans body font

### 2026-03-06

- `5:00pm` **Fix recenter button** - Cathy
  - Recenter now always fits visible pins without biasing toward user location
  - Filter changes (date, legs, Near Me) include user location when appropriate

- `4:30pm` **Dark theme bottom sheet** - Cathy
  - Bottom sheet now matches the rest of the app with `gray-800` background
  - Dark card-style list items, white text, dark detail view
  - Handle bar, badges, and buttons all dark-themed

- `4:15pm` **Unified top bar color** - Cathy
  - Safe area, header, toolbar, and day timeline all use solid `gray-800` - one seamless bar from status bar to map edge

- `4:00pm` **Cache cover images + fix status bar** - Cathy
  - Service worker now caches Notion cover images (cache-first) so they load instantly on repeat visits

- `3:30pm` **Near Me shows only nearby pins** - Cathy
  - Filters to pins within 5km of your location and centers map on you
  - List and map only show what's actually close by

- `3:20pm` **Near Me centers map on your location** - Cathy
  - Tapping Near Me now fits the map to show both your location and nearby pins

- `3:10pm` **Fix status bar color mismatch on map view** - Cathy
  - Trip page wrapper now uses `bg-gray-900` to match the header instead of inheriting `bg-gray-950` from body

- `3:00pm` **iOS status bar blends with page** - Cathy
  - Status bar now uses black-translucent style so page background extends behind it
  - Safe area insets respected on home page and trip header

- `2:45pm` **Fix date chips invisible in bottom sheet** - Cathy
  - DayTimeline now has light/dark variants - light for white bottom sheet, dark for toolbar

- `2:30pm` **Map centers on date-filtered pins** - Cathy
  - Selecting a date now auto-fits the map to show only that day's markers

- `2:15pm` **Remove sort picker from toolbar** - Cathy
  - Removed Type/Date/Priority segmented control from map view search bar

- `2:05pm` **UI redesign - rich/immersive dark theme** - Cathy
  - Home page: trip cards now show Notion cover images with gradient overlay, 3:2 aspect ratio, frosted glass status badges, photo zoom on hover
  - Home page: header pinned at top, trip cards scroll independently
  - Trip view: dark glass-morphism toolbar, header, sidebar, legend, and map buttons - the map is the hero, chrome floats over it
  - Sidebar: dark background with colored accent bars per type group
  - Day timeline: dark chips with pulsing blue today dot
  - Bottom sheet: card-style list items with rounded corners, colored type header strip on detail view
  - Filter chips glow when active

- `11:30am` **Offline support upgrade** - Cathy
  - Service worker now uses stale-while-revalidate for API routes
  - App shell (home, manifest, icons) pre-cached on install
  - Amber "You're offline" banner appears when connection is lost

- `11:20am` **Leg-based auto-bounds** - Cathy
  - Map automatically zooms to fit pins when you toggle a leg/city filter
  - Clears back to all pins when filter is removed

- `11:00am` **Day-by-day timeline** - Cathy
  - Scrollable date chip bar replaces the old Today button
  - Tap a date to filter map + list to that day, tap again to clear
  - Today's date gets a blue accent dot
  - Shows on desktop above sidebar and inside mobile bottom sheet

- `10:40am` **Sort options** - Cathy
  - Segmented picker in the search bar: Type, Date, Priority
  - Hidden when near-me is active (distance sort takes priority)
  - Sidebar renders a flat list when sorting by date or priority

- `10:20am` **Marker clustering** - Cathy
  - Dense pin areas now group into blue cluster circles showing counts
  - Zoom in to break clusters apart into individual pins
  - Uses imperative markers with `@googlemaps/markerclusterer` to avoid conflicts with React-managed markers

### 2025-03-05

- **Clean up map controls** - Cathy
  - Removed street view, satellite toggle, and Google's fullscreen button
  - Moved zoom controls to top-left so they're not blocked by the bottom sheet

- **True fullscreen map mode** - Cathy
  - Fullscreen button now hides the trip header bar too (not just filters/sidebar)
  - Removed map/satellite toggle for cleaner UI

- **Fix legend overlapping bottom sheet** - Cathy
  - Legend now sits above the collapsed bottom sheet on mobile

- **Fix bottom sheet swipe gestures on mobile** - Cathy
  - Added touch drag handling with velocity-based snap detection
  - Swipe up/down now properly controls the sheet instead of moving the map

- **Add dino app icons for PWA install support** - Cathy
  - Added 192px, 512px, and Apple touch icon
  - App is now installable on iOS and Android home screens

### Earlier (by Elisa)

- **Search auto-opens sheet, map fitBounds on load, bottom bar tappable**
- **Near me sort, walking directions, and PWA offline support**
- **Search, Today filter, mobile bottom sheet, and enhanced InfoWindow**
- **Neighborhood labels for single-leg trips**
- **Clickable legend type filters and redesigned landing page with gradient cards**
- **Leg filter for trip view**
- **Sidebar with Google Maps links**
- **Status filter toggles**
- **Initial commit - travel map app with Notion integration and Google Maps**
