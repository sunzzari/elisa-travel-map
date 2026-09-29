# Pins research: brief for the cloud session

You are a Claude Code cloud session on branch `pins-research` of `sunzzari/elisa-travel-map`,
working for Elisa. Everything you need is in this file. Where it conflicts with your defaults,
this file wins.

## Job

`data/pins/research-input.json` lists places that a free OpenStreetMap search could not pin with
confidence. For each one, find its real street address on a web page about that exact business or
place, and record the page's URL. You do NOT produce coordinates. A script on Elisa's Mac turns
your addresses into map pins with free public geocoders and checks each against its expected area.

## Hard rules

1. **Cost.** Elisa: "make sure YOU DO NOT MAKE ME PAY MORE THAN THE $100 CREDIT". Use only your
   built-in web search. No API keys, no paid services, no installs; you need none. Run batches
   through subagents on the `sonnet` model.
2. **Never guess.** Elisa: "what plans do you have to make sure that wronga ddresses arent added?
   such as ones in wrong countries". Never invent an address, a URL or a place. Every URL you record
   must be one your search returned. "Not found" is a correct answer; a plausible guess is the failure.
3. **Area.** Each row has an `area` (neighborhood and city, or leg city and trip location). An
   address counts only if its city, ZIP or country sits inside that area. If the business exists
   only somewhere else, the status is `needs-you` and the note says where.
4. **Chains.** If several branches exist and the row's area picks exactly one, use it. Otherwise
   `needs-you`, with up to 3 branch addresses in `alternatives`.
5. **Not a place.** If the name describes an activity, an outing or a deal rather than a venue
   ("Groupon", "Spa Day", "Private guide, 2 full days", "Elisa Date"), the status is `not-a-place`
   with a one-line reason. Never pick a venue for it. If the row has a `venue`, research the venue.
6. **Closed.** Still record the address; set `closed` to true when the source says permanently closed.
7. **Git.** Commit only `data/pins/research-output.json` (and short progress notes under `docs/`).
   Push only the branch `pins-research`. Never push to `master`, never open a pull request. A push
   to master deploys her live site.
8. **Privacy.** The repo is public. Record only the fields below.

## Output: `data/pins/research-output.json`

A JSON array, one object per researched row:

```json
{
  "id": "copied from the input",
  "name": "copied from the input",
  "status": "found | needs-you | not-a-place",
  "address": "street, city, state or region, postal code, country (found only)",
  "sourceUrl": "a URL your search returned",
  "sourceTitle": "that page's title",
  "note": "one short line: why this is the right place, or what is missing",
  "closed": false,
  "alternatives": ["up to 3 addresses, needs-you only"]
}
```

## Steps

1. Read `data/pins/research-input.json`. The first 25 rows are a mixed pilot on purpose.
2. **Pilot:** research the first 25 rows only. Write the output file, commit, push the branch.
   Then STOP and reply with the counts per status and anything that surprised you. Wait for a
   message that says "continue".
3. On "continue": research the rest in batches of about 20 through subagents (model `sonnet`), each
   returning only the output fields. Append to the output file, then commit and push after every
   batch. Keep going unless a message says stop.
4. Final reply: counts per status, in plain language, no emojis, no em-dashes.
