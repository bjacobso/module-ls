import { execFileSync } from "node:child_process"
import path from "node:path"

import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import { ModuleLsOutputSchema } from "../src/model.js"

const workspace = path.resolve(import.meta.dirname, "..")
const fixture = path.join(workspace, "test/fixtures/sample")
const tsx = path.join(workspace, "node_modules/.bin/tsx")

const cli = (...args: ReadonlyArray<string>): string =>
  execFileSync(tsx, ["src/cli.ts", ...args], {
    cwd: workspace,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" }
  })

describe("module-ls CLI", () => {
  it("runs the complete tree pipeline and respects ignores", () => {
    const tree = cli(fixture, "--peek-lines", "1", "--color", "never")
    expect(tree).toContain("sample/")
    expect(tree).toContain("cache.ts")
    expect(tree).toContain("│ A tiny cache module. …")
    expect(tree).toContain("namespace Metrics")
    expect(tree).toContain("add")
    expect(tree).not.toContain("privateValue")
    expect(tree).not.toContain("ignored.ts")
    expect(tree).not.toContain(".hidden.ts")
  })

  it("emits schema-versioned JSON for agents", () => {
    const parsed: unknown = JSON.parse(cli(fixture, "--format", "json"))
    const output = Schema.decodeUnknownSync(ModuleLsOutputSchema)(parsed)
    expect(output.schemaVersion).toBe(1)
    expect(output.roots[0]?.type).toBe("directory")
  })

  it("supports hidden, module-only, depth, and ASCII flags", () => {
    expect(cli(fixture, "--hidden", "--color", "never")).toContain(".hidden.ts")
    expect(cli(fixture, "--symbols", "modules", "--color", "never")).not.toContain("interface Cache")
    expect(cli(fixture, "--depth", "0", "--ascii", "--color", "never").trim()).toBe("sample/")
  })
})
