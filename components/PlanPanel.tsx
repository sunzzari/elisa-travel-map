'use client'

import { useState } from 'react'
import { formatLongDate } from '@/lib/day'
import type { TripPlan, PlanDay, Gap } from '@/lib/plan'
import type { Loaded, TripItem, TripTask } from '@/lib/types'
import type { EditableStatus } from '@/lib/trip-item-write'

// The Plan tab's side panel. Same map, same filters as the Trip tab; this only
// swaps what sits beside the map while the trip is still being planned.
//
// Elisa, 2026-10-18: "see what things I have booked, what things I still have
// left to do", "a to-do per day? and a to-do overall?", "highly modular in
// terms of the views i can make". Every section folds away on its own and the
// page remembers which, in the URL.

export const STATUS_DOT: Record<string, string> = {
  Confirmed: '#34C759',
  Assigned: '#0A84FF',
  'Reservation Pending': '#FF9F0A',
  Shortlisted: '#FFD60A',
  Researching: '#8E8E93',
}

export type Section = 'summary' | 'todo' | 'coverage' | 'days'

function shortDate(d: string | null): string {
  return d ? formatLongDate(d, { month: 'short', day: 'numeric' }) : ''
}

function Dot({ status }: { status: string | null }) {
  return <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full" style={{ background: STATUS_DOT[status ?? ''] ?? '#8E8E93' }} />
}

function Heading({ id, title, count, hidden, onToggle }: {
  id: Section; title: string; count?: number; hidden: Set<Section>; onToggle: (s: Section) => void
}) {
  const open = !hidden.has(id)
  return (
    <button onClick={() => onToggle(id)} className="flex w-full items-center gap-2 py-1 text-left">
      <span className="text-[10px] text-white/30">{open ? '▾' : '▸'}</span>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-white/50">{title}</span>
      {count !== undefined && <span className="text-[10px] text-white/30">{count}</span>}
    </button>
  )
}

function ItemRow({ item, number, selected, onSelect, sub }: {
  item: TripItem; number?: number; selected: boolean; onSelect: (i: TripItem) => void; sub?: string
}) {
  return (
    <button
      onClick={() => onSelect(item)}
      className={`flex w-full gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors ${selected ? 'bg-amber-400/10' : 'hover:bg-white/5'}`}
    >
      {number !== undefined
        ? <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-gray-950" style={{ background: STATUS_DOT[item.status ?? ''] ?? '#8E8E93' }}>{number}</span>
        : <Dot status={item.status} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-white/90">{item.name}</span>
        {sub && <span className="block truncate text-[11px] text-white/40">{sub}</span>}
      </span>
    </button>
  )
}

function GapRow({ gap, withDate }: { gap: Gap; withDate: boolean }) {
  return (
    <p className="flex gap-2 px-1.5 py-1 text-[13px] text-white/70">
      <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full border border-orange-300/70" />
      <span>{withDate ? `${shortDate(gap.date)} - ` : ''}{gap.text}</span>
    </p>
  )
}

interface Props {
  plan: TripPlan
  tasks: Loaded<TripTask[]>
  legsError: string | null
  day: PlanDay | null
  numbers: Map<string, number>
  onSelectDate: (date: string | null) => void
  selected: TripItem | null
  onSelect: (item: TripItem) => void
  hidden: Set<Section>
  onToggleSection: (s: Section) => void
  showConsidering: boolean
  matches: (i: TripItem) => boolean
}

export default function PlanPanel(props: Props) {
  const { plan, day } = props
  return day ? <DayView {...props} day={day} /> : <TripView {...props} />
}

function TripView({ plan, tasks, legsError, onSelectDate, selected, onSelect, hidden, onToggleSection, matches }: Props) {
  const openTasks = tasks.ok ? tasks.value : []
  const todoCount = openTasks.length + plan.toBook.length
  return (
    <div className="space-y-4 px-4 py-4">
      <section>
        <Heading id="summary" title="Where it stands" hidden={hidden} onToggle={onToggleSection} />
        {!hidden.has('summary') && (
          <div className="mt-1 grid grid-cols-4 gap-1.5">
            {[
              ['Booked', plan.counts.booked, STATUS_DOT.Confirmed],
              ['Planned', plan.counts.planned, STATUS_DOT.Assigned],
              ['To book', plan.counts.toBook, STATUS_DOT['Reservation Pending']],
              ['Considering', plan.counts.considering, STATUS_DOT.Shortlisted],
            ].map(([label, n, color]) => (
              <div key={label as string} className="rounded-lg bg-white/5 px-2 py-1.5">
                <p className="text-lg font-semibold leading-tight tabular-nums" style={{ color: color as string }}>{n as number}</p>
                <p className="text-[10px] text-white/40">{label as string}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <Heading id="todo" title="To do" count={todoCount} hidden={hidden} onToggle={onToggleSection} />
        {!hidden.has('todo') && (
          <div className="mt-1">
            {!tasks.ok && <p className="rounded-md bg-red-500/10 px-2 py-1.5 text-xs text-red-300">{tasks.error}. Your tasks are not shown.</p>}
            {openTasks.map(task => (
              <a key={task.id} href={task.url} target="_blank" rel="noreferrer" className="flex gap-2 rounded-md px-1.5 py-1.5 hover:bg-white/5">
                <span className="mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-sm border border-white/40" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-white/90">{task.title}</span>
                  <span className="block text-[11px] text-white/40">
                    {[task.workStatus, task.dueDate ? `due ${shortDate(task.dueDate)}` : task.targetDate ? `aim ${shortDate(task.targetDate)}` : ''].filter(Boolean).join(' - ')}
                  </span>
                </span>
              </a>
            ))}
            {plan.toBook.map(item => (
              <ItemRow key={item.id} item={item} selected={selected?.id === item.id} onSelect={onSelect}
                sub={`To book - ${shortDate(item.assignedToDate ?? item.date)}`} />
            ))}
            {tasks.ok && todoCount === 0 && <p className="px-1.5 text-xs text-white/35">Nothing open.</p>}
          </div>
        )}
      </section>

      <section>
        <Heading id="coverage" title="Gaps from your dates" count={plan.gaps.length} hidden={hidden} onToggle={onToggleSection} />
        {!hidden.has('coverage') && (
          <div className="mt-1">
            {legsError && <p className="rounded-md bg-red-500/10 px-2 py-1.5 text-xs text-red-300">{legsError}. Leg gaps are not checked.</p>}
            {plan.gaps.map(g => <GapRow key={`${g.kind}-${g.date}`} gap={g} withDate />)}
            {plan.gaps.length === 0 && <p className="px-1.5 text-xs text-white/35">Every night has a booked hotel and every leg a booked way in.</p>}
          </div>
        )}
      </section>

      <section>
        <Heading id="days" title="Day by day" count={plan.days.length} hidden={hidden} onToggle={onToggleSection} />
        {!hidden.has('days') && (
          <div className="mt-1 space-y-1">
            {plan.days.length === 0 && <p className="px-1.5 text-xs text-white/35">This trip has no dates yet.</p>}
            {plan.days.map(d => {
              const stops = d.committed.filter(c => c.item.type !== 'Hotel' && matches(c.item))
              const dayTodo = d.toBook.length + d.gaps.length
              return (
                <button key={d.date} onClick={() => onSelectDate(d.date)} className="block w-full rounded-lg border border-white/10 px-3 py-2 text-left transition-colors hover:bg-white/5">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold text-amber-300">{formatLongDate(d.date, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                    <span className="truncate text-[11px] text-white/35">{d.leg}</span>
                    {dayTodo > 0 && <span className="ml-auto flex-shrink-0 rounded-full bg-orange-400/15 px-1.5 text-[10px] text-orange-300">{dayTodo} to do</span>}
                  </div>
                  {d.isNight && (
                    <p className="text-[11px] text-white/45">{d.hotel ? `Sleeping at ${d.hotel.name}` : 'No hotel booked'}</p>
                  )}
                  {stops.length > 0
                    ? <p className="mt-0.5 truncate text-xs text-white/70">{stops.map(s => s.item.name).join(' · ')}</p>
                    : <p className="mt-0.5 text-xs text-white/30">Nothing planned</p>}
                  {d.considering.length > 0 && <p className="text-[11px] text-white/30">{d.considering.length} considering</p>}
                </button>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

function DayView({ plan, day, numbers, onSelectDate, selected, onSelect, showConsidering, matches }: Props & { day: PlanDay }) {
  const index = plan.days.findIndex(d => d.date === day.date)
  const prev = plan.days[index - 1]
  const next = plan.days[index + 1]
  const committed = day.committed.filter(c => matches(c.item))
  const considering = day.considering.filter(matches)
  const [showAll, setShowAll] = useState(false)
  const shownConsidering = showAll ? considering : considering.slice(0, 8)

  return (
    <div className="space-y-4 px-4 py-4">
      <div className="flex items-center gap-2">
        <button disabled={!prev} onClick={() => prev && onSelectDate(prev.date)} className="h-8 w-8 flex-shrink-0 rounded-lg bg-white/10 text-white/70 disabled:opacity-25" aria-label="Previous day">‹</button>
        <div className="min-w-0 flex-1 text-center">
          <p className="font-display text-lg leading-tight text-amber-300">{formatLongDate(day.date)}</p>
          <p className="text-[11px] text-white/40">Day {day.dayNumber} of {day.totalDays}{day.leg ? ` - ${day.leg}` : ''}</p>
        </div>
        <button disabled={!next} onClick={() => next && onSelectDate(next.date)} className="h-8 w-8 flex-shrink-0 rounded-lg bg-white/10 text-white/70 disabled:opacity-25" aria-label="Next day">›</button>
      </div>
      <button onClick={() => onSelectDate(null)} className="text-xs text-white/40 underline hover:text-white/70">Back to the whole trip</button>

      {(day.toBook.length > 0 || day.gaps.length > 0) && (
        <section className="rounded-lg border border-orange-400/30 bg-orange-400/10 px-2 py-1.5">
          <p className="px-1.5 text-[10px] font-semibold uppercase tracking-wider text-orange-400">To do for this day</p>
          {day.toBook.map(item => (
            <ItemRow key={item.id} item={item} selected={selected?.id === item.id} onSelect={onSelect} sub="To book" />
          ))}
          {day.gaps.map(g => <GapRow key={g.kind} gap={g} withDate={false} />)}
        </section>
      )}

      {day.isNight && day.hotel && (
        <button onClick={() => onSelect(day.hotel!)} className="block w-full rounded-lg border border-blue-400/30 bg-blue-400/10 px-3 py-2 text-left">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-400">Sleeping tonight</p>
          <p className="text-sm font-semibold text-white">{day.hotel.name}</p>
          <p className="text-[11px] text-white/45">{day.hotel.status}{day.hotel.confirmationNumber ? ` - ${day.hotel.confirmationNumber}` : ''}</p>
        </button>
      )}

      <section>
        <p className="px-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/50">Planned</p>
        {committed.filter(c => c.item.type !== 'Hotel').map(({ item, time }) => (
          <ItemRow key={item.id} item={item} number={numbers.get(item.id)} selected={selected?.id === item.id} onSelect={onSelect}
            sub={[time.label, item.type, item.status].filter(Boolean).join(' - ')} />
        ))}
        {committed.filter(c => c.item.type !== 'Hotel').length === 0 && <p className="px-1.5 text-xs text-white/35">Nothing planned yet.</p>}
      </section>

      <section>
        <p className="px-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/50">
          Considering <span className="text-white/30">{considering.length}</span>
          {!showConsidering && considering.length > 0 && <span className="ml-1 normal-case tracking-normal text-white/30">(off on the map)</span>}
        </p>
        {shownConsidering.map(item => (
          <ItemRow key={item.id} item={item} selected={selected?.id === item.id} onSelect={onSelect} sub={[item.type, item.status].filter(Boolean).join(' - ')} />
        ))}
        {considering.length > 8 && (
          <button onClick={() => setShowAll(v => !v)} className="px-1.5 text-xs text-amber-400 underline">
            {showAll ? 'Show fewer' : `Show all ${considering.length}`}
          </button>
        )}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Status editor. Her click is her word: this is how a candidate becomes a plan.

const CHOICES: { status: EditableStatus; label: string }[] = [
  { status: 'Shortlisted', label: 'Considering' },
  { status: 'Assigned', label: 'Planned' },
  { status: 'Reservation Pending', label: 'To book' },
  { status: 'Confirmed', label: 'Booked' },
  { status: 'Cancelled', label: 'Drop' },
]
const DATED = new Set(['Assigned', 'Reservation Pending', 'Confirmed'])

const field = 'w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-white placeholder:text-white/25 focus:border-amber-400/40 focus:outline-none'

export function StatusEditor({ item, dates, defaultDate, passcode, onSaved, onClose }: {
  item: TripItem
  dates: string[]
  defaultDate: string | null
  passcode: string
  onSaved: (item: TripItem) => void
  onClose: () => void
}) {
  const [status, setStatus] = useState<EditableStatus>((item.status as EditableStatus | null) ?? 'Shortlisted')
  const [date, setDate] = useState(item.assignedToDate ?? item.date ?? defaultDate ?? dates[0] ?? '')
  const [endDate, setEndDate] = useState(item.assignedToDateEnd ?? item.dateEnd ?? '')
  const [time, setTime] = useState(item.timeText)
  const [confirmation, setConfirmation] = useState(item.confirmationNumber)
  const [bookedVia, setBookedVia] = useState(item.bookedVia)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isHotel = item.type === 'Hotel'
  const dated = DATED.has(status)

  async function save() {
    setBusy(true); setError(null)
    const body: Record<string, unknown> = { status }
    if (dated) {
      body.date = date
      if (isHotel && endDate) body.endDate = endDate
      body.time = time
    }
    if (status === 'Confirmed') { body.confirmationNumber = confirmation; body.bookedVia = bookedVia }
    try {
      const res = await fetch(`/api/trip-items/${item.id.replace(/-/g, '')}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-edit-passcode': passcode },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error ?? `Save failed (${res.status})`); return }
      onSaved(json.item)
    } catch {
      setError('No connection. Nothing was saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2.5 rounded-xl border border-amber-400/25 bg-gray-900 p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{item.name}</p>
          <p className="text-[11px] text-white/40">{[item.type, item.legCity, item.status].filter(Boolean).join(' - ')}</p>
        </div>
        <a href={item.url} target="_blank" rel="noreferrer" className="flex-shrink-0 text-[11px] text-amber-400 hover:underline">Notion</a>
        <button onClick={onClose} className="flex-shrink-0 text-xs text-white/40 hover:text-white" aria-label="Close">✕</button>
      </div>

      <div className="flex flex-wrap gap-1">
        {CHOICES.map(c => (
          <button key={c.status} onClick={() => setStatus(c.status)}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium ${status === c.status || (c.status === 'Shortlisted' && status === 'Researching') ? 'border-amber-400 bg-amber-400 text-gray-950' : 'border-white/15 text-white/70 hover:bg-white/5'}`}>
            {c.label}
          </button>
        ))}
      </div>

      {dated && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-white/40">{isHotel ? 'Check in' : 'Day'}</span>
            <select value={date} onChange={e => setDate(e.target.value)} className={field}>
              {dates.map(d => <option key={d} value={d}>{formatLongDate(d, { weekday: 'short', month: 'short', day: 'numeric' })}</option>)}
            </select>
          </label>
          {isHotel ? (
            <label className="block">
              <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-white/40">Check out</span>
              <select value={endDate} onChange={e => setEndDate(e.target.value)} className={field}>
                <option value="">-</option>
                {dates.filter(d => d > date).map(d => <option key={d} value={d}>{formatLongDate(d, { weekday: 'short', month: 'short', day: 'numeric' })}</option>)}
              </select>
            </label>
          ) : (
            <label className="block">
              <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-white/40">Time (optional)</span>
              <input value={time} onChange={e => setTime(e.target.value)} placeholder="7:30pm or evening" className={field} />
            </label>
          )}
        </div>
      )}

      {status === 'Confirmed' && (
        <div className="grid grid-cols-2 gap-2">
          <input value={confirmation} onChange={e => setConfirmation(e.target.value)} placeholder="Confirmation #" className={field} />
          <input value={bookedVia} onChange={e => setBookedVia(e.target.value)} placeholder="Booked via" className={field} />
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
      <button onClick={save} disabled={busy || (dated && !date)} className="w-full rounded-lg bg-amber-400 py-2 text-sm font-semibold text-gray-950 disabled:opacity-40">
        {busy ? 'Saving...' : 'Save to Notion'}
      </button>
    </div>
  )
}
