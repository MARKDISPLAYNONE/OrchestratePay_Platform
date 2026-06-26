import { render, screen } from '@testing-library/react'
import GoogleOAuthProviderWrapper from '../GoogleOAuthProviderWrapper'

jest.mock('@react-oauth/google', () => ({
  GoogleOAuthProvider: ({ children, clientId }: { children: React.ReactNode; clientId: string }) => (
    <div data-testid="google-provider" data-client-id={clientId}>{children}</div>
  ),
}))

describe('GoogleOAuthProviderWrapper', () => {
  it('renders children directly when VITE_GOOGLE_CLIENT_ID is not set', () => {
    const saved = process.env.VITE_GOOGLE_CLIENT_ID
    delete process.env.VITE_GOOGLE_CLIENT_ID
    try {
      render(
        <GoogleOAuthProviderWrapper>
          <span>test child</span>
        </GoogleOAuthProviderWrapper>
      )
      expect(screen.getByText('test child')).toBeInTheDocument()
      expect(screen.queryByTestId('google-provider')).not.toBeInTheDocument()
    } finally {
      if (saved !== undefined) process.env.VITE_GOOGLE_CLIENT_ID = saved
    }
  })

  it('wraps children in GoogleOAuthProvider when client ID is set', () => {
    const saved = process.env.VITE_GOOGLE_CLIENT_ID
    process.env.VITE_GOOGLE_CLIENT_ID = 'test-client-id'
    try {
      render(
        <GoogleOAuthProviderWrapper>
          <span>test child</span>
        </GoogleOAuthProviderWrapper>
      )
      expect(screen.getByText('test child')).toBeInTheDocument()
      expect(screen.getByTestId('google-provider')).toHaveAttribute('data-client-id', 'test-client-id')
    } finally {
      if (saved !== undefined) process.env.VITE_GOOGLE_CLIENT_ID = saved
      else delete process.env.VITE_GOOGLE_CLIENT_ID
    }
  })
})
