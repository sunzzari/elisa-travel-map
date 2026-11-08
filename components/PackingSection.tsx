'use client'

import { useState, type ReactNode } from 'react'
import type { Loaded, PackingItem } from '@/lib/types'
import { groupByCategory, isDone, stillToPack, type Packer } from '@/lib/packing'

// The trip's packing list, its own mode beside Plan and Trip (no map).
// Elisa, 2026-11-07: "where is the packing dashboard". 2026-11-08:
//   "packing should be a separate mode ... mark clearly the items that are
//    shared that only one of us needs to pack vs. the ones that we both need
//    to pack vs the ones that are individual"
//   "i dont want you to get rid of the item once ive checked it"
//   "you should have toggles for show unpacked items, show all, etc"
//   "a one page view that cathy and elisa both look at. like item then column
//    cathy elisa"
//
// One shared table: item, who, an Elisa column and a Cathy column. The rows
// are the Notion Trip Packing copies /notion-trip-packing made; here you only
// tick `Elisa packed` / `Cathy packed`. Done-ness uses the same rule as the
// Notion boards (lib/packing.ts).

type Show = 'unpacked' | 'packed' | 'all'
const PEOPLE: Packer[] = ['Elisa', 'Cathy']

// One label per Notion `Who` value, in plain words. Colours match the Notion
// select options (Each blue, Shared green, Elisa purple, Cathy orange).
const WHO: Record<string, { label: string; long: string; className: string }> = {
  Each: { label: 'We both pack', long: 'Each of us brings our own', className: 'bg-sky-500/15 text-sky-300 ring-sky-400/40' },
  Shared: { label: 'One of us', long: 'Either of us brings one for both', className: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/40' },
  Elisa: { label: 'Elisa only', long: 'Only Elisa brings it', className: 'bg-violet-500/15 text-violet-300 ring-violet-400/40' },
  Cathy: { label: 'Cathy only', long: 'Only Cathy brings it', className: 'bg-orange-500/15 text-orange-300 ring-orange-400/40' },
}
const whoKey = (item: PackingItem) => item.who || 'Shared'

/** Whether this person has a box for the item at all. */
const packsIt = (item: PackingItem, person: Packer) =>
  item.who === 'Elisa' || item.who === 'Cathy' ? item.who === person : true

function Box({ on, label, disabled, onClick }: { on: boolean; label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={`flex h-5 w-5 items-center justify-center rounded border text-[11px] font-bold transition-colors ${on ? 'border-emerald-400 bg-emerald-400 text-gray-950' : 'border-white/40 hover:border-white/70'} ${disabled ? 'opacity-50' : ''}`}
    >
      {on ? '✓' : ''}
    </button>
  )
}

export default function PackingSection({ packing, passcode }: { packing: Loaded<PackingItem[]>; passcode: string }) {
  const [items, setItems] = useState<PackingItem[]>(packing.ok ? packing.value : [])
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  // All by default, so a checked item never vanishes on its own.
  const [show, setShow] = useState<Show>('all')
  // Which Who kinds to show; empty means every kind. The key chips toggle it.
  const [whoFilter, setWhoFilter] = useState<Set<string>>(new Set())
  // Rows ticked since the filters last changed stay put even under Unpacked,
  // so a tick never makes the row jump away under her finger.
  const [sticky, setSticky] = useState<Set<string>>(new Set())

  const wrap = (children: ReactNode) => <div className="mx-auto max-w-3xl px-4 py-5" data-section="packing">{children}</div>

  if (!packing.ok) {
    return wrap(<p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">{packing.error}. Your packing list is not shown.</p>)
  }
  if (items.length === 0) {
    return wrap(<p className="text-sm text-white/50">No packing list yet. Ask Claude to make the packing list.</p>)
  }

  async function tick(item: PackingItem, person: Packer) {
    const key = person === 'Elisa' ? 'elisaPacked' : 'cathyPacked'
    const packed = !item[key]
    const before = item
    setError(null)
    setSaving(s => new Set(s).add(item.id))
    setSticky(s => new Set(s).add(item.id))
    setItems(list => list.map(i => (i.id === item.id ? { ...i, [key]: packed } : i)))
    try {
      const res = await fetch(`/api/packing/${item.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...(passcode ? { 'x-edit-passcode': passcode } : {}) },
        body: JSON.stringify({ person, packed }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Notion did not save this')
      setItems(list => list.map(i => (i.id === item.id ? body.item : i)))
    } catch (err) {
      setItems(list => list.map(i => (i.id === item.id ? before : i)))
      setError(`${item.name}: ${err instanceof Error ? err.message : 'not saved'}`)
    } finally {
      setSaving(s => { const n = new Set(s); n.delete(item.id); return n })
    }
  }

  const resetSticky = () => setSticky(new Set())
  const left = { Elisa: items.filter(i => stillToPack(i, 'Elisa')).length, Cathy: items.filter(i => stillToPack(i, 'Cathy')).length }
  const done = items.filter(isDone).length
  const shown = items
    .filter(i => whoFilter.size === 0 || whoFilter.has(whoKey(i)))
    .filter(i => show === 'all' || sticky.has(i.id) || (show === 'packed' ? isDone(i) : !isDone(i)))

  function toggleWho(key: string) {
    const next = new Set(whoFilter)
    if (next.has(key)) next.delete(key); else next.add(key)
    setWhoFilter(next.size === Object.keys(WHO).length ? new Set() : next)
    resetSticky()
  }

  return wrap(
    <>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <span className="text-white/80"><span className="font-semibold text-violet-300">Elisa</span> {left.Elisa} left</span>
        <span className="text-white/80"><span className="font-semibold text-orange-300">Cathy</span> {left.Cathy} left</span>
        <span className="text-white/45">{done} of {items.length} done</span>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-white/40">Show</span>
        {([['unpacked', 'Unpacked'], ['packed', 'Packed'], ['all', 'All items']] as [Show, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => { setShow(id); resetSticky() }}
            aria-pressed={show === id}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${show === id ? 'bg-amber-400 font-semibold text-gray-950' : 'bg-white/5 text-white/70 hover:bg-white/10'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg bg-white/5 px-3 py-2">
        {Object.entries(WHO).map(([key, w]) => (
          <button
            key={key}
            onClick={() => toggleWho(key)}
            aria-pressed={whoFilter.has(key)}
            title="Tap to show only this kind"
            className={`flex items-center gap-1.5 text-left text-[11px] text-white/60 transition-opacity ${whoFilter.size === 0 || whoFilter.has(key) ? '' : 'opacity-35'}`}
          >
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${w.className}`}>{w.label}</span>
            {w.long}
          </button>
        ))}
        {whoFilter.size > 0 && <button onClick={() => { setWhoFilter(new Set()); resetSticky() }} className="text-[11px] text-amber-400 underline">Show every kind</button>}
      </div>

      {error && <p className="mb-3 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
      {shown.length === 0 && <p className="text-sm text-white/50">{show === 'unpacked' ? 'Nothing left to pack here.' : 'Nothing matches these filters.'}</p>}

      {shown.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-gray-950">
            <tr className="border-b border-white/15 text-[11px] uppercase tracking-wider text-white/45">
              <th className="py-2 pl-1 text-left font-semibold">Item</th>
              <th className="hidden py-2 text-left font-semibold sm:table-cell">Who</th>
              <th className="w-16 py-2 text-center font-semibold text-violet-300">Elisa</th>
              <th className="w-16 py-2 text-center font-semibold text-orange-300">Cathy</th>
            </tr>
          </thead>
          {groupByCategory(shown).map(([category, list]) => (
            <tbody key={category}>
              <tr>
                <td colSpan={4} className="pb-1 pl-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-white/40">
                  {category} <span className="font-normal text-white/25">{list.length}</span>
                </td>
              </tr>
              {list.map(item => {
                const busy = saving.has(item.id)
                const finished = isDone(item)
                const w = WHO[whoKey(item)]
                const shared = whoKey(item) === 'Shared'
                return (
                  <tr key={item.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="py-1.5 pl-1">
                      <span className={finished ? 'text-white/35 line-through' : 'text-white/90'}>{item.name}</span>
                      <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ring-1 sm:hidden ${w.className}`}>{w.label}</span>
                    </td>
                    <td className="hidden py-1.5 sm:table-cell">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${w.className}`}>{w.label}</span>
                    </td>
                    {PEOPLE.map(person => {
                      const own = person === 'Elisa' ? item.elisaPacked : item.cathyPacked
                      const other = person === 'Elisa' ? item.cathyPacked : item.elisaPacked
                      return (
                        <td key={person} className="py-1.5 text-center">
                          {!packsIt(item, person) ? (
                            <span className="text-white/20" title={`${w.label}: not ${person}'s to pack`}>-</span>
                          ) : shared && other && !own ? (
                            // A One of us item the other person already packed: covered, nothing to do.
                            <span className="text-[10px] text-emerald-300/70" title={`${person === 'Elisa' ? 'Cathy' : 'Elisa'} packed it`}>covered</span>
                          ) : (
                            <span className="inline-flex"><Box on={own} label={`${person} packed ${item.name}`} disabled={busy} onClick={() => tick(item, person)} /></span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          ))}
        </table>
      )}
    </>
  )
}
