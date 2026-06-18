/** @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest'
import React, { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import ErrorBoundary from '../../src/ui/ErrorBoundary'

function Broken({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Test crash')
  return <p>All good</p>
}

function ToggleParent() {
  const [shouldThrow, setShouldThrow] = useState(true)
  return (
    <div>
      <ErrorBoundary panelName="Test Panel">
        <Broken shouldThrow={shouldThrow} />
      </ErrorBoundary>
      <button onClick={() => setShouldThrow(false)}>Fix</button>
    </div>
  )
}

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundary panelName="Test Panel">
        <Broken shouldThrow={false} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('All good')).toBeTruthy()
  })

  it('shows fallback UI on error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary panelName="Test Panel">
        <Broken shouldThrow={true} />
      </ErrorBoundary>,
    )

    expect(screen.getByText('Test Panel Crashed')).toBeTruthy()
    expect(screen.getByText('Test crash')).toBeTruthy()

    spy.mockRestore()
  })

  it('recovers after Retry click when error condition is resolved', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<ToggleParent />)

    // Error boundary caught the error
    expect(screen.getByText('Test Panel Crashed')).toBeTruthy()

    // Click Retry — still broken, so error re-occurs (fallback stays)
    fireEvent.click(screen.getByText('Retry'))
    expect(screen.getByText('Test Panel Crashed')).toBeTruthy()

    // Resolve the error condition and click Retry again
    fireEvent.click(screen.getByText('Fix'))
    fireEvent.click(screen.getByText('Retry'))

    expect(screen.getByText('All good')).toBeTruthy()

    spy.mockRestore()
  })
})
