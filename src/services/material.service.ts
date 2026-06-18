import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { materialStore } from '../database/material.store'
import type { Material, IMaterialService } from '../types/materials'

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

export class MaterialService implements IMaterialService {
  async import(paths: string[]): Promise<Material[]> {
    const materialsDir = path.join(app.getPath('userData'), 'materials')
    fs.mkdirSync(materialsDir, { recursive: true })

    const results: Material[] = []

    for (const srcPath of paths) {
      try {
        const stat = await fs.promises.stat(srcPath)
        const ext = path.extname(srcPath).toLowerCase()
        const mimeType = MIME_MAP[ext] || 'application/octet-stream'
        const destName = `${crypto.randomUUID()}` + ext
        const destPath = path.join(materialsDir, destName)

        await fs.promises.copyFile(srcPath, destPath)

        const material = materialStore.insert({
          fileName: path.basename(srcPath),
          filePath: destPath,
          mimeType,
          fileSize: stat.size,
        })

        results.push(material)
      } catch {
        // single file failure doesn't block the rest
        continue
      }
    }

    return results
  }

  list(): Material[] {
    return materialStore.list()
  }

  delete(id: string): void {
    const mat = materialStore.getById(id)
    materialStore.deleteById(id)

    if (mat) {
      try {
        fs.unlinkSync(mat.filePath)
      } catch {
        // file already gone, ignore
      }
    }
  }

  getPath(id: string): string | null {
    const mat = materialStore.getById(id)
    if (!mat?.filePath) return null
    if (!fs.existsSync(mat.filePath)) return null
    return mat.filePath
  }
}

export const materialService = new MaterialService()
