import { Schema } from "effect"

export const DeclarationKindSchema = Schema.Literal(
  "namespace",
  "class",
  "function",
  "variable",
  "type",
  "interface",
  "enum",
  "re-export",
  "default"
)

export type DeclarationKind = typeof DeclarationKindSchema.Type

export const VisibilitySchema = Schema.Literal("public", "private", "unknown")
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

export const DeclarationSchema: Schema.Schema<Declaration> = Schema.Struct({
  kind: DeclarationKindSchema,
  name: Schema.String,
  visibility: VisibilitySchema,
  signature: Schema.NullOr(Schema.String),
  documentation: Schema.NullOr(Schema.String),
  location: SourceLocationSchema,
  range: SourceRangeSchema,
  nameRange: Schema.NullOr(SourceRangeSchema),
  documentationRange: Schema.NullOr(SourceRangeSchema),
  children: Schema.Array(Schema.suspend(() => DeclarationSchema))
})

export const DiagnosticSchema = Schema.Struct({
  severity: Schema.Literal("warning", "error"),
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

export const FileNodeSchema: Schema.Schema<FileNode> = Schema.Struct({
  type: Schema.Literal("file"),
  name: Schema.String,
  path: Schema.String,
  language: Schema.NullOr(Schema.Literal("typescript", "javascript")),
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

export const SymlinkNodeSchema: Schema.Schema<SymlinkNode> = Schema.Struct({
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

export const DirectoryNodeSchema: Schema.Schema<DirectoryNode> = Schema.Struct({
  type: Schema.Literal("directory"),
  name: Schema.String,
  path: Schema.String,
  children: Schema.Array(
    Schema.suspend((): Schema.Schema<TreeNode> => TreeNodeSchema)
  )
})

export const TreeNodeSchema: Schema.Schema<TreeNode> = Schema.Union(
  DirectoryNodeSchema,
  FileNodeSchema,
  SymlinkNodeSchema
)

export const ModuleLsOutputSchema = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  roots: Schema.Array(TreeNodeSchema),
  diagnostics: Schema.Array(DiagnosticSchema)
})

export interface ModuleLsOutput extends Schema.Schema.Type<typeof ModuleLsOutputSchema> {}

export const SelectedSourceSchema = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  path: Schema.String,
  language: Schema.NullOr(Schema.Literal("typescript", "javascript")),
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
  language: Schema.Literal("typescript", "javascript"),
  contentHash: Schema.String,
  documentation: Schema.NullOr(Schema.String),
  gitStatus: Schema.NullOr(Schema.String),
  declarations: Schema.Array(ExplorerDeclarationSchema)
})

export interface ExplorerFile extends Schema.Schema.Type<typeof ExplorerFileSchema> {}

export const ExplorerSnapshotSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  root: Schema.String,
  files: Schema.Array(ExplorerFileSchema),
  diagnostics: Schema.Array(DiagnosticSchema)
})

export interface ExplorerSnapshot extends Schema.Schema.Type<typeof ExplorerSnapshotSchema> {}

export const SymbolsSchema = Schema.Literal("modules", "public", "all")
export type Symbols = typeof SymbolsSchema.Type

export const OutputFormatSchema = Schema.Literal("tree", "json")
export type OutputFormat = typeof OutputFormatSchema.Type

export const ColorModeSchema = Schema.Literal("auto", "always", "never")
export type ColorMode = typeof ColorModeSchema.Type

export const InspectOptionsSchema = Schema.Struct({
  roots: Schema.Array(Schema.String),
  peek: Schema.Boolean,
  peekLines: Schema.Number.pipe(Schema.int(), Schema.positive()),
  depth: Schema.NullOr(Schema.NonNegativeInt),
  symbols: SymbolsSchema,
  format: OutputFormatSchema,
  hidden: Schema.Boolean,
  noIgnore: Schema.Boolean,
  ascii: Schema.Boolean,
  color: ColorModeSchema,
  maxSymbols: Schema.NullOr(Schema.NonNegativeInt),
  collapseBarrels: Schema.Boolean
})

export interface InspectOptions extends Schema.Schema.Type<typeof InspectOptionsSchema> {}
