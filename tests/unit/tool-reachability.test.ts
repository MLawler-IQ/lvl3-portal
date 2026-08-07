import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TOOLS } from '@/lib/tools/registry'

/**
 * Every tool route must be reachable from the Tools hub.
 *
 * This exists because a feature shipped that compiled, passed its own tests, and
 * appeared on no page in the application. app/(dashboard)/tools/page.tsx renders
 * ONLY the manifests in lib/tools/registry.ts, so a route directory without a
 * matching entry is a page nobody can navigate to — and nothing anywhere fails.
 *
 * That is the third time in one session a change was complete, correct and
 * uninvoked. The common shape: TypeScript checks definitions, the suite checks
 * behaviour, and NOTHING checks that a thing is called. A route and a registry
 * are two lists that must agree, and two lists always drift. Where a list can be
 * derived from a source of truth it should be (see SHARED_SLOTS in
 * app/actions/clients.ts, derived from SLOTS via promotesTo, which cannot drift).
 * The route table cannot be derived, so it gets a gate instead of a convention.
 *
 * The failure this prevents is silent: no exception, no red test, no log line.
 * Absence has no error, which is exactly why it needs one.
 */

const TOOLS_DIR = join(process.cwd(), 'app', '(dashboard)', 'tools')

/** Route segments under /tools that render a page of their own. */
function routeSlugs(): string[] {
  return readdirSync(TOOLS_DIR)
    .filter((entry) => {
      const full = join(TOOLS_DIR, entry)
      if (!statSync(full).isDirectory()) return false
      // A directory is only a route if it actually renders something.
      return existsSync(join(full, 'page.tsx'))
    })
    .sort()
}

describe('every tool route is reachable from the hub', () => {
  it('has a registry manifest for each route directory', () => {
    const routes = routeSlugs()
    const registered = new Set(TOOLS.map((t) => t.slug))
    const unreachable = routes.filter((slug) => !registered.has(slug))

    expect(
      unreachable,
      unreachable.length > 0
        ? `These tool routes exist on disk but appear in no registry manifest, so the Tools ` +
          `hub does not link them and they are reachable only by typing the URL: ` +
          `${unreachable.join(', ')}. Add an entry to lib/tools/registry.ts.`
        : '',
    ).toEqual([])
  })

  // The other direction. A manifest whose route was deleted or renamed renders a
  // card in the hub that 404s — the same broken promise pointing the other way,
  // and just as silent.
  //
  // `coming-soon` is exempt, and that exemption is VERIFIED rather than assumed:
  // ToolsHubClient.tsx:124 computes `enabled = !isComingSoon && …` and :128
  // renders `href={enabled ? tool.route : '#'}` with `pointer-events-none`, so a
  // placeholder card cannot navigate anywhere and needs no route. If that ever
  // changes to link the real route, this exemption becomes a hole — which is why
  // the reason is written here rather than the condition standing bare.
  it('has a route directory for each shipped registry manifest', () => {
    const routes = new Set(routeSlugs())
    const dangling = TOOLS.filter((t) => t.status !== 'coming-soon')
      .map((t) => t.slug)
      .filter((slug) => !routes.has(slug))

    expect(
      dangling,
      dangling.length > 0
        ? `These shipped registry manifests have no app/(dashboard)/tools/<slug>/page.tsx, so ` +
          `the hub renders a navigable card that 404s: ${dangling.join(', ')}. A placeholder ` +
          `is fine — mark it status: 'coming-soon' — but a shipped tool must have its route.`
        : '',
    ).toEqual([])
  })

  it('finds the routes at all, so a path change cannot make this test vacuous', () => {
    // Without this, moving the tools directory would leave both assertions
    // comparing empty arrays and passing forever.
    expect(routeSlugs().length).toBeGreaterThan(5)
    expect(TOOLS.length).toBeGreaterThan(5)
  })
})
