/**
 * Tests for src/main.tsx — entry point side-effects.
 * Uses jest.resetModules + jest.doMock so each describe block
 * loads the module fresh with its own mocks.
 */

let createRootMock: jest.Mock
let renderMock: jest.Mock

function setupRootElement() {
  const el = document.createElement('div')
  el.id = 'root'
  document.body.appendChild(el)
}

function teardownRootElement() {
  document.getElementById('root')?.remove()
}

afterEach(() => {
  jest.resetModules()
  teardownRootElement()
  delete process.env.PROD
})

describe('main.tsx — dev mode (no service worker)', () => {
  it('calls createRoot with the #root element and renders the app', () => {
    jest.resetModules()
    renderMock    = jest.fn()
    createRootMock = jest.fn(() => ({ render: renderMock }))

    jest.doMock('react-dom/client', () => ({ createRoot: createRootMock }))
    jest.doMock('../App',           () => ({ default: () => null }))

    setupRootElement()

    require('../main')

    expect(createRootMock).toHaveBeenCalledWith(document.getElementById('root'))
    expect(renderMock).toHaveBeenCalled()
  })
})

describe('main.tsx — production mode (service worker registered)', () => {
  it('registers /sw.js when PROD is set and serviceWorker exists', () => {
    jest.resetModules()
    renderMock    = jest.fn()
    createRootMock = jest.fn(() => ({ render: renderMock }))

    jest.doMock('react-dom/client', () => ({ createRoot: createRootMock }))
    jest.doMock('../App',           () => ({ default: () => null }))

    const registerMock = jest.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register: registerMock },
      configurable: true,
      writable: true,
    })

    // babel transforms import.meta.env.PROD → process.env.PROD
    process.env.PROD = 'true'

    setupRootElement()

    require('../main')

    expect(registerMock).toHaveBeenCalledWith('/sw.js')
  })
})
