'use client'

import { useState } from 'react'
import type { Loaded, PackingItem } from '@/lib/types'
import { groupByCategory, isDone, stillToPack, type Packer } from '@/lib/packing'

// The trip's packing list inside the Plan tab. Elisa, 2026-11-07: "where is the
// packing dashboard", then "Yes, build it". The rows are the Notion Trip
// Packing copies /notion-trip-packing made for this trip; here you only tick
// them. Mine / Cathy show what that person still owes (same rule as the Notion
// per-person boards, lib/packing.ts); All shows every row with both boxes.

type View = Packer | 'All'

function Box({ on, label, disabled, onClick }: { on: boolean; label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border text-[10px] font-bold transition-colors ${on ? 'border-emerald-400 bg-emerald-400 text-gray-950' : 'border-white/40 hover:border-white/70'} ${disabled ? 'opacity-50' : ''}`}
    >
      {on ? '✓' : ''}
    </button>
  )
}

export default function PackingSection({ packing, passcode }: { packing: Loaded<PackingItem[]>; passcode: string }) {
  const [items, setItems] = useState<PackingItem[]>(packing.ok ? packing.value : [])
  const [view, setView] = useState<View>('Elisa')
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  if (!packing.ok) {
    return <p className="rounded-md bg-red-500/10 px-2 py-1.5 text-xs text-red-300">{packing.error}. Your packing list is not shown.</p>
  }
  if (items.length === 0) {
    return <p className="px-1.5 text-xs text-white/35">No packing list yet. Ask Claude to make the packing list.</p>
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

  return (
    <div className="mt-1" data-section="packing">
      <div className="mb-1.5 flex gap-1">
        {([['Elisa', `Mine ${left.Elisa}`], ['Cathy', `Cathy ${left.Cathy}`], ['All', `All ${items.length}`]] as [View, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setView(id)}
            aria-pressed={view === id}
            className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${view === id ? 'bg-amber-400 font-semibold text-gray-950' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p className="mb-1 rounded-md bg-red-500/10 px-2 py-1.5 text-xs text-red-300">{error}</p>}
      {view !== 'All' && shown.length === 0 && <p className="px-1.5 text-xs text-white/35">All packed.</p>}
      {groupByCategory(shown).map(([category, list]) => (
        <div key={category} className="mb-1.5">
          <p className="px-1.5 text-[10px] uppercase tracking-wider text-white/35">{category} <span className="text-white/25">{list.length}</span></p>
          {list.map(item => {
            const busy = saving.has(item.id)
            return (
              <div key={item.id} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-white/5">
                {view === 'All' ? (
                  <>
                    <Box on={item.elisaPacked} label={`Elisa packed ${item.name}`} disabled={busy} onClick={() => tick(item, 'Elisa')} />
                    <Box on={item.cathyPacked} label={`Cathy packed ${item.name}`} disabled={busy} onClick={() => tick(item, 'Cathy')} />
                  </>
                ) : (
                  <Box on={view === 'Elisa' ? item.elisaPacked : item.cathyPacked} label={`${view} packed ${item.name}`} disabled={busy} onClick={() => tick(item, view)} />
                )}
                <span className={`min-w-0 flex-1 truncate text-[13px] ${view === 'All' && isDone(item) ? 'text-white/35 line-through' : 'text-white/90'}`}>{item.name}</span>
                <span className="flex-shrink-0 text-[10px] text-white/35">{item.who || 'Shared'}</span>
              </div>
            )
          })}
        </div>
      ))}
      {view === 'All' && <p className="px-1.5 text-[10px] text-white/30">Left box Elisa, right box Cathy.</p>}
    </div>
  )
}
