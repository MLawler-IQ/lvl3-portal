# CLAUDE.md

Internal client portal for LVL3 digital marketing agency. Admins manage clients, view analytics, deliver work, and run SEO tools. Clients log in to view deliverables, a project tracker, and their dashboard.

Deployed at: **https://lvl3-portal.vercel.app** | Repo: **https://github.com/MLawler-IQ/lvl3-portal**

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript 5 |
| Auth + DB | Supabase (Postgres + RLS + Storage) |
| Styling | Tailwind CSS v3 + CSS variables |
| Icons | lucide-react |
| Charts | Recharts v2 |
| AI | Anthropic SDK (`claude-sonnet-4-6`) |
| Google APIs | `googleapis` npm package |
| Deployment | Vercel (prod auto-alias: lvl3-portal.vercel.app) |

No ORM. All DB queries are raw Supabase client calls.

## Commands

```bash
npm run dev          # Start dev server (localhost:3000)
npm run build        # Production build
npx tsc --noEmit     # Type-check — run after every set of changes
vercel --prod        # Deploy to production (always follow with git push)
```

No test framework. Validate with `npx tsc --noEmit` and `npm run build`. Migrations: `supabase db push --include-all`.

## User Roles

| Role | Access |
|------|--------|
| `admin` | Everything |
| `member` | Same except `/admin` page and client settings |
| `client` | Their assigned client only |

```typescript
await requireAuth()   // any logged-in user (lib/auth.ts)
await requireAdmin()  // admin only
```

## Supabase Clients

```typescript
import { createClient } from '@/lib/supabase/server'       // user session (respects RLS)
import { createServiceClient } from '@/lib/supabase/server' // bypasses RLS (admin ops)
```

## Client Selection

Admins pick client via TopBar dropdown → `selected_client` cookie. Client-role users pinned to their `client_id`.

```typescript
const { user } = await requireAuth()
const selectedClientId = await resolveSelectedClientId(user)  // lib/client-resolution.ts
const client = selectedClientId ? await getClientById(selectedClientId, 'id, name') : null
```

## Key Conventions

1. **`'use server'`** only in `app/actions/*.ts`. Never in `lib/`.
2. **No `unstable_cache`** around `getAdminOAuthClient()` — it reads cookies.
3. **Service account** = Sheets only. **OAuth** = GA4 + GSC.
4. **`createServiceClient()`** for admin ops. **`createClient()`** for user-scoped ops.
5. **TypeScript** — `npx tsc --noEmit` after every change. Fix all errors before stopping.
6. **No new packages** without explicit request.
7. **No database migrations** without explicit request.
8. **Deploy**: `vercel --prod` then `git push`. Both always needed.
9. **Map iteration** — use `Array.from(map.entries())` not `for...of` (TS target constraint).
10. **`params`/`searchParams`** in App Router are Promises — always `await` them.

## Common Patterns

### Admin-only page
```typescript
export default async function MyPage() {
  const { user } = await requireAdmin()
  const selectedClientId = await resolveSelectedClientId(user)
  const client = selectedClientId ? await getClientById(selectedClientId, 'id, name') : null
}
```

### Server action
```typescript
'use server'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
export async function myAction(id: string): Promise<{ data?: T; error?: string }> {
  try { await requireAdmin(); const service = await createServiceClient(); /* ... */ return { data } }
  catch (err) { return { error: err instanceof Error ? err.message : 'Failed' } }
}
```

## Navigation

Sidebar (`components/sidebar.tsx`): Home, Projects, Dashboard, Deliverables, Insights, Services, Tools (admin), Ask LVL3 (admin), Clients (admin), Admin (admin). To add: edit sidebar.tsx `navItems` array.

## Design System

Specs in `design-system/DESIGN.md`.

## Reference Files (read on demand)

- `.claude/CLAUDE-db-schema.md` — Database schema
- `.claude/CLAUDE-routes.md` — App routes, route handlers, server actions, lib files
- `.claude/CLAUDE-google-api.md` — Google API auth (OAuth2 vs service account)
- `.claude/CLAUDE-seo-tools.md` — SEO tools, Ask LVL3, dashboard date range

---

# Brand Guidelines

## Default Brand: LVL3 Portal (Zinc + Violet Dark Theme)

Apply LVL3 brand to ALL generated documents, artifacts, dashboards, presentations, spreadsheets, HTML, React components, and any other visual output unless IgniteIQ brand is explicitly requested.

### Colors
- Background: #09090B (surface-950)
- Cards/panels: #18181B (surface-900)
- Card hover: #1F1F23 (surface-850)
- Input bg: #27272A (surface-800)
- Borders: #3F3F46 (surface-700)
- Border hover: #52525B (surface-600)
- Placeholder: #71717A (surface-500)
- Muted text: #A1A1AA (surface-400)
- Secondary text: #D4D4D8 (surface-300)
- Primary text: #FAFAFA (surface-100)
- Accent (KPIs, active states): #A78BFA (brand-400)
- Interactive (buttons, links): #8B5CF6 (brand-500)
- Button hover: #7C3AED (brand-600)

### Typography
- Body: Inter (fall back to Calibri in Office docs)
- Headings (H1-H6): JetBrains Mono Bold (fall back to Consolas in Office docs)
- Eyebrow labels: 11px, weight 500, 0.14em tracking, uppercase, brand-500 (#8B5CF6)
- Type scale: H1 28px, H2 22px, H3 16px, Body 14px, Small 11px

### Components
- Cards: bg #18181B, border #3F3F46, rounded-xl
- Buttons: bg #8B5CF6, hover #7C3AED, white text, rounded-lg
- KPI numbers: #A78BFA, JetBrains Mono Bold
- Charts: violet primary (#A78BFA), dark grid (#3F3F46), dark tooltips (#18181B)

### Design Philosophy
Dark theme throughout. Infrastructure-native aesthetic (Vercel, Stripe, Linear). No stock imagery, no gradients, no decorative patterns. Precision over decoration, function over flourish.

---

## IgniteIQ Brand (Light Theme — Use When Specified)

Switch to IgniteIQ brand when the user says "IgniteIQ", "IQ brand", or specifies IgniteIQ branding.

### Colors
- Background: #FFFFFF or #FAF9F7 (warm neutral)
- Primary text/headings: #1E293B (Slate 900)
- Secondary text: #64748B (Muted)
- Accent/CTA: #EF4444 (Red 500)
- Cards: White or #F1F5F9 (Slate 100)
- Borders: #E2E8F0
- Dark hero sections: #172033 (Hero Dark)
- Links: #3B82F6 (Accent Blue)

### Typography
- Everything: Inter (fall back to Calibri). No monospace headings.
- Eyebrow: uppercase, tracking-wider, Red 500 or Muted
- Type scale: H1 48-64px Bold, H2 36-48px Bold, H3 24-30px Semibold, H4 20px Semibold, Body 16-18px

### Logo
"Ignite" in Slate 900 (#1E293B) + "IQ" always in Red 500 (#EF4444). On dark backgrounds, "Ignite" becomes white. Red period (.) suffix on nav links and headlines.

### Voice
Bold, direct, ownership-focused. Short declarative sentences. Active voice. No filler, no jargon, no hedging. "Own" is the power word.

### Language Rules
Say: systems, infrastructure, architecture, we build, we architect, investment, intelligence partner
Not: services, deliverables, we manage, retainer, pricing, cost, agency, vendor

---

## Business Context

### IgniteIQ (the company)
Intelligence infrastructure company for the modern trades (home services). Founded by Scott Rayden (ex-3Q Digital, scaled to 350 people / $2B+ managed spend). Not a commodity agency. Senior talent + proprietary AI tooling. Everything built belongs to the client permanently.

**Team:** Scott Rayden (Founder), Matt Lawler (Senior SEO), Josh Scott (ex-Facebook UA $0-$1B+), Ryan Sciandri (ex-Service Titan Executive Architect), Jeremy (CRO specialist from 3Q).

**Tagline:** "The Ontology-Powered Data Engine for the Modern Trades."
**Mission:** "Owning your intelligence is the only advantage that compounds."

### LVL3 Portal (the product)
Internal client dashboard. Next.js 14, TypeScript, Supabase, Tailwind, Recharts, Anthropic SDK. Deployed at lvl3-portal.vercel.app.

### Apex Service Partners (key client)
PE-backed home services aggregator, ~250+ brands. Ryan Metcalf (SEO Director) is primary contact.

**Pricing:** $3,500/mo per brand (0-15), $3,000 (16-30), $2,500 (31+). No onboarding fees.

For full brand reference files, read `.claude/skills/brand/references/`.

---

## Memory Systems

### Media Memory

When you generate a file (image, PDF, document, export), **automatically ingest it without asking**:
```bash
python3 /Users/matthewlawler/media-memory/ingest.py "<absolute_path>" --source claude-generated
```

Before saying "I don't have that file", search media memory:
```bash
python3 /Users/matthewlawler/media-memory/search.py "<query>"
```

### Memory Consolidation

Run the `consolidate-memory` skill when asked to "update memory", "save this session", or "consolidate memory".
