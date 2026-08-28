/**
 * A tiny cache module.
 *
 * It demonstrates Effect-style exported combinators.
 */

export interface Cache<K, V> {
  readonly get: (key: K) => V | undefined
}

/** Construct an empty cache. */
export const make = <K, V>(): Cache<K, V> => new Map() as unknown as Cache<K, V>

export const get = <K, V>(cache: Cache<K, V>, key: K): V | undefined => cache.get(key)

const secret = "implementation detail"

export namespace Metrics {
  export function hit(name: string): void {
    void name
  }

  function hidden(): void {}
}
