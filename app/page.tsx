import { fetchAllTrips } from '@/lib/notion'
import { findLiveTrip, findNextTrip, tripSlug, daysUntil } from '@/lib/trip'
import Link from 'next/link'
import type { Trip } from '@/lib/types'

const GRADIENTS = [
  'from-blue-900 via-blue-700 to-cyan-500',
  'from-violet-900 via-purple-700 to-pink-500',
  'from-emerald-900 via-teal-700 to-green-400',
  'from-orange-900 via-rose-700 to-orange-400',
  'from-slate-900 via-indigo-800 to-blue-500',
  'from-amber-900 via-orange-700 to-yellow-400',
]

const STATUS_BADGE: Record<string, string> = {
  Planning:      'bg-amber-400/15 text-amber-200 border border-amber-400/20',
  Booked:        'bg-blue-400/20 text-blue-100 border border-blue-300/20',
  'In Progress': 'bg-green-400/20 text-green-100 border border-green-300/20',
  Completed:     'bg-white/10 text-white/50 border border-white/15',
  Cancelled:     'bg-red-400/15 text-red-200 border border-red-400/20',
}

function formatDateRange(dep: string | null, ret: string | null) {
  const fmt = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  if (dep && ret && dep !== ret) return `${fmt(dep)} - ${fmt(ret)}`
  if (dep) return fmt(dep)
  return null
}

export default async function Home() {
  const trips = await fetchAllTrips()

  // The live trip goes above everything. During a trip this is the only thing
  // she wants; hunting for it in a grid of cards is the problem being fixed.
  const today = new Date().toISOString().slice(0, 10)
  const live = findLiveTrip(trips, today)
  const next = live ? null : findNextTrip(trips, today)

  const ORDER: Record<string, number> = { 'In Progress': 0, Planning: 1, Booked: 2, Completed: 3, Cancelled: 4 }
  const sorted = [...trips].sort((a, b) => (ORDER[a.status ?? ''] ?? 9) - (ORDER[b.status ?? ''] ?? 9))

  return (
    <main className="h-screen flex flex-col bg-gray-950">
      <div className="flex-shrink-0 px-8 pt-12 pb-8 animate-fade-up" style={{ paddingTop: 'max(3rem, env(safe-area-inset-top, 0px) + 1rem)' }}>
        <h1 className="font-display text-4xl text-white tracking-tight" style={{ letterSpacing: '-0.5px' }}>Trip Maps</h1>
        <div className="w-10 h-[2.5px] bg-gradient-to-r from-amber-400 to-amber-500 rounded-full mt-3" />
        <p className="text-white/30 mt-3 text-sm font-light tracking-wide">{trips.length} trip{trips.length !== 1 ? 's' : ''} planned</p>
      </div>

      <div className="flex-1 overflow-y-auto">
      {(live || next) && (
        <div className="px-8 pb-8">
          <Link
            href={`/${tripSlug((live ?? next)!)}/itinerary`}
            className="group flex items-center gap-4 rounded-2xl border border-amber-400/25 bg-amber-400/10 px-5 py-4 transition-colors hover:bg-amber-400/15"
          >
            <div className="flex-1">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-amber-300/70">
                {live
                  ? 'On this trip now'
                  : `Leaves in ${daysUntil(next!.departureDate!, today)} day${daysUntil(next!.departureDate!, today) === 1 ? '' : 's'}`}
              </p>
              <h2 className="font-display text-xl leading-tight text-white">{(live ?? next)!.name}</h2>
              <p className="mt-1 text-xs text-white/40">{live ? "Open today's plan" : 'Open the day-by-day plan'}</p>
            </div>
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-amber-400 text-gray-950 transition-transform group-hover:translate-x-0.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </div>
          </Link>
        </div>
      )}
      <div className="px-8 pb-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {sorted.map((trip: Trip, i: number) => {
          const gradient = GRADIENTS[i % GRADIENTS.length]
          const dateRange = formatDateRange(trip.departureDate, trip.returnDate)
          const isCompleted = trip.status === 'Completed' || trip.status === 'Cancelled'
          const hasCover = !!trip.coverImage

          return (
            <Link
              key={trip.id}
              href={`/${trip.id.replace(/-/g, '')}`}
              className={`group relative overflow-hidden rounded-2xl aspect-[3/2] flex flex-col justify-between transition-all duration-400 hover:-translate-y-1 hover:shadow-[0_20px_40px_rgba(0,0,0,0.4),0_0_0_1px_rgba(255,255,255,0.08)] animate-fade-up ${isCompleted ? 'opacity-60' : ''}`}
              style={{ animationDelay: `${0.1 + i * 0.1}s` }}
            >
              {hasCover ? (
                <img
                  src={trip.coverImage!}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                />
              ) : (
                <div className={`absolute inset-0 bg-gradient-to-br ${gradient}`} />
              )}

              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/10" />

              <div className="flex justify-start p-5 relative z-10">
                {trip.status && (
                  <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full backdrop-blur-md ${STATUS_BADGE[trip.status] ?? STATUS_BADGE.Planning}`}>
                    {trip.status}
                  </span>
                )}
              </div>

              <div className="relative z-10 p-5 pt-0">
                <p className="text-white/50 text-xs font-normal uppercase tracking-[0.08em] mb-1.5">{trip.location}</p>
                <h2 className="font-display text-white text-2xl leading-tight" style={{ letterSpacing: '-0.2px' }}>{trip.name}</h2>
                {dateRange && (
                  <p className="text-white/35 text-xs mt-2 font-light">{dateRange}</p>
                )}
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-white/30 text-xs font-medium group-hover:text-white/60 transition-colors">Open map</span>
                  <div className="w-7 h-7 rounded-full bg-white/5 border border-white/8 flex items-center justify-center group-hover:bg-amber-400/15 group-hover:border-amber-400/25 transition-all">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/40 group-hover:text-amber-400 group-hover:translate-x-px transition-all">
                      <path d="M5 12h14M12 5l7 7-7 7"/>
                    </svg>
                  </div>
                </div>
              </div>
            </Link>
          )
        })}

        {trips.length === 0 && (
          <p className="text-gray-500 text-sm col-span-full">No trips found in Notion.</p>
        )}
      </div>
      </div>
    </main>
  )
}
