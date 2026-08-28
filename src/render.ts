import { Effect, Schema } from "effect"

import { RenderError } from "./errors.js"
import {
  ModuleLsOutputSchema,
  type Declaration,
  type InspectOptions,
  type ModuleLsOutput,
  type TreeNode
} from "./model.js"

interface RenderItem {
  readonly label: string
  readonly children: ReadonlyArray<RenderItem>
}

const ansi = {
  blue: "\u001b[34m",
  cyan: "\u001b[36m",
  dim: "\u001b[2m",
  magenta: "\u001b[35m",
  reset: "\u001b[0m",
  yellow: "\u001b[33m"
} as const

const paint = (enabled: boolean, color: keyof typeof ansi, value: string): string =>
  enabled ? `${ansi[color]}${value}${ansi.reset}` : value

const declarationLabel = (declaration: Declaration, color: boolean): string => {
  const lines = declaration.range.start.line === declaration.range.end.line
    ? `L${declaration.range.start.line}`
    : `L${declaration.range.start.line}–${declaration.range.end.line}`
  const suffix = paint(color, "dim", ` [${lines}]`)
  switch (declaration.kind) {
    case "namespace":
      return `${paint(color, "magenta", "namespace")} ${declaration.name}${suffix}`
    case "class":
    case "enum":
    case "interface":
    case "type":
      return `${paint(color, "yellow", declaration.kind)} ${declaration.name}${suffix}`
    case "function":
      return `${declaration.signature ?? declaration.name}${suffix}`
    case "variable":
      return `${declaration.signature === null
        ? declaration.name
        : `${declaration.name}: ${declaration.signature}`}${suffix}`
    case "re-export":
      return `export ${declaration.name}${declaration.signature === null ? "" : ` ${declaration.signature}`}${suffix}`
    case "default":
      return `default export${suffix}`
  }
}

const declarationItem = (declaration: Declaration, color: boolean): RenderItem => ({
  label: declarationLabel(declaration, color),
  children: declaration.children.map((child) => declarationItem(child, color))
})

const documentationItems = (
  documentation: string | null,
  maximumLines: number,
  color: boolean
): ReadonlyArray<RenderItem> => {
  if (documentation === null) return []
  const allLines = documentation.split("\n").filter((line) => line.trim() !== "")
  const visible = allLines.slice(0, maximumLines)
  return visible.map((line, index) => ({
    label: paint(
      color,
      "dim",
      `│ ${line}${index === visible.length - 1 && allLines.length > visible.length ? " …" : ""}`
    ),
    children: []
  }))
}

const treeItem = (node: TreeNode, options: InspectOptions, color: boolean): RenderItem => {
  switch (node.type) {
    case "directory":
      return {
        label: paint(color, "blue", `${node.name}/`),
        children: node.children.map((child) => treeItem(child, options, color))
      }
    case "symlink":
      return { label: paint(color, "cyan", `${node.name}@`), children: [] }
    case "file":
      const barrel = options.collapseBarrels && node.declarations.length > 0 &&
        node.declarations.every((declaration) => declaration.kind === "re-export")
      const maximum = options.maxSymbols ?? node.declarations.length
      const declarations = barrel
        ? [{ label: paint(color, "dim", `${node.declarations.length} re-exports`), children: [] }]
        : node.declarations.slice(0, maximum).map((declaration) => declarationItem(declaration, color))
      const remaining = barrel ? 0 : node.declarations.length - declarations.length
      return {
        label: paint(color, "cyan", node.name),
        children: [
          ...documentationItems(node.documentation, options.peekLines, color),
          ...declarations,
          ...(remaining > 0
            ? [{ label: paint(color, "dim", `… ${remaining} more`), children: [] }]
            : [])
        ]
      }
  }
}

const renderChildren = (
  items: ReadonlyArray<RenderItem>,
  prefix: string,
  ascii: boolean
): ReadonlyArray<string> => {
  const branch = ascii ? "+-- " : "├── "
  const lastBranch = ascii ? "`-- " : "└── "
  const pipe = ascii ? "|   " : "│   "
  const space = "    "

  return items.flatMap((item, index) => {
    const last = index === items.length - 1
    return [
      `${prefix}${last ? lastBranch : branch}${item.label}`,
      ...renderChildren(item.children, `${prefix}${last ? space : pipe}`, ascii)
    ]
  })
}

export const renderTree = (
  output: ModuleLsOutput,
  options: InspectOptions,
  color: boolean
): string =>
  output.roots.flatMap((root) => {
    const item = treeItem(root, options, color)
    return [item.label, ...renderChildren(item.children, "", options.ascii)]
  }).join("\n")

export const renderJson = (output: ModuleLsOutput): Effect.Effect<string, RenderError> =>
  Schema.encodeEffect(ModuleLsOutputSchema)(output).pipe(
    Effect.map((encoded) => JSON.stringify(encoded, null, 2)),
    Effect.mapError((cause) => new RenderError({ message: "Output did not match schema version 2", cause }))
  )
