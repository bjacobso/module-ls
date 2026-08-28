import { createServer } from "node:http"

import {
  FileSystem,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
  Path
} from "@effect/platform"
import { NodeHttpServer } from "@effect/platform-node"
import { Console, Effect, Layer } from "effect"

import { InspectError } from "./errors.js"
import { explorerSnapshot } from "./explorer.js"
import { ExplorerSnapshotSchema, SelectedSourceSchema } from "./model.js"
import { selectSource } from "./selection.js"

const errorResponse = (cause: unknown, status = 500): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.unsafeJson({
    error: cause instanceof Error ? cause.message : String(cause)
  }, { status })

const noStore = (response: HttpServerResponse.HttpServerResponse): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.setHeader(response, "cache-control", "no-store")

const containedPath = (
  pathService: Path.Path,
  root: string,
  requested: string
): string | null => {
  const absolute = pathService.resolve(root, requested)
  const relative = pathService.relative(root, absolute)
  return relative === "" || (!relative.startsWith("..") && !pathService.isAbsolute(relative))
    ? absolute
    : null
}

export const serveExplorer = (
  requestedRoot: string,
  port: number
) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    const root = pathService.resolve(requestedRoot)
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      return yield* new InspectError({ path: String(port), message: "Port must be between 1 and 65535" })
    }
    const rootInfo = yield* fs.stat(root).pipe(
      Effect.mapError((cause) => new InspectError({ path: requestedRoot, message: "Explorer root is unreadable", cause }))
    )
    if (rootInfo.type !== "Directory") {
      return yield* new InspectError({ path: requestedRoot, message: "Explorer root must be a directory" })
    }
    const builtStaticRoot = yield* pathService.fromFileUrl(new URL("./web", import.meta.url)).pipe(
      Effect.catchAll(() => Effect.succeed(pathService.resolve("dist/web")))
    )
    const localStaticRoot = pathService.resolve("dist/web")
    const staticRoot = yield* fs.stat(builtStaticRoot).pipe(
      Effect.as(builtStaticRoot),
      Effect.catchAll(() => Effect.succeed(localStaticRoot))
    )

    const treeHandler = explorerSnapshot(root).pipe(
      Effect.flatMap(HttpServerResponse.schemaJson(ExplorerSnapshotSchema)),
      Effect.map(noStore),
      Effect.catchAll((cause) => Effect.succeed(errorResponse(cause)))
    )

    const sourceHandler = Effect.gen(function*() {
      const request = yield* HttpServerRequest.HttpServerRequest
      const url = new URL(request.url, "http://127.0.0.1")
      const requested = url.searchParams.get("path")
      if (requested === null) return errorResponse("Missing path query parameter", 400)
      const path = containedPath(pathService, root, requested)
      if (path === null) return errorResponse("Path is outside the explorer root", 403)
      const selected = yield* selectSource(path, url.searchParams.get("symbol"))
      return noStore(yield* HttpServerResponse.schemaJson(SelectedSourceSchema)(selected))
    }).pipe(Effect.catchAll((cause) => Effect.succeed(errorResponse(cause, 404))))

    const staticHandler = Effect.gen(function*() {
      const request = yield* HttpServerRequest.HttpServerRequest
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname)
      const relative = pathname === "/" ? "index.html" : pathname.slice(1)
      const requested = pathService.resolve(staticRoot, relative)
      const safe = containedPath(pathService, staticRoot, requested)
      const candidate = safe === null ? pathService.join(staticRoot, "index.html") : safe
      const file = yield* fs.stat(candidate).pipe(Effect.option)
      const target = file._tag === "Some" && file.value.type === "File"
        ? candidate
        : pathService.join(staticRoot, "index.html")
      return yield* HttpServerResponse.file(target)
    }).pipe(Effect.catchAll(() => Effect.succeed(HttpServerResponse.text(
      "Web explorer assets are missing. Run `pnpm build:web` first.",
      { status: 503 }
    ))))

    const router = HttpRouter.empty.pipe(
      HttpRouter.get("/api/tree", treeHandler),
      HttpRouter.get("/api/source", sourceHandler),
      HttpRouter.get("/*", staticHandler)
    )
    const server = HttpServer.serve(router).pipe(
      Layer.provide(NodeHttpServer.layer(createServer, { host: "127.0.0.1", port }))
    )

    yield* Console.log(`module-ls explorer: http://127.0.0.1:${port}`)
    return yield* Layer.launch(server)
  })
