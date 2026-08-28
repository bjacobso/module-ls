#!/usr/bin/env node

import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect, Option, Terminal } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"

import { run } from "./app.js"
import { renderSelectedJson, renderSelectedSource, selectSource } from "./selection.js"
import { serveExplorer } from "./server.js"

const DEFAULT_TREE_DEPTH = 3

const paths = Argument.string("path").pipe(
  Argument.variadic(),
  Argument.withDescription("Files or directories to inspect (defaults to the current directory)")
)

const peek = Flag.boolean("peek").pipe(
  Flag.withDefault(false),
  Flag.withDescription("Show the leading documentation block for each source file")
)

const peekLines = Flag.integer("peek-lines").pipe(
  Flag.optional,
  Flag.withDescription("Maximum documentation lines to show (implies --peek)")
)

const depth = Flag.integer("depth").pipe(
  Flag.optional,
  Flag.withDescription(`Maximum directory depth below each root (tree default: ${DEFAULT_TREE_DEPTH})`)
)

const symbols = Flag.choice("symbols", ["modules", "public", "all"] as const).pipe(
  Flag.withDefault("public" as const),
  Flag.withDescription("Choose module-only, public, or all declarations")
)

const format = Flag.choice("format", ["tree", "json"] as const).pipe(
  Flag.withDefault("tree" as const),
  Flag.withDescription("Choose human-readable tree or schema-versioned JSON output")
)

const hidden = Flag.boolean("hidden").pipe(
  Flag.withDefault(false),
  Flag.withDescription("Include hidden files and directories")
)

const noIgnore = Flag.boolean("no-ignore").pipe(
  Flag.withDefault(false),
  Flag.withDescription("Disable .gitignore and built-in dependency/build ignores")
)

const ascii = Flag.boolean("ascii").pipe(
  Flag.withDefault(false),
  Flag.withDescription("Use ASCII tree connectors")
)

const color = Flag.choice("color", ["auto", "always", "never"] as const).pipe(
  Flag.withDefault("auto" as const),
  Flag.withDescription("Control ANSI color output")
)

const maxSymbols = Flag.integer("max-symbols").pipe(
  Flag.optional,
  Flag.withDescription("Maximum declarations shown per file (defaults to 8)")
)

const expand = Flag.boolean("expand").pipe(
  Flag.withDefault(false),
  Flag.withDescription("Show every directory and declaration and expand barrel re-exports")
)

const inspectCommand = Command.make(
  "module-ls",
  { paths, peek, peekLines, depth, symbols, format, hidden, noIgnore, ascii, color, maxSymbols, expand },
  (config) => run({
    roots: config.paths,
    peek: config.peek || Option.isSome(config.peekLines),
    peekLines: Option.getOrElse(config.peekLines, () => 3),
    depth: Option.isSome(config.depth)
      ? config.depth.value
      : (config.format === "json" || config.expand) ? null : DEFAULT_TREE_DEPTH,
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

const target = Argument.string("target").pipe(
  Argument.withDescription("Source file, optionally followed by #Qualified.Symbol or :Qualified.Symbol")
)

const selectedSymbol = Flag.string("symbol").pipe(
  Flag.optional,
  Flag.withDescription("Qualified symbol name (overrides a symbol embedded in the target)")
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

const serveRoot = Argument.string("path").pipe(
  Argument.withDefault("."),
  Argument.withDescription("Repository directory to explore")
)

const servePort = Flag.integer("port").pipe(
  Flag.withDefault(4310),
  Flag.withDescription("Loopback port for the local explorer")
)

const serveCommand = Command.make("serve", { serveRoot, servePort }, ({ serveRoot, servePort }) =>
  serveExplorer(serveRoot, servePort)).pipe(
    Command.withDescription("Start the local FoldKit code explorer")
  )

export const command = inspectCommand.pipe(
  Command.withSubcommands([showCommand, extractCommand, serveCommand])
)

const cli = Command.run(command, {
  version: "0.1.0"
})

cli.pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
)
