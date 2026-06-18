import { MODEL_CAPS } from '../types/models'
import type { ModelCapability, IModelService } from '../types/models'

export class ModelService implements IModelService {
  getModels(): ModelCapability[] {
    return Object.values(MODEL_CAPS)
  }

  getModel(id: string): ModelCapability | undefined {
    return MODEL_CAPS[id]
  }
}

export const modelService = new ModelService()
