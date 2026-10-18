import type { BranchPin } from './saved-pins'

export type TripStatus = 'Planning' | 'Booked' | 'In Progress' | 'Completed' | 'Cancelled'

export type ItemType =
  | 'Hotel'
  | 'Restaurant'
  | 'Activity'
  | 'Flight'
  | 'Train'
  | 'Ferry'
  | 'Car Rental'
  | 'Other'

export type ItemPriority = 'Must' | 'High' | 'Optional'
export type ItemStatus = 'Researching' | 'Shortlisted' | 'Assigned' | 'Reservation Pending' | 'Confirmed' | 'Cancelled'

export interface Coordinates {
  lat: number
  lng: number
}

export interface Trip {
  id: string
  url: string
  name: string
  location: string
  departureDate: string | null
  returnDate: string | null
  status: TripStatus | null
  coverImage: string | null
  /** IANA zone for the trip, e.g. "America/Denver". Blank falls back to the
      viewer's device zone. See lib/day.ts todayInZone. */
  timeZone: string
}

export interface TripItem {
  id: string
  url: string
  name: string
  type: ItemType | null
  priority: ItemPriority | null
  status: ItemStatus | null
  legCity: string
  venue: string
  notes: string
  tripUrl: string
  date: string | null
  dateEnd: string | null
  assignedToDate: string | null
  assignedToDateEnd: string | null
  /** Notion `Time`: free text, a clock time or a rough word. See lib/time.ts. */
  timeText: string
  address: string
  confirmationNumber: string
  bookedVia: string
  reservationRequired: boolean
  reservationMade: boolean
  coordinates?: Coordinates
  /** A chain's other branches, each drawn as its own pin that opens this item. */
  branches?: BranchPin[]
}

export interface DayBundle {
  id: string
  dateString: string
  confirmed: TripItem[]
  possibilities: TripItem[]
}

/** A row of Trip Legs. Legs are a fixed universe set at trip start; read only. */
export interface TripLeg {
  id: string
  name: string
  order: number | null
  startDate: string | null
  /** Checkout-exclusive, like a hotel: the leg's last night is the day before. */
  endDate: string | null
  nights: number | null
}

/** An open Central Task on the trip's Master Project. Read only. */
export interface TripTask {
  id: string
  url: string
  title: string
  workStatus: string
  dueDate: string | null
  targetDate: string | null
}

/** A Notion read that may have failed. A failure is shown, never rendered as empty. */
export type Loaded<T> = { ok: true; value: T } | { ok: false; error: string }

export interface TripWithItems extends Trip {
  items: TripItem[]
}
