import { Walkthrough } from "../src/walkthrough.js"

export const annotatedSourceWalkthrough = Walkthrough
  .make("annotated-source-pipeline-dsl", {
    title: "From repository source to an annotated code view",
    summary: "The programmatic form is built from the same Effect Schema contract.",
    audience: ["library authors", "coding agents"]
  })
  .add(
    Walkthrough.step("contract", {
      kind: "orientation",
      title: "Start with the wire contract",
      body: "Every renderer consumes one versioned AnnotatedSource value.",
      target: Walkthrough.target("src/model.ts", {
        symbol: "AnnotatedSourceSchema",
        highlight: ["lines", "hovers", "definitions"]
      })
    }),
    Walkthrough.step("pipeline", {
      title: "Combine syntax and semantics",
      body: "Selection, Shiki, and TypeScript meet at a small orchestration boundary.",
      target: Walkthrough.target("src/annotation.ts", { symbol: "annotateSource" })
    })
  )

export default annotatedSourceWalkthrough
