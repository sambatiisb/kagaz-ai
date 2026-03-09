'use client'

import { useRef, useState, useCallback } from 'react'

export interface VoiceSection {
  label: string
  text: string
}

interface VoicePlayerProps {
  sections: VoiceSection[]
}

type PlayState = 'idle' | 'loading' | 'playing'

// 20 bars with staggered delays for an organic waveform look
const BAR_DELAYS = [0, 120, 60, 200, 40, 160, 80, 240, 20, 140, 100, 220, 50, 170, 90, 250, 30, 150, 70, 230]

export function VoicePlayer({ sections }: VoicePlayerProps) {
  const [playState, setPlayState] = useState<PlayState>('idle')
  const [currentSection, setCurrentSection] = useState(-1)

  const audioRef       = useRef<HTMLAudioElement | null>(null)
  const abortRef       = useRef<AbortController | null>(null)
  const resolveRef     = useRef<(() => void) | null>(null)
  const cancelledRef   = useRef(false)

  // ── Stop everything ────────────────────────────────────────────────────────
  const stopAll = useCallback(() => {
    cancelledRef.current = true
    abortRef.current?.abort()
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
      audioRef.current = null
    }
    resolveRef.current?.()   // unblock any awaited playback promise
    resolveRef.current = null
    setPlayState('idle')
    setCurrentSection(-1)
  }, [])

  // ── Play sections sequentially ─────────────────────────────────────────────
  const playSections = useCallback(async () => {
    cancelledRef.current = false

    for (let i = 0; i < sections.length; i++) {
      if (cancelledRef.current) break

      const { text } = sections[i]
      if (!text || text === 'undefined') continue

      setCurrentSection(i)
      setPlayState('loading')

      try {
        // 1. Fetch audio from Azure Speech via our API route
        const abort = new AbortController()
        abortRef.current = abort

        const res = await fetch('/api/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
          signal: abort.signal,
        })

        if (!res.ok) throw new Error(`Speech API ${res.status}`)
        if (cancelledRef.current) break

        // 2. Create an object URL and play it
        const blob = await res.blob()
        if (cancelledRef.current) { URL.revokeObjectURL(URL.createObjectURL(blob)); break }

        const url = URL.createObjectURL(blob)
        setPlayState('playing')

        // 3. Await playback — resolveRef lets stopAll() break the await
        await new Promise<void>((resolve) => {
          resolveRef.current = resolve
          const audio = new Audio(url)
          audioRef.current = audio
          audio.onended  = () => { URL.revokeObjectURL(url); resolve() }
          audio.onerror  = () => { URL.revokeObjectURL(url); resolve() }
          audio.play().catch(() => resolve())
        })
        resolveRef.current = null

      } catch (err: unknown) {
        // AbortError = user pressed stop, not a real error
        const name = err instanceof Error ? err.name : ''
        if (name !== 'AbortError') console.error('[VoicePlayer]', err)
        break
      }
    }

    if (!cancelledRef.current) {
      setPlayState('idle')
      setCurrentSection(-1)
    }
  }, [sections])

  // ── Toggle handler ─────────────────────────────────────────────────────────
  const handleToggle = useCallback(() => {
    if (playState === 'idle') {
      playSections()
    } else {
      stopAll()
    }
  }, [playState, playSections, stopAll])

  const isActive = playState !== 'idle'

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #1B6B3A 0%, #0f3d22 100%)',
        borderRadius: '16px',
        overflow: 'hidden',
        boxShadow: '0 4px 20px rgba(0,0,0,0.18)',
      }}
    >
      {/* ── Header ───────────────────────────────────────── */}
      <div style={{ padding: '20px 20px 8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '12px',
            background: 'rgba(255,255,255,0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '22px',
            flexShrink: 0,
          }}
        >
          {playState === 'playing' ? '🔊' : '🔈'}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ color: 'white', fontWeight: 700, fontSize: '14px', lineHeight: '1.3', margin: 0 }}>
            आवाज़ में सुनिए
          </p>
          <p style={{ color: '#86efac', fontSize: '11px', margin: '2px 0 0' }}>
            Hindi voice explanation
          </p>
        </div>

        {isActive && currentSection >= 0 && (
          <span
            style={{
              background: 'rgba(255,255,255,0.12)',
              color: '#bbf7d0',
              fontSize: '11px',
              fontWeight: 600,
              padding: '3px 10px',
              borderRadius: '99px',
              flexShrink: 0,
            }}
          >
            {currentSection + 1} / {sections.length}
          </span>
        )}
      </div>

      {/* ── Waveform ─────────────────────────────────────── */}
      <div
        style={{
          padding: '0 20px',
          height: '52px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '3px',
        }}
      >
        {BAR_DELAYS.map((delay, i) => (
          <div
            key={i}
            style={{
              width: '4px',
              borderRadius: '2px',
              minHeight: '4px',
              maxHeight: '32px',
              background: playState === 'playing' ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.2)',
              height: playState === 'playing' ? undefined : '5px',
              transition: 'background 0.3s',
              ...(playState === 'playing'
                ? { animation: `wave ${0.45 + (i % 5) * 0.1}s ease-in-out ${delay}ms infinite alternate` }
                : {}),
            }}
          />
        ))}
      </div>

      {/* ── Section progress tabs ─────────────────────────── */}
      <div
        style={{
          padding: '12px 20px 16px',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '8px',
        }}
      >
        {sections.map((section, i) => {
          const isTabActive = currentSection === i
          const isDone      = currentSection > i
          return (
            <div
              key={i}
              style={{
                borderRadius: '12px',
                padding: '10px 8px',
                background: isTabActive
                  ? 'rgba(255,255,255,0.22)'
                  : isDone
                  ? 'rgba(255,255,255,0.1)'
                  : 'rgba(255,255,255,0.05)',
                border: isTabActive
                  ? '1px solid rgba(255,255,255,0.4)'
                  : '1px solid rgba(255,255,255,0.08)',
                transition: 'all 0.3s',
              }}
            >
              <div
                style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '9px',
                  fontWeight: 700,
                  marginBottom: '6px',
                  background: isTabActive ? 'white' : isDone ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)',
                  color: isTabActive ? '#1B6B3A' : 'white',
                }}
              >
                {isDone ? '✓' : i + 1}
              </div>
              <p
                style={{
                  fontSize: '10px',
                  fontWeight: 500,
                  lineHeight: '1.3',
                  margin: 0,
                  color: isTabActive ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.4)',
                  transition: 'color 0.3s',
                }}
              >
                {section.label}
              </p>
            </div>
          )
        })}
      </div>

      {/* ── Play / Stop / Loading button ─────────────────── */}
      <div style={{ padding: '0 20px 20px' }}>
        <button
          onClick={handleToggle}
          disabled={false}
          style={{
            width: '100%',
            padding: '14px 0',
            borderRadius: '12px',
            fontWeight: 700,
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            cursor: 'pointer',
            border: isActive ? '1px solid rgba(255,255,255,0.3)' : 'none',
            background: isActive ? 'rgba(255,255,255,0.15)' : 'white',
            color: isActive ? 'white' : '#1B6B3A',
            boxShadow: !isActive ? '0 2px 12px rgba(0,0,0,0.2)' : 'none',
            transition: 'all 0.2s',
          }}
        >
          {playState === 'loading' && (
            <>
              <LoadingDots />
              <span>लोड हो रहा है</span>
              <span style={{ opacity: 0.6, fontWeight: 500 }}>· Loading</span>
            </>
          )}
          {playState === 'playing' && (
            <>
              <span>⏹</span>
              <span>रोकिए</span>
              <span style={{ opacity: 0.6, fontWeight: 500 }}>· Stop</span>
            </>
          )}
          {playState === 'idle' && (
            <>
              <span>▶</span>
              <span>सुनिए</span>
              <span style={{ opacity: 0.6, fontWeight: 500 }}>· Play</span>
            </>
          )}
        </button>
      </div>
    </div>
  )
}

// Small inline loading indicator for the button
function LoadingDots() {
  return (
    <span style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: '5px',
            height: '5px',
            borderRadius: '50%',
            background: 'white',
            display: 'inline-block',
            animation: `bounce 0.8s ease-in-out ${i * 0.15}s infinite`,
          }}
        />
      ))}
    </span>
  )
}
