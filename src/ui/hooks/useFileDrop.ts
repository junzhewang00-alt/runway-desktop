import { useState, useCallback } from 'react'

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp']

export interface FileDropState {
  /** 是否正在拖拽文件到目标区域上方 */
  dragOver: boolean
  /** 拖拽进入处理 */
  handleDragOver: (e: React.DragEvent) => void
  handleDragEnter: (e: React.DragEvent) => void
  /** 拖拽离开处理（自动过滤子元素冒泡） */
  handleDragLeave: (e: React.DragEvent) => void
  /** 放置处理：提取文件路径，过滤图片扩展名，调用 onFiles 回调 */
  handleDrop: (e: React.DragEvent) => void
  /** 拖拽时边框颜色（快捷样式） */
  dragBorderColor: string
}

export interface FileDropOptions {
  /** 允许的文件扩展名列表，默认 ['.png', '.jpg', '.jpeg', '.webp'] */
  allowedExtensions?: string[]
  /** 收到文件路径后的回调 */
  onFiles: (paths: string[]) => void
}

export function useFileDrop({ allowedExtensions = IMAGE_EXTENSIONS, onFiles }: FileDropOptions): FileDropState {
  const [dragOver, setDragOver] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }, [])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // 只在离开目标区域时设置 false（非子元素冒泡）
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)

    const files = Array.from(e.dataTransfer.files)
    const paths = files
      .filter((f) => {
        const ext = '.' + f.name.split('.').pop()?.toLowerCase()
        return allowedExtensions.includes(ext)
      })
      .map((f) => (f as File & { path?: string }).path)
      .filter((p): p is string => typeof p === 'string' && p.length > 0)

    if (paths.length > 0) {
      onFiles(paths)
    }
  }, [allowedExtensions, onFiles])

  return {
    dragOver,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    dragBorderColor: dragOver ? 'var(--color-accent)' : 'transparent',
  }
}
