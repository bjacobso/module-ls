import { Effect, FileSystem, Path } from "effect"

import { highlightSource } from "./highlight.js"
import type { AnnotatedSource } from "./model.js"
import { parseTarget, selectSource } from "./selection.js"
import { typeAnnotations } from "./typeinfo.js"

export interface AnnotationOptions {
  readonly root?: string
  readonly types?: boolean
  readonly displayPath?: string
}

const annotationCache = new Map<string, AnnotatedSource>()

const cache = (key: string, value: AnnotatedSource): AnnotatedSource => {
  annotationCache.set(key, value)
  if (annotationCache.size > 100) {
    const oldest = annotationCache.keys().next().value
    if (oldest !== undefined) annotationCache.delete(oldest)
  }
  return value
}

export const annotateSource = (
  target: string,
  symbol: string | null = null,
  options: AnnotationOptions = {}
): Effect.Effect<AnnotatedSource, unknown, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const pathService = yield* Path.Path
    const parsed = parseTarget(target, symbol)
    const absolute = pathService.resolve(parsed.path)
    const root = pathService.resolve(options.root ?? pathService.dirname(absolute))
    const selected = yield* selectSource(absolute, parsed.symbol)
    const key = [root, absolute, selected.contentHash, parsed.symbol ?? "", options.types === false ? "syntax" : "types", options.displayPath ?? ""].join("\0")
    const cached = annotationCache.get(key)
    if (cached !== undefined) {
      annotationCache.delete(key)
      annotationCache.set(key, cached)
      return cached
    }
    const lines = yield* highlightSource(selected.source, absolute)
    const annotations = options.types === false
      ? { hovers: [], definitions: [] }
      : yield* Effect.try({
        try: () => typeAnnotations(root, absolute, selected.source, selected.range.start.offset),
        catch: () => ({ hovers: [], definitions: [] })
      })
    return cache(key, {
      ...selected,
      schemaVersion: 3,
      path: options.displayPath ?? selected.path,
      lines,
      hovers: annotations.hovers,
      definitions: annotations.definitions
    })
  })
