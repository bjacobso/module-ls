import type { Diagnostic } from "./model.js"

export type SourceLanguage = "typescript" | "javascript"

export interface DiscoveredFile {
  readonly _tag: "File"
  readonly name: string
  readonly path: string
  readonly displayPath: string
  readonly language: SourceLanguage | null
  readonly content: string | null
  readonly diagnostics: ReadonlyArray<Diagnostic>
}

export interface DiscoveredDirectory {
  readonly _tag: "Directory"
  readonly name: string
  readonly path: string
  readonly displayPath: string
  readonly children: ReadonlyArray<DiscoveredNode>
}

export interface DiscoveredSymlink {
  readonly _tag: "Symlink"
  readonly name: string
  readonly path: string
  readonly displayPath: string
}

export type DiscoveredNode =
  | DiscoveredFile
  | DiscoveredDirectory
  | DiscoveredSymlink

export interface DiscoveryResult {
  readonly roots: ReadonlyArray<DiscoveredNode>
  readonly diagnostics: ReadonlyArray<Diagnostic>
}
