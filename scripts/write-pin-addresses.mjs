/**
 * Copies the researched addresses in data/pins/research-output.json into the
 * Notion `Address` column of each place (restaurants, activities, trip items).
 *
 * Only fills an Address that is empty: anything typed in Notion by hand wins.
 * Chain rows get their first branch, since the column holds one address.
 *
 *   node scripts/write-pin-addresses.mjs            # dry run: prints what it would write
 *   node scripts/write-pin-addresses.mjs --write    # writes
 */
import { readFileSync } from 'node:fs'
import { Client } from '@notionhq/client'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n').filter(l => l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')])
)
if (!env.NOTION_TOKEN) throw new Error('NOTION_TOKEN missing from .env.local')
const notion = new Client({ auth: env.NOTION_TOKEN })
const write = process.argv.includes('--write')

const rows = JSON.parse(readFileSync('data/pins/research-output.json', 'utf8'))
  .filter(r => r.status === 'found' && r.address)

const sleep = ms => new Promise(r => setTimeout(r, ms))
const text = p => (p?.rich_text ?? []).map(t => t.plain_text).join('').trim()

let written = 0, skipped = 0, failed = 0
for (const r of rows) {
  try {
    const page = await notion.pages.retrieve({ page_id: r.id })
    if (!('Address' in page.properties)) {
      console.log(`SKIP  ${r.name}: no Address column on this page's database`)
      skipped++
      continue
    }
    if (text(page.properties.Address)) {
      skipped++
      continue
    }
    if (write) {
      await notion.pages.update({
        page_id: r.id,
        properties: { Address: { rich_text: [{ type: 'text', text: { content: r.address } }] } },
      })
    }
    console.log(`${write ? 'WROTE' : 'WOULD'} ${r.name}: ${r.address}`)
    written++
  } catch (err) {
    console.log(`FAIL  ${r.name}: ${err.message}`)
    failed++
  }
  await sleep(350) // Notion allows about 3 requests a second
}
console.log(`\n${write ? 'Written' : 'Would write'}: ${written}. Already had an address: ${skipped}. Failed: ${failed}.`)
if (!write) console.log('Dry run only. Add --write to save.')
