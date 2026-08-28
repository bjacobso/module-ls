import { Effect, Schema as S } from "effect"

export const SourcePosition = S.Struct({
  line: S.Number,
  column: S.Number,
  offset: S.Number
})

export const SourceRange = S.Struct({
  start: SourcePosition,
  end: SourcePosition
})

export const DeclarationKind = S.Literals([
  "namespace",
  "class",
  "function",
  "variable",
  "type",
  "interface",
  "enum",
  "re-export",
  "default"
])

export const ExplorerDeclaration = S.Struct({
  qualifiedName: S.String,
  kind: DeclarationKind,
  signature: S.NullOr(S.String),
  documentation: S.NullOr(S.String),
  range: SourceRange
})
export type ExplorerDeclaration = typeof ExplorerDeclaration.Type

export const ExplorerFile = S.Struct({
  path: S.String,
  name: S.String,
  language: S.Literals(["typescript", "javascript"]),
  contentHash: S.String,
  documentation: S.NullOr(S.String),
  gitStatus: S.NullOr(S.String),
  declarations: S.Array(ExplorerDeclaration)
})
export type ExplorerFile = typeof ExplorerFile.Type

const Diagnostic = S.Struct({
  severity: S.Literals(["warning", "error"]),
  code: S.String,
  message: S.String,
  path: S.NullOr(S.String),
  line: S.NullOr(S.Number)
})

export const ExplorerSnapshot = S.Struct({
  schemaVersion: S.Literal(1),
  root: S.String,
  files: S.Array(ExplorerFile),
  diagnostics: S.Array(Diagnostic)
})
export type ExplorerSnapshot = typeof ExplorerSnapshot.Type

export const SelectedSource = S.Struct({
  schemaVersion: S.Literal(2),
  path: S.String,
  language: S.NullOr(S.Literals(["typescript", "javascript"])),
  qualifiedName: S.NullOr(S.String),
  kind: S.NullOr(DeclarationKind),
  range: SourceRange,
  contentHash: S.String,
  source: S.String
})
export type SelectedSource = typeof SelectedSource.Type

const fetchJson = <A, I, R>(url: string, schema: S.Codec<A, I, R>) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, { headers: { accept: "application/json" } })
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null)
        const detail = typeof body === "object" && body !== null && "error" in body
          ? String(body.error)
          : response.statusText
        throw new Error(`${response.status}: ${detail}`)
      }
      return response.json() as Promise<unknown>
    },
    catch: (cause) => cause instanceof Error ? cause.message : String(cause)
  }).pipe(
    Effect.flatMap(S.decodeUnknownEffect(schema)),
    Effect.mapError(String)
  )

export const fetchTree = () => fetchJson("/api/tree", ExplorerSnapshot)

export const fetchSource = (path: string, symbol: string | null) => {
  const params = new URLSearchParams({ path })
  if (symbol !== null) params.set("symbol", symbol)
  return fetchJson(`/api/source?${params}`, SelectedSource)
}
