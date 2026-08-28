# module-ls

`module-ls` is `ls` for understanding a codebase.

Instead of stopping at filenames, it renders a small, language-aware tree of the
modules and public symbols inside a directory. An optional peek mode adds each
file's opening documentation block, turning an unfamiliar repository into
roaming documentation for humans and coding agents.

> [!NOTE]
> `module-ls` is currently in the design stage. The interface below describes
> the first release; implementation is the next milestone.

## The idea

Given a project like this:

```text
src/
├── cache.ts
├── parser.ml
└── accounts.ex
```

`module-ls src` will make its shape visible without opening every file:

```text
src/
├── cache.ts
│   ├── type Cache
│   ├── make
│   ├── get
│   └── set
├── parser.ml
│   ├── module Token
│   ├── type error
│   ├── parse
│   └── parse_many
└── accounts.ex
    └── Accounts
        ├── create_user/1
        └── fetch_user/1
```

With `--peek`, the same tree includes the leading comment or module
documentation for each source file:

```text
$ module-ls src --peek
src/
└── cache.ts
    │ A small, effectful cache with explicit lifetime management.
    ├── type Cache
    ├── make
    ├── get
    └── set
```

The initial language adapters target codebases with strong module conventions:

- TypeScript and JavaScript, including Effect-style functional modules
- OCaml interfaces and implementations
- Elixir modules, protocols, implementations, and public functions

## Planned command

```text
module-ls [path ...] [options]
```

The short alias will be `mls`.

```text
module-ls .                 # summarize the current directory
module-ls lib src           # inspect multiple roots
module-ls . --peek          # include opening documentation
module-ls . --depth 2       # limit directory traversal
module-ls . --symbols modules
module-ls . --format json   # structured output for tools and agents
```

The default view is deliberately compact: directories, recognized source
files, modules, and public symbols. It respects ignore files, does not require a
project to compile, and produces stable output suitable for prompts, issue
reports, and repository exploration.

## Principles

- **Useful at a glance.** The default output should fit the way people actually
  scan a terminal.
- **Language-aware, not compiler-dependent.** A broken or partially checked-out
  project should still be inspectable.
- **Functional at the edges.** Discovery, parsing, filtering, and rendering are
  small composable stages so language support can grow without one universal
  parser.
- **Predictable for agents.** Ordering is deterministic and JSON output has a
  versioned schema.
- **Quiet about noise.** Build products, dependency trees, generated files, and
  private implementation details stay out of the default view.

## Scope

The behavior proposed for the first release is specified in [SPEC.md](SPEC.md).
That document is the source of truth for CLI semantics, language adapters,
output shape, and acceptance criteria.

## License

No license has been selected yet.
