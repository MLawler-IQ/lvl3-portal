'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toWirePayload } from '@/lib/review/schemas'
import type { ItemState } from '@/lib/review/types'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const DEBOUNCE_MS = 500
const RETRY_DELAYS_MS = [2000, 5000, 10000]
const SAVED_FLASH_MS = 1500

type Handlers = {
  onLocked: () => void
  onInvalid: () => void
}

export function useAutosave(token: string, handlers: Handlers) {
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [errorItemIds, setErrorItemIds] = useState<Set<string>>(new Set())

  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  const latest = useRef(new Map<string, ItemState>())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const retryTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const retryCounts = useRef(new Map<string, number>())
  const inFlight = useRef(new Map<string, Promise<void>>())
  const dirty = useRef(new Set<string>())
  const errors = useRef(new Set<string>())
  const stopped = useRef(false)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function syncErrors() {
    setErrorItemIds(new Set(errors.current))
  }

  function stopAll() {
    stopped.current = true
    for (const timer of Array.from(timers.current.values())) clearTimeout(timer)
    for (const timer of Array.from(retryTimers.current.values())) clearTimeout(timer)
    timers.current.clear()
    retryTimers.current.clear()
    dirty.current.clear()
    if (savedTimer.current) clearTimeout(savedTimer.current)
    setSaveState('idle')
  }

  function maybeSettle() {
    if (stopped.current) return
    if (
      inFlight.current.size > 0 ||
      timers.current.size > 0 ||
      retryTimers.current.size > 0 ||
      dirty.current.size > 0
    ) {
      return
    }
    if (errors.current.size > 0) {
      setSaveState('error')
      return
    }
    setSaveState('saved')
    if (savedTimer.current) clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setSaveState('idle'), SAVED_FLASH_MS)
  }

  function scheduleRetry(itemId: string) {
    if (stopped.current) return
    errors.current.add(itemId)
    syncErrors()
    const attempt = retryCounts.current.get(itemId) ?? 0
    if (attempt >= RETRY_DELAYS_MS.length) return // exhausted — error sticks until the next edit
    retryCounts.current.set(itemId, attempt + 1)
    const timer = setTimeout(() => {
      retryTimers.current.delete(itemId)
      send(itemId)
    }, RETRY_DELAYS_MS[attempt])
    retryTimers.current.set(itemId, timer)
  }

  async function doSend(itemId: string, state: ItemState): Promise<void> {
    try {
      const res = await fetch(`/api/review/${token}/response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toWirePayload(itemId, state)),
      })
      if (res.status === 409) {
        stopAll()
        handlersRef.current.onLocked()
        return
      }
      if (res.status === 404) {
        stopAll()
        handlersRef.current.onInvalid()
        return
      }
      if (!res.ok) {
        if (res.status >= 500) scheduleRetry(itemId)
        else {
          errors.current.add(itemId)
          syncErrors()
        }
        return
      }
      retryCounts.current.delete(itemId)
      if (errors.current.delete(itemId)) syncErrors()
    } catch {
      scheduleRetry(itemId)
    }
  }

  function send(itemId: string) {
    if (stopped.current) return
    if (inFlight.current.has(itemId)) {
      dirty.current.add(itemId)
      return
    }
    const state = latest.current.get(itemId)
    if (!state) return
    setSaveState('saving')
    const settled = doSend(itemId, state).finally(() => {
      inFlight.current.delete(itemId)
      if (!stopped.current && dirty.current.has(itemId)) {
        dirty.current.delete(itemId)
        send(itemId)
      } else {
        maybeSettle()
      }
    })
    inFlight.current.set(itemId, settled)
  }

  function queueSave(itemId: string, state: ItemState) {
    if (stopped.current) return
    latest.current.set(itemId, state)
    // A fresh user edit resets any retry/error cycle for this item.
    const retryTimer = retryTimers.current.get(itemId)
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimers.current.delete(itemId)
    }
    retryCounts.current.delete(itemId)
    if (errors.current.delete(itemId)) syncErrors()
    const existing = timers.current.get(itemId)
    if (existing) clearTimeout(existing)
    setSaveState('saving')
    timers.current.set(
      itemId,
      setTimeout(() => {
        timers.current.delete(itemId)
        send(itemId)
      }, DEBOUNCE_MS)
    )
  }

  async function flushAll(): Promise<void> {
    for (const [itemId, timer] of Array.from(timers.current.entries())) {
      clearTimeout(timer)
      timers.current.delete(itemId)
      send(itemId)
    }
    for (const [itemId, timer] of Array.from(retryTimers.current.entries())) {
      clearTimeout(timer)
      retryTimers.current.delete(itemId)
      send(itemId)
    }
    // Dirty resends are re-queued synchronously as each request settles, so
    // looping until the in-flight map drains covers the whole chain.
    while (inFlight.current.size > 0) {
      await Promise.all(Array.from(inFlight.current.values()))
    }
  }

  const flushKeepalive = useCallback(() => {
    if (stopped.current) return
    const ids = new Set<string>()
    for (const id of Array.from(timers.current.keys())) ids.add(id)
    for (const id of Array.from(dirty.current)) ids.add(id)
    for (const id of Array.from(ids)) {
      const timer = timers.current.get(id)
      if (timer) {
        clearTimeout(timer)
        timers.current.delete(id)
      }
      dirty.current.delete(id)
      const state = latest.current.get(id)
      if (!state) continue
      try {
        void fetch(`/api/review/${token}/response`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(toWirePayload(id, state)),
          keepalive: true,
        })
      } catch {
        // best effort — page is going away
      }
    }
  }, [token])

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') flushKeepalive()
    }
    window.addEventListener('pagehide', flushKeepalive)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('pagehide', flushKeepalive)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [flushKeepalive])

  useEffect(() => {
    const debounceTimers = timers.current
    const pendingRetryTimers = retryTimers.current
    return () => {
      for (const timer of Array.from(debounceTimers.values())) clearTimeout(timer)
      for (const timer of Array.from(pendingRetryTimers.values())) clearTimeout(timer)
      if (savedTimer.current) clearTimeout(savedTimer.current)
    }
  }, [])

  return { queueSave, flushAll, saveState, errorItemIds }
}
