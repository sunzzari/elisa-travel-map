/**
 * Asks the Around Town search Elisa's own questions and checks the answers by
 * NAME, so a change to lib/place-search.ts or to which rows count as Around
 * Town is tested against what she actually expects to see.
 *
 *   node scripts/search-check.mjs                         (the live site)
 *   node scripts/search-check.mjs http://localhost:3000   (npm run dev)
 *
 * Free: the search reads the cached place list and calls nothing paid.
 *
 * Why names and not counts: two rounds passed a list of counts while "jian
 * bing" could not find Yu Ji (the row never reached the search) and "mian"
 * also returned Damian. A count cannot see either.
 */
const QUESTIONS = [
  // question, { has: names that must be there, not: names that must not, min, none }
  ['jian bing', { has: ['Yu Ji Stone Mill Chinese Crepes (Jian Bing)'] }],
  ['jian bing in rowland heights', { has: ['Yu Ji Stone Mill Chinese Crepes (Jian Bing)'] }],
  ['jianbing', { has: ['Yu Ji Stone Mill Chinese Crepes (Jian Bing)'] }],
  ['chinese crepes', { has: ['Yu Ji Stone Mill Chinese Crepes (Jian Bing)'], not: ['Genki Crepes and Mini Mart'] }],
  ['mian', { has: ['Mian'], not: ['Damian'] }],
  ['chinese food in san gabriel valley', { has: ['Mian', "Lu's Garden", 'Sinbala', 'Chengdu Taste'], not: ['Tacos el Gordo'], min: 30 }],
  ['chinese food near me', { has: ['Din Tai Fung'], min: 50, nearMe: true }],
  ['restaurant cafe in san gabriel valley', { min: 5 }],
  ['bestia', { has: ['Bestia'] }],
  ['best', { has: ['Bestia'] }],
  ['tacos in la', { min: 5 }],
  ['korean bbq koreatown', { min: 1 }],
  ['dim sum 626', { min: 1 }],
  ["chinese i haven't been to", { min: 1 }],
  ['la brea', { min: 1 }],
  ['zzzqqq', { none: true }],
]

const base = process.argv[2] ?? 'https://elisa-travel-map.vercel.app'
const { places } = await (await fetch(`${base}/api/around-town`)).json()
const nameOf = new Map(places.map(p => [p.id, p.name]))
const byName = new Map(places.map(p => [p.name, p]))

let failed = 0
const fail = message => { failed += 1; console.log(`FAIL  ${message}`) }
console.log(`${base}: ${places.length} saved places\n`)

for (const [question, want] of QUESTIONS) {
  const response = await fetch(`${base}/api/around-town/search?q=${encodeURIComponent(question)}`)
  if (!response.ok) { fail(`"${question}"  HTTP ${response.status}`); continue }
  const r = await response.json()
  const names = r.ids.map(id => nameOf.get(id))
  const problems = [
    ...(want.has ?? []).filter(n => !names.includes(n)).map(n => `missing ${n}`),
    ...(want.not ?? []).filter(n => names.includes(n)).map(n => `should not have ${n}`),
    ...(want.min && names.length < want.min ? [`only ${names.length}, expected ${want.min}+`] : []),
    ...(want.none && names.length ? [`expected nothing, got ${names.length}`] : []),
    ...(want.nearMe && !r.nearMe ? ['near me not understood'] : []),
  ]
  if (problems.length) fail(`"${question}": ${problems.join('; ')}`)
  else console.log(`ok    ${String(names.length).padStart(3)}  "${question}"${r.understood ? `  [${r.understood}]` : ''}`)
  console.log(`          ${names.slice(0, 6).join(' | ')}`)
}

// The map itself, not only the search.
const mian = byName.get('Mian')
if (!mian || mian.lat === null || mian.branches.length !== 2) fail('Mian should have 3 pins (1 + 2 branches)')
else console.log('ok         Mian has 3 pins')

const yuji = byName.get('Yu Ji Stone Mill Chinese Crepes (Jian Bing)')
if (!yuji) fail('Yu Ji is not in Around Town at all')
else if (yuji.lat === null) fail('Yu Ji has an address but no pin')
else console.log('ok         Yu Ji is on the map')

const grey = places.filter(p => p.color === '#8E8E93').length
const rated = places.filter(p => p.preference)
const ratedGrey = rated.filter(p => p.color === '#8E8E93').length
if (ratedGrey > 0) fail(`${ratedGrey} of ${rated.length} rated places are grey, so the legend colours do not show`)
else console.log(`ok         every rated place shows its rating colour (${grey} of ${places.length} pins are grey)`)

const sgv = await (await fetch(`${base}/api/around-town/search?q=${encodeURIComponent('cafe in san gabriel valley')}`)).json()
if (!sgv.hiddenPins?.length) fail('an area search should hide chain branches outside the area')
else console.log(`ok         "cafe in san gabriel valley" hides ${sgv.hiddenPins.length} branch pins outside it`)

process.exit(failed ? 1 : 0)
