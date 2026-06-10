'use client'

import { useState } from 'react'

export type SortDir = 'asc' | 'desc'

/**
 * Column-sort state shared by the Semrush gap tables (matrix / gaps / URL
 * coverage). Clicking the active column flips direction; clicking a new
 * column selects it descending (ascending for text-ish columns).
 */
export function useSemrushSort(
  initialKey: string,
  ascFirstKeys: string[] = ['keyword'],
) {
  const [sortKey, setSortKey] = useState<string>(initialKey)
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(ascFirstKeys.includes(key) ? 'asc' : 'desc')
    }
  }

  /** Jump straight to a column + direction (tab switches, post-run resets). */
  function setSort(key: string, dir: SortDir = 'desc') {
    setSortKey(key)
    setSortDir(dir)
  }

  return { sortKey, sortDir, toggleSort, setSort }
}
