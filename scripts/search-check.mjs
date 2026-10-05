/**
 * Asks the Around Town search a fixed list of questions and prints what each
 * one finds, so a change to lib/place-search.ts can be checked on real places.
 *
 *   node scripts/search-check.mjs                         (the live site)
 *   node scripts/search-check.mjs http://localhost:3000   (npm run dev)
 *
 * Free: the search reads the cached place list and calls nothing paid.
 */
const QUESTIONS = [
  // question, the fewest places it must find (null = must find none)
  ['jian bing in rowland heights', 1],
  ['chinese food near me', 40],
  ['restaurant cafe in san gabriel valley', 1],
  ['bestia', 1],
  ['best', 1],
  ['tacos in la', 5],
  ['korean bbq koreatown', 1],
  ['dim sum 626', 1],
  ["chinese i haven't been to", 1],
  ['sushi sf', 0],
  ['coffee in marin', 0],
  ['la brea', 1],
  ['zzzqqq', null],
]

const base = process.argv[2] ?? 'https://elisa-travel-map.vercel.app'
const { places } = await (await fetch(`${base}/api/around-town`)).json()
const nameOf = new Map(places.map(p => [p.id, p.name]))

let failed = 0
console.log(`${base}: ${places.length} saved places\n`)
for (const [question, atLeast] of QUESTIONS) {
  const response = await fetch(`${base}/api/around-town/search?q=${encodeURIComponent(question)}`)
  if (!response.ok) {
    failed += 1
    console.log(`FAIL      "${question}"  HTTP ${response.status}`)
    continue
  }
  const r = await response.json()
  const ok = atLeast === null ? r.ids.length === 0 : r.ids.length >= atLeast
  if (!ok) failed += 1
  const flags = Object.entries(r.filters).filter(([, on]) => on).map(([k]) => k)
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${String(r.ids.length).padStart(3)}  "${question}"` +
      (r.understood ? `  [${r.understood}]` : '') +
      (r.nearMe ? '  (near me)' : '') +
      (flags.length ? `  (phone applies: ${flags.join(', ')})` : '')
  )
  console.log(`          ${r.ids.slice(0, 5).map(id => nameOf.get(id)).join(' | ')}`)
}
process.exit(failed ? 1 : 0)
