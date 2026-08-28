import {
  Config,
  Console,
  Effect,
  FileSystem,
  Option,
  Path,
  PlatformError,
  Schema,
  Stdio,
  Terminal
} from "effect"

import { analyze } from "./analyzer.js"
import { discover } from "./discovery.js"
import { InspectError, RenderError } from "./errors.js"
import {
  InspectOptionsSchema,
  type InspectOptions,
  type ModuleLsOutput
} from "./model.js"
import { renderJson, renderTree } from "./render.js"

export const inspect = (
  input: unknown
): Effect.Effect<
  ModuleLsOutput,
  Schema.SchemaError | InspectError,
  FileSystem.FileSystem | Path.Path
> =>
  Schema.decodeUnknownEffect(InspectOptionsSchema)(input).pipe(
    Effect.flatMap((options) => discover(options).pipe(
      Effect.flatMap((discovery) => analyze(discovery, options))
    ))
  )

const shouldUseColor = (
  options: InspectOptions,
  stdio: Stdio.Stdio
): Effect.Effect<boolean> => {
  if (options.format === "json" || options.color === "never") return Effect.succeed(false)
  if (options.color === "always") return Effect.succeed(true)
  return Effect.all({
    tty: stdio.stdoutIsTerminal,
    noColor: Config.option(Config.string("NO_COLOR")).pipe(
      Effect.match({
        onFailure: () => Option.none<string>(),
        onSuccess: (value) => value
      })
    )
  }).pipe(Effect.map(({ noColor, tty }) => tty && Option.isNone(noColor)))
}

const printDiagnostics = (output: ModuleLsOutput): Effect.Effect<void> =>
  Effect.forEach(
    output.diagnostics,
    (item) => Console.error(
      `${item.path === null ? "module-ls" : item.path}: ${item.severity}: ${item.message} [${item.code}]`
    ),
    { discard: true }
  )

export const run = (
  input: unknown
): Effect.Effect<
  void,
  Schema.SchemaError | InspectError | RenderError | PlatformError.PlatformError,
  Terminal.Terminal | Stdio.Stdio | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*() {
    const options = yield* Schema.decodeUnknownEffect(InspectOptionsSchema)(input)
    const terminal = yield* Terminal.Terminal
    const stdio = yield* Stdio.Stdio
    const output = yield* discover(options).pipe(
      Effect.flatMap((discovery) => analyze(discovery, options))
    )
    const color = yield* shouldUseColor(options, stdio)
    const rendered = options.format === "json"
      ? yield* renderJson(output)
      : renderTree(output, options, color)

    yield* terminal.display(`${rendered}\n`)
    if (options.format === "tree") yield* printDiagnostics(output)
  })
