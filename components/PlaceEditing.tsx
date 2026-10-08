'use client'

import { useCallback, useEffect, useState } from 'react'
import type { TripItem } from '@/lib/types'
import type { AroundTownKind, AroundTownMeta } from '@/lib/aroundtown-shared'
import { PREFERENCES, PREFERENCE_COLORS, RESTAURANT_LOCATIONS } from '@/lib/aroundtown-shared'
import { placeIdOf } from '@/lib/saved-pins'

/**
 * Around Town editing: been there, preference, review, dishes, address and its
 * pin, and adding new places. Viewing needs nothing; editing needs the passcode, which
 * is checked by the server on every request and remembered in this browser.
 */

const STORE_KEY = 'aroundTownPasscode'

function readStored(): string {
  try {
    return localStorage.getItem(STORE_KEY) ?? ''
  } catch {
    return ''
  }
}

function writeStored(value: string | null) {
  try {
    if (value) localStorage.setItem(STORE_KEY, value)
    else localStorage.removeItem(STORE_KEY)
  } catch {}
}

export function usePasscode() {
  const [passcode, setPasscode] = useState('')
  useEffect(() => setPasscode(readStored()), [])

  const unlock = useCallback(async (candidate: string): Promise<string | null> => {
    const res = await fetch('/api/places/auth', { method: 'POST', headers: { 'x-edit-passcode': candidate } })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return body.error ?? 'Could not check the passcode'
    }
    writeStored(candidate)
    setPasscode(candidate)
    return null
  }, [])

  const lock = useCallback(() => {
    writeStored(null)
    setPasscode('')
  }, [])

  return { passcode, unlocked: passcode !== '', unlock, lock }
}

async function send(path: string, method: string, passcode: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-edit-passcode': passcode },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`)
  return json
}

const field = 'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-amber-400/40 focus:outline-none'
const label = 'mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/40'

export function UnlockForm({ onUnlock }: { onUnlock: (code: string) => Promise<string | null> }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={async e => {
        e.preventDefault()
        setBusy(true)
        setError(await onUnlock(code))
        setBusy(false)
      }}
    >
      <input
        type="password"
        value={code}
        onChange={e => setCode(e.target.value)}
        placeholder="Passcode to edit"
        className={`${field} max-w-[180px]`}
        autoComplete="current-password"
      />
      <button disabled={!code || busy} className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-semibold text-gray-950 disabled:opacity-40">
        {busy ? '...' : 'Unlock'}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </form>
  )
}

export interface PickedPin {
  lat: number
  lng: number
}

interface LookupMatch extends PickedPin {
  name: string
  address: string
  source: string
}

/**
 * Address entry with the free lookup (OpenStreetMap and the US Census, on the
 * server). Picking a match sets the address AND its pin; typing clears the pin,
 * and the server pins the typed address itself when the form is saved.
 */
function AddressLookup({
  value,
  onChange,
  name,
  kind,
  neighborhood,
  location,
  passcode,
  mapLink,
  onMapLink,
}: {
  value: string
  onChange: (address: string, pin: PickedPin | null) => void
  /** A pasted Google or Apple Maps link: the server reads the pin out of it when the free lookup cannot place the address. */
  mapLink: string
  onMapLink: (link: string) => void
  name: string
  kind: AroundTownKind
  neighborhood: string
  location: string
  passcode: string
}) {
  const [matches, setMatches] = useState<LookupMatch[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // A typed street address ("123 Main St") is looked up as an address;
  // otherwise the place's name is searched inside its area.
  const typedAddress = /^\s*\d+[a-z]?\s+\S/i.test(value)
  const q = typedAddress ? value : name

  async function search() {
    setBusy(true)
    setNote(null)
    try {
      const params = new URLSearchParams({ q, kind, neighborhood, location })
      const res = await send(`/api/places/lookup?${params}`, 'GET', passcode)
      setMatches(res.matches)
      setNote(res.matches.length ? 'Pick the right one:' : res.note ?? 'No matches. Type the street address and press Find. If it still cannot be found, paste its Google Maps link below.')
    } catch (err) {
      setMatches([])
      setNote((err as Error).message)
    }
    setBusy(false)
  }

  return (
    <div>
      <div className="flex gap-2">
        <input value={value} onChange={e => onChange(e.target.value, null)} placeholder="Street address" className={field} />
        <button
          type="button"
          onClick={search}
          disabled={!q.trim() || busy}
          className="flex-shrink-0 rounded-lg border border-amber-400/40 px-3 text-xs font-medium text-amber-300 disabled:opacity-40"
        >
          {busy ? '...' : 'Find'}
        </button>
      </div>
      {note && <p className="mt-1 text-xs text-white/40">{note}</p>}
      <input
        value={mapLink}
        onChange={e => onMapLink(e.target.value)}
        placeholder="Or paste a Google Maps link to set the pin"
        className={`${field} mt-1.5`}
      />
      {matches.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {matches.map(m => (
            <button
              type="button"
              key={`${m.lat},${m.lng}`}
              onClick={() => {
                onChange(m.address, { lat: m.lat, lng: m.lng })
                setMatches([])
                setNote('Address and pin set. Save to keep them.')
              }}
              className="block w-full rounded-lg bg-white/5 px-3 py-2 text-left hover:bg-white/10"
            >
              {m.name && <span className="block text-sm text-white">{m.name}</span>}
              <span className="block text-xs text-white/50">{m.address}</span>
            </button>
          ))}
          <button type="button" onClick={() => setMatches([])} className="text-xs text-white/40 hover:text-white/70">
            None of these
          </button>
        </div>
      )}
    </div>
  )
}

/** What the server did about the location on a save, in her words. */
function locationNote(location: { placed: boolean } | null | undefined, hadAddress: boolean): string {
  if (!location) return ''
  if (location.placed) return 'Pinned on the map.'
  return hadAddress
    ? 'That address could not be pinned. Open it in Google Maps, tap Share, and paste the link in the address box to pin it.'
    : 'No address yet, so it is under "Not on the map".'
}

function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        on ? 'border-green-400 bg-green-500 text-white' : 'border-white/15 text-white/60 hover:bg-white/5'
      }`}
    >
      {on ? '✓ ' : ''}
      {children}
    </button>
  )
}

function PreferencePicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PREFERENCES.map(p => {
        const on = value === p
        const c = PREFERENCE_COLORS[p]
        return (
          <button
            type="button"
            key={p}
            onClick={() => onChange(on ? null : p)}
            className="rounded-full border px-3 py-1 text-xs font-medium"
            style={on ? { background: c, borderColor: c, color: '#0b0f19' } : { borderColor: `${c}66`, color: c }}
          >
            {p}
          </button>
        )
      })}
    </div>
  )
}

export function PlaceEditor({
  item,
  meta,
  passcode,
  onSaved,
}: {
  item: TripItem
  meta: AroundTownMeta
  passcode: string
  /** `locationChanged`: the pin may have moved, so the page should reload its places. */
  onSaved: (next: AroundTownMeta, locationChanged: boolean) => void
}) {
  const [draft, setDraft] = useState(meta)
  const [pin, setPin] = useState<PickedPin | null>(null)
  const [mapLink, setMapLink] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Reset only when a different place is picked, so a save's own update does
  // not wipe the "Saved" message.
  useEffect(() => {
    setDraft(meta)
    setPin(null)
    setStatus(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  const isRestaurant = meta.kind === 'restaurant'
  const set = (patch: Partial<AroundTownMeta>) => setDraft(d => ({ ...d, ...patch }))

  async function save() {
    setBusy(true)
    setStatus(null)
    const body: Record<string, unknown> = {
      beenThere: draft.done,
      thinkingAbout: draft.done ? false : draft.thinkingAbout,
    }
    // The address goes up only when it changed or a match was picked. Sending
    // an unchanged address would make the server re-pin it, and could drop a
    // good pin for no reason.
    const link = mapLink.trim()
    const addressChanged = draft.address.trim() !== meta.address.trim()
    const locationChanged = pin !== null || addressChanged || link !== ''
    if (pin !== null || addressChanged) body.address = draft.address
    // A pasted link wins over a picked match: she pasted it because the match was wrong or missing.
    if (link) body.mapLink = link
    else if (pin) Object.assign(body, pin)
    if (isRestaurant) {
      body.preference = draft.preference
      body.comments = draft.comments
      body.topDishes = draft.topDishes
    }
    try {
      const res = await send(`/api/places/${placeIdOf(item.id)}`, 'PATCH', passcode, body)
      onSaved({ ...draft, thinkingAbout: draft.done ? false : draft.thinkingAbout }, locationChanged)
      setPin(null)
      setMapLink('')
      setStatus(`Saved to Notion. ${locationNote(res.location, draft.address.trim() !== '')}`.trim())
    } catch (err) {
      setStatus((err as Error).message)
    }
    setBusy(false)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <Toggle on={draft.done} onChange={v => set({ done: v, thinkingAbout: v ? false : draft.thinkingAbout })}>
          {isRestaurant ? 'Been there' : 'Done'}
        </Toggle>
        {!draft.done && (
          <Toggle on={draft.thinkingAbout} onChange={v => set({ thinkingAbout: v })}>
            Want to try
          </Toggle>
        )}
      </div>

      {isRestaurant && (
        <>
          <div>
            <span className={label}>Preference</span>
            <PreferencePicker value={draft.preference} onChange={v => set({ preference: v })} />
          </div>
          <div>
            <span className={label}>Review / comments</span>
            <textarea rows={3} value={draft.comments} onChange={e => set({ comments: e.target.value })} className={field} />
          </div>
          <div>
            <span className={label}>Top dishes</span>
            <textarea rows={2} value={draft.topDishes} onChange={e => set({ topDishes: e.target.value })} className={field} />
          </div>
        </>
      )}

      <div>
        <span className={label}>Address</span>
        <AddressLookup
          value={draft.address}
          onChange={(address, picked) => {
            set({ address })
            setPin(picked)
          }}
          name={item.name}
          kind={meta.kind}
          neighborhood={meta.neighborhood}
          location={meta.locationText}
          passcode={passcode}
          mapLink={mapLink}
          onMapLink={setMapLink}
        />
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={busy} className="rounded-lg bg-amber-400 px-4 py-2 text-xs font-semibold text-gray-950 disabled:opacity-40">
          {busy ? 'Saving...' : 'Save'}
        </button>
        {status && <span className="text-xs text-white/50">{status}</span>}
      </div>
    </div>
  )
}

export function AddPlaceForm({ passcode, onDone }: { passcode: string; onDone: (message: string) => void }) {
  const [kind, setKind] = useState<AroundTownKind>('restaurant')
  const [name, setName] = useState('')
  const [neighborhood, setNeighborhood] = useState('')
  const [location, setLocation] = useState('')
  const [address, setAddress] = useState('')
  const [pin, setPin] = useState<PickedPin | null>(null)
  const [mapLink, setMapLink] = useState('')
  const [beenThere, setBeenThere] = useState(false)
  const [thinkingAbout, setThinkingAbout] = useState(true)
  const [preference, setPreference] = useState<string | null>(null)
  const [comments, setComments] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // The server refuses a restaurant without both (Elisa 2026-10-08, "Block the add"); say so before the tap.
  const needsMore = kind === 'restaurant' && (!location || !address.trim())

  async function save() {
    setBusy(true)
    setError(null)
    const body: Record<string, unknown> = {
      kind,
      name,
      location,
      address,
      beenThere,
      thinkingAbout: beenThere ? false : thinkingAbout,
    }
    if (mapLink.trim()) body.mapLink = mapLink.trim()
    else if (pin) Object.assign(body, pin)
    if (kind === 'restaurant') Object.assign(body, { neighborhood, preference, comments })
    try {
      const res = await send('/api/places', 'POST', passcode, body)
      onDone(`${name} added. ${locationNote(res.location, address.trim() !== '')}`.trim())
    } catch (err) {
      setError((err as Error).message)
    }
    setBusy(false)
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {(['restaurant', 'activity'] as AroundTownKind[]).map(k => (
          <Toggle key={k} on={kind === k} onChange={() => setKind(k)}>
            {k === 'restaurant' ? 'Restaurant' : 'Activity'}
          </Toggle>
        ))}
      </div>
      <div>
        <span className={label}>Name</span>
        <input value={name} onChange={e => setName(e.target.value)} className={field} />
      </div>
      {kind === 'restaurant' ? (
        <div className="flex gap-2">
          <div className="flex-1">
            <span className={label}>Neighborhood</span>
            <input value={neighborhood} onChange={e => setNeighborhood(e.target.value)} placeholder="e.g. Silver Lake" className={field} />
          </div>
          <div className="w-32">
            <span className={label}>Location</span>
            <select value={location} onChange={e => setLocation(e.target.value)} className={field}>
              <option value="">Choose</option>
              {RESTAURANT_LOCATIONS.map(l => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <div>
          <span className={label}>Location</span>
          <input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Malibu, CA" className={field} />
        </div>
      )}
      <div>
        <span className={label}>Address</span>
        <AddressLookup
          value={address}
          onChange={(next, picked) => {
            setAddress(next)
            setPin(picked)
          }}
          name={name}
          kind={kind}
          neighborhood={kind === 'restaurant' ? neighborhood : ''}
          location={location}
          passcode={passcode}
          mapLink={mapLink}
          onMapLink={setMapLink}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Toggle on={beenThere} onChange={setBeenThere}>{kind === 'restaurant' ? 'Been there' : 'Done'}</Toggle>
        {!beenThere && <Toggle on={thinkingAbout} onChange={setThinkingAbout}>Want to try</Toggle>}
      </div>
      {kind === 'restaurant' && (
        <>
          <PreferencePicker value={preference} onChange={setPreference} />
          <textarea rows={2} value={comments} onChange={e => setComments(e.target.value)} placeholder="Review / comments" className={field} />
        </>
      )}
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={!name.trim() || needsMore || busy} className="rounded-lg bg-amber-400 px-4 py-2 text-xs font-semibold text-gray-950 disabled:opacity-40">
          {busy ? 'Saving...' : 'Add place'}
        </button>
        {needsMore && !error && <span className="text-xs text-white/50">A restaurant needs a Location and an address.</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  )
}
