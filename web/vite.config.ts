import { foldkit } from "@foldkit/vite-plugin"
import stylex from "@stylexjs/unplugin"
import { defineConfig } from "vite"

type StylexViteOptions = NonNullable<Parameters<typeof stylex.vite>[0]> & {
  readonly externalPackages: ReadonlyArray<string>
}

const stylexOptions: StylexViteOptions = {
  externalPackages: ["@foldworks/ui"]
}

export default defineConfig({
  plugins: [
    stylex.vite(stylexOptions),
    foldkit({ devToolsMcpPort: 9988 })
  ],
  build: {
    outDir: "../dist/web",
    emptyOutDir: false
  },
  optimizeDeps: {
    entries: ["src/entry.ts"]
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:4310"
    }
  }
})
