import { Data, Effect, FileSystem, Schema } from "effect"
import { parse as parseYaml } from "yaml"

export const WalkthroughStepKindSchema = Schema.Literals([
  "orientation",
  "code",
  "checkpoint",
  "detour"
])
export type WalkthroughStepKind = typeof WalkthroughStepKindSchema.Type

export const WalkthroughTargetSchema = Schema.Struct({
  path: Schema.NonEmptyString,
  symbol: Schema.optionalKey(Schema.NonEmptyString),
  line: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
  endLine: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
  highlight: Schema.optionalKey(Schema.Array(Schema.NonEmptyString))
})
export interface WalkthroughTarget extends Schema.Schema.Type<typeof WalkthroughTargetSchema> {}

export interface WalkthroughStep {
  readonly id: string
  readonly kind: WalkthroughStepKind
  readonly title: string
  readonly body: string
  readonly target?: WalkthroughTarget
  readonly notes: ReadonlyArray<string>
  readonly children: ReadonlyArray<WalkthroughStep>
}

export const WalkthroughStepSchema: Schema.Codec<WalkthroughStep> = Schema.Struct({
  id: Schema.NonEmptyString,
  kind: WalkthroughStepKindSchema,
  title: Schema.NonEmptyString,
  body: Schema.NonEmptyString,
  target: Schema.optionalKey(WalkthroughTargetSchema),
  notes: Schema.Array(Schema.String),
  children: Schema.Array(Schema.suspend((): Schema.Codec<WalkthroughStep> => WalkthroughStepSchema))
})

export const WalkthroughDocumentSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  id: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  summary: Schema.NonEmptyString,
  audience: Schema.Array(Schema.NonEmptyString),
  steps: Schema.Array(WalkthroughStepSchema)
})
export interface WalkthroughDocument extends Schema.Schema.Type<typeof WalkthroughDocumentSchema> {}

export class WalkthroughDefinition implements WalkthroughDocument {
  readonly schemaVersion = 1 as const
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly audience: ReadonlyArray<string>
  readonly steps: ReadonlyArray<WalkthroughStep>

  constructor(id: string, config: WalkthroughConfig, steps: ReadonlyArray<WalkthroughStep> = []) {
    this.id = id
    this.title = config.title
    this.summary = config.summary
    this.audience = config.audience ?? []
    this.steps = steps
  }

  add(...steps: ReadonlyArray<WalkthroughStep>): WalkthroughDefinition {
    return new WalkthroughDefinition(this.id, {
      title: this.title,
      summary: this.summary,
      audience: this.audience
    }, [...this.steps, ...steps])
  }
}

export interface WalkthroughConfig {
  readonly title: string
  readonly summary: string
  readonly audience?: ReadonlyArray<string>
}

export interface StepConfig {
  readonly title: string
  readonly body: string
  readonly kind?: WalkthroughStepKind
  readonly target?: WalkthroughTarget
  readonly notes?: ReadonlyArray<string>
  readonly children?: ReadonlyArray<WalkthroughStep>
}

export interface TargetConfig {
  readonly symbol?: string
  readonly line?: number
  readonly endLine?: number
  readonly highlight?: ReadonlyArray<string>
}

/** Fluent constructors for programmatic walkthroughs, mirroring HttpApi.make().add(). */
export const Walkthrough = {
  Schema: WalkthroughDocumentSchema,
  make: (id: string, config: WalkthroughConfig): WalkthroughDefinition => new WalkthroughDefinition(id, config),
  step: (id: string, config: StepConfig): WalkthroughStep => ({
    id,
    kind: config.kind ?? "code",
    title: config.title,
    body: config.body,
    ...(config.target === undefined ? {} : { target: config.target }),
    notes: config.notes ?? [],
    children: config.children ?? []
  }),
  target: (path: string, config: TargetConfig = {}): WalkthroughTarget => ({
    path,
    ...(config.symbol === undefined ? {} : { symbol: config.symbol }),
    ...(config.line === undefined ? {} : { line: config.line }),
    ...(config.endLine === undefined ? {} : { endLine: config.endLine }),
    ...(config.highlight === undefined ? {} : { highlight: config.highlight })
  })
} as const

export class WalkthroughError extends Data.TaggedError("WalkthroughError")<{
  readonly path: string
  readonly message: string
  readonly cause?: unknown
}> {}

export type WalkthroughFormat = "json" | "yaml"

export const parseWalkthrough = (
  input: string,
  format: WalkthroughFormat,
  path = "<input>"
): Effect.Effect<WalkthroughDocument, WalkthroughError> =>
  Effect.try({
    try: () => format === "json" ? JSON.parse(input) as unknown : parseYaml(input) as unknown,
    catch: (cause) => new WalkthroughError({ path, message: `Invalid ${format.toUpperCase()} walkthrough`, cause })
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(WalkthroughDocumentSchema)),
    Effect.mapError((cause) => cause instanceof WalkthroughError
      ? cause
      : new WalkthroughError({ path, message: "Walkthrough does not match schema version 1", cause }))
  )

export const loadWalkthrough = (
  path: string
): Effect.Effect<WalkthroughDocument, WalkthroughError, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const input = yield* fs.readFileString(path).pipe(
      Effect.mapError((cause) => new WalkthroughError({ path, message: "Unable to read walkthrough", cause }))
    )
    const format = path.toLowerCase().endsWith(".json") ? "json" : "yaml"
    return yield* parseWalkthrough(input, format, path)
  })

const targetLabel = (target: WalkthroughTarget): string => {
  const suffix = target.symbol === undefined
    ? target.line === undefined
      ? ""
      : `:L${target.line}${target.endLine === undefined || target.endLine === target.line ? "" : `–${target.endLine}`}`
    : `#${target.symbol}`
  return `${target.path}${suffix}`
}

export const renderWalkthroughTree = (walkthrough: WalkthroughDocument): string => {
  const renderSteps = (steps: ReadonlyArray<WalkthroughStep>, prefix = ""): ReadonlyArray<string> =>
    steps.flatMap((step, index) => {
      const isLast = index === steps.length - 1
      const connector = isLast ? "└──" : "├──"
      const continuation = isLast ? "    " : "│   "
      return [
        `${prefix}${connector} ${index + 1}. ${step.title} [${step.kind}]`,
        ...(step.target === undefined ? [] : [`${prefix}${continuation}↳ ${targetLabel(step.target)}`]),
        ...step.body.split("\n").map((line) => `${prefix}${continuation}${line}`),
        ...step.notes.map((note) => `${prefix}${continuation}• ${note}`),
        ...renderSteps(step.children, `${prefix}${continuation}`)
      ]
    })
  return [
    walkthrough.title,
    walkthrough.summary,
    ...(walkthrough.audience.length === 0 ? [] : [`For: ${walkthrough.audience.join(", ")}`]),
    ...renderSteps(walkthrough.steps)
  ].join("\n")
}

export const renderWalkthroughJson = (
  walkthrough: WalkthroughDocument
): Effect.Effect<string, WalkthroughError> =>
  Schema.encodeEffect(WalkthroughDocumentSchema)(walkthrough).pipe(
    Effect.map((encoded) => JSON.stringify(encoded, null, 2)),
    Effect.mapError((cause) => new WalkthroughError({
      path: walkthrough.id,
      message: "Unable to encode walkthrough",
      cause
    }))
  )
