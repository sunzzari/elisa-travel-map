'use client'

import { useState, type ReactNode } from 'react'
import type { Loaded, PackingItem } from '@/lib/types'
import { groupByCategory, isDone, stillToPack, type Packer } from '@/lib/packing'

// The trip's packing list, its own mode beside Plan and Trip (no map). Elisa,
// 2026-11-07: "where is the packing dashboard"; 2026-11-08: "packing should be
// a separate mode ... there should be a way to mark clearly the items that are
// shared that only one of us needs to pack vs. the ones that we both need to
// pack vs the ones that are individual that only one of us needs to pack".
//
// The rows are the Notion Trip Packing copies /notion-trip-packing made; here
// you only tick them. Mine / Cathy show what that person still owes (same rule
// as the Notion per-person boards, lib/packing.ts); All shows every row.

type View = Packer | 'All'

// One label per Notion `Who` value, in plain words. Colours match the Notion
// select options (Each blue, Shared green, Elisa purple, Cathy orange).
const WHO: Record<string, { label: string; long: string; className: string }> = {
  Each: { label: 'We both pack', long: 'Each of us brings our own', className: 'bg-sky-500/15 text-sky-300 ring-sky-400/40' },
  Shared: { label: 'One of us', long: 'Either of us brings one for both', className: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/40' },
  Elisa: { label: 'Elisa only', long: 'Only Elisa brings it', className: 'bg-violet-500/15 text-violet-300 ring-violet-400/40' },
  Cathy: { label: 'Cathy only', long: 'Only Cathy brings it', className: 'bg-orange-500/15 text-orange-300 ring-orange-400/40' },
}
const whoOf = (item: PackingItem) => WHO[item.who || 'Shared']

function WhoTag({ item }: { item: PackingItem }) {
  const w = whoOf(item)
  return <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${w.className}`}>{w.label}</span>
}

function Box({ on, letter, label, disabled, onClick }: { on: boolean; letter?: string; label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border text-[10px] font-bold transition-colors ${on ? 'border-emerald-400 bg-emerald-400 text-gray-950' : 'border-white/40 text-white/50 hover:border-white/70'} ${disabled ? 'opacity-50' : ''}`}
    >
      {on ? '✓' : letter ?? ''}
    </button>
  )
}

export default function PackingSection({ packing, passcode }: { packing: Loaded<PackingItem[]>; passcode: string }) {
  const [items, setItems] = useState<PackingItem[]>(packing.ok ? packing.value : [])
  const [view, setView] = useState<View>('Elisa')
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const wrap = (children: ReactNode) => <div className="mx-auto max-w-5xl px-4 py-5" data-section="packing">{children}</div>

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

  const left = { Elisa: items.filter(i => stillToPack(i, 'Elisa')).length, Cathy: items.filter(i => stillToPack(i, 'Cathy')).length }
  const shown = view === 'All' ? items : items.filter(i => stillToPack(i, view))
  const done = items.filter(isDone).length

  // Which boxes a row gets in All: one per person who could pack it.
  const packersFor = (item: PackingItem): Packer[] =>
    item.who === 'Elisa' ? ['Elisa'] : item.who === 'Cathy' ? ['Cathy'] : ['Elisa', 'Cathy']

  return wrap(
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {([['Elisa', `Mine - ${left.Elisa} left`], ['Cathy', `Cathy - ${left.Cathy} left`], ['All', `All ${items.length} - ${done} done`]] as [View, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setView(id)}
            aria-pressed={view === id}
            className={`rounded-full px-3 py-1.5 text-xs transition-colors ${view === id ? 'bg-amber-400 font-semibold text-gray-950' : 'bg-white/5 text-white/70 hover:bg-white/10'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5 rounded-lg bg-white/5 px-3 py-2">
        {Object.entries(WHO).map(([key, w]) => (
          <span key={key} className="flex items-center gap-1.5 text-[11px] text-white/60">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${w.className}`}>{w.label}</span>
            {w.long}
          </span>
        ))}
      </div>

      {error && <p className="mb-3 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
      {view !== 'All' && shown.length === 0 && <p className="text-sm text-white/50">All packed.</p>}

      <div className="gap-6 md:columns-2">
        {groupByCategory(shown).map(([category, list]) => (
          <div key={category} className="mb-4 break-inside-avoid">
            <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-white/40">{category} <span className="font-normal text-white/25">{list.length}</span></p>
            {list.map(item => {
              const busy = saving.has(item.id)
              return (
                <div key={item.id} className="flex items-center gap-2.5 rounded-md px-1 py-1.5 hover:bg-white/5">
                  {view === 'All' ? (
                    <span className="flex w-12 flex-shrink-0 gap-1.5">
                      {packersFor(item).map(p => (
                        <Box key={p} on={p === 'Elisa' ? item.elisaPacked : item.cathyPacked} letter={p[0]} label={`${p} packed ${item.name}`} disabled={busy} onClick={() => tick(item, p)} />
                      ))}
                    </span>
                  ) : (
                    <Box on={view === 'Elisa' ? item.elisaPacked : item.cathyPacked} label={`${view} packed ${item.name}`} disabled={busy} onClick={() => tick(item, view)} />
                  )}
                  <span className={`min-w-0 flex-1 truncate text-sm ${view === 'All' && isDone(item) ? 'text-white/35 line-through' : 'text-white/90'}`}>{item.name}</span>
                  <WhoTag item={item} />
                </div>
              )
            })}
          </div>
        ))}
      </div>
      {view === 'All' && <p className="mt-2 text-[11px] text-white/35">E is Elisa&apos;s box, C is Cathy&apos;s. A One of us item is done when either box is checked.</p>}
    </>
  )
}
