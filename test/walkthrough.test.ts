import path from "node:path"

import { NodeServices } from "@effect/platform-node"
import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { annotatedSourceWalkthrough } from "../examples/annotated-source.walkthrough.js"
import {
  Walkthrough,
  WalkthroughDocumentSchema,
  loadWalkthrough,
  parseWalkthrough,
  renderWalkthroughJson,
  renderWalkthroughTree
} from "../src/walkthrough.js"

const workspace = path.resolve(import.meta.dirname, "..")

describe("walkthrough DSL", () => {
  it("builds immutable documents with HttpApi-style constructors", () => {
    const empty = Walkthrough.make("tour", {
      title: "A tour",
      summary: "Follow the important path."
    })
    const complete = empty.add(Walkthrough.step("entry", {
      title: "Find the entry point",
      body: "Start where the request enters the system.",
      target: Walkthrough.target("src/server.ts", { symbol: "serveExplorer" })
    }))

    expect(empty.steps).toEqual([])
    expect(complete.steps[0]?.target).toMatchObject({ path: "src/server.ts", symbol: "serveExplorer" })
    expect(() => Schema.decodeUnknownSync(WalkthroughDocumentSchema)(complete)).not.toThrow()
    expect(() => Schema.decodeUnknownSync(WalkthroughDocumentSchema)(annotatedSourceWalkthrough)).not.toThrow()
  })

  it("loads YAML and JSON authoring formats through the same schema", async () => {
    const load = (name: string) => Effect.runPromise(loadWalkthrough(
      path.join(workspace, "examples", name)
    ).pipe(Effect.provide(NodeServices.layer)))
    const [yaml, json] = await Promise.all([
      load("annotated-source.walkthrough.yaml"),
      load("annotated-source.walkthrough.json")
    ])

    expect(yaml.schemaVersion).toBe(1)
    expect(yaml.steps[3]?.children).toHaveLength(2)
    expect(json.steps[0]?.target?.highlight).toEqual(["lines", "hovers", "definitions"])
  })

  it("renders human and normalized agent output", async () => {
    const walkthrough = await Effect.runPromise(parseWalkthrough(`
schemaVersion: 1
id: tiny
title: Tiny tour
summary: One useful stop.
audience: []
steps:
  - id: entry
    kind: code
    title: Enter here
    body: Read the handler.
    target:
      path: src/server.ts
      symbol: serveExplorer
    notes: []
    children: []
`, "yaml"))
    expect(renderWalkthroughTree(walkthrough)).toContain("src/server.ts#serveExplorer")
    expect(JSON.parse(await Effect.runPromise(renderWalkthroughJson(walkthrough))))
      .toMatchObject({ schemaVersion: 1, id: "tiny" })
  })

  it("rejects malformed documents at the authoring boundary", async () => {
    const result = await Effect.runPromiseExit(parseWalkthrough("{\"schemaVersion\": 2}", "json"))
    expect(result._tag).toBe("Failure")
  })
})
