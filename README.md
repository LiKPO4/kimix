# Kimix

A Codex-style desktop UI for [Kimi Code CLI](https://github.com/moonshot-ai/kimi-code).

![License](https://img.shields.io/badge/license-MIT-blue.svg)

## Features

- 🎯 **Project-aware coding assistant** — Open any local project and chat with Kimi in context
- 💬 **Real-time streaming** — See AI responses appear token-by-token
- 📝 **Markdown rendering** — Syntax highlighting, tables, code blocks, and diff viewers
- 🔒 **Permission controls** — Manual approval, session-level allow, or full access (Yolo)
- 🗂️ **Session management** — Persistent chat history per project
- 🌓 **Theme support** — Light / dark / system theme
- ⌨️ **Keyboard shortcuts** — `Cmd/Ctrl+B` sidebar, `Cmd/Ctrl+K` focus input, `Esc` stop generation
- 📤 **Export chats** — Download conversation as Markdown

## Download

Get the latest release from [GitHub Releases](https://github.com/LiKPO4/kimix/releases).

| Platform | Installer | Portable |
|----------|-----------|----------|
| Windows | `.exe` (NSIS) | `.exe` |
| macOS | `.dmg` | `.zip` |
| Linux | `.deb` | `.AppImage` |

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/) 9+
- [Kimi CLI](https://github.com/moonshot-ai/kimi-code) installed and authenticated

### Setup

```bash
pnpm install
```

### Run in development

```bash
pnpm dev
```

### Build for production

```bash
pnpm build
```

### Package installers

```bash
# Windows
pnpm dist:win

# macOS
pnpm dist:mac

# Linux
pnpm dist:linux

# All platforms
pnpm dist
```

## Tech Stack

- **Framework**: Electron + Vite
- **Frontend**: React 19 + TypeScript + Tailwind CSS
- **State**: Zustand
- **Markdown**: react-markdown + remark-gfm + highlight.js
- **Packaging**: electron-builder

## Architecture

```
kimix/
├── electron/           # Main process
│   ├── main.ts         # Entry point, IPC handlers
│   ├── preload.ts      # Context bridge API
│   ├── kimiBridge.ts   # Kimi SDK integration
│   ├── projectService.ts
│   └── settingsService.ts
├── src/                # Renderer process
│   ├── components/     # React UI components
│   ├── stores/         # Zustand state stores
│   ├── utils/          # Event mapper, helpers
│   └── main.tsx        # Renderer entry
└── build/              # App icons & resources
```

## License

MIT
