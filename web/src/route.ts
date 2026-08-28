import { Schema as S, pipe } from "effect"
import { Route } from "foldkit"

export const AppRoute = Route.defineRouteUnion({
  Explorer: {},
  File: { path: S.String },
  NotFound: { path: S.String }
})
export type AppRoute = typeof AppRoute.Type

export const explorerRouter = pipe(Route.root, Route.mapTo(AppRoute.Explorer))
export const fileRouter = pipe(
  Route.literal("file"),
  Route.slash(Route.restString("path")),
  Route.mapTo(AppRoute.File)
)

export const urlToAppRoute = Route.parseUrlWithFallback(
  Route.oneOf(fileRouter, explorerRouter),
  AppRoute.NotFound
)
