import { safeNext } from '@/lib/site-auth'

export const dynamic = 'force-dynamic'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-950 px-4">
      <form method="post" action="/api/login" className="w-full max-w-xs space-y-4">
        <div>
          <h1 className="font-display text-3xl text-white">Trip Maps</h1>
          <div className="mt-2 h-[2.5px] w-10 rounded-full bg-gradient-to-r from-amber-400 to-amber-500" />
        </div>
        <input type="hidden" name="next" value={safeNext(next)} />
        <input
          type="password"
          name="password"
          autoFocus
          autoComplete="current-password"
          placeholder="Password"
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-amber-400/40 focus:outline-none"
        />
        {error === 'wrong' && <p className="text-xs text-red-400">That is not the password.</p>}
        {error === 'unset' && <p className="text-xs text-red-400">No password is set on this deployment yet.</p>}
        <button className="w-full rounded-lg bg-amber-400 py-2.5 text-sm font-semibold text-gray-950">Enter</button>
      </form>
    </main>
  )
}
