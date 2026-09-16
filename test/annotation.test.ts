import path from "node:path"

import { NodeServices } from "@effect/platform-node"
import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { annotateSource } from "../src/annotation.js"
import { AnnotatedSourceSchema } from "../src/model.js"
import { searchSnapshot } from "../src/search.js"
import type { ExplorerSnapshot } from "../src/model.js"

const fixture = path.resolve(import.meta.dirname, "fixtures/sample")

describe("annotated source", () => {
  it("combines shiki tokens, TypeScript hovers, and in-root definitions", async () => {
    const annotated = await Effect.runPromise(annotateSource(
      path.join(fixture, "src/cache.ts"),
      null,
      { root: fixture, displayPath: "src/cache.ts" }
    ).pipe(Effect.provide(NodeServices.layer)))

    expect(() => Schema.decodeUnknownSync(AnnotatedSourceSchema)(annotated)).not.toThrow()
    expect(annotated).toMatchObject({ schemaVersion: 3, path: "src/cache.ts" })
    expect(annotated.lines.flat().map(({ content }) => content).join(""))
      .toContain("interface")
    expect(annotated.hovers.some(({ text }) => text.includes("interface Cache"))).toBe(true)
    expect(annotated.definitions.some(({ targets }) =>
      targets.some(({ path }) => path === "src/cache.ts"))).toBe(true)
  })

  it("can omit type analysis for static highlighting", async () => {
    const annotated = await Effect.runPromise(annotateSource(
      path.join(fixture, "src/cache.ts"),
      null,
      { root: fixture, types: false }
    ).pipe(Effect.provide(NodeServices.layer)))
    expect(annotated.lines.length).toBeGreaterThan(1)
    expect(annotated.hovers).toEqual([])
    expect(annotated.definitions).toEqual([])
  })

  it("accepts a symbol embedded in the target", async () => {
    const annotated = await Effect.runPromise(annotateSource(
      `${path.join(fixture, "src/cache.ts")}#Metrics.hit`,
      null,
      { root: fixture }
    ).pipe(Effect.provide(NodeServices.layer)))
    expect(annotated.qualifiedName).toBe("Metrics.hit")
    expect(annotated.source).toContain("export function hit")
  })
})

describe("explorer search", () => {
  it("ranks symbol matches ahead of containing files", () => {
    const range = {
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 2, offset: 1 }
    }
    const file = {
      path: "src/cache.ts",
      name: "cache.ts",
      language: "typescript" as const,
      contentHash: "fnv1a64:0",
      documentation: null,
      gitStatus: null,
      declarations: [{
        qualifiedName: "Metrics.hit",
        kind: "function" as const,
        signature: "hit(): void",
        documentation: null,
        range
      }]
    }
    const snapshot: ExplorerSnapshot = {
      schemaVersion: 1,
      root: fixture,
      tree: { type: "directory", name: "sample", path: "", children: [{ type: "file", file }] },
      files: [file],
      diagnostics: []
    }
    expect(searchSnapshot(snapshot, "Metrics")[0]).toMatchObject({
      type: "symbol",
      label: "Metrics.hit"
    })
  })
})
