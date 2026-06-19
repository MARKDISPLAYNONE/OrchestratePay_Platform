import '@testing-library/jest-dom'
import { TextEncoder, TextDecoder } from 'util'

// jsdom doesn't expose TextEncoder/TextDecoder — provide them from Node's util
Object.assign(global, { TextEncoder, TextDecoder })
