import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { type InspectOptions, ModuleLsOutputSchema } from "../src/model.js"
import { renderJson, renderTree } from "../src/render.js"

const options: InspectOptions = {
  roots: ["src"],
  peek: true,
  peekLines: 1,
  depth: null,
  symbols: "public",
  format: "tree",
  hidden: false,
  noIgnore: false,
  ascii: false,
  color: "never",
  maxSymbols: 8,
  collapseBarrels: true
}

const range = (line: number) => ({
  start: { line, column: 1, offset: line * 10 },
  end: { line, column: 10, offset: line * 10 + 9 }
})

const output: typeof ModuleLsOutputSchema.Type = {
  schemaVersion: 2,
  roots: [{
    type: "directory",
    name: "src",
    path: "src",
    children: [{
      type: "file",
      name: "cache.ts",
      path: "src/cache.ts",
      language: "typescript",
      contentHash: "fnv1a64:0000000000000000",
      documentation: "First line.\nSecond line.",
      diagnostics: [],
      declarations: [{
        kind: "type",
        name: "Cache",
        visibility: "public",
        signature: null,
        documentation: null,
        location: { line: 4, column: 1 },
        range: range(4),
        nameRange: range(4),
        documentationRange: null,
        children: []
      }, {
        kind: "function",
        name: "get",
        visibility: "public",
        signature: "get(cache, key)",
        documentation: null,
        location: { line: 8, column: 1 },
        range: range(8),
        nameRange: range(8),
        documentationRange: null,
        children: []
      }]
    }]
  }],
  diagnostics: []
}

describe("renderers", () => {
  it("renders deterministic Unicode and ASCII trees", () => {
    expect(renderTree(output, options, false)).toMatchInlineSnapshot(`
      "src/
      └── cache.ts
          ├── │ First line. …
          ├── type Cache [L4]
          └── get(cache, key) [L8]"
    `)
    expect(renderTree(output, { ...options, ascii: true }, false)).toContain("`-- cache.ts")
  })

  it("schema-encodes JSON output", () => {
    const json = Effect.runSync(renderJson(output))
    const parsed: unknown = JSON.parse(json)
    expect(Schema.decodeUnknownSync(ModuleLsOutputSchema)(parsed)).toEqual(output)
  })
})
