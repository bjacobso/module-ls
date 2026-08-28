import { Data } from "effect"

export class InspectError extends Data.TaggedError("InspectError")<{
  readonly path: string
  readonly message: string
  readonly cause?: unknown
}> {}

export class RenderError extends Data.TaggedError("RenderError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export type ModuleLsError = InspectError | RenderError
