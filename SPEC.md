# module-ls functional prototype specification

Status: Implemented prototype
Audience: implementers, contributors, and tool authors

## 1. Purpose

`module-ls` is a read-only JavaScript and TypeScript code explorer. It combines
repository topology, shallow AST structure, documentation, exact source
coordinates, and Git working-tree state without requiring the target project to
build or execute.

The product has four coordinated surfaces:

1. compact human-readable tree output;
2. a complete schema-versioned repository index;
3. exact `show` and `extract` source selection;
4. annotated source for static consumers; and
5. a local native FoldKit web explorer.

It is not a compiler, language server, dependency/call graph, persistent index,
or multi-language documentation generator.

## 2. Commands

The `module-ls` and `mls` bins are equivalent.

```text
module-ls [options] [path ...]
module-ls show <file[#symbol]> [--symbol <qualified-name>]
module-ls extract <file[#symbol]> [--symbol <qualified-name>]
module-ls annotate <file[#symbol]> [--root <path>] [--no-types]
module-ls walkthrough <definition.json|yaml> [--format tree|json]
module-ls serve [path] [--port 4310] [--no-types] [--open]
```

No inspection path means `.`. Inspection accepts multiple roots in argument
order. `serve` accepts one repository root, binds only to `127.0.0.1`, and
defaults to port 4310.

Inspection options are:

| Option | Constraint | Default |
| --- | --- | --- |
| `--peek` | boolean | false |
| `--peek-lines` | positive integer | 3 |
| `--depth` | non-negative integer or unlimited | 3 for tree; unlimited for JSON |
| `--symbols` | `modules`, `public`, `all` | `public` |
| `--format` | `tree`, `json` | `tree` |
| `--hidden` | boolean | false |
| `--no-ignore` | boolean | false |
| `--ascii` | boolean | false |
| `--color` | `auto`, `always`, `never` | `auto` |
| `--max-symbols` | non-negative integer or unlimited | 8 |
| `--expand` | disables depth/symbol limits and barrel collapse | false |

## 3. Discovery and analysis

Discovery uses the Effect 4 `FileSystem` and `Path` services. Source is passed as
strings into one in-memory ts-morph `Project`; ts-morph never traverses the real
filesystem. Supported extensions are `.ts`, `.tsx`, `.mts`, `.cts`, `.js`,
`.jsx`, `.mjs`, and `.cjs`.

Traversal is deterministic: directories first, then files and symlinks, each in
name order. Symlinks are leaves. Files larger than 1 MiB remain visible but are
not parsed. Hidden names, the explicit root `.gitignore`, and built-in dependency
or build directories are ignored unless their corresponding option disables the
behavior. Nested `.gitignore` layering is not implemented.

The analyzer indexes top-level functions, classes, variables, interfaces, type
aliases, enums, namespaces, ambient modules, default exports, named/star
re-exports, and direct namespace children. It recognizes ordinary
`exports.name`, `module.exports.name`, object `module.exports`, and default
`module.exports` assignments.

Declarations are deduplicated by kind and name at each scope. Source order is
retained; a public occurrence supersedes a private duplicate. Project code is
parsed but never evaluated. Cross-file resolution, inferred types, class
members, destructured binding expansion, and dynamic CommonJS are out of scope.

Export visibility is derived from syntax—export/default modifiers and local
export clauses—without invoking the TypeScript type checker. Source files are
parsed in bounded ts-morph project batches so large monorepos do not accumulate
every AST in one long-lived project.

Annotated-source requests use a separate, lazy TypeScript language service. It
loads the nearest in-root `tsconfig.json`, falls back to an `allowJs` bundler
configuration, and retains at most three services. Shiki and annotation results
are cached by source fingerprint; ordinary inspection remains syntax-only.

## 4. Source coordinates

Every declaration has:

```text
location:           { line, column }
range:              { start: SourcePosition, end: SourcePosition }
nameRange:          SourceRange | null
documentationRange: SourceRange | null

SourcePosition:
  line:   1-based
  column: 1-based
  offset: 0-based UTF-16 code units
```

All ranges are end-exclusive. `range` covers the declaration syntax node,
`nameRange` covers its identifier when available, and `documentationRange`
covers the last attached JSDoc. The legacy `location` equals `range.start`
without its offset.

Each read file has an `fnv1a64:<16 hex digits>` fingerprint over its UTF-8
bytes. Consumers compare it before applying stored offsets to later content.
This is stale-range detection, not collision-resistant security.

## 5. Public schemas

`ModuleLsOutputSchema` is version 2 and contains recursive tree nodes,
diagnostics, file content fingerprints, documentation, declarations, and exact
ranges. Optional information is `null`; collections are always present.

`SelectedSourceSchema` is version 2:

```text
SelectedSource
  schemaVersion: 2
  path: string
  language: "typescript" | "javascript" | null
  qualifiedName: string | null
  kind: DeclarationKind | null
  range: SourceRange
  contentHash: string
  source: string
```

Symbols resolve by dot-separated namespace descent. Without a symbol, the
selection covers the complete file.

`ExplorerSnapshotSchema` version 1 flattens the repository into files with
repository-relative paths, fingerprints, documentation, Git status, and
declarations with qualified names and ranges. Git status comes from
`git status --short --untracked-files=all` through the Effect 4 child-process
spawner service. A non-Git directory returns null statuses rather than failing.
The snapshot additionally carries a recursive directory tree over the same file
records.

`AnnotatedSourceSchema` version 3 extends a selected source with per-line Shiki
tokens, TypeScript quick-info ranges, and in-root definition targets. Annotation
offsets are 0-based UTF-16 code units relative to `source`. Light and dark token
colors are both present, and hover/definition collections may be empty.

`WalkthroughDocumentSchema` version 1 describes an ordered code tour. A document
contains an id, title, summary, audiences, and recursive steps. Each step has a
stable id, kind, narration, notes, children, and an optional source target with
a path, symbol or line range, and named highlights. JSON, YAML, the fluent
`Walkthrough.make(...).add(...)` DSL, CLI output, and web rendering all share
this schema.

## 6. Rendering and selection

Tree output includes declaration line ranges. It traverses three directory
levels by default and marks cutoff directories with `…`. It shows at most
`maxSymbols` declarations per file and appends `… N more`; all-re-export files
collapse to `N re-exports`. `--expand` disables all reductions. JSON remains
complete.

Peek mode selects the first JSDoc, block, or contiguous line-comment block after
an optional BOM, shebang, or triple-slash references. Markers and indentation are
removed. Tree truncation is explicit; JSON retains complete normalized text.

`show` prints a selection header and numbered source. `extract` encodes the same
selection through `SelectedSourceSchema`.

## 7. HTTP service

```text
GET /api/tree
GET /api/source?path=<repository-relative-file>
GET /api/source?path=<repository-relative-file>&symbol=<qualified-name>
GET /api/annotated?path=<repository-relative-file>[&symbol=<qualified-name>]
GET /api/search?q=<query>
GET /api/walkthrough?path=<repository-relative-json-or-yaml>
```

API responses are schema encoded and uncached. Source paths resolve against the
configured root and paths escaping it are rejected. Other GET paths serve the
built Vite SPA. Missing assets return 503. The loopback-only service is read-only
and recomputes analysis and Git state on refresh.

## 8. FoldKit application

`web/` is a native FoldKit SPA on the same Effect 4 RC as the Node package. It
uses one Schema `Model`, one exhaustive Message union, named Commands for HTTP and
navigation, `Runtime.makeApplication`, bidirectional route parsers, FoldKit
virtual DOM, `@foldworks/ui` controls and theme, FoldKit DevTools, Vite, and
StyleX. It contains no React compatibility layer.

The workspace pins one Effect version across both packages. Schema-validated
HTTP JSON remains the runtime boundary between the Node service and browser app.

The UI provides a recursive tree, filtering, file routes, qualified symbols,
documentation, highlighted source, type hover, go-to-definition, fingerprints,
light/dark code themes, refresh, and Git badges. It does not edit files or
render full patches. `/walkthrough/<definition>` renders schema-validated code
tours with navigable source targets.

## 9. Effect architecture

```text
effect/unstable/cli Command.run
  -> Schema option decoding
  -> Effect FileSystem / Path discovery
  -> in-memory ts-morph analysis
  -> schema model
  -> tree / JSON / selection / HTTP
  -> NodeServices.layer
  -> NodeRuntime.runMain
```

Filesystem, path, terminal, process execution, and HTTP capabilities come from
Effect services. Tagged errors describe domain failures. Recoverable per-file
failures become diagnostics; invalid roots and selections exit nonzero.

## 10. Verification and deferred work

`pnpm check` typechecks both workspaces, runs unit and end-to-end CLI tests,
builds CLI declarations, and creates production Vite assets. Browser
verification covers service rendering, navigation, filtering, exact selection,
refresh, and console errors.

Deferred work includes nested `.gitignore` semantics, class/interface members,
full patch views, pane resizing, watch mode/SSE, references, LRU eviction for
large monorepos, MCP, additional languages, npm publication, and a license. The
core must remain fast, read-only, and smaller than a language server.
