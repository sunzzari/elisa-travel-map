'use client'

import { useEffect, useState, type ReactNode } from 'react'
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
//   "get rid of the legend. also add some sorting and filtration capabilities.
//    add an easy way for elisa to see her remining things and cathy to see her
//    remaining things. ... one person changing the view should only change
//    thiers. instead of the show toggles just make filters and sort"
//
// One shared table: item, who, an Elisa column and a Cathy column. The rows
// are the Notion Trip Packing copies /notion-trip-packing made; here you only
// tick `Elisa packed` / `Cathy packed`. Done-ness uses the same rule as the
// Notion boards (lib/packing.ts).

// Status filter. "Elisa left" / "Cathy left" are each person's remaining
// items, the same rule as the Notion per-person boards.
type Status = 'all' | 'unpacked' | 'packed' | 'elisa-left' | 'cathy-left'
type Sort = 'category' | 'name' | 'who' | 'unpacked-first'
interface ViewPrefs { status: Status; who: string; category: string; compartment: string; sort: Sort; q: string }
const DEFAULT_PREFS: ViewPrefs = { status: 'all', who: 'all', category: 'all', compartment: 'all', sort: 'category', q: '' }
// Notion's own order for the Compartment options; an item with none reads "Not set".
const COMPARTMENT_ORDER = ['Backpack', 'Carry-On', 'Lole', 'Checked Bag', 'Wear']
const NO_COMPARTMENT = 'none'
// Each person's view lives in their own browser, so changing it never
// changes anyone else's. Elisa, 2026-11-08: "one person changing the view
// should only change thiers."
const PREFS_KEY = 'packing-view-v1'
function readPrefs(): ViewPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS
  } catch {
    return DEFAULT_PREFS
  }
}
function writePrefs(p: ViewPrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch {}
}
const WHO_ORDER = ['Each', 'Shared', 'Elisa', 'Cathy']
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
  // Filters and sort. All items by default, so a checked item never vanishes
  // on its own. Saved per browser (readPrefs), never shared.
  const [prefs, setPrefsState] = useState<ViewPrefs>(DEFAULT_PREFS)
  useEffect(() => setPrefsState(readPrefs()), [])
  // Rows ticked since the filters last changed stay put even under Unpacked,
  // so a tick never makes the row jump away under her finger.
  const [sticky, setSticky] = useState<Set<string>>(new Set())
  // Remove asks once on the row, then offers Undo. Elisa, 2026-11-08: "make an
  // option to delte something from the packing list". Only this trip's copy
  // goes (to Notion Trash); the Master Packing List is never touched.
  const [confirming, setConfirming] = useState<string | null>(null)
  const [removed, setRemoved] = useState<PackingItem | null>(null)

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

  const headers = { 'content-type': 'application/json', ...(passcode ? { 'x-edit-passcode': passcode } : {}) }

  async function remove(item: PackingItem) {
    setConfirming(null)
    setError(null)
    setItems(list => list.filter(i => i.id !== item.id))
    try {
      const res = await fetch(`/api/packing/${item.id}`, { method: 'DELETE', headers })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Notion did not remove this')
      setRemoved(item)
    } catch (err) {
      setItems(list => [...list, item])
      setError(`${item.name}: ${err instanceof Error ? err.message : 'not removed'}`)
    }
  }

  async function undoRemove() {
    const item = removed
    if (!item) return
    setRemoved(null)
    try {
      const res = await fetch(`/api/packing/${item.id}`, { method: 'PATCH', headers, body: JSON.stringify({ restore: true }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Notion did not restore this')
      setItems(list => [...list, body.item ?? item])
    } catch (err) {
      setError(`${item.name}: ${err instanceof Error ? err.message : 'not restored'}. It is in Notion Trash.`)
    }
  }

  const setPrefs = (patch: Partial<ViewPrefs>) => {
    const next = { ...prefs, ...patch }
    setPrefsState(next)
    writePrefs(next)
    setSticky(new Set())
  }
  const left = { Elisa: items.filter(i => stillToPack(i, 'Elisa')).length, Cathy: items.filter(i => stillToPack(i, 'Cathy')).length }
  const done = items.filter(isDone).length
  const categories = Array.from(new Set(items.map(i => i.category))).sort()
  const compartments = Array.from(new Set(items.flatMap(i => i.compartments)))
    .sort((a, b) => (COMPARTMENT_ORDER.indexOf(a) + 1 || 99) - (COMPARTMENT_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b))
  const q = prefs.q.trim().toLowerCase()
  const statusOk = (i: PackingItem) => {
    switch (prefs.status) {
      case 'unpacked': return !isDone(i)
      case 'packed': return isDone(i)
      case 'elisa-left': return stillToPack(i, 'Elisa')
      case 'cathy-left': return stillToPack(i, 'Cathy')
      default: return true
    }
  }
  const shown = items
    .filter(i => prefs.who === 'all' || whoKey(i) === prefs.who)
    .filter(i => prefs.category === 'all' || i.category === prefs.category)
    .filter(i => prefs.compartment === 'all' || (prefs.compartment === NO_COMPARTMENT ? i.compartments.length === 0 : i.compartments.includes(prefs.compartment)))
    .filter(i => !q || i.name.toLowerCase().includes(q))
    .filter(i => sticky.has(i.id) || statusOk(i))
  const byName = (a: PackingItem, b: PackingItem) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  const sorted = [...shown].sort((a, b) => {
    if (prefs.sort === 'who') return WHO_ORDER.indexOf(whoKey(a)) - WHO_ORDER.indexOf(whoKey(b)) || byName(a, b)
    if (prefs.sort === 'unpacked-first') return Number(isDone(a)) - Number(isDone(b)) || byName(a, b)
    return byName(a, b)
  })
  // Category sort keeps the category headings; the others are one flat list.
  const sections: [string, PackingItem[]][] = prefs.sort === 'category' ? groupByCategory(sorted) : [['', sorted]]
  const filtered = prefs.status !== 'all' || prefs.who !== 'all' || prefs.category !== 'all' || prefs.compartment !== 'all' || !!q
  const select = 'rounded-md border border-white/15 bg-gray-900 px-2 py-1 text-xs text-white/80 focus:border-amber-400/50 focus:outline-none'

  return wrap(
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {([['elisa-left', 'Elisa', left.Elisa, 'text-violet-300'], ['cathy-left', 'Cathy', left.Cathy, 'text-orange-300']] as [Status, string, number, string][]).map(([id, name, n, color]) => {
          const on = prefs.status === id
          return (
            <button
              key={id}
              onClick={() => setPrefs({ status: on ? 'all' : id })}
              aria-pressed={on}
              title={on ? 'Show everything again' : `Show only what ${name} still has to pack`}
              className={`rounded-full px-3 py-1 transition-colors ${on ? 'bg-white/15 ring-1 ring-white/30' : 'bg-white/5 hover:bg-white/10'}`}
            >
              <span className={`font-semibold ${color}`}>{name}</span> <span className="text-white/80">{n} left</span>
            </button>
          )
        })}
        <span className="text-white/45">{done} of {items.length} done</span>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={prefs.q}
          onChange={e => setPrefs({ q: e.target.value })}
          placeholder="Find an item"
          className={`${select} w-36`}
        />
        <select aria-label="Status" value={prefs.status} onChange={e => setPrefs({ status: e.target.value as Status })} className={select}>
          <option value="all">Any status</option>
          <option value="unpacked">Not done</option>
          <option value="packed">Done</option>
          <option value="elisa-left">Elisa still to pack</option>
          <option value="cathy-left">Cathy still to pack</option>
        </select>
        <select aria-label="Who" value={prefs.who} onChange={e => setPrefs({ who: e.target.value })} className={select}>
          <option value="all">Anyone</option>
          {WHO_ORDER.map(k => <option key={k} value={k}>{WHO[k].label}</option>)}
        </select>
        <select aria-label="Category" value={prefs.category} onChange={e => setPrefs({ category: e.target.value })} className={select}>
          <option value="all">All categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select aria-label="Compartment" value={prefs.compartment} onChange={e => setPrefs({ compartment: e.target.value })} className={select}>
          <option value="all">Any bag</option>
          {compartments.map(c => <option key={c} value={c}>{c}</option>)}
          <option value={NO_COMPARTMENT}>Bag not set</option>
        </select>
        <span className="ml-1 text-[11px] text-white/40">Sort</span>
        <select aria-label="Sort" value={prefs.sort} onChange={e => setPrefs({ sort: e.target.value as Sort })} className={select}>
          <option value="category">By category</option>
          <option value="name">A to Z</option>
          <option value="who">By who</option>
          <option value="unpacked-first">Not done first</option>
        </select>
        {filtered && <button onClick={() => setPrefs({ status: 'all', who: 'all', category: 'all', compartment: 'all', q: '' })} className="text-[11px] text-amber-400 underline">Clear filters</button>}
        {filtered && <span className="text-[11px] text-white/40">{shown.length} shown</span>}
      </div>

      {error && <p className="mb-3 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
      {removed && (
        <p className="mb-3 flex items-center gap-2 rounded-md bg-white/5 px-3 py-2 text-xs text-white/70">
          Removed {removed.name} from this trip&apos;s list.
          <button onClick={undoRemove} className="font-semibold text-amber-400 underline">Undo</button>
          <button onClick={() => setRemoved(null)} className="ml-auto text-white/40 hover:text-white" aria-label="Dismiss">✕</button>
        </p>
      )}
      {shown.length === 0 && <p className="text-sm text-white/50">{prefs.status === 'elisa-left' || prefs.status === 'cathy-left' || prefs.status === 'unpacked' ? 'Nothing left to pack here.' : 'Nothing matches these filters.'}</p>}

      {shown.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-gray-950">
            <tr className="border-b border-white/15 text-[11px] uppercase tracking-wider text-white/45">
              <th className="py-2 pl-1 text-left font-semibold">Item</th>
              <th className="hidden py-2 text-left font-semibold sm:table-cell">Who</th>
              <th className="hidden py-2 text-left font-semibold md:table-cell">Bag</th>
              <th className="w-16 py-2 text-center font-semibold text-violet-300">Elisa</th>
              <th className="w-16 py-2 text-center font-semibold text-orange-300">Cathy</th>
              <th className="w-8 py-2"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          {sections.map(([category, list]) => (
            <tbody key={category || 'all'}>
              {category && <tr>
                <td colSpan={6} className="pb-1 pl-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-white/40">
                  {category} <span className="font-normal text-white/25">{list.length}</span>
                </td>
              </tr>}
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
                      {item.compartments.length > 0 && <span className="block text-[10px] text-white/40 md:hidden">{item.compartments.join(', ')}</span>}
                    </td>
                    <td className="hidden py-1.5 sm:table-cell">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${w.className}`}>{w.label}</span>
                    </td>
                    <td className="hidden py-1.5 text-[11px] text-white/55 md:table-cell">{item.compartments.join(', ') || <span className="text-white/25">Not set</span>}</td>
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
                    <td className="py-1.5 pr-1 text-right">
                      {confirming === item.id ? (
                        <span className="whitespace-nowrap text-[11px]">
                          <button onClick={() => remove(item)} className="font-semibold text-red-300 hover:text-red-200">Remove</button>
                          <button onClick={() => setConfirming(null)} className="ml-2 text-white/50 hover:text-white">Keep</button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirming(item.id)}
                          aria-label={`Remove ${item.name} from this trip`}
                          title="Remove from this trip's list"
                          className="rounded px-1 text-white/25 hover:bg-white/10 hover:text-red-300"
                        >
                          ✕
                        </button>
                      )}
                    </td>
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
