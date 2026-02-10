import { useState, useEffect, useCallback, useRef } from 'react'
import './App.css'
import config from './config.json'

const DEBUG = import.meta.env.DEV && import.meta.env.VITE_DEBUG === 'true'
const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

const DEFAULT_HSL = config.default
const STORAGE_KEY = config.storageKey
const HISTORY_KEY = `${config.storageKey}-history`
const ANIMATE_KEY = `${config.storageKey}-animate`
const VIGNETTE_KEY = `${config.storageKey}-vignette`
const HINTS_KEY = `${config.storageKey}-hints`
const HINTS_VISIBLE_KEY = `${config.storageKey}-hints-visible`
const MAX_HISTORY = 15
const { h: H_LIMITS, s: S_LIMITS, l: L_LIMITS } = config.limits
const { hCyclesPerVW, sCyclesPerVW, lCyclesPerVH } = config.sensitivity
const { x: X_DEADZONE, y: Y_DEADZONE } = config.deadzone
const { darkThreshold, darkLightness, lightLightness } = config.mode
const { h: H_KEY, s: S_KEY, l: L_KEY } = config.keyboard
const { min: V_MIN, max: V_MAX, sensitivity: V_SENSITIVITY, blurSize: V_BLUR, spreadSize: V_SPREAD, baseLightness: V_LIGHTNESS } = config.vignette

function getStoredColor() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (typeof parsed.h === 'number' && typeof parsed.s === 'number' && typeof parsed.l === 'number') {
        return parsed
      }
    }
  } catch {
    // Ignore
  }
  return DEFAULT_HSL
}

function getHistory() {
  try {
    const stored = localStorage.getItem(HISTORY_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed)) {
        return parsed
      }
    }
  } catch {
    // Ignore
  }
  return []
}

function saveHistory(history) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
  } catch {
    // Ignore
  }
}

function pushToHistory(hsl) {
  const history = getHistory()
  history.push(hsl)
  // Keep only last MAX_HISTORY items
  if (history.length > MAX_HISTORY) {
    history.shift()
  }
  saveHistory(history)
}

function popFromHistory() {
  const history = getHistory()
  if (history.length === 0) return null
  const previous = history.pop()
  saveHistory(history)
  return previous
}

function saveColor(hsl, addToHistory = true) {
  try {
    if (addToHistory) {
      // Save current color to history before overwriting
      const current = getStoredColor()
      pushToHistory(current)
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(hsl))
  } catch {
    // Ignore
  }
}

function getStoredAnimate() {
  try {
    const stored = localStorage.getItem(ANIMATE_KEY)
    if (stored !== null) {
      return stored === 'true'
    }
  } catch {
    // Ignore
  }
  // Default: animate unless user prefers reduced motion
  return !prefersReducedMotion
}

function saveAnimate(value) {
  try {
    localStorage.setItem(ANIMATE_KEY, String(value))
  } catch {
    // Ignore
  }
}

function getStoredVignette() {
  try {
    const stored = localStorage.getItem(VIGNETTE_KEY)
    if (stored !== null) {
      return parseFloat(stored) || 0
    }
  } catch {
    // Ignore
  }
  return 0
}

function saveVignette(value) {
  try {
    localStorage.setItem(VIGNETTE_KEY, String(value))
  } catch {
    // Ignore
  }
}

function App() {
  const [hsl, setHsl] = useState(getStoredColor)
  const [isDragging, setIsDragging] = useState(false)
  const [cursorPos, setCursorPos] = useState({ x: -100, y: -100 })
  const [isOverNavbar, setIsOverNavbar] = useState(false)
  const [delta, setDelta] = useState({ dx: 0, dy: 0 })
  const [animateColors, setAnimateColors] = useState(getStoredAnimate)
  const [vignette, setVignette] = useState(getStoredVignette)
  const [isVignetteDrag, setIsVignetteDrag] = useState(false)
  const [isKeyAdjusting, setIsKeyAdjusting] = useState(false)
  const keyAdjustTimerRef = useRef(null)
  const [hintsVisible, setHintsVisible] = useState(() => {
    try {
      const stored = localStorage.getItem(HINTS_VISIBLE_KEY)
      if (stored !== null) return stored === 'true'
    } catch {}
    return true
  })
  const [hintsPanel, setHintsPanel] = useState(() => {
    try {
      const stored = localStorage.getItem(HINTS_KEY)
      if (stored === 'keyboard' || stored === 'drag') return stored
    } catch {}
    return 'drag'
  })

  const prevPosRef = useRef(null)
  const hslRef = useRef(hsl)
  const dragStartHslRef = useRef(null)
  const vignetteStartRef = useRef(null)

  useEffect(() => {
    hslRef.current = hsl
  }, [hsl])

  const updateColor = useCallback((dx, dy, ctrlKey = false) => {
    const c = hslRef.current

    let h = c.h
    let s = c.s
    let l = c.l

    const absDx = Math.abs(dx)
    const absDy = Math.abs(dy)

    // Calculate sensitivity based on viewport dimensions
    const vw = window.innerWidth
    const vh = window.innerHeight
    const hSensitivity = (hCyclesPerVW * (H_LIMITS.max - H_LIMITS.min)) / vw
    const sSensitivity = (sCyclesPerVW * (S_LIMITS.max - S_LIMITS.min)) / vw
    const lSensitivity = (lCyclesPerVH * (L_LIMITS.max - L_LIMITS.min)) / vh

    // Store delta for debug
    if (DEBUG) setDelta({ dx, dy })

    // Apply deadzones - only change if movement exceeds threshold
    const changeX = absDx >= X_DEADZONE
    const changeY = absDy >= Y_DEADZONE

    // Vertical: lightness (up = brighter, down = darker)
    if (changeY) {
      l = l - dy * lSensitivity
      l = Math.max(L_LIMITS.min, Math.min(L_LIMITS.max, l))
    }

    // Horizontal: hue or saturation (Ctrl = saturation)
    if (changeX) {
      if (ctrlKey) {
        // Ctrl + horizontal: saturation
        s = s + dx * sSensitivity
        s = Math.max(S_LIMITS.min, Math.min(S_LIMITS.max, s))
      } else {
        // Horizontal: hue (wraps around)
        const range = H_LIMITS.max - H_LIMITS.min
        h = H_LIMITS.min + ((h - H_LIMITS.min + dx * hSensitivity) % range + range) % range
      }
    }

    const next = { h, s, l }
    hslRef.current = next
    // Skip UI updates during drag if animations are disabled
    if (animateColors) {
      setHsl(next)
    }
  }, [animateColors])

  const updateVignette = useCallback((dx, dy) => {
    // Drag towards center = more vignette, away from center = less
    const vw = window.innerWidth
    const vh = window.innerHeight
    const centerX = vw / 2
    const centerY = vh / 2

    // Get current cursor position
    const curX = prevPosRef.current?.x ?? centerX
    const curY = prevPosRef.current?.y ?? centerY

    // Vector from cursor to center
    const toCenterX = centerX - curX
    const toCenterY = centerY - curY

    // Normalize the to-center vector
    const toCenterDist = Math.sqrt(toCenterX * toCenterX + toCenterY * toCenterY)
    if (toCenterDist < 1) return // Too close to center

    const toCenterNormX = toCenterX / toCenterDist
    const toCenterNormY = toCenterY / toCenterDist

    // Project drag vector onto to-center vector (dot product)
    // Positive = dragging toward center, negative = away
    const dragTowardCenter = dx * toCenterNormX + dy * toCenterNormY

    // Sensitivity from config
    const diagonal = Math.sqrt(vw * vw + vh * vh)
    const sensitivity = V_SENSITIVITY / diagonal

    setVignette(prev => {
      const next = Math.max(V_MIN, Math.min(V_MAX, prev + dragTowardCenter * sensitivity))
      return next
    })
  }, [])

  const onMouseDown = useCallback((e) => {
    if (e.target.closest('.navbar')) return
    // Alt/Opt + drag for vignette
    if (e.altKey) {
      setIsVignetteDrag(true)
      vignetteStartRef.current = vignette
    } else {
      setIsVignetteDrag(false)
    }
    setIsDragging(true)
    prevPosRef.current = { x: e.clientX, y: e.clientY }
    dragStartHslRef.current = { ...hslRef.current }
  }, [vignette])

  const onMouseMove = useCallback((e) => {
    setCursorPos({ x: e.clientX, y: e.clientY })

    if (!isDragging || !prevPosRef.current) return

    const dx = e.clientX - prevPosRef.current.x
    const dy = e.clientY - prevPosRef.current.y

    if (isVignetteDrag) {
      updateVignette(dx, dy)
    } else {
      updateColor(dx, dy, e.ctrlKey)
    }
    prevPosRef.current = { x: e.clientX, y: e.clientY }
  }, [isDragging, isVignetteDrag, updateColor, updateVignette])

  const onMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false)
      if (isVignetteDrag) {
        saveVignette(vignette)
        setIsVignetteDrag(false)
      } else {
        // Apply final color to UI if animations were disabled
        if (!animateColors) {
          setHsl(hslRef.current)
        }
        saveColor(hslRef.current)
      }
    }
    prevPosRef.current = null
  }, [isDragging, isVignetteDrag, vignette, animateColors])

  const onMouseLeave = useCallback(() => {
    setCursorPos({ x: -100, y: -100 })
    if (isDragging) {
      onMouseUp()
    }
  }, [isDragging, onMouseUp])

  // Touch
  const onTouchStart = useCallback((e) => {
    if (e.target.closest('.navbar')) return
    const t = e.touches[0]
    setIsDragging(true)
    prevPosRef.current = { x: t.clientX, y: t.clientY }
    setCursorPos({ x: t.clientX, y: t.clientY })
  }, [])

  const onTouchMove = useCallback((e) => {
    const t = e.touches[0]
    setCursorPos({ x: t.clientX, y: t.clientY })

    if (!isDragging || !prevPosRef.current) return

    const dx = t.clientX - prevPosRef.current.x
    const dy = t.clientY - prevPosRef.current.y

    updateColor(dx, dy)
    prevPosRef.current = { x: t.clientX, y: t.clientY }
  }, [isDragging, updateColor])

  const onTouchEnd = useCallback(() => {
    if (isDragging) {
      setIsDragging(false)
      // Apply final color to UI if animations were disabled
      if (!animateColors) {
        setHsl(hslRef.current)
      }
      saveColor(hslRef.current)
    }
    prevPosRef.current = null
    setCursorPos({ x: -100, y: -100 })
  }, [isDragging, animateColors])

  const isDarkMode = hsl.l < darkThreshold

  const toggleAnimate = useCallback(() => {
    setAnimateColors(prev => {
      const next = !prev
      saveAnimate(next)
      return next
    })
  }, [])

  const toggleMode = useCallback(() => {
    const newL = isDarkMode ? lightLightness : darkLightness
    const newHsl = { ...hslRef.current, l: newL }
    hslRef.current = newHsl
    setHsl(newHsl)
    saveColor(newHsl)
  }, [isDarkMode])

  const undoChange = useCallback(() => {
    const previous = popFromHistory()
    if (previous) {
      hslRef.current = previous
      setHsl(previous)
      saveColor(previous, false) // Don't add to history when undoing
    }
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Option/Alt + H to toggle hints
      if (e.altKey && e.code === 'KeyH') {
        e.preventDefault()
        setHintsVisible(prev => {
          const next = !prev
          try { localStorage.setItem(HINTS_VISIBLE_KEY, String(next)) } catch {}
          return next
        })
        return
      }
      // Option/Alt + L to toggle lights
      if (e.altKey && e.code === 'KeyL') {
        e.preventDefault()
        toggleMode()
        return
      }
      // Cmd/Ctrl + Z to undo
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ' && !e.shiftKey) {
        e.preventDefault()
        undoChange()
        return
      }

      // Arrow key adjustments
      const isArrow = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)
      if (!isArrow) return

      e.preventDefault()
      const c = hslRef.current
      let { h, s, l } = c

      // Up/Down: Lightness
      if (e.code === 'ArrowUp') {
        const step = e.shiftKey ? L_KEY.step * L_KEY.shiftMultiplier : L_KEY.step
        l = Math.min(L_LIMITS.max, l + step)
      } else if (e.code === 'ArrowDown') {
        const step = e.shiftKey ? L_KEY.step * L_KEY.shiftMultiplier : L_KEY.step
        l = Math.max(L_LIMITS.min, l - step)
      }
      // Ctrl + Left/Right: Saturation
      else if (e.ctrlKey && e.code === 'ArrowRight') {
        const step = S_KEY.step
        s = Math.min(S_LIMITS.max, s + step)
      } else if (e.ctrlKey && e.code === 'ArrowLeft') {
        const step = S_KEY.step
        s = Math.max(S_LIMITS.min, s - step)
      }
      // Left/Right: Hue
      else if (e.code === 'ArrowRight') {
        const step = e.shiftKey ? H_KEY.step * H_KEY.shiftMultiplier : H_KEY.step
        const range = H_LIMITS.max - H_LIMITS.min
        h = H_LIMITS.min + ((h - H_LIMITS.min + step) % range + range) % range
      } else if (e.code === 'ArrowLeft') {
        const step = e.shiftKey ? H_KEY.step * H_KEY.shiftMultiplier : H_KEY.step
        const range = H_LIMITS.max - H_LIMITS.min
        h = H_LIMITS.min + ((h - H_LIMITS.min - step) % range + range) % range
      }

      const next = { h, s, l }
      hslRef.current = next
      setHsl(next)
      saveColor(next)

      setIsKeyAdjusting(true)
      clearTimeout(keyAdjustTimerRef.current)
      keyAdjustTimerRef.current = setTimeout(() => setIsKeyAdjusting(false), 300)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleMode, undoChange])

  // Convert saturation to oklch chroma (rough approximation)
  const chroma = (hsl.s / 100) * 0.4
  const bgHsl = `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`
  const bgOklch = `oklch(${hsl.l}% ${chroma.toFixed(3)} ${hsl.h})`

  const textColor = hsl.l > 50 ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.6)'
  const glassBg = hsl.l > 50 ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.08)'
  const glassBorder = hsl.l > 50 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)'

  // Vignette uses current hue but dark - opacity controlled for performance
  const vignetteColor = `hsl(${hsl.h}, ${Math.min(hsl.s + 20, 100)}%, ${V_LIGHTNESS}%)`

  return (
    <div
      className="app"
      style={{
        '--bg-hsl': bgHsl,
        '--bg-oklch': bgOklch,
        '--vignette-color': vignetteColor,
        '--vignette-opacity': vignette,
        '--vignette-blur': `${V_BLUR}px`,
        '--vignette-spread': `${V_SPREAD}px`,
        cursor: 'none'
      }}
      onContextMenu={(e) => e.preventDefault()}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Vignette overlay */}
      <div className="vignette" />

      <div
        className={`custom-cursor ${isDragging ? 'dragging' : ''} ${isOverNavbar ? 'hidden' : ''}`}
        style={{
          left: cursorPos.x,
          top: cursorPos.y,
          borderColor: textColor,
        }}
      />

      <nav
        className="navbar"
        style={{
          backgroundColor: glassBg,
          borderColor: glassBorder,
          color: textColor,
        }}
        onMouseEnter={() => setIsOverNavbar(true)}
        onMouseLeave={() => setIsOverNavbar(false)}
      >
        <div className="navbar-brand">Backlite</div>
        <div className="navbar-actions">
          <button
            className="mode-toggle"
            onClick={toggleAnimate}
            style={{
              backgroundColor: glassBg,
              borderColor: glassBorder,
              color: textColor,
            }}
          >
            <svg
              className={`aperture-icon ${(isDragging && animateColors) || isKeyAdjusting ? 'spinning' : ''}`}
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10"/>
              <line x1="14.31" y1="8" x2="20.05" y2="17.94"/>
              <line x1="9.69" y1="8" x2="21.17" y2="8"/>
              <line x1="7.38" y1="12" x2="13.12" y2="2.06"/>
              <line x1="9.69" y1="16" x2="3.95" y2="6.06"/>
              <line x1="14.31" y1="16" x2="2.83" y2="16"/>
              <line x1="16.62" y1="12" x2="10.88" y2="21.94"/>
            </svg>
            <span className="mode-label">Animate colors</span>
          </button>
          <button
            className="mode-toggle"
            onClick={toggleMode}
            style={{
              backgroundColor: glassBg,
              borderColor: glassBorder,
              color: textColor,
            }}
          >
            {isDarkMode ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"/>
                <line x1="12" y1="1" x2="12" y2="3"/>
                <line x1="12" y1="21" x2="12" y2="23"/>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                <line x1="1" y1="12" x2="3" y2="12"/>
                <line x1="21" y1="12" x2="23" y2="12"/>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            )}
            <span className="mode-label">{isDarkMode ? 'Lights on' : 'Lights off'}</span>
          </button>
        </div>
      </nav>
      
        {hintsVisible ? (
          <>
            <div className="debug" style={{ color: textColor }}>
              <div>pos: {cursorPos.x}, {cursorPos.y}</div>
              <div>delta: {delta.dx}, {delta.dy}</div>
              <div>h: {hsl.h?.toFixed(1) ?? '-'} s: {hsl.s?.toFixed(1) ?? '-'} l: {hsl.l?.toFixed(1) ?? '-'}</div>
              <div>dragging: {isDragging ? 'yes' : 'no'}</div>
            </div>

            <div className="hints" style={{ color: textColor }}>
              <div className="hints-segmented" style={{ borderColor: glassBorder }}>
                <button
                  className={`hints-segment${hintsPanel === 'drag' ? ' active' : ''}`}
                  style={{
                    backgroundColor: hintsPanel === 'drag' ? glassBg : 'transparent',
                    borderColor: glassBorder,
                    color: textColor,
                  }}
                  tabIndex={1}
                  onClick={() => { setHintsPanel('drag'); try { localStorage.setItem(HINTS_KEY, 'drag') } catch {} }}
                >Drag</button>
                <button
                  className={`hints-segment${hintsPanel === 'keyboard' ? ' active' : ''}`}
                  style={{
                    backgroundColor: hintsPanel === 'keyboard' ? glassBg : 'transparent',
                    borderColor: glassBorder,
                    color: textColor,
                  }}
                  tabIndex={1}
                  onClick={() => { setHintsPanel('keyboard'); try { localStorage.setItem(HINTS_KEY, 'keyboard') } catch {} }}
                >Keyboard</button>
              </div>
              {hintsPanel === 'drag' ? (
                <div className="hints-panel">
                  <div><code className="arrow" aria-label="up and down">↑ ↓</code> drag to change brightness</div>
                  <div><code className="arrow" aria-label="left and right">← →</code> drag to change hue</div>
                  <div><code>^ ctrl</code> + <code className="arrow" aria-label="left and right">← →</code> drag to change saturation</div>
                  <div><code>{isMac ? '⌥ opt' : 'alt'}</code> + <code>L</code> toggle lights</div>
                  <div><code>{isMac ? '⌘ cmd' : 'ctrl'}</code> + <code>Z</code> undo</div>
                  <div><code>{isMac ? '⌥ opt' : 'alt'}</code> + <code>H</code> hide hints</div>
                </div>
              ) : (
                <div className="hints-panel">
                  <div><code className="arrow" aria-label="up and down">↑ ↓</code> arrows for brightness (<code class="arrow">⇧</code> shift for larger steps)</div>
                  <div><code className="arrow" aria-label="left and right">← →</code> arrows for hue (<code class="arrow">⇧</code> shift for larger steps)</div>
                  <div><code>^ ctrl</code> + <code className="arrow" aria-label="left and right">← →</code> arrows for saturation</div>
                  <div><code>{isMac ? '⌥ opt' : 'alt'}</code> + <code>L</code> toggle lights</div>
                  <div><code>{isMac ? '⌘ cmd' : 'ctrl'}</code> + <code>Z</code> undo</div>
                  <div><code>{isMac ? '⌥ opt' : 'alt'}</code> + <code>H</code> hide hints</div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="hints hints-hidden" style={{ color: textColor }}>
            <div><code>{isMac ? '⌥ opt' : 'alt'}</code> + <code>H</code> show hints</div>
          </div>
        )}
      
    </div>
  )
}

export default App
