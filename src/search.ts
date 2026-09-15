import type { ExplorerSnapshot, SearchResult } from "./model.js"

const score = (query: string, value: string): number => {
  const normalized = value.toLowerCase()
  if (normalized === query) return 100
  if (normalized.startsWith(query)) return 80 - normalized.length / 1_000
  const name = normalized.split("/").at(-1) ?? normalized
  if (name.startsWith(query)) return 70 - name.length / 1_000
  const index = normalized.indexOf(query)
  return index < 0 ? -1 : 50 - index / 100 - normalized.length / 10_000
}

export const searchSnapshot = (
  snapshot: ExplorerSnapshot,
  input: string,
  limit = 50
): ReadonlyArray<SearchResult> => {
  const query = input.trim().toLowerCase()
  if (query === "") return []
  return snapshot.files.flatMap((file): ReadonlyArray<SearchResult> => {
    const fileScore = Math.max(score(query, file.path), score(query, file.documentation ?? ""))
    const fileResult: ReadonlyArray<SearchResult> = fileScore < 0 ? [] : [{
      type: "file",
      path: file.path,
      label: file.path,
      detail: file.documentation,
      symbol: null,
      range: null,
      score: fileScore
    }]
    return [
      ...fileResult,
      ...file.declarations.flatMap((declaration): ReadonlyArray<SearchResult> => {
        const symbolScore = Math.max(
          score(query, declaration.qualifiedName),
          score(query, declaration.documentation ?? "")
        )
        return symbolScore < 0 ? [] : [{
          type: "symbol",
          path: file.path,
          label: declaration.qualifiedName,
          detail: declaration.signature,
          symbol: declaration.qualifiedName,
          range: declaration.range,
          score: symbolScore + 5
        }]
      })
    ]
  }).sort((left, right) => right.score - left.score || left.label.localeCompare(right.label)).slice(0, limit)
}
