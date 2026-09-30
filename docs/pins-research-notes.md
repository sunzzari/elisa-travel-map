# Pins research: notes on the output

Adds to the format in `pins-research.md`. Everything there still holds.

## `branches` on chain rows

Elisa asked that a chain gets every branch inside the area she named, not one pick. Those rows
are `status: "found"` and carry an extra field:

```json
"branches": [
  { "address": "...", "sourceUrl": "...", "sourceTitle": "...", "closed": false }
]
```

- Every branch sits inside one of the places named in the row's `area`, and has its own source.
- `address`, `sourceUrl` and `sourceTitle` at the top level are the same as `branches[0]`, so a
  script that reads one address per row still pins one real branch.
- Top-level `closed` is true only when every branch is permanently closed.
- To pin every branch, read `branches` when it is present. The app places one pin per item
  today (`geocodeItem` returns one location), so showing all of them needs an app change.

## `needs-you` rows with a researched address

When the only location found sits outside the named area, or the name only nearly matches, the
row is `needs-you` and the researched address is in `alternatives`, with its source kept.

## Source strength

Some found rows cite a business's own site whose page this environment could not open; for
those, the address came from the search result text about that page rather than the page
itself. The geocoder's area check is the backstop.
