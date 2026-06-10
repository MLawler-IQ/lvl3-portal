import { beforeEach, describe, expect, it, vi } from 'vitest'

// Chainable supabase stub. `maybeSingleResult` controls what the
// user_client_access lookup returns.
const mocks = vi.hoisted(() => {
  const state = { maybeSingleResult: { data: null as unknown } }
  const builder: Record<string, unknown> = {}
  builder.from = vi.fn(() => builder)
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.maybeSingle = vi.fn(async () => state.maybeSingleResult)
  return { state, builder }
})

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mocks.builder),
  createServiceClient: vi.fn(async () => mocks.builder),
}))

import { memberHasClientAccess, userCanAccessClient } from '@/lib/auth'

const CLIENT_A = 'client-aaa'
const CLIENT_B = 'client-bbb'

beforeEach(() => {
  mocks.state.maybeSingleResult = { data: null }
  vi.clearAllMocks()
})

describe('userCanAccessClient', () => {
  it('always allows admins, without touching the database', async () => {
    const ok = await userCanAccessClient(
      { id: 'u1', role: 'admin', client_id: null },
      CLIENT_A,
    )
    expect(ok).toBe(true)
    expect(mocks.builder.from).not.toHaveBeenCalled()
  })

  it('allows client role only when client_id matches', async () => {
    const user = { id: 'u2', role: 'client' as const, client_id: CLIENT_A }
    await expect(userCanAccessClient(user, CLIENT_A)).resolves.toBe(true)
    await expect(userCanAccessClient(user, CLIENT_B)).resolves.toBe(false)
    expect(mocks.builder.from).not.toHaveBeenCalled()
  })

  it('denies client role with no pinned client', async () => {
    const user = { id: 'u2', role: 'client' as const, client_id: null }
    await expect(userCanAccessClient(user, CLIENT_A)).resolves.toBe(false)
  })

  it('allows member only when a user_client_access row exists', async () => {
    const user = { id: 'u3', role: 'member' as const, client_id: null }

    mocks.state.maybeSingleResult = { data: { client_id: CLIENT_A } }
    await expect(userCanAccessClient(user, CLIENT_A)).resolves.toBe(true)

    mocks.state.maybeSingleResult = { data: null }
    await expect(userCanAccessClient(user, CLIENT_B)).resolves.toBe(false)
  })
})

describe('memberHasClientAccess', () => {
  it('queries user_client_access filtered by user and client', async () => {
    mocks.state.maybeSingleResult = { data: { client_id: CLIENT_A } }
    const ok = await memberHasClientAccess('u3', CLIENT_A)
    expect(ok).toBe(true)
    expect(mocks.builder.from).toHaveBeenCalledWith('user_client_access')
    expect(mocks.builder.eq).toHaveBeenCalledWith('user_id', 'u3')
    expect(mocks.builder.eq).toHaveBeenCalledWith('client_id', CLIENT_A)
  })

  it('returns false when no row exists', async () => {
    mocks.state.maybeSingleResult = { data: null }
    await expect(memberHasClientAccess('u3', CLIENT_B)).resolves.toBe(false)
  })
})
