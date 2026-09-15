# Project Instructions

## Changelog (MANDATORY)

**Every time you commit and push to master, you MUST update `CHANGELOG.md`** in the same
commit. Format:
- Add a new date heading (`## YYYY-MM-DD`) if one doesn't exist for today
- Each entry gets a timestamp prefix: `` `H:MMam/pm` ``
- Newest entries go at the TOP of the day's section
- Include "- Cathy" attribution on entries Cathy wrote
- This is not optional - do it before telling the user you're done.

The changelog used to live in `README.md`; it moved to `CHANGELOG.md` on 2026-09-14 so
both this repo and `sunzzari-app` work the same way.

A pre-push hook in `.githooks/pre-push` enforces this. If it isn't firing, run:
`git config core.hooksPath .githooks`

## Before pushing

1. `git pull --rebase` - Cathy pushes here too
2. `npm run build` must pass clean
3. Update `CHANGELOG.md`
4. Ask before pushing - a push to master deploys production immediately, no staging gate
