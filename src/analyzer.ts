import { Effect } from "effect"
import {
  ModuleKind,
  Node,
  Project,
  ScriptTarget,
  SyntaxKind,
  type ExportDeclaration,
  type FunctionDeclaration,
  type ParameterDeclaration,
  type ModuleDeclaration,
  type Node as MorphNode,
  type SourceFile,
  type Statement,
  type VariableStatement,
  ts
} from "ts-morph"

import type { DiscoveredFile, DiscoveredNode, DiscoveryResult } from "./internal.js"
import type {
  Declaration,
  Diagnostic,
  DirectoryNode,
  FileNode,
  InspectOptions,
  ModuleLsOutput,
  SourcePosition,
  SourceRange,
  SourceLocation,
  SymlinkNode,
  Visibility
} from "./model.js"
import { InspectError } from "./errors.js"

const normalizeDocumentation = (raw: string): string | null => {
  const lines = raw
    .replace(/^\s*\/\*\*?/, "")
    .replace(/\*\/\s*$/, "")
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s*\/\/\/?\s?/u, "").replace(/^\s*\*\s?/u, ""))

  while (lines[0]?.trim() === "") lines.shift()
  while (lines.at(-1)?.trim() === "") lines.pop()
  if (lines.length === 0) return null

  const indentation = lines
    .filter((line) => line.trim() !== "")
    .map((line) => line.match(/^\s*/u)?.[0].length ?? 0)
  const common = indentation.length === 0 ? 0 : Math.min(...indentation)
  return lines.map((line) => line.slice(common).trimEnd()).join("\n").trim() || null
}

export const extractLeadingDocumentation = (source: string): string | null => {
  let input = source.replace(/^\uFEFF/u, "")
  input = input.replace(/^#![^\n]*(?:\n|$)/u, "")
  input = input.replace(/^(?:\s*\/\/\/\s*<reference[^\n]*\n)+/u, "")
  input = input.trimStart()

  const block = input.match(/^\/\*\*?[\s\S]*?\*\//u)?.[0]
  if (block !== undefined) return normalizeDocumentation(block)

  const lineBlock = input.match(/^(?:\/\/[^\n]*(?:\n|$))+/u)?.[0]
  return lineBlock === undefined ? null : normalizeDocumentation(lineBlock)
}

const declarationDocumentation = (node: MorphNode): string | null => {
  if (!Node.isJSDocable(node)) return null
  const jsDoc = node.getJsDocs().at(-1)
  return jsDoc === undefined ? null : normalizeDocumentation(jsDoc.getText())
}

const sourcePositionOf = (sourceFile: SourceFile, offset: number): SourcePosition => ({
  ...sourceFile.getLineAndColumnAtPos(offset),
  offset
})

const rangeOf = (sourceFile: SourceFile, node: MorphNode): SourceRange => ({
  start: sourcePositionOf(sourceFile, node.getStart()),
  end: sourcePositionOf(sourceFile, node.getEnd())
})

const documentationRangeOf = (sourceFile: SourceFile, node: MorphNode): SourceRange | null => {
  if (!Node.isJSDocable(node)) return null
  const jsDoc = node.getJsDocs().at(-1)
  return jsDoc === undefined ? null : rangeOf(sourceFile, jsDoc)
}

const locationOf = (sourceFile: SourceFile, node: MorphNode): SourceLocation =>
  sourceFile.getLineAndColumnAtPos(node.getStart())

const sourceMetadata = (
  sourceFile: SourceFile,
  node: MorphNode,
  nameNode: MorphNode | undefined = undefined,
  documentationNode: MorphNode = node
) => ({
  location: locationOf(sourceFile, node),
  range: rangeOf(sourceFile, node),
  nameRange: nameNode === undefined ? null : rangeOf(sourceFile, nameNode),
  documentationRange: documentationRangeOf(sourceFile, documentationNode)
})

/** A small, deterministic content identity for stale-range detection (not security). */
export const contentFingerprint = (source: string): string => {
  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(source)) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`
}

const visibilityOf = (node: MorphNode, declarationFile: boolean): Visibility => {
  if (Node.isExportable(node)) {
    return node.isExported() || node.isDefaultExport() || declarationFile ? "public" : "private"
  }
  return declarationFile ? "public" : "unknown"
}

const parameterSignature = (
  name: string,
  parameters: ReadonlyArray<ParameterDeclaration>
): string => {
  const rendered = parameters.map((parameter) => {
    const rest = parameter.isRestParameter() ? "..." : ""
    const optional = parameter.isOptional() ? "?" : ""
    return `${rest}${parameter.getName()}${optional}`
  })
  return `${name}(${rendered.join(", ")})`
}

const functionSignature = (declaration: FunctionDeclaration): string | null => {
  const name = declaration.getName()
  return name === undefined ? null : parameterSignature(name, declaration.getParameters())
}

const moduleChildren = (
  declaration: ModuleDeclaration,
  sourceFile: SourceFile
): ReadonlyArray<Declaration> => {
  const body = declaration.getBody()
  if (body === undefined) return []
  if (Node.isModuleBlock(body)) return statementsToDeclarations(body.getStatements(), sourceFile)
  if (Node.isModuleDeclaration(body)) return [moduleDeclaration(body, sourceFile)]
  return []
}

const moduleDeclaration = (
  declaration: ModuleDeclaration,
  sourceFile: SourceFile
): Declaration => ({
  kind: "namespace",
  name: declaration.getName(),
  visibility: visibilityOf(declaration, sourceFile.isDeclarationFile()),
  signature: null,
  documentation: declarationDocumentation(declaration),
  ...sourceMetadata(sourceFile, declaration, declaration.getNameNode()),
  children: moduleChildren(declaration, sourceFile)
})

const variableDeclarations = (
  statement: VariableStatement,
  sourceFile: SourceFile
): ReadonlyArray<Declaration> =>
  statement.getDeclarations().map((declaration) => {
    const initializer = declaration.getInitializer()
    const callable = initializer !== undefined &&
      (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))
    return {
      kind: callable ? "function" as const : "variable" as const,
      name: declaration.getName(),
      visibility: visibilityOf(statement, sourceFile.isDeclarationFile()),
      signature: callable
        ? parameterSignature(declaration.getName(), initializer.getParameters())
        : declaration.getTypeNode()?.getText() ?? null,
      documentation: declarationDocumentation(statement),
      ...sourceMetadata(sourceFile, statement, declaration.getNameNode(), statement),
      children: []
    }
  })

const exportDeclarations = (
  statement: ExportDeclaration,
  sourceFile: SourceFile
): ReadonlyArray<Declaration> => {
  const from = statement.getModuleSpecifierValue()
  const signature = from === undefined ? null : `from ${JSON.stringify(from)}`
  const named = statement.getNamedExports()
  if (named.length === 0) {
    return [{
      kind: "re-export",
      name: "*",
      visibility: "public",
      signature,
      documentation: declarationDocumentation(statement),
      ...sourceMetadata(sourceFile, statement, undefined, statement),
      children: []
    }]
  }

  return named.map((specifier) => ({
    kind: "re-export" as const,
    name: specifier.getAliasNode()?.getText() ?? specifier.getName(),
    visibility: "public" as const,
    signature,
    documentation: declarationDocumentation(statement),
    ...sourceMetadata(
      sourceFile,
      statement,
      specifier.getAliasNode() ?? specifier.getNameNode(),
      statement
    ),
    children: []
  }))
}

const commonJsDeclarations = (
  statement: Statement,
  sourceFile: SourceFile
): ReadonlyArray<Declaration> => {
  if (!Node.isExpressionStatement(statement)) return []
  const expression = statement.getExpression()
  if (!Node.isBinaryExpression(expression) || expression.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) {
    return []
  }

  const target = expression.getLeft().getText()
  const base = {
    kind: "variable" as const,
    visibility: "public" as const,
    signature: null,
    documentation: declarationDocumentation(statement),
    ...sourceMetadata(sourceFile, statement, undefined, statement),
    children: []
  }

  const property = target.match(/^(?:exports|module\.exports)\.([A-Za-z_$][\w$]*)$/u)?.[1]
  if (property !== undefined) return [{ ...base, name: property }]
  if (target !== "module.exports") return []

  const value = expression.getRight()
  if (!Node.isObjectLiteralExpression(value)) {
    return [{ ...base, kind: "default", name: "default" }]
  }

  return value.getProperties().flatMap((item) => {
    if (Node.isShorthandPropertyAssignment(item) || Node.isPropertyAssignment(item) || Node.isMethodDeclaration(item)) {
      return [{ ...base, name: item.getName() }]
    }
    return []
  })
}

const statementToDeclarations = (
  statement: Statement,
  sourceFile: SourceFile
): ReadonlyArray<Declaration> => {
  const visibility = visibilityOf(statement, sourceFile.isDeclarationFile())
  const base = {
    visibility,
    documentation: declarationDocumentation(statement),
    ...sourceMetadata(sourceFile, statement, undefined, statement),
    children: []
  } as const

  if (Node.isModuleDeclaration(statement)) return [moduleDeclaration(statement, sourceFile)]
  if (Node.isVariableStatement(statement)) return variableDeclarations(statement, sourceFile)
  if (Node.isExportDeclaration(statement)) return exportDeclarations(statement, sourceFile)
  const commonJs = commonJsDeclarations(statement, sourceFile)
  if (commonJs.length > 0) return commonJs
  if (Node.isExportAssignment(statement)) {
    return [{ ...base, kind: "default", name: "default", visibility: "public", signature: null }]
  }
  if (Node.isFunctionDeclaration(statement)) {
    return [{
      ...base,
      kind: "function",
      name: statement.getName() ?? "default",
      nameRange: statement.getNameNode() === undefined ? null : rangeOf(sourceFile, statement.getNameNode()!),
      signature: functionSignature(statement)
    }]
  }
  if (Node.isClassDeclaration(statement)) {
    return [{
      ...base,
      kind: "class",
      name: statement.getName() ?? "default",
      nameRange: statement.getNameNode() === undefined ? null : rangeOf(sourceFile, statement.getNameNode()!),
      signature: null
    }]
  }
  if (Node.isInterfaceDeclaration(statement)) {
    return [{ ...base, kind: "interface", name: statement.getName(), nameRange: rangeOf(sourceFile, statement.getNameNode()), signature: null }]
  }
  if (Node.isTypeAliasDeclaration(statement)) {
    return [{
      ...base,
      kind: "type",
      name: statement.getName(),
      nameRange: rangeOf(sourceFile, statement.getNameNode()),
      signature: statement.getTypeNode()?.getText() ?? null
    }]
  }
  if (Node.isEnumDeclaration(statement)) {
    return [{ ...base, kind: "enum", name: statement.getName(), nameRange: rangeOf(sourceFile, statement.getNameNode()), signature: null }]
  }
  return []
}

const statementsToDeclarations = (
  statements: ReadonlyArray<Statement>,
  sourceFile: SourceFile
): ReadonlyArray<Declaration> => {
  const declarations = statements.flatMap((statement) => statementToDeclarations(statement, sourceFile))
  const positions = new Map<string, number>()
  const deduplicated: Array<Declaration> = []
  for (const declaration of declarations) {
    const key = `${declaration.kind}\0${declaration.name}`
    const position = positions.get(key)
    if (position === undefined) {
      positions.set(key, deduplicated.length)
      deduplicated.push(declaration)
    } else if (
      declaration.visibility === "public" &&
      deduplicated[position]?.visibility !== "public"
    ) {
      deduplicated[position] = declaration
    }
  }
  return deduplicated
}

const filterDeclaration = (
  declaration: Declaration,
  symbols: InspectOptions["symbols"]
): Declaration | null => {
  const children = declaration.children.flatMap((child) => {
    const filtered = filterDeclaration(child, symbols)
    return filtered === null ? [] : [filtered]
  })

  if (symbols === "modules" && declaration.kind !== "namespace") return null
  if (symbols === "public" && declaration.visibility === "private" && declaration.kind !== "namespace") {
    return null
  }
  return { ...declaration, children }
}

const parserDiagnostic = (file: DiscoveredFile, cause: unknown): Diagnostic => ({
  severity: "error",
  code: "parse-error",
  message: cause instanceof Error ? cause.message : String(cause),
  path: file.displayPath,
  line: null
})

const analyzeFile = (
  project: Project,
  file: DiscoveredFile,
  options: InspectOptions
): FileNode => {
  if (file.content === null) {
    return {
      type: "file",
      name: file.name,
      path: file.displayPath,
      language: file.language,
      contentHash: null,
      documentation: null,
      declarations: [],
      diagnostics: file.diagnostics
    }
  }

  try {
    const sourceFile = project.createSourceFile(file.path, file.content, { overwrite: true })
    const declarations = statementsToDeclarations(sourceFile.getStatements(), sourceFile)
      .flatMap((declaration) => {
        const filtered = filterDeclaration(declaration, options.symbols)
        return filtered === null ? [] : [filtered]
      })
    return {
      type: "file",
      name: file.name,
      path: file.displayPath,
      language: file.language,
      contentHash: contentFingerprint(file.content),
      documentation: options.peek ? extractLeadingDocumentation(file.content) : null,
      declarations,
      diagnostics: file.diagnostics
    }
  } catch (cause) {
    return {
      type: "file",
      name: file.name,
      path: file.displayPath,
      language: file.language,
      contentHash: contentFingerprint(file.content),
      documentation: options.peek ? extractLeadingDocumentation(file.content) : null,
      declarations: [],
      diagnostics: [...file.diagnostics, parserDiagnostic(file, cause)]
    }
  }
}

const analyzeNode = (
  project: Project,
  node: DiscoveredNode,
  options: InspectOptions
): DirectoryNode | FileNode | SymlinkNode => {
  switch (node._tag) {
    case "File":
      return analyzeFile(project, node, options)
    case "Symlink":
      return { type: "symlink", name: node.name, path: node.displayPath }
    case "Directory":
      return {
        type: "directory",
        name: node.name,
        path: node.displayPath,
        children: node.children.map((child) => analyzeNode(project, child, options))
      }
  }
}

const collectDiagnostics = (node: DirectoryNode | FileNode | SymlinkNode): ReadonlyArray<Diagnostic> => {
  switch (node.type) {
    case "file":
      return node.diagnostics
    case "symlink":
      return []
    case "directory":
      return node.children.flatMap(collectDiagnostics)
  }
}

export const analyze = (
  discovery: DiscoveryResult,
  options: InspectOptions
): Effect.Effect<ModuleLsOutput, InspectError> =>
  Effect.try({
    try: () => {
    const project = new Project({
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        allowJs: true,
        checkJs: false,
        jsx: ts.JsxEmit.Preserve,
        module: ModuleKind.ESNext,
        target: ScriptTarget.Latest
      }
    })
    const roots = discovery.roots.map((node) => analyzeNode(project, node, options))
    return {
      schemaVersion: 2,
      roots,
      diagnostics: [
        ...discovery.diagnostics,
        ...roots.flatMap(collectDiagnostics).filter(
          (item, index, all) => all.findIndex((candidate) =>
            candidate.code === item.code && candidate.path === item.path && candidate.message === item.message
          ) === index
        )
      ]
    }
    },
    catch: (cause) => new InspectError({
      path: "<analysis>",
      message: "Unable to initialize the TypeScript analyzer",
      cause
    })
  })
