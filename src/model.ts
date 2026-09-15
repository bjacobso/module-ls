import { Schema } from "effect"

export const DeclarationKindSchema = Schema.Literals([
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

export type DeclarationKind = typeof DeclarationKindSchema.Type

export const VisibilitySchema = Schema.Literals(["public", "private", "unknown"])
export type Visibility = typeof VisibilitySchema.Type

export const SourceLocationSchema = Schema.Struct({
  line: Schema.Number,
  column: Schema.Number
})

export interface SourceLocation extends Schema.Schema.Type<typeof SourceLocationSchema> {}

export const SourcePositionSchema = Schema.Struct({
  line: Schema.Number,
  column: Schema.Number,
  offset: Schema.Number
})

export interface SourcePosition extends Schema.Schema.Type<typeof SourcePositionSchema> {}

export const SourceRangeSchema = Schema.Struct({
  start: SourcePositionSchema,
  end: SourcePositionSchema
})

export interface SourceRange extends Schema.Schema.Type<typeof SourceRangeSchema> {}

export interface Declaration {
  readonly kind: DeclarationKind
  readonly name: string
  readonly visibility: Visibility
  readonly signature: string | null
  readonly documentation: string | null
  readonly location: SourceLocation
  readonly range: SourceRange
  readonly nameRange: SourceRange | null
  readonly documentationRange: SourceRange | null
  readonly children: ReadonlyArray<Declaration>
}

export const DeclarationSchema: Schema.Codec<Declaration> = Schema.Struct({
  kind: DeclarationKindSchema,
  name: Schema.String,
  visibility: VisibilitySchema,
  signature: Schema.NullOr(Schema.String),
  documentation: Schema.NullOr(Schema.String),
  location: SourceLocationSchema,
  range: SourceRangeSchema,
  nameRange: Schema.NullOr(SourceRangeSchema),
  documentationRange: Schema.NullOr(SourceRangeSchema),
  children: Schema.Array(Schema.suspend((): Schema.Codec<Declaration> => DeclarationSchema))
})

export const DiagnosticSchema = Schema.Struct({
  severity: Schema.Literals(["warning", "error"]),
  code: Schema.String,
  message: Schema.String,
  path: Schema.NullOr(Schema.String),
  line: Schema.NullOr(Schema.Number)
})

export interface Diagnostic extends Schema.Schema.Type<typeof DiagnosticSchema> {}

export interface FileNode {
  readonly type: "file"
  readonly name: string
  readonly path: string
  readonly language: "typescript" | "javascript" | null
  readonly contentHash: string | null
  readonly documentation: string | null
  readonly declarations: ReadonlyArray<Declaration>
  readonly diagnostics: ReadonlyArray<Diagnostic>
}

export const FileNodeSchema: Schema.Codec<FileNode> = Schema.Struct({
  type: Schema.Literal("file"),
  name: Schema.String,
  path: Schema.String,
  language: Schema.NullOr(Schema.Literals(["typescript", "javascript"])),
  contentHash: Schema.NullOr(Schema.String),
  documentation: Schema.NullOr(Schema.String),
  declarations: Schema.Array(DeclarationSchema),
  diagnostics: Schema.Array(DiagnosticSchema)
})

export interface SymlinkNode {
  readonly type: "symlink"
  readonly name: string
  readonly path: string
}

export const SymlinkNodeSchema: Schema.Codec<SymlinkNode> = Schema.Struct({
  type: Schema.Literal("symlink"),
  name: Schema.String,
  path: Schema.String
})

export interface DirectoryNode {
  readonly type: "directory"
  readonly name: string
  readonly path: string
  readonly children: ReadonlyArray<TreeNode>
}

export type TreeNode = DirectoryNode | FileNode | SymlinkNode

export const DirectoryNodeSchema: Schema.Codec<DirectoryNode> = Schema.Struct({
  type: Schema.Literal("directory"),
  name: Schema.String,
  path: Schema.String,
  children: Schema.Array(
    Schema.suspend((): Schema.Codec<TreeNode> => TreeNodeSchema)
  )
})

export const TreeNodeSchema: Schema.Codec<TreeNode> = Schema.Union([
  DirectoryNodeSchema,
  FileNodeSchema,
  SymlinkNodeSchema
])

export const ModuleLsOutputSchema = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  roots: Schema.Array(TreeNodeSchema),
  diagnostics: Schema.Array(DiagnosticSchema)
})

export interface ModuleLsOutput extends Schema.Schema.Type<typeof ModuleLsOutputSchema> {}

export const SelectedSourceSchema = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  path: Schema.String,
  language: Schema.NullOr(Schema.Literals(["typescript", "javascript"])),
  qualifiedName: Schema.NullOr(Schema.String),
  kind: Schema.NullOr(DeclarationKindSchema),
  range: SourceRangeSchema,
  contentHash: Schema.String,
  source: Schema.String
})

export interface SelectedSource extends Schema.Schema.Type<typeof SelectedSourceSchema> {}

export const ExplorerDeclarationSchema = Schema.Struct({
  qualifiedName: Schema.String,
  kind: DeclarationKindSchema,
  signature: Schema.NullOr(Schema.String),
  documentation: Schema.NullOr(Schema.String),
  range: SourceRangeSchema
})

export interface ExplorerDeclaration extends Schema.Schema.Type<typeof ExplorerDeclarationSchema> {}

export const ExplorerFileSchema = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
  language: Schema.Literals(["typescript", "javascript"]),
  contentHash: Schema.String,
  documentation: Schema.NullOr(Schema.String),
  gitStatus: Schema.NullOr(Schema.String),
  declarations: Schema.Array(ExplorerDeclarationSchema)
})

export interface ExplorerFile extends Schema.Schema.Type<typeof ExplorerFileSchema> {}

export interface ExplorerDirectory {
  readonly type: "directory"
  readonly name: string
  readonly path: string
  readonly children: ReadonlyArray<ExplorerDirectory | ExplorerFileNode>
}

export interface ExplorerFileNode {
  readonly type: "file"
  readonly file: ExplorerFile
}

export const ExplorerFileNodeSchema: Schema.Codec<ExplorerFileNode> = Schema.Struct({
  type: Schema.Literal("file"),
  file: ExplorerFileSchema
})

export const ExplorerDirectorySchema: Schema.Codec<ExplorerDirectory> = Schema.Struct({
  type: Schema.Literal("directory"),
  name: Schema.String,
  path: Schema.String,
  children: Schema.Array(Schema.Union([
    Schema.suspend((): Schema.Codec<ExplorerDirectory> => ExplorerDirectorySchema),
    ExplorerFileNodeSchema
  ]))
})

export const ExplorerSnapshotSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  root: Schema.String,
  tree: ExplorerDirectorySchema,
  files: Schema.Array(ExplorerFileSchema),
  diagnostics: Schema.Array(DiagnosticSchema)
})

export interface ExplorerSnapshot extends Schema.Schema.Type<typeof ExplorerSnapshotSchema> {}

export const HighlightedTokenSchema = Schema.Struct({
  content: Schema.String,
  start: Schema.Number,
  end: Schema.Number,
  color: Schema.NullOr(Schema.String),
  darkColor: Schema.NullOr(Schema.String),
  fontStyle: Schema.NullOr(Schema.Number)
})

export interface HighlightedToken extends Schema.Schema.Type<typeof HighlightedTokenSchema> {}

export const HoverAnnotationSchema = Schema.Struct({
  start: Schema.Number,
  end: Schema.Number,
  text: Schema.String,
  documentation: Schema.NullOr(Schema.String)
})

export interface HoverAnnotation extends Schema.Schema.Type<typeof HoverAnnotationSchema> {}

export const DefinitionTargetSchema = Schema.Struct({
  path: Schema.String,
  range: SourceRangeSchema
})

export const DefinitionAnnotationSchema = Schema.Struct({
  start: Schema.Number,
  end: Schema.Number,
  targets: Schema.Array(DefinitionTargetSchema)
})

export interface DefinitionAnnotation extends Schema.Schema.Type<typeof DefinitionAnnotationSchema> {}

export const AnnotatedSourceSchema = Schema.Struct({
  schemaVersion: Schema.Literal(3),
  path: Schema.String,
  language: Schema.NullOr(Schema.Literals(["typescript", "javascript"])),
  qualifiedName: Schema.NullOr(Schema.String),
  kind: Schema.NullOr(DeclarationKindSchema),
  range: SourceRangeSchema,
  contentHash: Schema.String,
  source: Schema.String,
  lines: Schema.Array(Schema.Array(HighlightedTokenSchema)),
  hovers: Schema.Array(HoverAnnotationSchema),
  definitions: Schema.Array(DefinitionAnnotationSchema)
})

export interface AnnotatedSource extends Schema.Schema.Type<typeof AnnotatedSourceSchema> {}

export const SearchResultSchema = Schema.Struct({
  type: Schema.Literals(["file", "symbol"]),
  path: Schema.String,
  label: Schema.String,
  detail: Schema.NullOr(Schema.String),
  symbol: Schema.NullOr(Schema.String),
  range: Schema.NullOr(SourceRangeSchema),
  score: Schema.Number
})

export interface SearchResult extends Schema.Schema.Type<typeof SearchResultSchema> {}

export const SearchResponseSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  query: Schema.String,
  results: Schema.Array(SearchResultSchema)
})

export const SymbolsSchema = Schema.Literals(["modules", "public", "all"])
export type Symbols = typeof SymbolsSchema.Type

export const OutputFormatSchema = Schema.Literals(["tree", "json"])
export type OutputFormat = typeof OutputFormatSchema.Type

export const ColorModeSchema = Schema.Literals(["auto", "always", "never"])
export type ColorMode = typeof ColorModeSchema.Type

export const InspectOptionsSchema = Schema.Struct({
  roots: Schema.Array(Schema.String),
  peek: Schema.Boolean,
  peekLines: Schema.Int.check(Schema.isGreaterThan(0)),
  depth: Schema.NullOr(Schema.Natural),
  symbols: SymbolsSchema,
  format: OutputFormatSchema,
  hidden: Schema.Boolean,
  noIgnore: Schema.Boolean,
  ascii: Schema.Boolean,
  color: ColorModeSchema,
  maxSymbols: Schema.NullOr(Schema.Natural),
  collapseBarrels: Schema.Boolean
})

export interface InspectOptions extends Schema.Schema.Type<typeof InspectOptionsSchema> {}
