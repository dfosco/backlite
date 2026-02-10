import { useState, useEffect, useCallback, useRef } from 'react'
import './App.css'
import config from './config.json'

const DEBUG = import.meta.env.DEV && import.meta.env.VITE_DEBUG === 'true'

const DEFAULT_HSL = config.default
const STORAGE_KEY = config.storageKey
const { h: H_LIMITS, s: S_LIMITS, l: L_LIMITS } = config.limits
const { hCyclesPerVW, sCyclesPerVW, lCyclesPerVH } = config.sensitivity
const { x: X_DEADZONE, y: Y_DEADZONE } = config.deadzone

function getStoredColor() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      // Validate stored values
      if (typeof parsed.h === 'number' && typeof parsed.s === 'number' && typeof parsed.l === 'number') {
        return parsed
      }
    }
  } catch {
    // Ignore
  }
  return DEFAULT_HSL
}

function saveColor(hsl) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(hsl))
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

  const prevPosRef = useRef(null)
  const hslRef = useRef(hsl)

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
    setHsl(next)
  }, [])

  const onMouseDown = useCallback((e) => {
    if (e.target.closest('.navbar')) return
    setIsDragging(true)
    prevPosRef.current = { x: e.clientX, y: e.clientY }
  }, [])

  const onMouseMove = useCallback((e) => {
    setCursorPos({ x: e.clientX, y: e.clientY })

    if (!isDragging || !prevPosRef.current) return

    const dx = e.clientX - prevPosRef.current.x
    const dy = e.clientY - prevPosRef.current.y

    updateColor(dx, dy, e.ctrlKey || e.metaKey)
    prevPosRef.current = { x: e.clientX, y: e.clientY }
  }, [isDragging, updateColor])

  const onMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false)
      saveColor(hslRef.current)
    }
    prevPosRef.current = null
  }, [isDragging])

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
      saveColor(hslRef.current)
    }
    prevPosRef.current = null
    setCursorPos({ x: -100, y: -100 })
  }, [isDragging])

  const bg = `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`
  const textColor = hsl.l > 50 ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.6)'
  const glassBg = hsl.l > 50 ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.08)'
  const glassBorder = hsl.l > 50 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)'

  return (
    <div
      className="app"
      style={{ backgroundColor: bg, cursor: 'none' }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
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
      </nav>
      
        <div className="debug" style={{ color: textColor }}>
          <div>pos: {cursorPos.x}, {cursorPos.y}</div>
          <div>delta: {delta.dx}, {delta.dy}</div>
          <div>h: {hsl.h?.toFixed(1) ?? '-'} s: {hsl.s?.toFixed(1) ?? '-'} l: {hsl.l?.toFixed(1) ?? '-'}</div>
          <div>dragging: {isDragging ? 'yes' : 'no'}</div>
        </div>
      
        <div className="hints" style={{ color: textColor }}>
          <div>Drag up / down ↑ ↓ down to change brightness</div>
          <div>Drag left / right to change hue</div>
          <div>Hold <code>cmd</code> + drag left / right to change saturation</div>
        </div>
      
    </div>
  )
}

export default App
