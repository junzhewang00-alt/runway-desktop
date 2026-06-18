export interface Material {
  id: string
  fileName: string
  filePath: string
  mimeType: string
  fileSize: number
  width?: number
  height?: number
  createdAt: number
}

export interface CreateMaterialParams {
  fileName: string
  filePath: string
  mimeType: string
  fileSize: number
  width?: number
  height?: number
}

export interface IMaterialService {
  import(paths: string[]): Promise<Material[]>
  list(): Material[]
  delete(id: string): void
  getPath(id: string): string | null
}
