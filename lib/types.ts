export type TripStatus = 'Planning' | 'Booked' | 'In Progress' | 'Completed'

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
  reservationRequired: boolean
  coordinates?: Coordinates
}

export interface DayBundle {
  id: string
  dateString: string
  confirmed: TripItem[]
  possibilities: TripItem[]
}

export interface TripNewsletter {
  id: string
  tripId: string
  date: string
  prose: string
  generatedAt: string | null
  stale: boolean
  itemsHash: string
}

export interface TripWithItems extends Trip {
  items: TripItem[]
}
