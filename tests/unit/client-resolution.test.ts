import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const state = {
    cookieValue: null as string | null,
    // Result returned by terminal supabase calls (order/single)
    queryResult: { data: null as unknown },
  }
  const builder: Record<string, unknown> = {}
  builder.from = vi.fn(() => builder)
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.order = vi.fn(async () => state.queryResult)
  builder.single = vi.fn(async () => state.queryResult)
  // member path: .select(...).eq(...) is awaited directly — make eq thenable
  ;(builder.eq as { mockImplementation: (fn: () => unknown) => void }).mockImplementation(
    () =>
      Object.assign(Object.create(builder), {
        then: (resolve: (v: unknown) => unknown) => resolve(state.queryResult),
      }),
  )
  return { state, builder }
})

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      name === 'selected_client' && mocks.state.cookieValue !== null
        ? { name, value: mocks.state.cookieValue }
        : undefined,
  })),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mocks.builder),
  createServiceClient: vi.fn(async () => mocks.builder),
}))

import {
  getClientById,
  getClientListForUser,
  getSelectedClientId,
  resolveSelectedClientId,
} from '@/lib/client-resolution'

beforeEach(() => {
  mocks.state.cookieValue = null
  mocks.state.queryResult = { data: null }
})

describe('getSelectedClientId', () => {
  it('returns the selected_client cookie value', async () => {
    mocks.state.cookieValue = 'client-123'
    await expect(getSelectedClientId()).resolves.toBe('client-123')
  })

  it('returns null when the cookie is absent', async () => {
    await expect(getSelectedClientId()).resolves.toBeNull()
  })
})

describe('resolveSelectedClientId', () => {
  it('pins client-role users to their assigned client_id, ignoring the cookie', async () => {
    mocks.state.cookieValue = 'cookie-client'
    const id = await resolveSelectedClientId({ role: 'client', client_id: 'pinned-client' })
    expect(id).toBe('pinned-client')
  })

  it('returns the client-role client_id even when null (never falls back to cookie)', async () => {
    mocks.state.cookieValue = 'cookie-client'
    const id = await resolveSelectedClientId({ role: 'client', client_id: null })
    expect(id).toBeNull()
  })

  it('uses the cookie selection for admins', async () => {
    mocks.state.cookieValue = 'cookie-client'
    const id = await resolveSelectedClientId({ role: 'admin', client_id: null })
    expect(id).toBe('cookie-client')
  })

  it('uses the cookie selection for members', async () => {
    mocks.state.cookieValue = 'cookie-client'
    const id = await resolveSelectedClientId({ role: 'member', client_id: null })
    expect(id).toBe('cookie-client')
  })

  it('returns null for admins with no cookie set', async () => {
    const id = await resolveSelectedClientId({ role: 'admin', client_id: null })
    expect(id).toBeNull()
  })
})

describe('getClientById', () => {
  it('returns the row when found', async () => {
    mocks.state.queryResult = { data: { id: 'c1', name: 'Acme' } }
    const client = await getClientById('c1', 'id, name')
    expect(client).toEqual({ id: 'c1', name: 'Acme' })
  })

  it('returns null when not found', async () => {
    mocks.state.queryResult = { data: null }
    await expect(getClientById('missing', 'id, name')).resolves.toBeNull()
  })
})

describe('getClientListForUser', () => {
  it('client role: no list, no selector, auto-selected pinned client', async () => {
    const res = await getClientListForUser('u1', 'client', 'pinned-client')
    expect(res).toEqual({
      clientList: [],
      autoSelectedClientId: 'pinned-client',
      showSelector: false,
    })
  })

  it('admin role: returns all clients with selector shown', async () => {
    mocks.state.queryResult = {
      data: [
        { id: 'c1', name: 'Acme' },
        { id: 'c2', name: 'Beta' },
      ],
    }
    const res = await getClientListForUser('u1', 'admin', null)
    expect(res.showSelector).toBe(true)
    expect(res.autoSelectedClientId).toBeNull()
    expect(res.clientList).toEqual([
      { id: 'c1', name: 'Acme' },
      { id: 'c2', name: 'Beta' },
    ])
  })

  it('member role: returns only granted clients, sorted by name', async () => {
    mocks.state.queryResult = {
      data: [
        { client_id: 'c2', clients: { id: 'c2', name: 'Zeta' } },
        { client_id: 'c3', clients: null },
        { client_id: 'c1', clients: { id: 'c1', name: 'Acme' } },
      ],
    }
    const res = await getClientListForUser('u3', 'member', null)
    expect(res.showSelector).toBe(true)
    expect(res.clientList).toEqual([
      { id: 'c1', name: 'Acme' },
      { id: 'c2', name: 'Zeta' },
    ])
  })
})
