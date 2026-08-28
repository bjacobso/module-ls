import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { analyze, extractLeadingDocumentation } from "../src/analyzer.js"
import type { DiscoveryResult } from "../src/internal.js"
import type { InspectOptions } from "../src/model.js"

const source = `/**
 * Public cache helpers.
 * Second line.
 */
export interface Cache<K, V> {}
export const make = () => ({})
const privateValue = 1
export namespace Metrics {
  export function hit(name: string): void {}
  function hidden(): void {}
}
`

const discovery: DiscoveryResult = {
  roots: [{
    _tag: "File",
    name: "cache.ts",
    path: "/cache.ts",
    displayPath: "cache.ts",
    language: "typescript",
    content: source,
    diagnostics: []
  }],
  diagnostics: []
}

const options = (symbols: InspectOptions["symbols"]): InspectOptions => ({
  roots: ["cache.ts"],
  peek: true,
  peekLines: 3,
  depth: null,
  symbols,
  format: "tree",
  hidden: false,
  noIgnore: false,
  ascii: false,
  color: "never"
})

describe("extractLeadingDocumentation", () => {
  it("normalizes JSDoc, line comments, shebangs, and reference pragmas", () => {
    expect(extractLeadingDocumentation(source)).toBe("Public cache helpers.\nSecond line.")
    expect(extractLeadingDocumentation("#!/usr/bin/env node\n// Hello\n// world\nconst x = 1")).toBe("Hello\nworld")
    expect(extractLeadingDocumentation("/// <reference types=\"node\" />\n/** Module docs. */\nexport {}"))
      .toBe("Module docs.")
  })
})

describe("analyze", () => {
  it("indexes public declarations and nested namespaces with ts-morph", () => {
    const output = Effect.runSync(analyze(discovery, options("public")))
    const file = output.roots[0]
    expect(file?.type).toBe("file")
    if (file?.type !== "file") throw new Error("expected file")

    expect(file.documentation).toBe("Public cache helpers.\nSecond line.")
    expect(file.declarations.map(({ kind, name }) => [kind, name])).toEqual([
      ["interface", "Cache"],
      ["variable", "make"],
      ["namespace", "Metrics"]
    ])
    expect(file.declarations[2]?.children.map(({ name }) => name)).toEqual(["hit"])
  })

  it("supports module-only and all-symbol views", () => {
    const modules = Effect.runSync(analyze(discovery, options("modules")))
    const all = Effect.runSync(analyze(discovery, options("all")))
    const moduleFile = modules.roots[0]
    const allFile = all.roots[0]
    if (moduleFile?.type !== "file" || allFile?.type !== "file") throw new Error("expected files")

    expect(moduleFile.declarations.map(({ name }) => name)).toEqual(["Metrics"])
    expect(moduleFile.declarations[0]?.children).toEqual([])
    expect(allFile.declarations.map(({ name }) => name)).toContain("privateValue")
    expect(allFile.declarations.find(({ name }) => name === "Metrics")?.children.map(({ name }) => name))
      .toEqual(["hit", "hidden"])
  })

  it("recognizes CommonJS object exports", () => {
    const commonJs: DiscoveryResult = {
      roots: [{
        _tag: "File",
        name: "math.js",
        path: "/math.js",
        displayPath: "math.js",
        language: "javascript",
        content: "const add = () => 1; const sub = () => 0; module.exports = { add, sub }",
        diagnostics: []
      }],
      diagnostics: []
    }
    const output = Effect.runSync(analyze(commonJs, options("public")))
    const file = output.roots[0]
    if (file?.type !== "file") throw new Error("expected file")
    expect(file.declarations.map(({ name }) => name)).toEqual(["add", "sub"])
  })
})
