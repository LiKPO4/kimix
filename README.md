# Kimix

Kimix 是一个 Codex 风格的 Kimi Code 桌面界面，基于 [Kimi Code CLI](https://github.com/moonshot-ai/kimi-code) 构建。

![许可证](https://img.shields.io/badge/license-MIT-blue.svg)

## 功能特性

- **项目感知的编码助手**：打开任意本地项目，在项目上下文中与 Kimi 对话。
- **实时流式回复**：模型回复会逐步显示，方便观察当前执行进度。
- **Markdown 渲染**：支持语法高亮、表格、代码块、文件卡片和变更信息展示。
- **权限控制**：支持手动批准、会话级允许和完全访问模式。
- **会话管理**：按项目保存历史对话，方便继续之前的工作。
- **图片消息**：支持粘贴、拖拽、发送图片，并在对话中显示缩略图和预览。
- **搜索与 Skill**：可搜索对话、思考、命令等内容，并管理本地 Skill 启用状态。
- **主题支持**：支持浅色、深色和跟随系统主题。
- **快捷键**：支持 `Cmd/Ctrl+B` 切换侧栏、`Cmd/Ctrl+K` 聚焦输入框、`Esc` 停止生成。
- **导出对话**：可将会话导出为 Markdown。

## 下载

请在 [GitHub Releases](https://github.com/LiKPO4/kimix/releases) 下载最新版本。

| 平台 | 安装包 | 便携版 |
| --- | --- | --- |
| Windows | `.exe`（NSIS 安装器） | `.exe` |
| macOS | `.dmg` | `.zip` |
| Linux | `.deb` | `.AppImage` |

## 开发

### 环境要求

- [Node.js](https://nodejs.org/) 22 或更高版本
- [pnpm](https://pnpm.io/) 9 或更高版本
- 已安装并登录 [Kimi Code CLI](https://github.com/moonshot-ai/kimi-code)

### 安装依赖

```bash
pnpm install
```

### 启动开发环境

```bash
pnpm dev
```

### 构建生产版本

```bash
pnpm build
```

### 打包安装包

```bash
# Windows
pnpm dist:win

# macOS
pnpm dist:mac

# Linux
pnpm dist:linux

# 全平台
pnpm dist
```

## 技术栈

- **应用框架**：Electron + Vite
- **前端**：React 19 + TypeScript + Tailwind CSS
- **状态管理**：Zustand
- **Markdown**：react-markdown + remark-gfm + highlight.js
- **打包发布**：electron-builder

## 项目结构

```text
kimix/
├── electron/           # Electron 主进程
│   ├── main.ts         # 入口文件和 IPC 处理
│   ├── preload.ts      # Context Bridge API
│   ├── kimiBridge.ts   # Kimi SDK 集成
│   ├── projectService.ts
│   └── settingsService.ts
├── src/                # 渲染进程
│   ├── components/     # React UI 组件
│   ├── stores/         # Zustand 状态
│   ├── utils/          # 事件映射和工具函数
│   └── main.tsx        # 渲染进程入口
└── build/              # 应用图标和资源
```

## 许可证

MIT
