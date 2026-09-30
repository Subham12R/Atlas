import { render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FlowingGradientShader } from './flowing-gradient-shader'

// Minimal WebGL stand-in that records calls; real shader compilation is checked in a browser.
function fakeGl(options: { compiles?: boolean } = {}): Record<string, unknown> {
  const fn = (): ReturnType<typeof vi.fn> => vi.fn()
  return {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5,
    STATIC_DRAW: 6, FLOAT: 7, TRIANGLES: 8, COLOR_BUFFER_BIT: 9,
    createShader: vi.fn(() => ({})), shaderSource: fn(), compileShader: fn(),
    getShaderParameter: vi.fn(() => options.compiles ?? true), getShaderInfoLog: vi.fn(() => 'boom'),
    createProgram: vi.fn(() => ({})), attachShader: fn(), bindAttribLocation: fn(), linkProgram: fn(),
    getProgramParameter: vi.fn(() => true), getProgramInfoLog: fn(), useProgram: fn(),
    createBuffer: vi.fn(() => ({})), bindBuffer: fn(), bufferData: fn(), enableVertexAttribArray: fn(),
    vertexAttribPointer: fn(), getUniformLocation: vi.fn(() => ({})), uniform2f: fn(), uniform1f: fn(),
    viewport: fn(), clearColor: fn(), clear: fn(), drawArrays: fn(),
    deleteShader: fn(), deleteProgram: fn(), deleteBuffer: fn()
  }
}

let getContext: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => vi.restoreAllMocks())

it('keeps the static CSS gradient when WebGL is unavailable', () => {
  getContext.mockReturnValue(null)
  const { container } = render(<FlowingGradientShader />)
  const canvas = container.querySelector('canvas') as HTMLCanvasElement
  expect(canvas.style.background).toContain('radial-gradient')
})

it('keeps the fallback and frees GL objects when the shader does not compile', () => {
  const gl = fakeGl({ compiles: false })
  getContext.mockReturnValue(gl as unknown as WebGLRenderingContext)
  const { container } = render(<FlowingGradientShader />)
  expect((container.querySelector('canvas') as HTMLCanvasElement).style.background).toContain(
    'radial-gradient'
  )
  expect(gl.drawArrays).not.toHaveBeenCalled()
})

it('draws exactly one still frame, with no animation loop, when motion is reduced', () => {
  const gl = fakeGl()
  getContext.mockReturnValue(gl as unknown as WebGLRenderingContext)
  const raf = vi.spyOn(window, 'requestAnimationFrame')
  const { container } = render(<FlowingGradientShader paused />)
  expect((container.querySelector('canvas') as HTMLCanvasElement).style.background).not.toContain(
    'radial-gradient'
  )
  expect(gl.drawArrays).toHaveBeenCalled()
  expect(raf).not.toHaveBeenCalled()
})

it('animates while visible and releases the GL program and frame loop on unmount', () => {
  const gl = fakeGl()
  getContext.mockReturnValue(gl as unknown as WebGLRenderingContext)
  const callbacks: FrameRequestCallback[] = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => callbacks.push(cb))
  const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  const { unmount } = render(<FlowingGradientShader />)
  expect(callbacks).toHaveLength(1)
  callbacks[0](1000)
  expect(gl.drawArrays).toHaveBeenCalledTimes(2) // initial resize repaint + first frame
  unmount()
  expect(cancel).toHaveBeenCalled()
  expect(gl.deleteProgram).toHaveBeenCalled()
  expect(gl.deleteBuffer).toHaveBeenCalled()
})
