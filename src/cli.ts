#!/usr/bin/env node

import { Args, Command, Options } from "@effect/cli"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Effect, Option } from "effect"

import { run } from "./app.js"

const paths = Args.text({ name: "path" }).pipe(
  Args.repeated,
  Args.withDescription("Files or directories to inspect (defaults to the current directory)")
)

const peek = Options.boolean("peek").pipe(
  Options.withDescription("Show the leading documentation block for each source file")
)

const peekLines = Options.integer("peek-lines").pipe(
  Options.optional,
  Options.withDescription("Maximum documentation lines to show (implies --peek)")
)

const depth = Options.integer("depth").pipe(
  Options.optional,
  Options.withDescription("Maximum directory depth below each root")
)

const symbols = Options.choice("symbols", ["modules", "public", "all"] as const).pipe(
  Options.withDefault("public" as const),
  Options.withDescription("Choose module-only, public, or all declarations")
)

const format = Options.choice("format", ["tree", "json"] as const).pipe(
  Options.withDefault("tree" as const),
  Options.withDescription("Choose human-readable tree or schema-versioned JSON output")
)

const hidden = Options.boolean("hidden").pipe(
  Options.withDescription("Include hidden files and directories")
)

const noIgnore = Options.boolean("no-ignore").pipe(
  Options.withDescription("Disable .gitignore and built-in dependency/build ignores")
)

const ascii = Options.boolean("ascii").pipe(
  Options.withDescription("Use ASCII tree connectors")
)

const color = Options.choice("color", ["auto", "always", "never"] as const).pipe(
  Options.withDefault("auto" as const),
  Options.withDescription("Control ANSI color output")
)

export const command = Command.make(
  "module-ls",
  { paths, peek, peekLines, depth, symbols, format, hidden, noIgnore, ascii, color },
  (config) => run({
    roots: config.paths,
    peek: config.peek || Option.isSome(config.peekLines),
    peekLines: Option.getOrElse(config.peekLines, () => 3),
    depth: Option.getOrNull(config.depth),
    symbols: config.symbols,
    format: config.format,
    hidden: config.hidden,
    noIgnore: config.noIgnore,
    ascii: config.ascii,
    color: config.color
  })
)

const cli = Command.run(command, {
  name: "module-ls",
  version: "0.1.0"
})

cli(process.argv).pipe(
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain
)
