import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('shows an explicit IndexedDB requirement when browser storage is unavailable', () => {
    render(<App />)

    expect(screen.getByText('IndexedDB is required')).toBeInTheDocument()
  })
})
