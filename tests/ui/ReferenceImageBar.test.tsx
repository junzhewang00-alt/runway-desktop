/** @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import ReferenceImageBar from '../../src/ui/ReferenceImageBar'
import type { Material } from '../../src/types/materials'

const mockImages: Material[] = [
  {
    id: 'img-1',
    fileName: 'beach-sunset.png',
    filePath: '/materials/beach-sunset.png',
    mimeType: 'image/png',
    fileSize: 1024000,
    width: 1920,
    height: 1080,
    createdAt: Date.now(),
  },
  {
    id: 'img-2',
    fileName: 'dog-running.jpg',
    filePath: '/materials/dog-running.jpg',
    mimeType: 'image/jpeg',
    fileSize: 2048000,
    width: 3840,
    height: 2160,
    createdAt: Date.now(),
  },
]

describe('ReferenceImageBar', () => {
  it('renders images with thumbnails', () => {
    render(
      <ReferenceImageBar
        images={mockImages}
        onRemove={vi.fn()}
        onAdd={vi.fn()}
      />
    )
    // 缩略图应出现
    expect(screen.getAllByRole('img').length).toBe(2)
  })

  it('shows add button when fewer than 5 images', () => {
    render(
      <ReferenceImageBar
        images={mockImages}
        onRemove={vi.fn()}
        onAdd={vi.fn()}
      />
    )
    expect(screen.getByText('+')).toBeDefined()
  })

  it('hides add button when 5 images', () => {
    const fiveImages = Array.from({ length: 5 }, (_, i) => ({
      ...mockImages[0],
      id: `img-${i}`,
      fileName: `image-${i}.png`,
    }))
    render(
      <ReferenceImageBar
        images={fiveImages}
        onRemove={vi.fn()}
        onAdd={vi.fn()}
      />
    )
    expect(screen.queryByText('+')).toBeNull()
  })

  it('calls onRemove when × button clicked', () => {
    const onRemove = vi.fn()
    render(
      <ReferenceImageBar
        images={mockImages}
        onRemove={onRemove}
        onAdd={vi.fn()}
      />
    )
    const removeButtons = screen.getAllByText('×')
    fireEvent.click(removeButtons[0])
    expect(onRemove).toHaveBeenCalledWith('img-1')
  })

  it('calls onAdd when + button clicked', () => {
    const onAdd = vi.fn()
    render(
      <ReferenceImageBar
        images={mockImages}
        onRemove={vi.fn()}
        onAdd={onAdd}
      />
    )
    fireEvent.click(screen.getByText('+'))
    expect(onAdd).toHaveBeenCalled()
  })

  it('shows lightbox preview on thumbnail click', () => {
    render(
      <ReferenceImageBar
        images={mockImages}
        onRemove={vi.fn()}
        onAdd={vi.fn()}
      />
    )
    const thumbnails = screen.getAllByRole('img')
    fireEvent.click(thumbnails[0])
    // Lightbox 应出现
    expect(screen.getByText('× 关闭')).toBeDefined()
  })

  it('displays count label correctly', () => {
    render(
      <ReferenceImageBar
        images={mockImages}
        onRemove={vi.fn()}
        onAdd={vi.fn()}
      />
    )
    expect(screen.getByText(/参考图（2\/5/)).toBeDefined()
  })

  it('renders empty state without errors', () => {
    render(
      <ReferenceImageBar
        images={[]}
        onRemove={vi.fn()}
        onAdd={vi.fn()}
      />
    )
    expect(screen.getByText(/参考图（0\/5/)).toBeDefined()
  })
})
