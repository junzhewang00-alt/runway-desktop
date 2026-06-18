# Sprint 7 — 模型管理

## TASK-007: modelCaps 配置

**负责人**: Claude  
**优先级**: P1  
**依赖**: Sprint 4 完成（Adapter 接口就绪）

### 描述

定义配置驱动的模型能力表，禁止硬编码到 UI。

### 验收标准

- [ ] `MODEL_CAPS` 配置对象定义完整
- [ ] 包含: Gen-4, Aleph, Seedance 2
- [ ] 新增模型只需修改配置
- [ ] `ModelService.getModels()` 方法
- [ ] `ModelService.getModel(id)` 方法

### 配置结构

```typescript
interface ModelCapability {
  id: string;
  name: string;
  maxPromptLength: number;
  supportsTextToVideo: boolean;
  supportsImageToVideo: boolean;
  maxDuration: number;       // 秒
  supportedResolutions: string[];
}

const MODEL_CAPS: Record<string, ModelCapability> = {
  'gen-4': {
    id: 'gen-4',
    name: 'Gen-4',
    maxPromptLength: 500,
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    maxDuration: 10,
    supportedResolutions: ['1280x768', '768x1280'],
  },
  'aleph': {
    id: 'aleph',
    name: 'Aleph',
    maxPromptLength: 300,
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    maxDuration: 10,
    supportedResolutions: ['1280x768', '768x1280'],
  },
  'seedance-2': {
    id: 'seedance-2',
    name: 'Seedance 2',
    maxPromptLength: 400,
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    maxDuration: 10,
    supportedResolutions: ['1280x768', '768x1280'],
  },
};
```

### Claude 实现指令

```
实现 modelCaps.ts

要求：
- 配置驱动，ModelCapability 接口
- 包含 Gen-4, Aleph, Seedance 2
- 提供 ModelService 查询方法
- 禁止在 UI 组件中硬编码模型名称
- UI 通过 ModelService.getModels() 获取列表

注意：
- Runway 模型名称可能随官方更新变化，做好配置隔离
```
