import { render } from '@testing-library/react'
import App from '../App'

jest.mock('@react-oauth/google', () => ({
  GoogleOAuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

jest.mock('react-router-dom', () => ({
  BrowserRouter: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Routes:   () => null,
  Route:    () => null,
  Navigate: () => null,
}))

describe('App', () => {
  it('renders without crashing', () => {
    render(<App />)
  })
})
