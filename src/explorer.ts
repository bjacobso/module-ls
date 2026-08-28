import { Command, CommandExecutor, FileSystem, Path } from "@effect/platform"
import { Effect } from "effect"

import { inspect } from "./app.js"
import { InspectError } from "./errors.js"
import type {
  Declaration,
  ExplorerDeclaration,
  ExplorerFile,
  ExplorerSnapshot,
  InspectOptions,
  TreeNode
} from "./model.js"

const optionsFor = (root: string): InspectOptions => ({
  roots: [root],
  peek: true,
  peekLines: 3,
  depth: null,
  symbols: "all",
  format: "json",
  hidden: false,
  noIgnore: false,
  ascii: false,
  color: "never",
  maxSymbols: null,
  collapseBarrels: false
})

const flattenDeclarations = (
  declarations: ReadonlyArray<Declaration>,
  prefix = ""
): ReadonlyArray<ExplorerDeclaration> => declarations.flatMap((declaration) => {
  const qualifiedName = prefix === "" ? declaration.name : `${prefix}.${declaration.name}`
  return [{
    qualifiedName,
    kind: declaration.kind,
    signature: declaration.signature,
    documentation: declaration.documentation,
    range: declaration.range
  }, ...flattenDeclarations(declaration.children, qualifiedName)]
})

const collectFiles = (node: TreeNode): ReadonlyArray<ExplorerFile> => {
  switch (node.type) {
    case "directory":
      return node.children.flatMap(collectFiles)
    case "symlink":
      return []
    case "file":
      if (node.language === null || node.contentHash === null) return []
      return [{
        path: node.path,
        name: node.name,
        language: node.language,
        contentHash: node.contentHash,
        documentation: node.documentation,
        gitStatus: null,
        declarations: flattenDeclarations(node.declarations)
      }]
  }
}

const gitStatuses = (root: string): Effect.Effect<ReadonlyMap<string, string>, never, CommandExecutor.CommandExecutor> =>
  Command.make("git", "status", "--short", "--untracked-files=all").pipe(
    Command.workingDirectory(root),
    Command.string,
    Effect.map((output) => new Map(output.trim().split("\n").flatMap((line) => {
      if (line.length < 4) return []
      const status = line.slice(0, 2).trim() || "changed"
      const rawPath = line.slice(3).replace(/^.* -> /u, "")
      return [[rawPath.replaceAll("\\", "/"), status] as const]
    }))),
    Effect.catchAll(() => Effect.succeed(new Map()))
  )

export const explorerSnapshot = (
  root: string
): Effect.Effect<ExplorerSnapshot, InspectError, Path.Path | CommandExecutor.CommandExecutor | FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const pathService = yield* Path.Path
    const absoluteRoot = pathService.resolve(root)
    const output = yield* inspect(optionsFor(absoluteRoot)).pipe(
      Effect.mapError((cause) => cause instanceof InspectError
        ? cause
        : new InspectError({ path: root, message: "Invalid explorer options", cause }))
    )
    const statuses = yield* gitStatuses(absoluteRoot)
    const files = output.roots.flatMap(collectFiles).map((file) => {
      const absoluteFile = pathService.isAbsolute(file.path)
        ? file.path
        : pathService.resolve(file.path)
      const relative = pathService.relative(absoluteRoot, absoluteFile).replaceAll("\\", "/")
      return { ...file, path: relative, gitStatus: statuses.get(relative) ?? null }
    })
    return {
      schemaVersion: 1,
      root: absoluteRoot,
      files,
      diagnostics: output.diagnostics
    }
  })
