# Sprint 4 — Runway Adapter

## TASK-004: RunwayAdapter 接口定义

**负责人**: Claude  
**优先级**: P0  
**依赖**: Sprint 2 完成

### 描述

定义 Runway 操作的抽象接口，后续所有 Runway 交互必须通过此 Adapter。

### 验收标准

- [ ] `IRunwayAdapter` 接口定义完整
- [ ] 实现类可通过构造函数注入 BrowserView 引用
- [ ] 方法体为空实现（骨架）
- [ ] 不对 UI 暴露任何 DOM 操作

### 接口定义

```typescript
interface IRunwayAdapter {
  selectModel(modelId: string): Promise<void>;
  fillPrompt(prompt: string): Promise<void>;
  clickGenerate(): Promise<void>;
  checkStatus(): Promise<GenerationStatus>;
  waitForCompletion(): Promise<GenerationResult>;
}

type GenerationStatus = 'idle' | 'generating' | 'completed' | 'failed';

interface GenerationResult {
  status: GenerationStatus;
  videoUrl?: string;
  error?: string;
}
```

### Claude 实现指令

```
实现 RunwayAdapter

要求：
- 只实现接口和空方法
- 通过依赖注入接收 BrowserView 引用
- 每个方法内加 TODO 注释标注后续实现方式
- 不要直接耦合 UI
- 不要包含 document.querySelector 等 DOM 操作（那是后续 Sprint 的事）

设计原则：
- Adapter 是唯一能与 Runway 网页交互的模块
- 使用 executeJavaScript 与 BrowserView 通信
```
