import { createServer } from "node:http"

import { NodeHttpServer } from "@effect/platform-node"
import { Console, Effect, FileSystem, Layer, Path } from "effect"
import {
  HttpServer,
  HttpServerRequest,
  HttpServerResponse
} from "effect/unstable/http"

import { InspectError } from "./errors.js"
import { explorerSnapshot } from "./explorer.js"
import {
  AnnotatedSourceSchema,
  ExplorerSnapshotSchema,
  SearchResponseSchema,
  SelectedSourceSchema
} from "./model.js"
import { searchSnapshot } from "./search.js"
import { selectSource } from "./selection.js"

const errorResponse = (cause: unknown, status = 500): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.jsonUnsafe({
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
  port: number,
  options: { readonly types?: boolean } = {}
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
      Effect.match({
        onFailure: () => pathService.resolve("dist/web"),
        onSuccess: (path) => path
      })
    )
    const localStaticRoot = pathService.resolve("dist/web")
    const staticRoot = yield* fs.stat(builtStaticRoot).pipe(
      Effect.as(builtStaticRoot),
      Effect.match({
        onFailure: () => localStaticRoot,
        onSuccess: (path) => path
      })
    )

    const treeHandler = explorerSnapshot(root).pipe(
      Effect.flatMap(HttpServerResponse.schemaJson(ExplorerSnapshotSchema)),
      Effect.map(noStore),
      Effect.match({
        onFailure: (cause) => errorResponse(cause),
        onSuccess: (response) => response
      })
    )

    const sourceHandler = Effect.gen(function*() {
      const request = yield* HttpServerRequest.HttpServerRequest
      const url = new URL(request.url, "http://127.0.0.1")
      const requested = url.searchParams.get("path")
      if (requested === null) return errorResponse("Missing path query parameter", 400)
      const path = containedPath(pathService, root, requested)
      if (path === null) return errorResponse("Path is outside the explorer root", 403)
      const selected = yield* selectSource(path, url.searchParams.get("symbol"))
      return noStore(yield* HttpServerResponse.schemaJson(SelectedSourceSchema)({
        ...selected,
        path: requested.replaceAll("\\", "/")
      }))
    }).pipe(Effect.match({
      onFailure: (cause) => errorResponse(cause, 404),
      onSuccess: (response) => response
    }))

    const annotatedHandler = Effect.gen(function*() {
      const request = yield* HttpServerRequest.HttpServerRequest
      const url = new URL(request.url, "http://127.0.0.1")
      const requested = url.searchParams.get("path")
      if (requested === null) return errorResponse("Missing path query parameter", 400)
      const path = containedPath(pathService, root, requested)
      if (path === null) return errorResponse("Path is outside the explorer root", 403)
      const { annotateSource } = yield* Effect.promise(() => import("./annotation.js"))
      const selected = yield* annotateSource(path, url.searchParams.get("symbol"), {
        root,
        types: options.types !== false,
        displayPath: requested.replaceAll("\\", "/")
      })
      return noStore(yield* HttpServerResponse.schemaJson(AnnotatedSourceSchema)(selected))
    }).pipe(Effect.match({
      onFailure: (cause) => errorResponse(cause, 404),
      onSuccess: (response) => response
    }))

    const searchHandler = Effect.gen(function*() {
      const request = yield* HttpServerRequest.HttpServerRequest
      const url = new URL(request.url, "http://127.0.0.1")
      const query = url.searchParams.get("q") ?? ""
      const snapshot = yield* explorerSnapshot(root)
      return noStore(yield* HttpServerResponse.schemaJson(SearchResponseSchema)({
        schemaVersion: 1,
        query,
        results: searchSnapshot(snapshot, query)
      }))
    }).pipe(Effect.match({
      onFailure: (cause) => errorResponse(cause),
      onSuccess: (response) => response
    }))

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
    }).pipe(Effect.match({
      onFailure: () => HttpServerResponse.text(
        "Web explorer assets are missing. Run `pnpm build:web` first.",
        { status: 503 }
      ),
      onSuccess: (response) => response
    }))

    const application = Effect.gen(function*() {
      const request = yield* HttpServerRequest.HttpServerRequest
      const pathname = new URL(request.url, "http://127.0.0.1").pathname
      if (pathname === "/api/tree") return yield* treeHandler
      if (pathname === "/api/source") return yield* sourceHandler
      if (pathname === "/api/annotated") return yield* annotatedHandler
      if (pathname === "/api/search") return yield* searchHandler
      return yield* staticHandler
    })
    const server = HttpServer.serve(application).pipe(
      Layer.provide(NodeHttpServer.layer(createServer, { host: "127.0.0.1", port }))
    )

    yield* Console.log(`module-ls explorer: http://127.0.0.1:${port}`)
    return yield* Layer.launch(server)
  })
