# Sprint 9 — Adapter DOM 实现 + 集成测试

## TASK-009: Runway DOM 选择器真实实现

**负责人**: Claude  
**优先级**: P0  
**依赖**: Sprint 4, 8 完成

### 描述

当前 `RunwayAdapter` 中的 DOM 选择器都是 TODO 占位。本 Sprint 需要：
1. 在 Runway 网页上找到真实的选择器
2. 实现可工作的 selectModel / fillPrompt / clickGenerate / checkStatus
3. 添加超时和错误处理
4. 编写集成测试

### 当前问题

```typescript
// src/adapters/runway.adapter.ts 当前状态
async selectModel(modelId: string): Promise<void> {
  // TODO: 需要确认 Runway 页面上的模型选择器 DOM 结构
  await this.browserView.webContents.executeJavaScript(`
    // 这是占位代码，需要替换为真实选择器
  `);
}
```

### 实现要求

#### 1. DOM 选择器配置化

创建 `src/adapters/runway.selectors.ts`，集中管理所有 CSS 选择器：

```typescript
export const RUNWAY_SELECTORS = {
  modelDropdown: '',    // 模型下拉按钮
  modelOption: (id: string) => ``,  // 模型选项
  promptInput: '',      // Prompt 输入框
  generateButton: '',   // 生成按钮
  statusIndicator: '',  // 状态指示器
  resultVideo: '',      // 结果视频元素
} as const;
```

#### 2. 每个操作添加超时

```typescript
const ADAPTER_TIMEOUT = 30_000; // 30 秒

async selectModel(modelId: string): Promise<void> {
  await this.executeWithTimeout(async () => {
    // 实际实现
  }, ADAPTER_TIMEOUT, `selectModel(${modelId}) timeout`);
}
```

#### 3. 集成测试

创建 `tests/adapters/runway.adapter.test.ts`：

```typescript
// 使用 mock BrowserView 测试
describe('RunwayAdapter', () => {
  it('selectModel should execute correct JavaScript', () => {});
  it('fillPrompt should execute correct JavaScript', () => {});
  it('clickGenerate should execute correct JavaScript', () => {});
  it('should timeout after 30s', () => {});
});
```

### 验收标准

- [ ] `runway.selectors.ts` 文件创建，选择器集中管理
- [ ] 在 Runway 页面上 selectModel 可工作
- [ ] 在 Runway 页面上 fillPrompt 可工作
- [ ] 在 Runway 页面上 clickGenerate 可工作
- [ ] checkStatus 可正确检测生成状态
- [ ] 超时 30s 后返回明确错误
- [ ] 集成测试通过 (`npm test`)
- [ ] 选择器变更时只需修改 `runway.selectors.ts`

### 注意事项

- Runway 网页是 React SPA，选择器可能随版本变化
- 使用 `data-testid` 或 `aria-label` 优于 class 选择器（更稳定）
- `executeJavaScript` 返回的 Promise 需要正确处理
- 页面元素可能需要等待渲染（添加 `waitForSelector` 逻辑）

### Claude 实现指令

```
实现 Sprint 9: Runway Adapter DOM 真实实现

背景：
- src/adapters/runway.adapter.ts 中的 DOM 选择器当前是 TODO 占位
- 需要在真实 Runway 页面上找到正确的 CSS 选择器

要求：
1. 创建 src/adapters/runway.selectors.ts，集中定义所有 DOM 选择器
2. 每个 Adapter 方法添加 30s 超时（用 Promise.race）
3. selectModel: 点击模型下拉 → 选择对应模型
4. fillPrompt: 找到 prompt textarea/input → 填入文本
5. clickGenerate: 找到生成按钮 → 点击
6. checkStatus: 轮询页面状态指示器
7. waitForCompletion: 已有轮询逻辑，保持并增强

DOM 查找方式建议：
- 在 BrowserView 中打开 Runway → 用 DevTools 检查元素
- 优先使用 aria-label / data-testid / placeholder 属性
- 避免使用动态生成的 class 名（CSS Modules 会变化）

测试：
- 创建 tests/ 目录
- 用 vitest + mock BrowserView 写集成测试
- 覆盖 happy path 和 timeout 路径
```
