import { Runtime } from "foldkit"

import "./reset.css"
import { Message, Model, init, update, view } from "./main.js"

if (import.meta.env.DEV) void import("virtual:stylex:runtime")

const application = Runtime.makeApplication({
  Model,
  init,
  update,
  view,
  container: document.getElementById("root"),
  routing: {
    onUrlRequest: (request) => Message.ClickedLink({ request }),
    onUrlChange: (url) => Message.ChangedUrl({ url })
  },
  devTools: { Message }
})

Runtime.run(application)
