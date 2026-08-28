import * as stylex from "@stylexjs/stylex"
import type { StyleXStyles } from "@stylexjs/stylex"
import { Button, Input } from "@foldkit/ui"
import { Effect, Schema as S } from "effect"
import { Command, Navigation, Runtime, Update } from "foldkit"
import type { Document, Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { evo } from "foldkit/struct"
import type { Url } from "foldkit/url"
import { toString as urlToString } from "foldkit/url"

import {
  ExplorerSnapshot,
  SelectedSource,
  fetchSource,
  fetchTree,
  type ExplorerDeclaration,
  type ExplorerFile
} from "./api.js"
import { AppRoute, fileRouter, urlToAppRoute } from "./route.js"
import { styles } from "./styles.js"

const cx = (...tokens: ReadonlyArray<StyleXStyles>): string =>
  stylex.props(...tokens).className ?? ""

export const Model = S.Struct({
  route: AppRoute,
  tree: S.NullOr(ExplorerSnapshot),
  selected: S.NullOr(SelectedSource),
  selectedPath: S.NullOr(S.String),
  selectedSymbol: S.NullOr(S.String),
  query: S.String,
  isLoadingTree: S.Boolean,
  isLoadingSource: S.Boolean,
  error: S.NullOr(S.String)
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  ChangedUrl: { url: S.Any },
  ClickedLink: { request: Navigation.UrlRequest },
  ClickedRefresh: {},
  ClickedSymbol: { path: S.String, symbol: S.String },
  CompletedNavigate: {},
  FailedFetchSource: { error: S.String },
  FailedFetchTree: { error: S.String },
  SucceededFetchSource: { selected: SelectedSource },
  SucceededFetchTree: { tree: ExplorerSnapshot },
  TypedQuery: { value: S.String }
})
export type Message = typeof Message.Type

const FetchTree = Command.define("FetchTree", {
  messages: [Message.SucceededFetchTree, Message.FailedFetchTree],
  execute: fetchTree().pipe(Effect.match({
    onFailure: (error) => Message.FailedFetchTree({ error }),
    onSuccess: (tree) => Message.SucceededFetchTree({ tree })
  }))
})

const FetchSource = Command.define("FetchSource", {
  args: { path: S.String, symbol: S.NullOr(S.String) },
  messages: [Message.SucceededFetchSource, Message.FailedFetchSource],
  execute: ({ path, symbol }) => fetchSource(path, symbol).pipe(Effect.match({
    onFailure: (error) => Message.FailedFetchSource({ error }),
    onSuccess: (selected) => Message.SucceededFetchSource({ selected })
  }))
})

const Navigate = Command.define("Navigate", {
  args: { url: S.String },
  messages: [Message.CompletedNavigate],
  execute: ({ url }) => Navigation.pushUrl(url).pipe(Effect.as(Message.CompletedNavigate()))
})

const initialModel = (route: AppRoute): Model => ({
  route,
  tree: null,
  selected: null,
  selectedPath: route._tag === "File" ? route.path : null,
  selectedSymbol: null,
  query: "",
  isLoadingTree: true,
  isLoadingSource: route._tag === "File",
  error: null
})

export const init: Runtime.RoutingApplicationInit<Model, Message> = (url) => {
  const route = urlToAppRoute(url)
  return {
    model: initialModel(route),
    commands: [
      FetchTree(),
      ...(route._tag === "File" ? [FetchSource({ path: route.path, symbol: null })] : [])
    ]
  }
}

type UpdateReturn = Update.Return<Model, Message>

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ChangedUrl: ({ url }) => {
      const route = urlToAppRoute(url as Url)
      if (route._tag !== "File") {
        return { model: evo(model, {
          route: () => route,
          selected: () => null,
          selectedPath: () => null,
          selectedSymbol: () => null,
          isLoadingSource: () => false
        }) }
      }
      return {
        model: evo(model, {
          route: () => route,
          selectedPath: () => route.path,
          selectedSymbol: () => null,
          isLoadingSource: () => true,
          error: () => null
        }),
        commands: [FetchSource({ path: route.path, symbol: null })]
      }
    },
    ClickedLink: ({ request }) => request._tag === "Internal"
      ? { model, commands: [Navigate({ url: urlToString(request.url) })] }
      : { model, commands: [Command.define("LoadExternal", {
        messages: [Message.CompletedNavigate],
        execute: Navigation.load(request.href).pipe(Effect.as(Message.CompletedNavigate()))
      })()] },
    ClickedRefresh: () => ({
      model: evo(model, { isLoadingTree: () => true, error: () => null }),
      commands: [FetchTree()]
    }),
    ClickedSymbol: ({ path, symbol }) => ({
      model: evo(model, {
        selectedPath: () => path,
        selectedSymbol: () => symbol,
        isLoadingSource: () => true,
        error: () => null
      }),
      commands: [FetchSource({ path, symbol })]
    }),
    CompletedNavigate: () => ({ model }),
    FailedFetchSource: ({ error }) => ({
      model: evo(model, { isLoadingSource: () => false, error: () => error })
    }),
    FailedFetchTree: ({ error }) => ({
      model: evo(model, { isLoadingTree: () => false, error: () => error })
    }),
    SucceededFetchSource: ({ selected }) => ({
      model: evo(model, {
        selected: () => selected,
        selectedPath: () => selected.path,
        selectedSymbol: () => selected.qualifiedName,
        isLoadingSource: () => false,
        error: () => null
      })
    }),
    SucceededFetchTree: ({ tree }) => {
      const first = model.selectedPath === null ? tree.files[0] : undefined
      return {
        model: evo(model, {
          tree: () => tree,
          selectedPath: (path) => path ?? first?.path ?? null,
          isLoadingTree: () => false,
          isLoadingSource: (loading) => loading || first !== undefined,
          error: () => null
        }),
        commands: first === undefined ? [] : [FetchSource({ path: first.path, symbol: null })]
      }
    },
    TypedQuery: ({ value }) => ({ model: evo(model, { query: () => value }) })
  })

const lineLabel = (declaration: ExplorerDeclaration): string => {
  const start = declaration.range.start.line
  const end = declaration.range.end.line
  return end === start ? `L${start}` : `L${start}–${end}`
}

const visibleFiles = (model: Model): ReadonlyArray<ExplorerFile> => {
  if (model.tree === null) return []
  const query = model.query.trim().toLowerCase()
  if (query === "") return model.tree.files
  return model.tree.files.filter((file) => [
    file.path,
    file.documentation ?? "",
    ...file.declarations.map((declaration) => declaration.qualifiedName)
  ].some((value) => value.toLowerCase().includes(query)))
}

const symbolView = (
  model: Model,
  file: ExplorerFile,
  declaration: ExplorerDeclaration,
  h: HtmlBuilder<Message>
): Html => Button.view({
  onClick: Message.ClickedSymbol({ path: file.path, symbol: declaration.qualifiedName }),
  toView: ({ button }) => h.button(
    [
      ...button,
      h.Class(cx(styles.symbolButton,
        model.selectedSymbol === declaration.qualifiedName ? styles.symbolActive : false))
    ],
    [
      h.span([h.Class(cx(styles.kind))], [declaration.kind]),
      h.span([h.Class(cx(styles.symbolName))], [declaration.qualifiedName]),
      h.span([h.Class(cx(styles.lineRef))], [lineLabel(declaration)])
    ]
  )
}, h)

const fileView = (model: Model, file: ExplorerFile, h: HtmlBuilder<Message>): Html => {
  const selected = model.selectedPath === file.path
  return h.li([h.Class(cx(styles.fileRow, selected ? styles.fileRowSelected : false))], [
    h.a([h.Href(fileRouter({ path: file.path })), h.Class(cx(styles.fileLink))], [
      h.span([h.Class(cx(styles.fileIcon)), h.AriaHidden(true)], ["◆"]),
      h.span([h.Class(cx(styles.fileName)), h.Title(file.path)], [file.path]),
      ...(file.gitStatus === null
        ? []
        : [h.span([h.Class(cx(styles.git)), h.Title("Git working tree status")], [file.gitStatus])])
    ]),
    ...(selected && file.declarations.length > 0
      ? [h.ul([h.Class(cx(styles.declarations))], file.declarations.map((declaration) =>
        h.li([h.Key(declaration.qualifiedName)], [symbolView(model, file, declaration, h)])))]
      : [])
  ])
}

const sidebarView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const files = visibleFiles(model)
  return h.aside([h.Class(cx(styles.sidebar))], [
    h.div([h.Class(cx(styles.searchWrap))], [
      Input.view({
        id: "code-search",
        value: model.query,
        placeholder: "file, symbol, or docs…",
        onInput: (value) => Message.TypedQuery({ value }),
        toView: ({ input, label }) => h.div([], [
          h.label([...label, h.Class(cx(styles.searchLabel))], ["Filter the map"]),
          h.input([...input, h.Class(cx(styles.search))])
        ])
      }, h)
    ]),
    files.length === 0
      ? h.p([h.Class(cx(styles.emptySide))], [model.isLoadingTree ? "Reading the repository…" : "No matching modules."])
      : h.ul([h.Class(cx(styles.files))], files.map((file) =>
        h.keyed("li")(file.path, [], [fileView(model, file, h)])))
  ])
}

const selectedDocumentation = (model: Model): string | null => {
  if (model.tree === null || model.selectedPath === null) return null
  const file = model.tree.files.find((candidate) => candidate.path === model.selectedPath)
  if (file === undefined) return null
  if (model.selectedSymbol === null) return file.documentation
  return file.declarations.find((declaration) => declaration.qualifiedName === model.selectedSymbol)?.documentation ?? null
}

const sourceView = (model: Model, h: HtmlBuilder<Message>): Html => {
  if (model.error !== null) return h.div([h.Class(cx(styles.error)), h.Role("alert")], [model.error])
  if (model.selected === null) return h.div([h.Class(cx(styles.welcome))], [
    h.span([h.Class(cx(styles.welcomeKicker))], ["Roaming documentation"]),
    h.h2([h.Class(cx(styles.welcomeTitle))], ["Follow the shape of the code."]),
    h.p([h.Class(cx(styles.welcomeCopy))], [
      model.isLoadingSource
        ? "Locating the first source block…"
        : "Choose a file or symbol. Every entry carries a versioned, end-exclusive source range an agent can jump to without searching."
    ])
  ])

  const selected = model.selected
  const lines = selected.source.split("\n")
  if (lines.at(-1) === "") lines.pop()
  const range = selected.range.start.line === selected.range.end.line
    ? `L${selected.range.start.line}`
    : `L${selected.range.start.line}–${selected.range.end.line}`
  const documentation = selectedDocumentation(model)
  return h.article([], [
    h.header([h.Class(cx(styles.sourceHeader))], [
      h.div([h.Class(cx(styles.crumbs))], [
        h.span([h.Class(cx(styles.sourcePath))], [selected.path]),
        ...(selected.qualifiedName === null ? [] : [h.span([], ["›"]), h.strong([], [selected.qualifiedName])]),
        h.span([h.Class(cx(styles.range))], [range]),
        ...(model.isLoadingSource ? [h.span([h.Class(cx(styles.meta))], ["refreshing…"])] : [])
      ]),
      h.div([h.Class(cx(styles.hash))], [selected.contentHash])
    ]),
    ...(documentation === null ? [] : [h.p([h.Class(cx(styles.documentation))], [documentation])]),
    h.pre([h.Class(cx(styles.code))], lines.map((line, index) =>
      h.div([h.Class(cx(styles.codeLine)), h.Key(String(selected.range.start.line + index))], [
        h.span([h.Class(cx(styles.codeNumber))], [String(selected.range.start.line + index)]),
        h.code([h.Class(cx(styles.codeText))], [line || " "])
      ])))
  ])
}

const refreshButton = (model: Model, h: HtmlBuilder<Message>): Html => Button.view({
  isDisabled: model.isLoadingTree,
  onClick: Message.ClickedRefresh(),
  toView: ({ button }) => h.button([...button, h.Class(cx(styles.refresh))], [
    model.isLoadingTree ? "Reading…" : "Refresh map"
  ])
}, h)

export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  const changed = model.tree?.files.filter((file) => file.gitStatus !== null).length ?? 0
  return {
    title: model.selectedPath === null ? "module-ls" : `${model.selectedPath} · module-ls`,
    lang: "en",
    body: h.div([h.Class(cx(styles.app))], [
      h.header([h.Class(cx(styles.topbar))], [
        h.div([h.Class(cx(styles.brandWrap))], [
          h.div([h.Class(cx(styles.mark)), h.AriaHidden(true)], ["m/ls"]),
          h.div([], [
            h.h1([h.Class(cx(styles.brand))], ["module-ls"]),
            h.div([h.Class(cx(styles.rootPath))], [model.tree?.root ?? "Reading repository…"])
          ])
        ]),
        h.div([h.Class(cx(styles.actions))], [
          h.span([h.Class(cx(styles.meta))], [
            `${model.tree?.files.length ?? 0} files · ${changed} changed`
          ]),
          refreshButton(model, h)
        ])
      ]),
      h.div([h.Class(cx(styles.layout))], [
        sidebarView(model, h),
        h.main([h.Class(cx(styles.main))], [sourceView(model, h)])
      ])
    ])
  }
}
