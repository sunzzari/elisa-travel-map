# How to Work on the Travel Map

Everything from first clone to a live change on the site.

---

## Overview: How Updates Work

```
Edit code -> npm run build (must pass) -> update CHANGELOG.md -> git push
-> Vercel builds and deploys to production automatically (~1-2 min)
```

**There is no staging step.** A push to `master` goes straight to
[elisa-travel-map.vercel.app](https://elisa-travel-map.vercel.app). A broken push
is a broken live site, which is why the build check below is not optional.

---

## Who Can Do What

| Task | Elisa | Cathy |
|------|-------|-------|
| Edit code and push to GitHub | Yes | Yes |
| Run the site locally | Yes | Yes (needs the API keys) |
| See the Vercel deploy log | Yes | No |
| Edit trip content in Notion (no code) | Yes | Yes |

---

## Part 1 - First-Time Setup (once per machine)

**Requirements**: Node 20 or newer, and Git.

**1. Clone the repo**
```bash
git clone https://github.com/sunzzari/elisa-travel-map.git
```

**2. Install dependencies**
```bash
npm install
```

**3. Turn on the repo's git hooks** (one line, do not skip - see Part 4)
```bash
git config core.hooksPath .githooks
```

**4. Create your local secrets file**

`.env.local` is gitignored and never committed. Copy the example and fill it in:
```bash
cp .env.local.example .env.local
```

What each key is for:

| Key | What it does | Where to get it |
|-----|--------------|-----------------|
| `NOTION_TOKEN` | Reads the trips out of Notion | Ask Elisa |
| `GOOGLE_MAPS_API_KEY` | Server-side geocoding | Ask Elisa |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Renders the map in the browser | Ask Elisa |
| `SYNC_SECRET` | Authenticates the Notion webhook | Any random string locally: `openssl rand -hex 32` |
| `KV_*` | Vercel KV cache | Leave blank locally; Vercel injects them in production |

**5. Run it**
```bash
npm run dev
```
Open http://localhost:3000.

---

## Part 2 - Making a Code Change

**1. Always pull first.** Two people push to this repo.
```bash
git pull --rebase
```

**2. Make your edit.**

**3. Run the build. It must pass clean.**
```bash
npm run build
```
This is the only thing standing between a typo and a broken live site. `npm run dev`
working is not the same as the build passing.

**4. Update `CHANGELOG.md`.** Required - see Part 4.

**5. Commit and push.**
```bash
git add -A
git commit -m "Short description of what changed"
git push
```

**6. Check the site.** Give Vercel a minute or two, then load
[elisa-travel-map.vercel.app](https://elisa-travel-map.vercel.app) and confirm your
change is actually there. A successful push is not proof of a successful deploy.

### If your push is rejected

That means the other person pushed while you were working. Do not force it:
```bash
git pull --rebase
npm run build
git push
```

---

## Part 3 - Where Pins Come From

Every place's pin is saved in Notion (`Address`, `Latitude`, `Longitude`, and
`Other Branches` for a chain) and comes from free sources only: OpenStreetMap and the
US Census geocoder. Nothing in this repo calls Google Geocoding or Google Places; that
code was deleted on 2026-09-30 after a $97 bill, and it must not come back.

- Adding or editing a place on the website or in the Sunzzari app saves its pin
  through `/api/places` (see `lib/place-lookup.ts` and `lib/places-write.ts`).
- A place added straight in Notion shows under "Not on the map". Use "Find it" there,
  or wait for the weekly sweep, which pins it when every check passes.
- `data/geocache.json` still holds older trip pins. It is read, never written.

---

## Part 4 - The Changelog (required)

**Every push to `master` updates [CHANGELOG.md](CHANGELOG.md) in the same commit.**

This is how either of us can come back in three months and know what changed and why.
Format:

- Newest at the top, always
- A date heading (`## YYYY-MM-DD`) for today if there isn't one yet
- Each entry starts with a time in backticks: `` `2:15pm` ``
- Bold the headline, then explain what actually changed and why it matters
- Add `- Cathy` at the end of entries Cathy wrote

Example:

```markdown
## 2026-09-20

- `2:15pm` **Restaurants now show their price range** - the Notion Price field was
  being read but never displayed. It now sits under the name in the map callout. - Cathy
```

**A pre-push hook enforces this.** If you change anything in `app/`, `components/`, or
`lib/` without touching `CHANGELOG.md`, the push is refused with a reminder. That is
the hook you turned on in Part 1, step 3. It is a reminder, not a lock - if you have a
genuine reason to skip it, `git push --no-verify` works, but the default answer is to
write the entry.

---

## Part 5 - Content Changes (no code needed)

Trips, restaurants, activities, and Around Town places all come from Notion. Adding or
editing them there changes the site with no code and no deploy. Only reach for this
repo when you want to change how the site *behaves* or *looks*.

---

## Never Commit Secrets

`.env.local` holds the Notion token and the Google Maps keys. It is gitignored and must
stay that way. If a key ever lands in a commit, tell Elisa immediately so it can be
rotated - the repo is public.
