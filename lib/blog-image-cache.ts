// Browser-side cache for generated blog images (IndexedDB).
// Keyed by SHA-256 of filename + prompt + style rules, so any change to a
// row's prompt or the style rules is a cache miss and regenerates.

const DB_NAME = 'blog-image-cache'
const STORE = 'images'
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

interface CacheEntry {
  data: string // base64 WebP
  ts: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function imageCacheKey(filename: string, prompt: string, styleRules: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${filename}\u0000${prompt}\u0000${styleRules}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function getCachedImage(key: string): Promise<string | null> {
  try {
    const db = await openDb()
    return await new Promise<string | null>((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      req.onsuccess = () => {
        const entry = req.result as CacheEntry | undefined
        resolve(entry && Date.now() - entry.ts < MAX_AGE_MS ? entry.data : null)
      }
      req.onerror = () => resolve(null)
    })
  } catch {
    return null // cache is best-effort
  }
}

export async function putCachedImage(key: string, data: string): Promise<void> {
  try {
    const db = await openDb()
    const entry: CacheEntry = { data, ts: Date.now() }
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(entry, key)
  } catch {
    // cache is best-effort
  }
}
