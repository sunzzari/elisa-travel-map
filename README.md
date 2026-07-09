# Travel Map

An interactive trip planner that pulls trips from Notion and displays them on a Google Map. Built with Next.js, Tailwind CSS, and deployed on Vercel.

**Live site:** [elisa-travel-map.vercel.app](https://elisa-travel-map.vercel.app)

## Stack

- **Next.js 16** (App Router, server components)
- **Google Maps** via `@vis.gl/react-google-maps`
- **Notion** as the backend database
- **Redis** for caching
- **Tailwind CSS** for styling
- **Vercel** for hosting + auto-deploys

## Contributors

- **Elisa Fazzari** ([@elisafazz](https://github.com/elisafazz)) - creator
- **Cathy Sun** ([@nutellafan](https://github.com/nutellafan)) - contributor

## Changelog

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
