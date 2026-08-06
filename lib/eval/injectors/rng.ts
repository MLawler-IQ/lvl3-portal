// A tiny deterministic PRNG for fixture generation.
//
// Three hard constraints shaped this:
//   1. No new npm packages (repo rule 6), so it is written here.
//   2. Never Math.random and never Date.now — a fixture that changes between runs
//      turns the eval gate into a flaky test, and a flaky gate gets deleted. The
//      generator is a pure function of its seed.
//   3. Seeds are *strings*, so a scenario can derive independent sub-streams
//      ('template-bug@7/h1', 'template-bug@7/geo') without one injector's draw
//      count shifting another injector's output. Adding an encoding to the H1
//      injector must not silently re-roll every city name.
//
// mulberry32: 32-bit state, one multiply-shift-xor round. Not cryptographic, but
// well-distributed enough that different seeds produce visibly different
// fixtures, which is the only statistical property this needs.

/** FNV-1a over the seed string — maps any label to a 32-bit state. */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  // Avoid a zero state, which mulberry32 handles but which makes the first draw
  // suspiciously small.
  return (h >>> 0) || 0x9e3779b9
}

export interface Rng {
  /** The seed label this stream was derived from — carried for provenance. */
  readonly label: string
  /** Uniform in [0, 1). */
  next(): number
  /** Uniform integer in [min, max], both inclusive. */
  int(min: number, max: number): number
  /** True with probability p. */
  bool(p: number): boolean
  /** One element. Throws only on an empty array — a generator bug, not fixture data. */
  pick<T>(items: readonly T[]): T
  /** n distinct elements, in seeded order. Caps at items.length. */
  sample<T>(items: readonly T[], n: number): T[]
  /** A seeded permutation. Does not mutate the input. */
  shuffle<T>(items: readonly T[]): T[]
  /** An independent sub-stream. Same parent seed + same suffix → same stream. */
  derive(suffix: string): Rng
}

export function makeRng(seed: string): Rng {
  let state = hashSeed(seed)

  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const rng: Rng = {
    label: seed,
    next,
    int(min, max) {
      if (max < min) throw new Error(`rng.int: max ${max} < min ${min}`)
      return min + Math.floor(next() * (max - min + 1))
    },
    bool(p) {
      return next() < p
    },
    pick(items) {
      if (items.length === 0) throw new Error(`rng.pick: empty array (stream ${seed})`)
      return items[Math.floor(next() * items.length)]
    },
    sample(items, n) {
      return rng.shuffle(items).slice(0, Math.max(0, Math.min(n, items.length)))
    },
    shuffle(items) {
      const out = items.slice()
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        const tmp = out[i]
        out[i] = out[j]
        out[j] = tmp
      }
      return out
    },
    derive(suffix) {
      return makeRng(`${seed}/${suffix}`)
    },
  }

  return rng
}
