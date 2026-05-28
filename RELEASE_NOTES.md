# Kimix v2.8.73 Release Notes

## 重大更新

### 前端架构重构
- 从 `App.tsx` 提取 9 个自定义 Hooks，彻底解耦业务逻辑与 UI 渲染
- 将 `AppShell.tsx`（3069 行）拆分为专注子组件：`TopMenuBar`、`SessionToolbar`、`DialogSystem`、`ToastSystem`、`ResizeHandle`、`LongTaskInspectorPanel`、`DiffPanel`
- 新增 Zustand 选择器与派生 Hooks（`useLiveSession`、`useSessionDiffs`），消除过度订阅导致的重渲染
- 引入 Vitest 测试基础设施，为核心工具函数建立单元测试防护网

### 视觉设计系统（Phase 5）
- 建立统一的 "Warm Paper Editorial + Blue Precision" 设计 Token 体系
- 纸张底色 `#F5F2EB` + 明亮蓝 `#1982ff` + 暖栗 `#B85C38` 配色方案
- 引入霞鹜文楷界面字体 + JetBrains Mono 代码字体
- 核心组件全面视觉升级：`Composer`、`MessageBubble`、`Sidebar`、`ChatThread`、`SettingsPanel`
- 完整深色模式映射，对比度与质感全面优化

### 设置面板修复
- 统一所有卡片背景色，消除深浅不一的混乱
- 修复两列布局：采用独立 Flex 双列，避免 Grid 拉伸导致的错位
- 标题行统一高度（36px）+ 垂直居中，含右侧按钮时也对齐

### Kimi Agent Tracing Visualizer 集成
- 套餐用量面板新增「使用详情」按钮
- 自动检测并启动 `kimi vis --no-open`，3 秒后自动打开浏览器
- Windows 兼容的 `spawn` 实现（`detached: true` + `stdio: "ignore"`）
- Toast 实时反馈启动和打开状态

### 其他改进
- 前景面板颜色提亮，与背景形成更清晰的视觉层次
- 轮次通知与变更卡片渲染优化

## 验证

- 已通过 `pnpm build` 和 `pnpm test:run`
- 发布产物由 GitHub Actions 自动构建和发布，请以 CI 产物为准
