import { FileSystem, Path } from "@effect/platform"
import { Effect, Option } from "effect"
import createIgnore, { type Ignore } from "ignore"

import { InspectError } from "./errors.js"
import type {
  DiscoveredDirectory,
  DiscoveredFile,
  DiscoveredNode,
  DiscoveryResult,
  SourceLanguage
} from "./internal.js"
import type { Diagnostic, InspectOptions } from "./model.js"

const MAX_FILE_SIZE = FileSystem.MiB(1)

const builtInIgnoredDirectories = new Set([
  ".git",
  ".elixir_ls",
  "_build",
  "_opam",
  "build",
  "coverage",
  "deps",
  "dist",
  "node_modules"
])

const languageForExtension = (extension: string): SourceLanguage | undefined => {
  switch (extension) {
    case ".ts":
    case ".tsx":
    case ".mts":
    case ".cts":
      return "typescript"
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "javascript"
    default:
      return undefined
  }
}

const slash = (value: string): string => value.replaceAll("\\", "/")

const diagnostic = (
  severity: "warning" | "error",
  code: string,
  message: string,
  path: string | null
): Diagnostic => ({ severity, code, message, path, line: null })

interface WalkContext {
  readonly cwd: string
  readonly root: string
  readonly rootIgnore: Ignore
  readonly options: InspectOptions
}

interface WalkResult {
  readonly node: DiscoveredNode | null
  readonly diagnostics: ReadonlyArray<Diagnostic>
}

const displayPath = (pathService: Path.Path, cwd: string, absolute: string): string => {
  const relative = slash(pathService.relative(cwd, absolute))
  return relative === "" ? "." : relative.startsWith("..") ? slash(absolute) : relative
}

const loadRootIgnore = (
  fs: FileSystem.FileSystem,
  pathService: Path.Path,
  root: string,
  enabled: boolean
): Effect.Effect<Ignore> => {
  const matcher = createIgnore()
  if (!enabled) return Effect.succeed(matcher)

  const ignorePath = pathService.join(root, ".gitignore")
  return fs.readFileString(ignorePath).pipe(
    Effect.tap((content) => Effect.sync(() => matcher.add(content))),
    Effect.as(matcher),
    Effect.catchAll(() => Effect.succeed(matcher))
  )
}

const shouldIgnore = (
  pathService: Path.Path,
  context: WalkContext,
  absolute: string,
  name: string,
  isDirectory: boolean
): boolean => {
  if (!context.options.hidden && name.startsWith(".")) return true
  if (context.options.noIgnore) return false
  if (isDirectory && builtInIgnoredDirectories.has(name)) return true

  const relative = slash(pathService.relative(context.root, absolute))
  if (relative === "" || relative.startsWith("..")) return false
  const candidate = isDirectory ? `${relative}/` : relative
  return context.rootIgnore.ignores(candidate)
}

const walk = (
  fs: FileSystem.FileSystem,
  pathService: Path.Path,
  absolute: string,
  depth: number,
  context: WalkContext,
  explicit: boolean
): Effect.Effect<WalkResult, InspectError> =>
  Effect.gen(function*() {
    const shownPath = displayPath(pathService, context.cwd, absolute)
    const name = explicit && shownPath === "." ? "." : pathService.basename(absolute)

    const link = yield* Effect.option(fs.readLink(absolute))
    if (Option.isSome(link)) {
      return {
        node: { _tag: "Symlink", name, path: absolute, displayPath: shownPath },
        diagnostics: []
      }
    }

    const info = yield* fs.stat(absolute).pipe(
      Effect.mapError(
        (cause) => new InspectError({ path: shownPath, message: "Unable to inspect path", cause })
      )
    )

    if (info.type === "File") {
      const language = languageForExtension(pathService.extname(name).toLowerCase())
      if (language === undefined && !explicit) return { node: null, diagnostics: [] }

      if (language === undefined) {
        const warning = diagnostic(
          "warning",
          "unsupported-file",
          "File type is not supported; only JavaScript and TypeScript are indexed",
          shownPath
        )
        return {
          node: {
            _tag: "File",
            name,
            path: absolute,
            displayPath: shownPath,
            language: null,
            content: null,
            diagnostics: [warning]
          },
          diagnostics: [warning]
        }
      }

      if (info.size > MAX_FILE_SIZE) {
        const warning = diagnostic(
          "warning",
          "file-too-large",
          "File is larger than 1 MiB and was not parsed",
          shownPath
        )
        const node: DiscoveredFile = {
          _tag: "File",
          name,
          path: absolute,
          displayPath: shownPath,
          language,
          content: null,
          diagnostics: [warning]
        }
        return { node, diagnostics: [warning] }
      }

      const content = yield* fs.readFileString(absolute).pipe(
        Effect.mapError(
          (cause) => new InspectError({ path: shownPath, message: "Unable to read source file", cause })
        )
      )
      return {
        node: {
          _tag: "File",
          name,
          path: absolute,
          displayPath: shownPath,
          language,
          content,
          diagnostics: []
        },
        diagnostics: []
      }
    }

    if (info.type !== "Directory") return { node: null, diagnostics: [] }

    if (context.options.depth !== null && depth >= context.options.depth) {
      const directory: DiscoveredDirectory = {
        _tag: "Directory",
        name,
        path: absolute,
        displayPath: shownPath,
        children: []
      }
      return { node: directory, diagnostics: [] }
    }

    const entries = yield* fs.readDirectory(absolute).pipe(
      Effect.mapError(
        (cause) => new InspectError({ path: shownPath, message: "Unable to read directory", cause })
      )
    )

    const inspected = yield* Effect.forEach(
      entries,
      (entry) => {
        const child = pathService.join(absolute, entry)
        return Effect.gen(function*() {
          const childLink = yield* Effect.option(fs.readLink(child))
          const isLink = Option.isSome(childLink)
          const childInfo = isLink ? Option.none<FileSystem.File.Info>() : yield* Effect.option(fs.stat(child))
          const isDirectory = Option.isSome(childInfo) && childInfo.value.type === "Directory"
          if (shouldIgnore(pathService, context, child, entry, isDirectory)) {
            return { node: null, diagnostics: [] } satisfies WalkResult
          }
          return yield* walk(fs, pathService, child, depth + 1, context, false)
        }).pipe(
          Effect.catchTag("InspectError", (error) => {
            const warning = diagnostic("error", "filesystem-error", error.message, error.path)
            return Effect.succeed({ node: null, diagnostics: [warning] } satisfies WalkResult)
          })
        )
      },
      { concurrency: 8 }
    )

    const children = inspected
      .flatMap((result) => result.node === null ? [] : [result.node])
      .filter((node) => node._tag !== "Directory" || node.children.length > 0)
      .sort((left, right) => {
        const leftDirectory = left._tag === "Directory"
        const rightDirectory = right._tag === "Directory"
        if (leftDirectory !== rightDirectory) return leftDirectory ? -1 : 1
        return left.name < right.name ? -1 : left.name > right.name ? 1 : 0
      })

    const directory: DiscoveredDirectory = {
      _tag: "Directory",
      name,
      path: absolute,
      displayPath: shownPath,
      children
    }
    return {
      node: directory,
      diagnostics: inspected.flatMap((result) => result.diagnostics)
    }
  })

export const discover = (
  options: InspectOptions
): Effect.Effect<DiscoveryResult, InspectError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    const cwd = pathService.resolve()
    const roots = options.roots.length === 0 ? ["."] : options.roots

    const results = yield* Effect.forEach(roots, (requested) =>
      Effect.gen(function*() {
        const absolute = pathService.resolve(requested)
        const rootInfo = yield* fs.stat(absolute).pipe(
          Effect.mapError(
            (cause) => new InspectError({ path: requested, message: "Path does not exist or is unreadable", cause })
          )
        )
        const ignoreRoot = rootInfo.type === "Directory" ? absolute : pathService.dirname(absolute)
        const rootIgnore = yield* loadRootIgnore(fs, pathService, ignoreRoot, !options.noIgnore)
        return yield* walk(fs, pathService, absolute, 0, {
          cwd,
          root: ignoreRoot,
          rootIgnore,
          options
        }, true)
      })
    )

    return {
      roots: results.flatMap((result) => result.node === null ? [] : [result.node]),
      diagnostics: results.flatMap((result) => result.diagnostics)
    }
  })
