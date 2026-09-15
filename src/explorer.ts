import { Effect, FileSystem, Path } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"

import { inspect } from "./app.js"
import { InspectError } from "./errors.js"
import type {
  Declaration,
  ExplorerDeclaration,
  ExplorerDirectory,
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

interface MutableDirectory {
  type: "directory"
  name: string
  path: string
  children: Array<MutableDirectory | { type: "file", file: ExplorerFile }>
}

const directoryTree = (root: string, files: ReadonlyArray<ExplorerFile>): ExplorerDirectory => {
  const tree: MutableDirectory = {
    type: "directory",
    name: root.split(/[\\/]/u).at(-1) || root,
    path: "",
    children: []
  }
  for (const file of files) {
    const parts = file.path.split("/")
    let directory = tree
    for (const part of parts.slice(0, -1)) {
      let child = directory.children.find((candidate): candidate is MutableDirectory =>
        candidate.type === "directory" && candidate.name === part)
      if (child === undefined) {
        child = {
          type: "directory",
          name: part,
          path: directory.path === "" ? part : `${directory.path}/${part}`,
          children: []
        }
        directory.children.push(child)
      }
      directory = child
    }
    directory.children.push({ type: "file", file })
  }
  const sort = (directory: MutableDirectory): void => {
    directory.children.sort((left, right) => {
      if (left.type !== right.type) return left.type === "directory" ? -1 : 1
      const leftName = left.type === "directory" ? left.name : left.file.name
      const rightName = right.type === "directory" ? right.name : right.file.name
      return leftName.localeCompare(rightName)
    })
    for (const child of directory.children) if (child.type === "directory") sort(child)
  }
  sort(tree)
  return tree
}

const gitStatuses = (
  root: string
): Effect.Effect<ReadonlyMap<string, string>, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const output = yield* spawner.string(ChildProcess.make(
      "git",
      ["status", "--short", "--untracked-files=all"],
      { cwd: root }
    ))
    return new Map(output.trim().split("\n").flatMap((line) => {
      if (line.length < 4) return []
      const status = line.slice(0, 2).trim() || "changed"
      const rawPath = line.slice(3).replace(/^.* -> /u, "")
      return [[rawPath.replaceAll("\\", "/"), status] as const]
    }))
  }).pipe(Effect.match({
    onFailure: () => new Map<string, string>(),
    onSuccess: (statuses) => statuses
  }))

export const explorerSnapshot = (
  root: string
): Effect.Effect<
  ExplorerSnapshot,
  InspectError,
  Path.Path | ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> =>
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
      tree: directoryTree(absoluteRoot, files),
      files,
      diagnostics: output.diagnostics
    }
  })
