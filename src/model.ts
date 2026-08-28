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

export interface Declaration {
  readonly kind: DeclarationKind
  readonly name: string
  readonly visibility: Visibility
  readonly signature: string | null
  readonly documentation: string | null
  readonly location: SourceLocation
  readonly children: ReadonlyArray<Declaration>
}

export const DeclarationSchema: Schema.Schema<Declaration> = Schema.Struct({
  kind: DeclarationKindSchema,
  name: Schema.String,
  visibility: VisibilitySchema,
  signature: Schema.NullOr(Schema.String),
  documentation: Schema.NullOr(Schema.String),
  location: SourceLocationSchema,
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
  readonly documentation: string | null
  readonly declarations: ReadonlyArray<Declaration>
  readonly diagnostics: ReadonlyArray<Diagnostic>
}

export const FileNodeSchema: Schema.Schema<FileNode> = Schema.Struct({
  type: Schema.Literal("file"),
  name: Schema.String,
  path: Schema.String,
  language: Schema.NullOr(Schema.Literal("typescript", "javascript")),
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
  schemaVersion: Schema.Literal(1),
  roots: Schema.Array(TreeNodeSchema),
  diagnostics: Schema.Array(DiagnosticSchema)
})

export interface ModuleLsOutput extends Schema.Schema.Type<typeof ModuleLsOutputSchema> {}

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
  color: ColorModeSchema
})

export interface InspectOptions extends Schema.Schema.Type<typeof InspectOptionsSchema> {}
