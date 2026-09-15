import * as stylex from "@stylexjs/stylex"
import type { StyleXStyles } from "@stylexjs/stylex"
import { Button, Input } from "@foldworks/ui"
import { Effect, Option, Schema as S } from "effect"
import { Command, Navigation, Runtime, Update } from "foldkit"
import type { Document, Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { evo } from "foldkit/struct"
import type { Url } from "foldkit/url"
import { toString as urlToString } from "foldkit/url"

import {
  AnnotatedSource,
  ExplorerSnapshot,
  fetchAnnotated,
  fetchTree,
  type DefinitionAnnotation,
  type ExplorerDirectoryType,
  type ExplorerDeclaration,
  type ExplorerFile,
  type HighlightedToken,
  type HoverAnnotation
} from "./api.js"
import { AppRoute, fileRouter, urlToAppRoute } from "./route.js"
import { styles } from "./styles.js"

const cx = (...tokens: ReadonlyArray<StyleXStyles>): string =>
  stylex.props(...tokens).className ?? ""

export const Model = S.Struct({
  route: AppRoute,
  tree: S.NullOr(ExplorerSnapshot),
  selected: S.NullOr(AnnotatedSource),
  selectedPath: S.NullOr(S.String),
  selectedSymbol: S.NullOr(S.String),
  focusLine: S.NullOr(S.Number),
  query: S.String,
  expandedPaths: S.Array(S.String),
  theme: S.Literals(["light", "dark"]),
  isLoadingTree: S.Boolean,
  isLoadingSource: S.Boolean,
  error: S.NullOr(S.String)
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  ChangedUrl: { url: S.Any },
  ClickedLink: { request: Navigation.UrlRequest },
  ClickedRefresh: {},
  ToggledDirectory: { path: S.String },
  ToggledTheme: {},
  CompletedNavigate: {},
  CompletedScroll: {},
  FailedFetchSource: { error: S.String },
  FailedFetchTree: { error: S.String },
  SucceededFetchSource: { selected: AnnotatedSource },
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
  execute: ({ path, symbol }) => fetchAnnotated(path, symbol).pipe(Effect.match({
    onFailure: (error) => Message.FailedFetchSource({ error }),
    onSuccess: (selected) => Message.SucceededFetchSource({ selected })
  }))
})

const Navigate = Command.define("Navigate", {
  args: { url: S.String },
  messages: [Message.CompletedNavigate],
  execute: ({ url }) => Navigation.pushUrl(url).pipe(Effect.as(Message.CompletedNavigate()))
})

const ScrollToLine = Command.define("ScrollToLine", {
  args: { line: S.Number },
  messages: [Message.CompletedScroll],
  execute: ({ line }) => Effect.sync(() => {
    requestAnimationFrame(() => document.getElementById(`L${line}`)?.scrollIntoView({ block: "center" }))
  }).pipe(Effect.as(Message.CompletedScroll()))
})

const hashValue = (url: Url): string | null => Option.getOrNull(url.hash)

const symbolFromUrl = (url: Url): string | null => {
  const hash = hashValue(url)
  if (hash?.startsWith("symbol=") !== true) return null
  try {
    return decodeURIComponent(hash.slice("symbol=".length)) || null
  } catch {
    return null
  }
}

const lineFromUrl = (url: Url): number | null => {
  const match = hashValue(url)?.match(/^L(\d+)$/u)
  return match === null || match === undefined ? null : Number(match[1])
}

const fileUrl = (path: string, hash: string | null = null): string =>
  `${fileRouter({ path })}${hash === null ? "" : `#${hash}`}`

const initialModel = (route: AppRoute, url: Url): Model => ({
  route,
  tree: null,
  selected: null,
  selectedPath: route._tag === "File" ? route.path : null,
  selectedSymbol: route._tag === "File" ? symbolFromUrl(url) : null,
  focusLine: route._tag === "File" ? lineFromUrl(url) : null,
  query: "",
  expandedPaths: [""],
  theme: "light",
  isLoadingTree: true,
  isLoadingSource: route._tag === "File",
  error: null
})

export const init: Runtime.RoutingApplicationInit<Model, Message> = (url) => {
  const route = urlToAppRoute(url)
  const symbol = route._tag === "File" ? symbolFromUrl(url) : null
  return {
    model: initialModel(route, url),
    commands: [
      FetchTree(),
      ...(route._tag === "File" ? [FetchSource({ path: route.path, symbol })] : [])
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
          focusLine: () => null,
          isLoadingSource: () => false
        }) }
      }
      const nextUrl = url as Url
      const symbol = symbolFromUrl(nextUrl)
      return {
        model: evo(model, {
          route: () => route,
          selectedPath: () => route.path,
          selectedSymbol: () => symbol,
          focusLine: () => lineFromUrl(nextUrl),
          isLoadingSource: () => true,
          error: () => null
        }),
        commands: [FetchSource({ path: route.path, symbol })]
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
    ToggledDirectory: ({ path }) => ({
      model: evo(model, {
        expandedPaths: (paths) => paths.includes(path)
          ? paths.filter((candidate) => candidate !== path)
          : [...paths, path]
      })
    }),
    ToggledTheme: () => ({
      model: evo(model, { theme: (theme) => theme === "light" ? "dark" : "light" })
    }),
    CompletedNavigate: () => ({ model }),
    CompletedScroll: () => ({ model }),
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
      }),
      commands: model.focusLine === null ? [] : [ScrollToLine({ line: model.focusLine })]
    }),
    SucceededFetchTree: ({ tree }) => {
      const first = model.selectedPath === null ? tree.files[0] : undefined
      const selectedPath = model.selectedPath ?? first?.path
      const firstDirectories = selectedPath === undefined
        ? []
        : selectedPath.split("/").slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join("/"))
      return {
        model: evo(model, {
          tree: () => tree,
          selectedPath: (path) => path ?? first?.path ?? null,
          expandedPaths: (paths) => [...new Set([...paths, ...firstDirectories])],
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
): Html => h.a([
  h.Href(fileUrl(file.path, `symbol=${encodeURIComponent(declaration.qualifiedName)}`)),
  h.Class(cx(styles.symbolButton,
    model.selectedSymbol === declaration.qualifiedName ? styles.symbolActive : false))
], [
  h.span([h.Class(cx(styles.kind))], [declaration.kind]),
  h.span([h.Class(cx(styles.symbolName))], [declaration.qualifiedName]),
  h.span([h.Class(cx(styles.lineRef))], [lineLabel(declaration)])
])

const fileView = (model: Model, file: ExplorerFile, h: HtmlBuilder<Message>): Html => {
  const selected = model.selectedPath === file.path
  return h.div([h.Class(cx(styles.fileRow, selected ? styles.fileRowSelected : false))], [
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

const directoryHasVisibleFiles = (directory: ExplorerDirectoryType, paths: ReadonlySet<string>): boolean =>
  directory.children.some((child) => child.type === "file"
    ? paths.has(child.file.path)
    : directoryHasVisibleFiles(child, paths))

const directoryView = (
  model: Model,
  directory: ExplorerDirectoryType,
  visiblePaths: ReadonlySet<string>,
  h: HtmlBuilder<Message>,
  isRoot = false
): Html => {
  const expanded = isRoot || model.expandedPaths.includes(directory.path)
  const children = directory.children.filter((child) => child.type === "file"
    ? visiblePaths.has(child.file.path)
    : directoryHasVisibleFiles(child, visiblePaths))
  return h.div([h.Class(cx(styles.directory)), h.Role("treeitem"), h.AriaExpanded(expanded)], [
    ...(isRoot ? [] : [h.button([
      h.OnClick(Message.ToggledDirectory({ path: directory.path })),
      h.Class(cx(styles.directoryButton))
    ], [
        h.span([h.Class(cx(styles.chevron)), h.AriaHidden(true)], [expanded ? "▾" : "▸"]),
        h.span([], [directory.name]),
        h.span([h.Class(cx(styles.directoryCount))], [String(children.length)])
      ])]),
    ...(expanded ? [h.div([h.Class(cx(styles.treeGroup)), h.Role("group")], children.map((child) =>
      child.type === "file"
        ? h.keyed("div")(child.file.path, [], [fileView(model, child.file, h)])
        : h.keyed("div")(child.path, [], [directoryView(model, child, visiblePaths, h)])))] : [])
  ])
}

const sidebarView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const files = visibleFiles(model)
  const paths = new Set(files.map((file) => file.path))
  return h.aside([h.Class(cx(styles.sidebar))], [
    h.div([h.Class(cx(styles.searchWrap))], [
      Input.view({
        id: "code-search",
        value: model.query,
        placeholder: "file, symbol, or docs…",
        onInput: (value) => Message.TypedQuery({ value }),
        ariaLabel: "Filter the map",
        attributes: [h.Class(cx(styles.search))]
      }, h)
    ]),
    files.length === 0
      ? h.p([h.Class(cx(styles.emptySide))], [model.isLoadingTree ? "Reading the repository…" : "No matching modules."])
      : model.tree === null
        ? h.p([h.Class(cx(styles.emptySide))], ["Reading the repository…"])
        : h.div([h.Class(cx(styles.files)), h.Role("tree"), h.AriaLabel("Repository files")], [
          directoryView(model, model.tree.tree, paths, h, true)
        ])
  ])
}

const selectedDocumentation = (model: Model): string | null => {
  if (model.tree === null || model.selectedPath === null) return null
  const file = model.tree.files.find((candidate) => candidate.path === model.selectedPath)
  if (file === undefined) return null
  if (model.selectedSymbol === null) return file.documentation
  return file.declarations.find((declaration) => declaration.qualifiedName === model.selectedSymbol)?.documentation ?? null
}

interface ViewerSegment {
  readonly content: string
  readonly start: number
  readonly color: string | null
  readonly darkColor: string | null
  readonly fontStyle: number | null
  readonly hover: HoverAnnotation | null
  readonly definition: DefinitionAnnotation | null
}

const segmentsFor = (
  token: HighlightedToken,
  hovers: ReadonlyArray<HoverAnnotation>,
  definitions: ReadonlyArray<DefinitionAnnotation>
): ReadonlyArray<ViewerSegment> => {
  const matchingHovers = hovers.filter((hover) => hover.start < token.end && hover.end > token.start)
  const matchingDefinitions = definitions.filter((definition) => definition.start < token.end && definition.end > token.start)
  const boundaries = [...new Set([
    token.start,
    token.end,
    ...matchingHovers.flatMap(({ start, end }) => [Math.max(start, token.start), Math.min(end, token.end)]),
    ...matchingDefinitions.flatMap(({ start, end }) => [Math.max(start, token.start), Math.min(end, token.end)])
  ])].sort((left, right) => left - right)
  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1] ?? token.end
    return {
      content: token.content.slice(start - token.start, end - token.start),
      start,
      color: token.color,
      darkColor: token.darkColor,
      fontStyle: token.fontStyle,
      hover: matchingHovers.find((candidate) => candidate.start <= start && candidate.end >= end) ?? null,
      definition: matchingDefinitions.find((candidate) => candidate.start <= start && candidate.end >= end) ?? null
    }
  })
}

const segmentView = (model: Model, segment: ViewerSegment, h: HtmlBuilder<Message>): Html => {
  const style: Record<string, string> = {
    color: (model.theme === "dark" ? segment.darkColor : segment.color) ?? "inherit",
    ...(segment.fontStyle === null ? {} : {
      ...(segment.fontStyle & 1 ? { fontStyle: "italic" } : {}),
      ...(segment.fontStyle & 2 ? { fontWeight: "700" } : {}),
      ...(segment.fontStyle & 4 ? { textDecoration: "underline" } : {})
    })
  }
  const content = segment.definition === null
    ? h.span([h.Style(style)], [segment.content])
    : h.a([
      h.Style(style),
      h.Class(cx(styles.definition)),
      h.Href(fileUrl(
        segment.definition.targets[0]?.path ?? model.selectedPath ?? "",
        `L${segment.definition.targets[0]?.range.start.line ?? 1}`
      ))
    ], [segment.content])
  if (segment.hover === null) return content
  const hover = segment.hover
  const title = `${hover.text}${hover.documentation === null ? "" : `\n\n${hover.documentation}`}`
  return h.span([h.Class("type-hover"), h.Tabindex(0), h.Title(title)], [
    content,
    h.span([h.Class(`${cx(styles.hoverCard)} type-card`), h.Role("tooltip")], [
      h.code([h.Class(cx(styles.hoverSignature))], [hover.text]),
      ...(hover.documentation === null
        ? []
        : [h.p([h.Class(cx(styles.hoverDocumentation))], [hover.documentation])])
    ])
  ])
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
    h.pre([h.Class(cx(styles.code, model.theme === "dark" ? styles.codeDark : false))], selected.lines.map((line, index) => {
      const lineNumber = selected.range.start.line + index
      return h.div([
        h.Class(`${cx(styles.codeLine)} code-line-anchor${model.focusLine === lineNumber ? " code-line-focused" : ""}`),
        h.Key(String(lineNumber)),
        h.Id(`L${lineNumber}`)
      ], [
        h.span([h.Class(cx(styles.codeNumber))], [String(lineNumber)]),
        h.code([h.Class(cx(styles.codeText))], line.length === 0
          ? [" "]
          : line.flatMap((token) => segmentsFor(token, selected.hovers, selected.definitions)
            .map((segment) => segmentView(model, segment, h))))
      ])
    }))
  ])
}

const refreshButton = (model: Model, h: HtmlBuilder<Message>): Html => Button.view({
  label: model.isLoadingTree ? "Reading…" : "Refresh map",
  isDisabled: model.isLoadingTree,
  onClick: Message.ClickedRefresh(),
  variant: "outline",
  size: "sm",
  style: styles.refresh
}, h)

const themeButton = (model: Model, h: HtmlBuilder<Message>): Html => Button.view({
  label: model.theme === "light" ? "Dark" : "Light",
  onClick: Message.ToggledTheme(),
  variant: "outline",
  size: "sm",
  ariaLabel: `Use ${model.theme === "light" ? "dark" : "light"} code theme`,
  style: styles.refresh
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
          themeButton(model, h),
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
