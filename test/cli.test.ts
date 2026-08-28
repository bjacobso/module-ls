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
    expect(tree).toContain("two/")
    expect(tree).not.toContain("deep.ts")
  })

  it("emits schema-versioned JSON for agents", () => {
    const parsed: unknown = JSON.parse(cli(fixture, "--format", "json"))
    const output = Schema.decodeUnknownSync(ModuleLsOutputSchema)(parsed)
    expect(output.schemaVersion).toBe(2)
    expect(output.roots[0]?.type).toBe("directory")
    expect(JSON.stringify(output)).toContain("deep.ts")
  })

  it("supports hidden, module-only, depth, and ASCII flags", () => {
    expect(cli(fixture, "--hidden", "--color", "never")).toContain(".hidden.ts")
    expect(cli(fixture, "--symbols", "modules", "--color", "never")).not.toContain("interface Cache")
    expect(cli(fixture, "--depth", "0", "--ascii", "--color", "never").trim()).toBe(
      "sample/\n`-- …"
    )
    expect(cli(fixture, "--expand", "--color", "never")).toContain("deep.ts")
  })

  it("shows and extracts exact symbol ranges", () => {
    const cache = path.join(fixture, "src/cache.ts")
    const shown = cli("show", `${cache}#Metrics.hit`)
    expect(shown).toContain("Metrics.hit · function")
    expect(shown).toContain("│ export function hit")

    const extracted: unknown = JSON.parse(cli("extract", cache, "--symbol", "Cache"))
    expect(extracted).toMatchObject({ schemaVersion: 2, qualifiedName: "Cache", kind: "interface" })
  })
})
