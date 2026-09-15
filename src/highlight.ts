import { Effect } from "effect"
import { createHighlighter } from "shiki"

import type { HighlightedToken } from "./model.js"

const languages = ["typescript", "tsx", "javascript", "jsx", "json"] as const
const themes = ["github-light", "github-dark"] as const

let highlighter: ReturnType<typeof createHighlighter> | undefined

const getHighlighter = () => highlighter ??= createHighlighter({
  langs: [...languages],
  themes: [...themes]
})

const languageFor = (path: string): typeof languages[number] => {
  const lower = path.toLowerCase()
  if (lower.endsWith(".tsx")) return "tsx"
  if (lower.endsWith(".jsx")) return "jsx"
  if (lower.endsWith(".json")) return "json"
  if (/\.[cm]?js$/u.test(lower)) return "javascript"
  return "typescript"
}

export const highlightSource = (
  source: string,
  path: string
): Effect.Effect<ReadonlyArray<ReadonlyArray<HighlightedToken>>, Error> =>
  Effect.tryPromise({
    try: async () => {
      const instance = await getHighlighter()
      const light = instance.codeToTokens(source, {
        lang: languageFor(path),
        theme: "github-light"
      })
      const dark = instance.codeToTokens(source, {
        lang: languageFor(path),
        theme: "github-dark"
      })
      return light.tokens.map((line, lineIndex) => line.map((token, tokenIndex) => ({
        content: token.content,
        start: token.offset,
        end: token.offset + token.content.length,
        color: token.color ?? null,
        darkColor: dark.tokens[lineIndex]?.[tokenIndex]?.color ?? null,
        fontStyle: token.fontStyle ?? null
      })))
    },
    catch: (cause) => cause instanceof Error ? cause : new Error(String(cause))
  })
