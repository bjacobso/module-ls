# module-ls

`module-ls` is `ls` for understanding JavaScript and TypeScript codebases.

It renders the filesystem and the public API in one compact tree. An optional
peek mode includes each file's opening documentation block, so a directory can
act as roaming documentation for humans and coding agents.

```text
$ module-ls test/fixtures/sample --peek --color never
sample/
├── nested/
│   └── index.ts
│       └── namespace Nested
│           └── visible
└── src/
    ├── cache.ts
    │   ├── │ A tiny cache module.
    │   ├── │ It demonstrates Effect-style exported combinators.
    │   ├── interface Cache
    │   ├── make
    │   ├── get
    │   └── namespace Metrics
    │       └── hit(name)
    └── math.js
        ├── │ CommonJS arithmetic helpers.
        ├── add
        └── subtract
```

This repository contains a working v0.1 prototype. It is not published to npm.

## Why

File trees answer “where is it?” API extractors answer “what is exported?”
`module-ls` answers both without requiring the project to build.

It is particularly useful for functional modules where a file exports types,
constructors, guards, and small combinators rather than one primary class. It
does not special-case Effect; Effect-style TypeScript naturally produces useful
output.

## Try it

Node.js 20 or newer and pnpm are required for development.

```sh
pnpm install
pnpm dev .
pnpm dev src --peek
pnpm check
```

Build the installable commands:

```sh
pnpm build
node dist/cli.js src
pnpm link --global
module-ls src
mls src
```

`module-ls` and `mls` are equivalent bins.

## Usage

```text
module-ls [options] [path ...]
```

With no path, the current directory is inspected. Files and multiple roots are
accepted.

```text
module-ls .
module-ls lib src
module-ls src --peek
module-ls src --peek-lines 1
module-ls src --depth 2
module-ls src --symbols modules
module-ls src --symbols all
module-ls src --format json
module-ls src --ascii --color never
```

Important options:

| Option | Purpose | Default |
| --- | --- | --- |
| `--peek` | Show leading file documentation. | off |
| `--peek-lines <n>` | Limit documentation lines and imply `--peek`. | `3` |
| `--depth <n>` | Limit traversal below each root. | unlimited |
| `--symbols <level>` | Show `modules`, `public`, or `all` declarations. | `public` |
| `--format <format>` | Produce `tree` or `json`. | `tree` |
| `--hidden` | Include hidden entries. | off |
| `--no-ignore` | Disable root `.gitignore` and built-in ignores. | off |
| `--ascii` | Use ASCII tree connectors. | off |
| `--color <when>` | Use color `auto`, `always`, or `never`. | `auto` |

Effect CLI also provides `--help`, `--version`, shell completions, log-level
control, and wizard mode. `NO_COLOR` is honored in automatic color mode.

## What it understands

Supported extensions:

```text
.ts .tsx .mts .cts .js .jsx .mjs .cjs
```

The ts-morph adapter recognizes:

- exported functions, variables, classes, interfaces, types, and enums;
- TypeScript namespaces and ambient modules, including direct children;
- default exports and named or star re-exports;
- public declarations in `.d.ts` files;
- private top-level declarations with `--symbols all`; and
- common CommonJS assignments such as `exports.name = value`,
  `module.exports.name = value`, and `module.exports = { name }`.

The analyzer is intentionally shallow. It does not list class members,
function-local bindings, inferred types, imports, dependencies, or call graphs.

## Peek mode

Peek mode reads the first JSDoc, block comment, or contiguous line-comment block
after an optional BOM, shebang, or triple-slash reference directive.

Comment markers are removed, indentation is normalized, blank lines are omitted
from tree output, and truncation is explicit:

```text
cache.ts
├── │ A tiny cache module. …
├── interface Cache
└── make
```

Source is parsed only. Project code is never evaluated.

## Agent output

`--format json` emits a single schema-versioned object without ANSI escapes:

```json
{
  "schemaVersion": 1,
  "roots": [],
  "diagnostics": []
}
```

The complete recursive contract is exported as `ModuleLsOutputSchema` from the
package. Other schemas, `inspect`, discovery, analysis, and render functions are
also exported for programmatic use.

## Architecture

The implementation uses Effect through every side-effecting boundary:

```text
@effect/cli
    ↓
Effect Schema options
    ↓
@effect/platform discovery ──→ in-memory ts-morph Project
    ↓                              ↓
shared Schema model ←──────── declarations and docs
    ↓
tree or JSON renderer
    ↓
Platform Terminal ──→ NodeRuntime.runMain
```

Filesystem access comes from `FileSystem` and `Path`; terminal capabilities come
from `Terminal`; failures use tagged Effect errors; and JSON is encoded through
the same Effect Schema exposed to consumers. ts-morph receives source strings in
an in-memory project and does not perform its own filesystem traversal.

The pipeline remains composable:

```text
paths -> discover -> analyze -> filter -> render
```

## Prototype boundaries

- Only JavaScript and TypeScript are indexed.
- The explicit root `.gitignore` is applied; nested `.gitignore` files are not
  yet layered.
- Files larger than 1 MiB are listed with a diagnostic but not parsed.
- Symlinks are shown as leaves and never followed.
- tsconfig-based module resolution and cross-file type analysis are not used.
- The package is currently unlicensed and unpublished.

The implemented contract and remaining decisions are detailed in
[SPEC.md](SPEC.md).

## License

No license has been selected yet.
