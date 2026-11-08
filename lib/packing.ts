import type { PackingItem } from './types'

// Who still owes a packing item. The same rule as the Notion Trip Packing
// formulas and per-person views (~/Dropbox/claude/notion/skills/
// notion-trip-packing/PACKING-STRUCTURE.md), kept in one place here:
//   Each   - on both lists until that person's own box is checked
//   Elisa  - only on Elisa's list; Cathy only on Cathy's
//   Shared - on both lists until EITHER box is checked
//   (none) - treated as Shared, so it never silently drops off both lists

export type Packer = 'Elisa' | 'Cathy'

export function stillToPack(item: PackingItem, person: Packer): boolean {
  const own = person === 'Elisa' ? item.elisaPacked : item.cathyPacked
  if (item.who === 'Each') return !own
  if (item.who === 'Elisa' || item.who === 'Cathy') return item.who === person && !own
  return !(item.elisaPacked || item.cathyPacked)
}

export function isDone(item: PackingItem): boolean {
  return !stillToPack(item, 'Elisa') && !stillToPack(item, 'Cathy')
}

export function groupByCategory(items: PackingItem[]): [string, PackingItem[]][] {
  const groups = new Map<string, PackingItem[]>()
  for (const item of items) {
    const list = groups.get(item.category) ?? []
    list.push(item)
    groups.set(item.category, list)
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}
