import fs from "node:fs"
import path from "node:path"

import ts from "typescript"

import type {
  DefinitionAnnotation,
  HoverAnnotation,
  SourcePosition,
  SourceRange
} from "./model.js"

const MAX_IDENTIFIERS = 5_000

const normalize = (value: string): string => path.resolve(value).replaceAll("\\", "/")

const positionAt = (source: string, offset: number): SourcePosition => {
  const before = source.slice(0, offset)
  const lastNewline = before.lastIndexOf("\n")
  return { line: before.split("\n").length, column: offset - lastNewline, offset }
}

const rangeAt = (source: string, start: number, length: number): SourceRange => ({
  start: positionAt(source, start),
  end: positionAt(source, start + length)
})

const nearestConfig = (root: string, file: string): string | undefined => {
  let directory = path.dirname(file)
  while (directory === root || directory.startsWith(`${root}${path.sep}`)) {
    const candidate = path.join(directory, "tsconfig.json")
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return undefined
}

interface ServiceEntry {
  readonly service: ts.LanguageService
  readonly fileNames: Set<string>
}

const services = new Map<string, ServiceEntry>()

const serviceFor = (root: string, selectedFile: string): ServiceEntry => {
  const configPath = nearestConfig(root, selectedFile)
  const key = configPath ?? `${root}::default`
  const existing = services.get(key)
  if (existing !== undefined) {
    existing.fileNames.add(selectedFile)
    services.delete(key)
    services.set(key, existing)
    return existing
  }

  let fileNames = new Set<string>([selectedFile])
  let options: ts.CompilerOptions = {
    allowJs: true,
    checkJs: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    skipLibCheck: true
  }
  if (configPath !== undefined) {
    const loaded = ts.readConfigFile(configPath, ts.sys.readFile)
    if (loaded.error === undefined) {
      const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, path.dirname(configPath))
      options = parsed.options
      fileNames = new Set(parsed.fileNames.map(normalize))
      fileNames.add(selectedFile)
    }
  }

  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => options,
    getScriptFileNames: () => [...fileNames],
    getScriptVersion: (fileName) => {
      try {
        const stat = fs.statSync(fileName)
        return `${stat.mtimeMs}:${stat.size}`
      } catch {
        return "missing"
      }
    },
    getScriptSnapshot: (fileName) => {
      const source = ts.sys.readFile(fileName)
      return source === undefined ? undefined : ts.ScriptSnapshot.fromString(source)
    },
    getCurrentDirectory: () => root,
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    getNewLine: () => ts.sys.newLine
  }
  const entry = { service: ts.createLanguageService(host), fileNames }
  services.set(key, entry)
  if (services.size > 3) {
    const oldestKey = services.keys().next().value
    if (oldestKey !== undefined) {
      services.get(oldestKey)?.service.dispose()
      services.delete(oldestKey)
    }
  }
  return entry
}

const identifierSpans = (fileName: string, source: string): ReadonlyArray<ts.TextSpan> => {
  const kind = /\.[cm]?tsx$/iu.test(fileName)
    ? ts.ScriptKind.TSX
    : /\.[cm]?jsx$/iu.test(fileName)
      ? ts.ScriptKind.JSX
      : /\.[cm]?js$/iu.test(fileName) ? ts.ScriptKind.JS : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind)
  const spans: Array<ts.TextSpan> = []
  const visit = (node: ts.Node): void => {
    if (spans.length >= MAX_IDENTIFIERS) return
    if (ts.isIdentifier(node) || node.kind === ts.SyntaxKind.ThisKeyword) {
      spans.push({ start: node.getStart(sourceFile), length: node.getWidth(sourceFile) })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return spans
}

export interface TypeAnnotations {
  readonly hovers: ReadonlyArray<HoverAnnotation>
  readonly definitions: ReadonlyArray<DefinitionAnnotation>
}

export const typeAnnotations = (
  requestedRoot: string,
  requestedFile: string,
  source: string,
  selectionStart = 0
): TypeAnnotations => {
  const root = normalize(requestedRoot)
  const file = normalize(requestedFile)
  const { service } = serviceFor(root, file)
  const hovers: Array<HoverAnnotation> = []
  const definitions: Array<DefinitionAnnotation> = []
  const seenHover = new Set<string>()
  const seenDefinition = new Set<string>()

  for (const span of identifierSpans(file, source)) {
    const absoluteStart = span.start + selectionStart
    const quickInfo = service.getQuickInfoAtPosition(file, absoluteStart)
    if (quickInfo !== undefined) {
      const start = quickInfo.textSpan.start - selectionStart
      const end = start + quickInfo.textSpan.length
      if (start >= 0 && end <= source.length) {
        const key = `${start}:${end}`
        if (!seenHover.has(key)) {
          seenHover.add(key)
          hovers.push({
            start,
            end,
            text: ts.displayPartsToString(quickInfo.displayParts),
            documentation: ts.displayPartsToString(quickInfo.documentation) || null
          })
        }
      }
    }

    const targetDefinitions = service.getDefinitionAtPosition(file, absoluteStart)
    if (targetDefinitions === undefined) continue
    const targets = targetDefinitions.flatMap((definition) => {
      const targetFile = normalize(definition.fileName)
      const relative = path.relative(root, targetFile).replaceAll("\\", "/")
      if (relative.startsWith("..") || path.isAbsolute(relative)) return []
      const targetSource = ts.sys.readFile(targetFile)
      if (targetSource === undefined) return []
      return [{ path: relative, range: rangeAt(targetSource, definition.textSpan.start, definition.textSpan.length) }]
    })
    if (targets.length === 0) continue
    const start = span.start
    const end = span.start + span.length
    const key = `${start}:${end}`
    if (!seenDefinition.has(key)) {
      seenDefinition.add(key)
      definitions.push({ start, end, targets })
    }
  }

  return { hovers, definitions }
}
