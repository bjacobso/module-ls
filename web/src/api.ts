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

export interface ExplorerDirectoryType {
  readonly type: "directory"
  readonly name: string
  readonly path: string
  readonly children: ReadonlyArray<ExplorerDirectoryType | ExplorerFileNodeType>
}

export interface ExplorerFileNodeType {
  readonly type: "file"
  readonly file: ExplorerFile
}

const ExplorerFileNode: S.Codec<ExplorerFileNodeType> = S.Struct({
  type: S.Literal("file"),
  file: ExplorerFile
})

export const ExplorerDirectory: S.Codec<ExplorerDirectoryType> = S.Struct({
  type: S.Literal("directory"),
  name: S.String,
  path: S.String,
  children: S.Array(S.Union([
    S.suspend((): S.Codec<ExplorerDirectoryType> => ExplorerDirectory),
    ExplorerFileNode
  ]))
})

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
  tree: ExplorerDirectory,
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

export const HighlightedToken = S.Struct({
  content: S.String,
  start: S.Number,
  end: S.Number,
  color: S.NullOr(S.String),
  darkColor: S.NullOr(S.String),
  fontStyle: S.NullOr(S.Number)
})
export type HighlightedToken = typeof HighlightedToken.Type

export const HoverAnnotation = S.Struct({
  start: S.Number,
  end: S.Number,
  text: S.String,
  documentation: S.NullOr(S.String)
})
export type HoverAnnotation = typeof HoverAnnotation.Type

export const DefinitionTarget = S.Struct({ path: S.String, range: SourceRange })
export type DefinitionTarget = typeof DefinitionTarget.Type

export const DefinitionAnnotation = S.Struct({
  start: S.Number,
  end: S.Number,
  targets: S.Array(DefinitionTarget)
})
export type DefinitionAnnotation = typeof DefinitionAnnotation.Type

export const AnnotatedSource = S.Struct({
  schemaVersion: S.Literal(3),
  path: S.String,
  language: S.NullOr(S.Literals(["typescript", "javascript"])),
  qualifiedName: S.NullOr(S.String),
  kind: S.NullOr(DeclarationKind),
  range: SourceRange,
  contentHash: S.String,
  source: S.String,
  lines: S.Array(S.Array(HighlightedToken)),
  hovers: S.Array(HoverAnnotation),
  definitions: S.Array(DefinitionAnnotation)
})
export type AnnotatedSource = typeof AnnotatedSource.Type

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

export const fetchAnnotated = (path: string, symbol: string | null) => {
  const params = new URLSearchParams({ path })
  if (symbol !== null) params.set("symbol", symbol)
  return fetchJson(`/api/annotated?${params}`, AnnotatedSource)
}
