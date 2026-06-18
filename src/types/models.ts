// ==========================================
// 模型相关类型定义
// ==========================================

/** 模型能力描述 */
export interface ModelCapability {
  id: string
  name: string
  maxPromptLength: number
  supportsTextToVideo: boolean
  supportsImageToVideo: boolean
  /** 参考图最大数量 */
  maxImages: number
  /** 可选时长列表（秒） */
  durations: number[]
  defaultDuration: number
  /** 可选分辨率列表 */
  resolutions: string[]
  defaultResolution: string
  /** 可选画面比例列表 */
  aspectRatios: string[]
  defaultAspectRatio: string
}

/** 模型能力配置表（配置驱动，禁止硬编码到 UI）
 *  同步自 ai-script-analyzer/runway_config.py MODEL_CAPS */
export const MODEL_CAPS: Record<string, ModelCapability> = {
  'seedance-2': {
    id: 'seedance-2',
    name: 'Seedance 2.0',
    maxPromptLength: 400,
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    maxImages: 9,
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 5,
    resolutions: ['480p', '720p'],
    defaultResolution: '720p',
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    defaultAspectRatio: '16:9',
  },
  'seedance2.0Fast': {
    id: 'seedance2.0Fast',
    name: 'Seedance 2.0 Fast',
    maxPromptLength: 400,
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    maxImages: 9,
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 5,
    resolutions: ['480p', '720p'],
    defaultResolution: '720p',
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    defaultAspectRatio: '16:9',
  },
  'gen-4.5': {
    id: 'gen-4.5',
    name: 'Gen-4.5',
    maxPromptLength: 500,
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    maxImages: 5,
    durations: [2, 3, 4, 5, 6, 7, 8, 9, 10],
    defaultDuration: 6,
    resolutions: ['720p', '1080p', '2K'],
    defaultResolution: '1080p',
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    defaultAspectRatio: '16:9',
  },
  'gen-4': {
    id: 'gen-4',
    name: 'Gen-4',
    maxPromptLength: 500,
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    maxImages: 5,
    durations: [2, 3, 4, 5, 6, 7, 8, 9, 10],
    defaultDuration: 5,
    resolutions: ['720p', '1080p', '2K'],
    defaultResolution: '1080p',
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    defaultAspectRatio: '16:9',
  },
  'gen-4-turbo': {
    id: 'gen-4-turbo',
    name: 'Gen-4 Turbo',
    maxPromptLength: 500,
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    maxImages: 5,
    durations: [2, 3, 4, 5, 6, 7, 8, 9, 10],
    defaultDuration: 5,
    resolutions: ['720p', '1080p'],
    defaultResolution: '1080p',
    aspectRatios: ['16:9', '9:16', '1:1'],
    defaultAspectRatio: '16:9',
  },
  'gen-3-alpha': {
    id: 'gen-3-alpha',
    name: 'Gen-3 Alpha',
    maxPromptLength: 500,
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    maxImages: 5,
    durations: [4, 5, 8, 10],
    defaultDuration: 5,
    resolutions: ['720p', '1080p'],
    defaultResolution: '1080p',
    aspectRatios: ['16:9', '9:16', '1:1'],
    defaultAspectRatio: '16:9',
  },
  'gen-3-turbo': {
    id: 'gen-3-turbo',
    name: 'Gen-3 Turbo',
    maxPromptLength: 500,
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    maxImages: 5,
    durations: [4, 5, 8, 10],
    defaultDuration: 5,
    resolutions: ['720p', '1080p'],
    defaultResolution: '1080p',
    aspectRatios: ['16:9', '9:16', '1:1'],
    defaultAspectRatio: '16:9',
  },
  'kling-3': {
    id: 'kling-3',
    name: 'Kling 3.0 Pro',
    maxPromptLength: 400,
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    maxImages: 5,
    durations: [4, 5, 8, 10],
    defaultDuration: 5,
    resolutions: ['720p', '1080p'],
    defaultResolution: '1080p',
    aspectRatios: ['16:9', '9:16', '1:1'],
    defaultAspectRatio: '16:9',
  },
  kling: {
    id: 'kling',
    name: 'Kling',
    maxPromptLength: 400,
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    maxImages: 5,
    durations: [4, 5, 8, 10],
    defaultDuration: 5,
    resolutions: ['720p', '1080p'],
    defaultResolution: '1080p',
    aspectRatios: ['16:9', '9:16', '1:1'],
    defaultAspectRatio: '16:9',
  },
  'veo-3': {
    id: 'veo-3',
    name: 'Veo 3.1',
    maxPromptLength: 500,
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    maxImages: 5,
    durations: [4, 5, 8, 10],
    defaultDuration: 5,
    resolutions: ['720p', '1080p'],
    defaultResolution: '1080p',
    aspectRatios: ['16:9', '9:16', '1:1'],
    defaultAspectRatio: '16:9',
  },
  veo: {
    id: 'veo',
    name: 'Veo',
    maxPromptLength: 500,
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    maxImages: 5,
    durations: [4, 5, 8, 10],
    defaultDuration: 5,
    resolutions: ['720p', '1080p'],
    defaultResolution: '1080p',
    aspectRatios: ['16:9', '9:16', '1:1'],
    defaultAspectRatio: '16:9',
  },
  'wan-2.6': {
    id: 'wan-2.6',
    name: 'WAN 2.6',
    maxPromptLength: 500,
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    maxImages: 5,
    durations: [4, 5, 6, 7, 8, 9, 10],
    defaultDuration: 5,
    resolutions: ['480p', '720p', '1080p'],
    defaultResolution: '720p',
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    defaultAspectRatio: '16:9',
  },
  aleph: {
    id: 'aleph',
    name: 'Aleph',
    maxPromptLength: 300,
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    maxImages: 5,
    durations: [4, 5, 8, 10],
    defaultDuration: 5,
    resolutions: ['720p', '1080p'],
    defaultResolution: '1080p',
    aspectRatios: ['16:9', '9:16', '1:1'],
    defaultAspectRatio: '16:9',
  },
}

/** 模型服务接口 */
export interface IModelService {
  getModels(): ModelCapability[]
  getModel(id: string): ModelCapability | undefined
}
