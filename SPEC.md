# module-ls v0.1 specification

Status: Draft

Audience: implementers, contributors, and tool authors

## 1. Summary

`module-ls` is a read-only command-line explorer that combines a filesystem tree
with a shallow, language-aware index of source modules and public symbols. It is
optimized for quick repository orientation rather than complete semantic
analysis.

The program installs two equivalent commands:

```text
module-ls
mls
```

The first release supports TypeScript/JavaScript, OCaml, and Elixir. Its
implementation is organized as a pipeline of small stages:

```text
paths -> discover -> classify -> parse -> filter -> render
```

Each language adapter consumes source text and returns the same small document
model. Renderers never inspect language-specific syntax.

## 2. Goals

Version 0.1 must:

1. Show directory structure and source-level structure in one compact tree.
2. Work in incomplete, unbuilt, or syntactically broken repositories whenever a
   useful partial result can be recovered.
3. Recognize the module and public API conventions of the initial languages.
4. Optionally show a concise opening documentation block for each source file.
5. Produce deterministic terminal and JSON output.
6. Be safe to run anywhere: read-only, bounded, and non-following by default.
7. Make adding a language adapter or renderer a local change.

Version 0.1 is not:

- a compiler, type checker, documentation generator, or language server;
- a call graph, dependency graph, or import graph;
- a replacement for `find`, `tree`, `ctags`, or API reference documentation;
- a full parser required to reject invalid source; or
- an index stored on disk or maintained by a daemon.

## 3. Command-line interface

```text
module-ls [path ...] [options]
```

With no path, the command inspects the current directory. A file path inspects
that single file. Multiple roots are rendered in argument order.

### 3.1 Options

| Option | Meaning | Default |
| --- | --- | --- |
| `--peek` | Show the leading file or module documentation block. | off |
| `--peek-lines <n>` | Maximum rendered lines per documentation block. Implies `--peek`. | `3` |
| `--depth <n>` | Maximum directory depth below each root. Root is depth `0`. | unlimited |
| `--symbols <level>` | `modules`, `public`, or `all`; see section 6. | `public` |
| `--format <format>` | `tree` or `json`. | `tree` |
| `--language <name>` | Restrict adapters; repeatable. | all supported |
| `--hidden` | Include hidden entries unless otherwise ignored. | off |
| `--no-ignore` | Do not apply ignore files or built-in ignored directory names. | off |
| `--color <when>` | `auto`, `always`, or `never`. | `auto` |
| `--ascii` | Use ASCII tree connectors. | off |
| `--version` | Print the program version and exit. | — |
| `--help` | Print command help and exit. | — |

Unknown options, missing option values, invalid enum values, negative depths,
and nonexistent explicit paths are usage errors.

`NO_COLOR` disables color when `--color` was not explicitly passed. Color must
never appear in JSON.

## 4. Discovery

### 4.1 Traversal

Discovery walks each directory recursively. It must not follow symbolic links in
version 0.1. A symlink may be shown as a leaf only when it was explicitly passed
or survives normal filtering.

Entries are sorted deterministically within each directory:

1. directories by Unicode code-point order of name;
2. files by Unicode code-point order of name; then
3. source declarations in source order.

Unreadable entries yield a diagnostic and do not stop other roots from being
processed.

### 4.2 Filtering

By default, discovery excludes:

- hidden entries (a basename beginning with `.`);
- paths ignored by the nearest applicable `.gitignore`; and
- common dependency and build directories: `node_modules`, `dist`, `build`,
  `_build`, `_opam`, `deps`, `.elixir_ls`, and `cover`.

A later revision may expose a config file; v0.1 has no project configuration
format.

`--hidden` only changes hidden-entry filtering. It does not override ignore
rules. `--no-ignore` disables `.gitignore` and the built-in directory list, but
hidden entries still require `--hidden`.

Only recognized source files are shown by default. Directories that contain no
visible descendant after filtering are omitted. An explicitly passed file is
shown even when its extension is unrecognized, but has no declarations.

### 4.3 Limits

The implementation must process files incrementally and must not read an entire
repository into memory. A single file larger than 1 MiB is listed but not parsed;
the tree adds an `unparsed: file too large` annotation and JSON adds a diagnostic.

## 5. Shared document model

Adapters return language-neutral nodes with these conceptual fields:

```text
Document
  path: string
  language: string | null
  documentation: string | null
  declarations: Declaration[]
  diagnostics: Diagnostic[]

Declaration
  kind: string
  name: string
  visibility: public | private | unknown
  signature: string | null
  documentation: string | null
  location: { line: number, column: number }
  children: Declaration[]
```

Line and column numbers are one-based. Adapters may return a partial document
with diagnostics. A parse problem is not automatically a process failure.

## 6. Symbol levels

`--symbols` controls which declarations are rendered:

- `modules` shows module-like containers only: modules, namespaces, module
  types, protocols, implementations, and equivalent declarations.
- `public` shows module-like containers plus declarations exported through the
  language's normal public mechanism. This is the default.
- `all` additionally shows recognized private or local declarations at the
  adapter's indexed scope.

Adapters perform shallow indexing. They index the top level of a file and direct
members of recognized module containers; they do not index function-local
bindings.

Signatures should be concise and single-line. When a full signature cannot be
recovered cheaply, the adapter returns the declaration name without inventing a
type.

## 7. Language adapters

### 7.1 TypeScript and JavaScript

Extensions: `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`

The adapter recognizes:

- exported `namespace`, `module`, `class`, `function`, `const`, `let`, and
  `var` declarations;
- exported `type`, `interface`, and `enum` declarations;
- named declarations re-exported with `export { ... }` when their local
  declaration is recoverable;
- default named declarations; and
- public declarations nested directly in a namespace or ambient module.

At `public`, unexported top-level declarations are omitted. At `all`, recognized
unexported top-level declarations are included. Imports and star re-exports are
not declarations. Object properties and function-local bindings are not
indexed.

This deliberately supports the common Effect module style: a file is the module,
and its exported types, constructors, refinements, and pipeable combinators form
the visible API. The adapter does not need Effect as a dependency and does not
special-case particular Effect package names.

### 7.2 OCaml

Extensions: `.ml`, `.mli`

The adapter recognizes top-level:

- `module` and `module type` declarations;
- `type`, `exception`, `external`, `class`, and `class type` declarations;
- `val` declarations; and
- named `let` bindings, including operator names.

Declarations inside an explicit `struct ... end` or `sig ... end` module are
children of that module when nesting can be recovered. Functor declarations keep
their declared module name and may include a shortened signature.

An `.mli` declaration is public unless syntax says otherwise. In `.ml`, top-level
declarations have `unknown` visibility because an unseen interface may restrict
them; they appear at `public` and `all`. Local bindings inside expression-level
`let` constructs are not indexed.

### 7.3 Elixir

Extensions: `.ex`, `.exs`

The adapter recognizes:

- `defmodule`, `defprotocol`, and `defimpl` containers;
- public `def`, `defmacro`, and `defdelegate` declarations;
- private `defp`, `defmacrop`, and `defguardp` declarations at `all`;
- public `defguard` declarations;
- `@type`, `@typep`, `@opaque`, `@callback`, and `@macrocallback`
  declarations; and
- function name and arity for ordinary heads, including multiple clauses
  collapsed into one declaration.

Default arguments contribute to the callable arities when they can be recovered;
tree output may use a compact form such as `fetch/1,2`. Generated functions and
declarations hidden inside arbitrary macros are outside v0.1.

`defimpl Protocol, for: Type` is displayed as `Protocol for Type` when both names
can be recovered.

## 8. Documentation peeking

`--peek` extracts documentation only; it never executes code or expands macros.
The selected text is normalized by:

1. removing comment delimiters and conventional decoration such as a leading
   `*`;
2. dedenting by common whitespace;
3. trimming leading and trailing blank lines;
4. collapsing internal whitespace only when required for a one-line tree label;
5. rendering at most `--peek-lines`; and
6. adding `…` when nonblank content was truncated.

The preferred documentation source is:

| Language | Precedence |
| --- | --- |
| TypeScript/JavaScript | leading `/** ... */`, then a leading contiguous `//` block, then `/* ... */` |
| OCaml | leading `(** ... *)`, then `(* ... *)` |
| Elixir | the containing module's literal `@moduledoc`, then a leading `#` block |

A UTF-8 BOM, shebang, blank lines, and language pragmas that cannot carry prose
may occur before the documentation block. License banners are not automatically
distinguished from documentation in v0.1.

Only file/module documentation is shown in tree mode in v0.1. Declaration-level
documentation may be captured in the shared model and JSON but does not expand
the default tree.

Dynamic Elixir moduledocs (for example, function calls or interpolation that
cannot be read as a literal) are omitted with no evaluation.

## 9. Tree output

Tree output uses UTF-8 connectors unless `--ascii` is set. A source file is a
filesystem node. Its documentation and declarations are child nodes. Nested
module declarations own their direct declarations.

Example:

```text
lib/
├── cache.ts
│   │ An effectful cache with explicit lifetime management.
│   ├── type Cache
│   ├── make
│   ├── get
│   └── set
├── parser.mli
│   ├── module Token
│   ├── type error
│   └── val parse
└── accounts.ex
    └── Accounts
        ├── type user
        ├── create_user/1
        └── fetch_user/1
```

Kind labels are included when they disambiguate structure (`module`, `type`,
`class`, `val`) and may be omitted for ordinary functions and values. The output
must not depend on terminal width in v0.1; renderers truncate only according to
explicit limits.

Diagnostics go to standard error in tree mode and include the path. Normal tree
output goes to standard output.

## 10. JSON output

JSON output is a single UTF-8 object with this top-level shape:

```json
{
  "schemaVersion": 1,
  "roots": [],
  "diagnostics": []
}
```

Filesystem nodes contain `type` (`directory`, `file`, or `symlink`), `name`,
`path`, and `children` where applicable. File nodes additionally contain
`language`, `documentation`, `declarations`, and file-local `diagnostics` using
the model in section 5.

Paths are slash-separated and relative to the current working directory when
possible. Explicit roots outside it use normalized absolute paths. Optional or
unknown scalar fields are emitted as `null`, not omitted. Arrays are always
present. This makes the schema convenient for agents without losing the
distinction between empty and unknown values.

JSON output contains no ANSI escapes and no separate progress messages. Fatal or
root-level diagnostics are present in the JSON object as well as determining the
exit status.

## 11. Diagnostics and exit status

| Code | Meaning |
| --- | --- |
| `0` | All explicit roots were inspected; recoverable parse diagnostics may exist. |
| `1` | At least one failure prevented useful inspection of part of a root. |
| `2` | Command-line usage error. |

When multiple roots produce different outcomes, the highest exit code wins.
Broken pipes terminate quietly with success, following normal Unix pipeline
behavior.

## 12. Architecture constraints

The implementation should favor pure transformations and explicit data:

- discovery yields filesystem entries;
- extension classification selects an adapter;
- adapters return the shared model without printing;
- filters transform model trees without reparsing; and
- renderers consume only filtered model trees.

Language adapters must be independently testable with source strings. Filesystem
discovery must be independently testable with temporary fixtures. The tree and
JSON renderers must be snapshot-testable from in-memory model values.

No adapter may invoke a compiler, execute project code, install dependencies, or
access the network. Version 0.1 should avoid native parser dependencies unless a
handwritten tolerant scanner proves materially unreliable against the acceptance
fixtures.

## 13. Acceptance criteria

Version 0.1 is complete when:

1. `module-ls` and `mls` behave identically.
2. Running with no arguments inspects the current directory.
3. Fixtures for all three adapter families produce the expected nested modules
   and public declarations.
4. `--symbols modules|public|all` changes output as specified.
5. `--peek` extracts, normalizes, limits, and truncates each supported comment
   style without executing source.
6. Hidden, ignored, oversized, unreadable, symlinked, empty, and explicitly
   passed paths have tests.
7. Tree output is deterministic and has ASCII and no-color coverage.
8. JSON output validates against checked-in schema-version-1 fixtures.
9. Partial parse failures preserve recovered declarations and emit diagnostics.
10. Piping into a command that closes early does not print a stack trace.
11. The CLI performs no writes inside the inspected project.
12. README examples are exercised as integration tests or generated from tested
    fixtures to prevent drift.

## 14. Deferred decisions

The following are intentionally deferred until after v0.1:

- additional languages and user-defined adapters;
- configuration files and custom ignore patterns;
- import, dependency, call, or type relationship graphs;
- declaration-doc expansion in tree output;
- watch mode, caching, and editor or MCP integrations;
- Markdown and other renderers; and
- merging `.mli` and `.ml` or re-exported TypeScript declarations across files.

These features should be evaluated against the core constraint: `module-ls` must
remain a fast way to understand where useful code lives, not become a second
language server.
