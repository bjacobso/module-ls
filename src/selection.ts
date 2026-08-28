import { Effect, FileSystem, Path, Schema } from "effect"

import { inspect } from "./app.js"
import { InspectError, RenderError } from "./errors.js"
import {
  SelectedSourceSchema,
  type Declaration,
  type InspectOptions,
  type SelectedSource,
  type SourcePosition,
  type SourceRange
} from "./model.js"

interface ParsedTarget {
  readonly path: string
  readonly symbol: string | null
}

export const parseTarget = (target: string, explicitSymbol: string | null = null): ParsedTarget => {
  if (explicitSymbol !== null) return { path: target, symbol: explicitSymbol }
  const hash = target.lastIndexOf("#")
  if (hash > 0) return { path: target.slice(0, hash), symbol: target.slice(hash + 1) || null }

  const match = target.match(/^(.+\.(?:[cm]?[jt]sx?)):(.+)$/iu)
  return match === null
    ? { path: target, symbol: null }
    : { path: match[1]!, symbol: match[2]! }
}

const positionAt = (source: string, offset: number): SourcePosition => {
  const before = source.slice(0, offset)
  const lastNewline = before.lastIndexOf("\n")
  return {
    line: before.split("\n").length,
    column: offset - lastNewline,
    offset
  }
}

const fullRange = (source: string): SourceRange => ({
  start: positionAt(source, 0),
  end: positionAt(source, source.length)
})

const findDeclaration = (
  declarations: ReadonlyArray<Declaration>,
  qualifiedName: string
): Declaration | null => {
  const parts = qualifiedName.split(".").filter(Boolean)
  let candidates = declarations
  let found: Declaration | undefined
  for (const part of parts) {
    found = candidates.find((declaration) => declaration.name === part)
    if (found === undefined) return null
    candidates = found.children
  }
  return found ?? null
}

const inspectOptions = (path: string): InspectOptions => ({
  roots: [path],
  peek: true,
  peekLines: 3,
  depth: null,
  symbols: "all",
  format: "json",
  hidden: true,
  noIgnore: true,
  ascii: false,
  color: "never",
  maxSymbols: null,
  collapseBarrels: false
})

export const selectSource = (
  target: string,
  explicitSymbol: string | null = null
): Effect.Effect<SelectedSource, InspectError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    const parsed = parseTarget(target, explicitSymbol)
    const absolute = pathService.resolve(parsed.path)
    const source = yield* fs.readFileString(absolute).pipe(
      Effect.mapError((cause) => new InspectError({
        path: parsed.path,
        message: "Unable to read selected source file",
        cause
      }))
    )
    const output = yield* inspect(inspectOptions(parsed.path)).pipe(
      Effect.mapError((cause) => cause instanceof InspectError
        ? cause
        : new InspectError({ path: parsed.path, message: "Invalid source selection options", cause }))
    )
    const file = output.roots[0]
    if (file?.type !== "file" || file.contentHash === null) {
      return yield* new InspectError({
        path: parsed.path,
        message: "Selection target is not a supported JavaScript or TypeScript file"
      })
    }

    const declaration = parsed.symbol === null
      ? null
      : findDeclaration(file.declarations, parsed.symbol)
    if (parsed.symbol !== null && declaration === null) {
      return yield* new InspectError({
        path: parsed.path,
        message: `Symbol ${JSON.stringify(parsed.symbol)} was not found`
      })
    }

    const range = declaration?.range ?? fullRange(source)
    return {
      schemaVersion: 2,
      path: file.path,
      language: file.language,
      qualifiedName: parsed.symbol,
      kind: declaration?.kind ?? null,
      range,
      contentHash: file.contentHash,
      source: source.slice(range.start.offset, range.end.offset)
    }
  })

export const renderSelectedSource = (selected: SelectedSource): string => {
  const from = selected.range.start.line
  const to = selected.range.end.line
  const width = String(Math.max(from, to)).length
  const lines = selected.source.split("\n")
  if (lines.at(-1) === "") lines.pop()
  const header = [
    `${selected.path}:L${from}${to === from ? "" : `–${to}`}`,
    selected.qualifiedName,
    selected.kind,
    selected.contentHash
  ].filter((part): part is string => part !== null).join(" · ")
  return [
    header,
    ...lines.map((line, index) => `${String(from + index).padStart(width)} │ ${line}`)
  ].join("\n")
}

export const renderSelectedJson = (
  selected: SelectedSource
): Effect.Effect<string, RenderError> =>
  Schema.encodeEffect(SelectedSourceSchema)(selected).pipe(
    Effect.map((encoded) => JSON.stringify(encoded, null, 2)),
    Effect.mapError((cause) => new RenderError({ message: "Selection did not match schema version 2", cause }))
  )
