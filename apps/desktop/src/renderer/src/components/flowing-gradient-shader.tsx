import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

const VERTEX = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`

// A slow, domain-warped colour field anchored to the bottom edge. Output is premultiplied alpha
// so the window background shows through; a hash dither hides 8-bit banding in the soft falloff.
const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uTime;
uniform float uDark;

float hash(vec2 v) { return fract(sin(dot(v, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = vec2(uv.x * uRes.x / uRes.y, uv.y);
  float t = uTime * 0.12;

  for (int i = 0; i < 3; i++) {
    float k = float(i) + 1.0;
    p += (0.32 / k) * vec2(
      sin(p.y * 2.3 * k + t * (1.0 + 0.3 * k)),
      cos(p.x * 1.9 * k - t * (0.8 + 0.25 * k)));
  }
  float f = 0.5 + 0.5 * sin(p.x * 1.7 + p.y * 1.3 + t * 1.6);
  float g = 0.5 + 0.5 * sin(p.x * 1.1 - p.y * 2.1 - t * 1.1 + 2.0);

  vec3 sky = vec3(0.49, 0.83, 0.99);
  vec3 indigo = vec3(0.65, 0.71, 0.99);
  vec3 orchid = vec3(0.94, 0.67, 0.99);
  vec3 peach = vec3(0.99, 0.73, 0.45);
  vec3 col = mix(sky, indigo, smoothstep(0.0, 0.5, f));
  col = mix(col, orchid, smoothstep(0.4, 0.9, f));
  col = mix(col, peach, smoothstep(0.6, 1.0, f) * smoothstep(0.4, 1.0, g) * 0.6);

  float edge = 0.46 + 0.10 * sin(p.x * 1.4 + t * 1.3) + 0.06 * g;
  float a = 1.0 - smoothstep(0.0, edge, uv.y);
  a *= a * mix(0.8, 0.55, uDark);

  float dither = (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4((col + dither) * a, a);
}
`

// Shown when WebGL is unavailable or its context is lost.
const FALLBACK =
  'radial-gradient(ellipse 100% 140% at 50% 100%, rgba(165,180,252,0.55) 0%, rgba(125,211,252,0.35) 14%, rgba(240,171,252,0.18) 30%, transparent 46%)'

const RENDER_SCALE = 0.5 // smooth gradient: render at half resolution, let the browser upscale
const FRAME_MS = 1000 / 30
const STILL_TIME = 8 // seconds into the flow used for the single reduced-motion frame

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
  console.warn('Atlas gradient shader failed to compile:', gl.getShaderInfoLog(shader))
  gl.deleteShader(shader)
  return null
}

/** Full-bleed, non-interactive flowing gradient drawn by a WebGL fragment shader. Pauses while the
 * window is hidden, draws one still frame when `paused` (reduced motion), and falls back to a
 * static CSS gradient if WebGL cannot start. */
export function FlowingGradientShader({
  paused = false,
  className
}: {
  paused?: boolean
  className?: string
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power'
    })
    const vertex = gl && compile(gl, gl.VERTEX_SHADER, VERTEX)
    const fragment = gl && compile(gl, gl.FRAGMENT_SHADER, FRAGMENT)
    const program = gl && vertex && fragment ? gl.createProgram() : null
    if (!gl || !vertex || !fragment || !program) return // keep the CSS fallback

    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.bindAttribLocation(program, 0, 'p')
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('Atlas gradient shader failed to link:', gl.getProgramInfoLog(program))
      gl.deleteProgram(program)
      gl.deleteShader(vertex)
      gl.deleteShader(fragment)
      return
    }
    gl.useProgram(program)
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    const uRes = gl.getUniformLocation(program, 'uRes')
    const uTime = gl.getUniformLocation(program, 'uTime')
    const uDark = gl.getUniformLocation(program, 'uDark')

    canvas.style.background = 'none' // WebGL is drawing; drop the fallback
    let raf = 0
    let lastFrame = 0
    let lost = false
    const start = performance.now()

    const draw = (seconds: number): void => {
      gl.uniform2f(uRes, canvas.width, canvas.height)
      gl.uniform1f(uTime, seconds)
      gl.uniform1f(uDark, document.documentElement.classList.contains('dark') ? 1 : 0)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    const frame = (now: number): void => {
      raf = 0
      if (lost || document.hidden) return
      raf = requestAnimationFrame(frame)
      if (now - lastFrame < FRAME_MS) return
      lastFrame = now
      draw((now - start) / 1000)
    }
    const render = (): void => {
      if (lost) return
      if (paused) draw(STILL_TIME)
      else if (!raf && !document.hidden) raf = requestAnimationFrame(frame)
    }
    const resize = (): void => {
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * RENDER_SCALE))
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * RENDER_SCALE))
      gl.viewport(0, 0, canvas.width, canvas.height)
      // A resized canvas is cleared; repaint now instead of waiting for the next tick.
      draw(paused ? STILL_TIME : (performance.now() - start) / 1000)
    }
    const onVisibility = (): void => {
      if (!paused && !document.hidden) render()
    }
    const onLost = (event: Event): void => {
      event.preventDefault()
      lost = true
      cancelAnimationFrame(raf)
      canvas.style.background = FALLBACK
    }

    resize()
    render()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    observer?.observe(canvas)
    // Theme switches while paused would otherwise leave the still frame in the old palette.
    const theme = new MutationObserver(() => paused && draw(STILL_TIME))
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    canvas.addEventListener('webglcontextlost', onLost)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelAnimationFrame(raf)
      observer?.disconnect()
      theme.disconnect()
      canvas.removeEventListener('webglcontextlost', onLost)
      document.removeEventListener('visibilitychange', onVisibility)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
      gl.deleteShader(vertex)
      gl.deleteShader(fragment)
      // No loseContext(): React StrictMode remounts this canvas and would get the lost context back.
    }
  }, [paused])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 h-full w-full', className)}
      style={{ background: FALLBACK }}
    />
  )
}

export default FlowingGradientShader
