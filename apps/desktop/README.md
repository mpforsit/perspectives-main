# @perspectives/desktop

The Electron desktop application — packages the React UI with an in-process engine and runs against a local SQLite metadata store. Runs the same engine code as the server, so behavior is identical across distribution modes.

## Develop

From the workspace root:

```sh
pnpm dev          # launches the Electron window with HMR (delegates to this package)
```

Or directly:

```sh
pnpm --filter desktop dev
pnpm --filter desktop build    # electron-vite build + electron-builder
```

`pnpm dev` starts `electron-vite dev`: Vite serves the renderer with HMR, main and preload are watched and the Electron process restarts on changes. Build output lands under `out/`; packaged installers under `release/`.

## Layout

```
apps/desktop/
├── src/
│   ├── main/      # Electron main process (Node)
│   ├── preload/   # Sandboxed preload script (empty for now)
│   └── renderer/  # React + Vite app
│       ├── index.html
│       └── src/
│           ├── App.tsx
│           ├── main.tsx
│           ├── components/ui/   # shadcn/ui components (button, card, typography)
│           ├── lib/utils.ts
│           └── styles/globals.css
├── electron.vite.config.ts
├── electron-builder.json
├── tailwind.config.ts
├── postcss.config.cjs
├── components.json              # shadcn/ui CLI config
└── tsconfig.json
```

The renderer never sees Node, the filesystem, or database credentials. The preload script will eventually expose a typed tRPC bridge to the main process; nothing is exposed today.
