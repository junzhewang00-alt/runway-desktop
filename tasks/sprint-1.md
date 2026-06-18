# Sprint 1 — Electron 基础框架

## TASK-001: Electron 项目初始化

**负责人**: Claude  
**优先级**: P0  
**预估**: 1 sprint

### 描述

使用 electron-vite 初始化 Electron + React + TypeScript 项目骨架。

### 验收标准

- [x] Vite 构建成功
- [x] Electron 主进程启动
- [x] React 渲染进程启动
- [x] TypeScript 严格模式无错误
- [x] `npm run dev` 一键启动

### 技术约束

- 使用 `electron-vite` 脚手架（非手动配置 webpack）
- React 18
- TypeScript strict mode
- 不写任何业务代码（空壳即可）

### 文件清单

```
src/main/index.ts          # Electron 主进程入口
src/preload/index.ts       # Preload 脚本
src/renderer/App.tsx       # React 根组件
src/renderer/main.tsx      # React 入口
package.json               # 依赖和脚本
tsconfig.json              # TypeScript 配置
electron.vite.config.ts    # electron-vite 配置
```

### Claude 实现指令

```
实现 Electron + React + TypeScript 项目初始化

要求：
- 使用 electron-vite 脚手架
- Vite 构建
- TypeScript strict 模式
- React 18
- 不要写业务代码
- 只创建项目骨架，确保能启动
```
