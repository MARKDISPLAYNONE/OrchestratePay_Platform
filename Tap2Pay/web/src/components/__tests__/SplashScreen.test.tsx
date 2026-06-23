import { render, screen, act, fireEvent } from '@testing-library/react'
import SplashScreen from '../SplashScreen'

describe('SplashScreen', () => {
  it('renders the tap to skip hint', () => {
    render(<SplashScreen onDone={jest.fn()} />)
    expect(screen.getByText(/tap to skip/i)).toBeInTheDocument()
  })

  it('calls onDone when clicked', () => {
    const onDone = jest.fn()
    render(<SplashScreen onDone={onDone} />)
    fireEvent.click(document.querySelector('.splash-container')!)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('calls onDone after 12 seconds via timer', () => {
    jest.useFakeTimers()
    try {
      const onDone = jest.fn()
      render(<SplashScreen onDone={onDone} />)
      expect(onDone).not.toHaveBeenCalled()
      act(() => { jest.advanceTimersByTime(12000) })
      expect(onDone).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it('clears the timer on unmount', () => {
    jest.useFakeTimers()
    try {
      const onDone = jest.fn()
      const { unmount } = render(<SplashScreen onDone={onDone} />)
      unmount()
      act(() => { jest.advanceTimersByTime(12000) })
      expect(onDone).not.toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
    }
  })
})
