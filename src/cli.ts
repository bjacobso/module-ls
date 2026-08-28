#!/usr/bin/env node

import { Args, Command, Options } from "@effect/cli"
import { Terminal } from "@effect/platform"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Effect, Option } from "effect"

import { run } from "./app.js"
import { renderSelectedJson, renderSelectedSource, selectSource } from "./selection.js"
import { serveExplorer } from "./server.js"

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

const maxSymbols = Options.integer("max-symbols").pipe(
  Options.optional,
  Options.withDescription("Maximum declarations shown per file (defaults to 8)")
)

const expand = Options.boolean("expand").pipe(
  Options.withDescription("Show every declaration and expand barrel re-exports")
)

const inspectCommand = Command.make(
  "module-ls",
  { paths, peek, peekLines, depth, symbols, format, hidden, noIgnore, ascii, color, maxSymbols, expand },
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
    color: config.color,
    maxSymbols: config.expand ? null : Option.getOrElse(config.maxSymbols, () => 8),
    collapseBarrels: !config.expand
  })
)

const target = Args.text({ name: "target" }).pipe(
  Args.withDescription("Source file, optionally followed by #Qualified.Symbol or :Qualified.Symbol")
)

const selectedSymbol = Options.text("symbol").pipe(
  Options.optional,
  Options.withDescription("Qualified symbol name (overrides a symbol embedded in the target)")
)

const showCommand = Command.make("show", { target, selectedSymbol }, ({ target, selectedSymbol }) =>
  Effect.gen(function*() {
    const terminal = yield* Terminal.Terminal
    const selected = yield* selectSource(target, Option.getOrNull(selectedSymbol))
    yield* terminal.display(`${renderSelectedSource(selected)}\n`)
  })).pipe(Command.withDescription("Show an exact source block with line numbers"))

const extractCommand = Command.make("extract", { target, selectedSymbol }, ({ target, selectedSymbol }) =>
  Effect.gen(function*() {
    const terminal = yield* Terminal.Terminal
    const selected = yield* selectSource(target, Option.getOrNull(selectedSymbol))
    const json = yield* renderSelectedJson(selected)
    yield* terminal.display(`${json}\n`)
  })).pipe(Command.withDescription("Emit an exact source block as schema-versioned JSON"))

const serveRoot = Args.text({ name: "path" }).pipe(
  Args.withDefault("."),
  Args.withDescription("Repository directory to explore")
)

const servePort = Options.integer("port").pipe(
  Options.withDefault(4310),
  Options.withDescription("Loopback port for the local explorer")
)

const serveCommand = Command.make("serve", { serveRoot, servePort }, ({ serveRoot, servePort }) =>
  serveExplorer(serveRoot, servePort)).pipe(
    Command.withDescription("Start the local FoldKit code explorer")
  )

export const command = inspectCommand.pipe(
  Command.withSubcommands([showCommand, extractCommand, serveCommand])
)

const cli = Command.run(command, {
  name: "module-ls",
  version: "0.1.0"
})

cli(process.argv).pipe(
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain
)
