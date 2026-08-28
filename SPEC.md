# module-ls v0.1 prototype specification

Status: Implemented prototype

Audience: implementers, contributors, and tool authors

## 1. Summary

`module-ls` is a read-only command-line explorer for JavaScript and TypeScript.
It combines a filesystem tree with a shallow index of modules and declarations.
It is optimized for repository orientation, compact documentation, and stable
agent input rather than complete semantic analysis.

The package installs equivalent `module-ls` and `mls` commands. The runtime is
Effect TypeScript, source analysis uses ts-morph, and Node execution terminates
through `NodeRuntime.runMain`.

## 2. Goals and non-goals

Version 0.1 does the following:

1. Shows directory structure and source-level structure together.
2. Finds useful declarations without requiring a build or valid typecheck.
3. Understands common ESM, TypeScript namespace, declaration-file, and CommonJS
   export patterns.
4. Optionally shows concise opening documentation for each source file.
5. Produces deterministic tree output and schema-versioned JSON.
6. Uses Effect services for filesystem, path, terminal, configuration, failure,
   and runtime concerns.
7. Keeps discovery, analysis, filtering, and rendering independently usable.

Version 0.1 is not:

- a compiler, type checker, documentation generator, or language server;
- a dependency, import, type, call, or control-flow graph;
- a complete JavaScript evaluator or macro system;
- an index stored on disk or maintained by a daemon; or
- a multi-language implementation.

## 3. Commands and options

```text
module-ls [options] [path ...]
mls [options] [path ...]
```

No path means the current directory. A file path inspects one file. Multiple
roots are rendered in argument order.

| Option | Meaning | Default |
| --- | --- | --- |
| `--peek` | Show leading file documentation. | off |
| `--peek-lines <n>` | Maximum nonblank documentation lines; implies `--peek`. | `3` |
| `--depth <n>` | Maximum directory depth below each explicit root. | unlimited |
| `--symbols <level>` | `modules`, `public`, or `all`. | `public` |
| `--format <format>` | `tree` or `json`. | `tree` |
| `--hidden` | Include hidden entries unless otherwise ignored. | off |
| `--no-ignore` | Disable root `.gitignore` and built-in ignores. | off |
| `--ascii` | Use ASCII connectors. | off |
| `--color <when>` | `auto`, `always`, or `never`. | `auto` |
| `--version` | Print version and exit. | — |
| `--help` | Print command help and exit. | — |

`--peek-lines` must be a positive integer. `--depth` must be a non-negative
integer; root is depth zero. Invalid choices and values fail command validation.

Effect CLI supplies shell completion generation, log-level selection, and wizard
mode in addition to the options above.

`NO_COLOR` disables automatic color. Explicit `--color always` takes precedence.
JSON never contains color.

## 4. Discovery

### 4.1 Platform boundary

Discovery obtains `FileSystem.FileSystem` and `Path.Path` from the Effect context.
It does not import `node:fs` or `node:path`. The production CLI provides these
services with `NodeContext.layer`.

Source files are read into memory individually. Source text is handed to an
in-memory ts-morph project, which prevents the analyzer from bypassing the
platform service boundary.

### 4.2 Traversal

Directories are recursive unless limited by `--depth`. Symlinks are displayed as
leaf nodes and never followed.

Entries are deterministic within each directory:

1. directories in Unicode code-point name order;
2. files and symlinks in Unicode code-point name order; and
3. declarations in source order after deduplication.

Empty directories are omitted unless an explicit depth boundary produces the
empty root node. Multiple roots keep argument order.

### 4.3 Source classification

Recognized TypeScript extensions:

```text
.ts .tsx .mts .cts
```

Recognized JavaScript extensions:

```text
.js .jsx .mjs .cjs
```

Unrecognized descendants are omitted. An explicitly requested unrecognized file
is shown with `language: null`, no declarations, and an `unsupported-file`
diagnostic.

Files larger than 1 MiB are shown but not read or parsed. They receive a
`file-too-large` diagnostic.

### 4.4 Ignore behavior

Hidden basenames are excluded unless `--hidden` is passed.

Unless `--no-ignore` is passed, discovery applies:

- the `.gitignore` located at an explicit directory root, or beside an explicit
  file root; and
- built-in directory ignores: `.git`, `.elixir_ls`, `_build`, `_opam`, `build`,
  `coverage`, `deps`, `dist`, and `node_modules`.

Nested `.gitignore` layering is deferred. `--hidden` does not override ignore
patterns. `--no-ignore` does not imply `--hidden`.

### 4.5 Recovery

An unreadable or nonexistent explicit root fails with `InspectError`. Unreadable
descendants are skipped with a `filesystem-error` diagnostic so other entries can
still be rendered.

## 5. Shared Schema model

All public output is described by Effect Schema and exported from `src/model.ts`.
The conceptual model is:

```text
ModuleLsOutput
  schemaVersion: 1
  roots: TreeNode[]
  diagnostics: Diagnostic[]

TreeNode
  DirectoryNode | FileNode | SymlinkNode

DirectoryNode
  type: "directory"
  name: string
  path: string
  children: TreeNode[]

FileNode
  type: "file"
  name: string
  path: string
  language: "typescript" | "javascript" | null
  documentation: string | null
  declarations: Declaration[]
  diagnostics: Diagnostic[]

Declaration
  kind: DeclarationKind
  name: string
  visibility: "public" | "private" | "unknown"
  signature: string | null
  documentation: string | null
  location: { line: number, column: number }
  children: Declaration[]
```

Declaration kinds are `namespace`, `class`, `function`, `variable`, `type`,
`interface`, `enum`, `re-export`, and `default`.

Paths use forward slashes. Paths beneath the current working directory are
relative; outside paths are normalized absolute paths. Line and column numbers
are one-based.

Optional information is represented as `null`, not an omitted field. Arrays are
always present.

## 6. ts-morph analysis

### 6.1 Project configuration

Each inspection creates one ts-morph `Project` with:

- an in-memory filesystem;
- no automatic tsconfig source loading;
- JavaScript allowed but not typechecked;
- preserved JSX;
- ESNext modules; and
- the latest TypeScript syntax target.

Each discovered source string is created as a source file in this project.
Project code is never run. No compiler, package manager, or network command is
invoked.

### 6.2 ESM and TypeScript declarations

The adapter indexes top-level:

- `function` and `class` declarations;
- `const`, `let`, and `var` bindings;
- `interface`, `type`, and `enum` declarations;
- `namespace` and ambient `module` declarations;
- named, star, and default exports; and
- direct declarations inside namespace or ambient-module bodies.

Ordinary imports are not declarations. Named re-exports use the exported alias
when present and retain a compact `from "specifier"` signature. Star re-exports
are displayed as `export * from "specifier"`.

Function signatures include parameter names, rest markers, and optional markers.
Variable signatures include an explicit type annotation when present. Inferred
types are not printed.

Top-level declarations with an ESM export or default-export modifier are public.
Unexported top-level declarations are private. Declarations in `.d.ts` files are
public by default. Nested namespace members use their own visibility unless they
are ambient declarations.

### 6.3 CommonJS

The JavaScript adapter recognizes these assignment shapes:

```js
exports.name = value
module.exports.name = value
module.exports = { name, alias: value, method() {} }
module.exports = value
```

Named properties become public variables. A non-object `module.exports`
assignment becomes a default export.

CommonJS assignments constructed indirectly through aliases, mutation helpers,
or dynamic property names are outside v0.1.

### 6.4 Deduplication

Declarations are deduplicated by kind and name at each indexed scope. This is
needed for overloads and for a private local declaration later exposed by a
CommonJS assignment. When visibility differs, the public occurrence wins while
the first position remains stable.

### 6.5 Symbol levels

- `modules` retains only namespace and ambient-module containers. Their
  non-module children are removed.
- `public` retains public declarations and namespace containers. Private direct
  children are removed. This is the default.
- `all` retains every recognized declaration at indexed scopes.

Files remain visible even when filtering removes every declaration.

## 7. Documentation peeking

Peek mode recognizes these leading forms:

```text
/** JSDoc */
/* block comment */
// contiguous line comments
```

A UTF-8 BOM, shebang, blank space, or leading triple-slash reference directives
may precede the selected block.

Normalization:

1. removes comment delimiters and conventional leading `*` decoration;
2. removes common indentation;
3. trims leading and trailing blank lines;
4. omits blank lines in tree output;
5. renders at most `--peek-lines` nonblank lines; and
6. appends `…` to the last rendered line when content was truncated.

The complete normalized documentation string is retained in JSON. The line limit
is a tree-rendering concern.

JSDoc immediately attached to a declaration is also retained on that declaration
in JSON, but declaration documentation is not expanded in the tree.

License banners are not distinguished automatically from module documentation.

## 8. Rendering

### 8.1 Tree

Directory names end with `/`; symlink names end with `@`. Files own documentation
lines and declarations. Namespace declarations own their direct children.

Unicode connectors are `├──`, `└──`, and `│`. `--ascii` substitutes `+--`,
`` `-- ``, and `|` forms.

Directories, source files, declaration kinds, and documentation may be colored.
Rendering is deterministic and does not depend on terminal width.

Tree output goes through `Terminal.display`. Diagnostics are written separately
to standard error and include path, severity, message, and code.

### 8.2 JSON

JSON is encoded through `ModuleLsOutputSchema`, pretty-printed with two spaces,
and emitted as one UTF-8 object:

```json
{
  "schemaVersion": 1,
  "roots": [],
  "diagnostics": []
}
```

It contains no ANSI escapes or separate progress messages. Diagnostics remain in
the JSON object and are not duplicated to standard error.

## 9. Effect architecture

The executable composition is:

```text
Command.run(command)(process.argv)
  -> Schema.decodeUnknown(InspectOptionsSchema)
  -> discover
  -> analyze
  -> renderTree | renderJson
  -> Terminal.display
  -> Effect.provide(NodeContext.layer)
  -> NodeRuntime.runMain
```

Responsibilities:

- `@effect/cli` owns argv parsing, help, versioning, and completions.
- Effect Schema validates input and describes every public output node.
- `@effect/platform` supplies filesystem, path, terminal, and platform errors.
- tagged `InspectError` and `RenderError` values describe domain failures.
- ts-morph performs synchronous AST work inside a captured Effect boundary.
- pure render helpers make tree output independently testable.
- `NodeRuntime.runMain` handles process signals, finalization, error reporting,
  and exit status.

The library exports `inspect` for callers that want the model without terminal
output and `run` for callers that want normal CLI rendering with supplied
platform services.

## 10. Diagnostics and process behavior

Diagnostic codes currently include:

- `unsupported-file`;
- `file-too-large`;
- `filesystem-error`; and
- `parse-error`.

Successful inspection exits zero even when a recoverable per-file diagnostic is
present. Invalid CLI input, an invalid option schema, an unreadable explicit
root, schema encoding failure, or platform display failure terminates the Effect
and is reported by `NodeRuntime.runMain` with a nonzero exit.

Broken-pipe behavior is delegated to the current platform Terminal and runtime.

## 11. Verification

The prototype test suite covers:

- JSDoc, line-comment, shebang, and triple-slash peek extraction;
- public, module-only, and all-symbol filtering;
- nested namespace members;
- CommonJS object exports;
- deterministic Unicode and ASCII rendering;
- Effect Schema JSON encoding and decoding;
- root `.gitignore` and hidden-file behavior;
- depth limiting; and
- source and built CLI execution.

The verification command is:

```sh
pnpm check
```

README examples use the checked-in integration fixture.

## 12. Deferred work

The following are not part of the functional prototype:

- nested `.gitignore` layering and configuration files;
- tsconfig discovery and cross-file export resolution;
- detailed parse diagnostics from the TypeScript compiler;
- destructured binding expansion and dynamic CommonJS patterns;
- class and interface members;
- declaration-document expansion in tree output;
- additional languages or user-defined adapters;
- Markdown, MCP, watch, or cached-index renderers; and
- npm publication and license selection.

Future features must preserve the core constraint: `module-ls` should remain a
fast way to learn where useful code lives, not become another language server.
