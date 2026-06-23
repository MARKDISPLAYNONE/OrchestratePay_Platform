import '@testing-library/jest-dom'
import { configure } from '@testing-library/react'
import { TextEncoder, TextDecoder } from 'util'

// jsdom doesn't expose TextEncoder/TextDecoder — provide them from Node's util
Object.assign(global, { TextEncoder, TextDecoder })

// UI interaction tests simulate keystrokes and can be slow under load
jest.setTimeout(15000)

// waitFor polls for assertions — raise its default 1 s timeout to match the above
configure({ asyncUtilTimeout: 8000 })
