'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getProfile, hasRequiredDocs } from '@/lib/profile'

// ── Types ──────────────────────────────────────────────────────────────────────
interface FilledField {
  label: string
  value: string
  source: string
  xPct: number      // LEFT edge of blank space (as % of form width)
  yPct: number      // VERTICAL CENTRE of the field line (as % of form height)
  widthPct?: number // width of blank space — used to scale font
  confidence: number
}

interface ValidationError {
  field: string
  message: string
  severity: 'error' | 'warning'
}

interface FillResult {
  formType: string
  fields: FilledField[]
  unfilled: string[]
  instructions: string
}

type AppState = 'upload' | 'filling' | 'filled' | 'validating' | 'validated' | 'downloading'

// ── Source badge color ────────────────────────────────────────────────────────
function sourceColor(source: string | null | undefined): string {
  if (!source) return '#374151'
  const s = source.toLowerCase()
  if (s.includes('aadhaar') || s.includes('आधार')) return '#1B6B3A'
  if (s.includes('pan')) return '#7C3AED'
  if (s.includes('bank')) return '#0369A1'
  if (s.includes('ration')) return '#B45309'
  if (s.includes('passport')) return '#9F1239'
  return '#374151'
}

// ── Voice helper ──────────────────────────────────────────────────────────────
async function speakHindi(text: string) {
  try {
    const res = await fetch('/api/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, lang: 'hi-IN' }),
    })
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audio.play()
    audio.onended = () => URL.revokeObjectURL(url)
  } catch { /* best-effort */ }
}

// ── Load image from URL (no crossOrigin — works for blob: URLs) ───────────────
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    // Do NOT set crossOrigin on blob: URLs — it silently breaks loading
    img.onload  = () => resolve(img)
    img.onerror = (_e) => reject(new Error('Image failed to load'))
    img.src = src
  })
}

// ── Draw filled form on canvas → returns data URL ─────────────────────────────
// xPct = LEFT edge of blank space  (NOT centre)
// yPct = VERTICAL CENTRE of field line  (we draw the baseline below centre)
function drawFilledCanvas(
  img: HTMLImageElement,
  fields: FilledField[],
  errors: ValidationError[]
): string {
  const canvas = document.createElement('canvas')
  canvas.width  = img.naturalWidth  || img.width
  canvas.height = img.naturalHeight || img.height
  const ctx = canvas.getContext('2d')!

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

  const W = canvas.width
  const H = canvas.height

  // Base font size — relative to form width, like typewritten text
  // Typical form field height ≈ 1.5–2% of page height; font at ~60% of that
  const baseFontSize = Math.max(10, Math.min(W * 0.016, 15))

  for (const field of fields) {
    // Skip fields with no real value (Phi-4 returns null/"null" for unknowns)
    if (!field.value || field.value === 'null' || !field.xPct || !field.yPct) continue

    // x = left edge of blank space + small padding so text doesn't hug the border
    const x  = (field.xPct / 100) * W + 3
    // y = vertical centre of the field line
    const cy = (field.yPct / 100) * H

    // If the API gave us the blank-space width, use it to scale the font down to fit
    const boxWidthPx = field.widthPct ? (field.widthPct / 100) * W : W * 0.45

    // Start with base font size, then shrink if the text is too wide
    ctx.font = `${baseFontSize}px Arial, sans-serif`
    const textW = ctx.measureText(field.value).width
    let fontSize = baseFontSize
    if (textW > boxWidthPx * 0.92 && boxWidthPx > 20) {
      fontSize = Math.max(8, baseFontSize * (boxWidthPx * 0.92 / textW))
      ctx.font = `${fontSize}px Arial, sans-serif`
    }

    const err = errors.find((e) => e.field.toLowerCase() === field.label.toLowerCase())
    ctx.fillStyle = err?.severity === 'error'
      ? '#DC2626'
      : err?.severity === 'warning'
      ? '#B45309'
      : '#1a3a6b'   // dark navy — looks like typed ink

    // Canvas fillText draws from the text BASELINE.
    // To visually centre text around cy, shift baseline = cy + (fontSize × 0.35)
    // (cap-height ≈ 70% of fontSize, so centre of caps is 0.35 × fontSize above baseline)
    ctx.fillText(field.value, x, cy + fontSize * 0.35)
  }

  // Subtle watermark
  ctx.globalAlpha = 0.10
  ctx.fillStyle = '#1B6B3A'
  ctx.font = `${Math.max(9, W * 0.011)}px Arial, sans-serif`
  ctx.fillText('Kagaz AI', 8, H - 6)
  ctx.globalAlpha = 1

  return canvas.toDataURL('image/png')
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function FillPage() {
  const router = useRouter()
  const fileInputRef  = useRef<HTMLInputElement>(null)
  const hiddenImgRef  = useRef<HTMLImageElement>(null)   // hidden, used for canvas draw

  // null = still checking, true = ok, false = needs onboarding
  const [aadhaarReady, setAadhaarReady] = useState<boolean | null>(null)

  const [appState, setAppState]         = useState<AppState>('upload')
  const [formFile, setFormFile]         = useState<File | null>(null)
  const [formImageUrl, setFormImageUrl] = useState<string | null>(null)
  const [fillResult, setFillResult]     = useState<FillResult | null>(null)
  const [filledImageUrl, setFilledImageUrl] = useState<string | null>(null) // baked canvas
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([])
  const [fillError, setFillError]       = useState<string | null>(null)
  const [validateError, setValidateError] = useState<string | null>(null)

  // ── Guard: check Aadhaar synchronously on mount ───────────────────────────
  useEffect(() => {
    const p = getProfile()
    if (!hasRequiredDocs(p)) {
      setAadhaarReady(false)
      router.replace('/onboard')
    } else {
      setAadhaarReady(true)
    }
  }, [router])

  // ── Auto-render filled canvas when fillResult arrives ────────────────────
  useEffect(() => {
    if (!fillResult || !formImageUrl) return
    let cancelled = false
    loadImage(formImageUrl)
      .then((img) => {
        if (cancelled) return
        const dataUrl = drawFilledCanvas(img, fillResult.fields, [])
        setFilledImageUrl(dataUrl)
      })
      .catch(() => {/* best-effort */})
    return () => { cancelled = true }
  }, [fillResult, formImageUrl])

  // Re-render canvas with error colors after validation
  useEffect(() => {
    if (!fillResult || !formImageUrl || validationErrors.length === 0) return
    let cancelled = false
    loadImage(formImageUrl)
      .then((img) => {
        if (cancelled) return
        const dataUrl = drawFilledCanvas(img, fillResult.fields, validationErrors)
        setFilledImageUrl(dataUrl)
      })
      .catch(() => {/* best-effort */})
    return () => { cancelled = true }
  }, [validationErrors, fillResult, formImageUrl])

  // ── Fill logic ─────────────────────────────────────────────────────────────
  async function doFill(file: File) {
    const profile = getProfile()
    if (!profile) return

    setAppState('filling')
    setFillError(null)
    setFilledImageUrl(null)

    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('profile', JSON.stringify(profile))

      const res = await fetch('/api/fill-form', { method: 'POST', body: fd })
      const json = await res.json()

      if (!res.ok || json.error) throw new Error(json.error ?? 'Form filling failed.')

      setFillResult(json as FillResult)
      setAppState('filled')
      speakHindi(
        `फॉर्म भर दिया गया है। ${json.fields?.length ?? 0} फील्ड भरे गए।`
      )
    } catch (err) {
      setFillError(err instanceof Error ? err.message : 'An error occurred.')
      setAppState('upload')
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (formImageUrl) URL.revokeObjectURL(formImageUrl)
    const url = URL.createObjectURL(file)
    setFormFile(file)
    setFormImageUrl(url)
    setFillResult(null)
    setFilledImageUrl(null)
    setValidationErrors([])
    setFillError(null)
    setAppState('upload')
    // Direct call — no useEffect loop
    doFill(file)
  }

  async function handleValidate() {
    if (!fillResult) return
    setAppState('validating')
    setValidateError(null)

    try {
      const profile = getProfile()
      const res = await fetch('/api/validate-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: fillResult.fields, profile }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Validation failed.')
      setValidationErrors(json.errors ?? [])
      setAppState('validated')

      const errCount  = (json.errors ?? []).filter((e: ValidationError) => e.severity === 'error').length
      const warnCount = (json.errors ?? []).filter((e: ValidationError) => e.severity === 'warning').length
      if (errCount === 0 && warnCount === 0) {
        speakHindi('सभी फील्ड सही हैं। कोई गलती नहीं मिली।')
      } else {
        speakHindi(`${errCount} गलती और ${warnCount} चेतावनी मिली।`)
      }
    } catch (err) {
      setValidateError(err instanceof Error ? err.message : 'Validation error.')
      setAppState('filled')
    }
  }

  function handleDownload() {
    if (!filledImageUrl || !fillResult) return
    const link = document.createElement('a')
    link.href = filledImageUrl
    link.download = `${(fillResult.formType ?? 'form').replace(/\s+/g, '-')}-filled.png`
    link.click()
  }

  async function handleWhatsApp() {
    if (!filledImageUrl) return
    const blob = await fetch(filledImageUrl).then((r) => r.blob())
    const file  = new File([blob], 'filled-form.png', { type: 'image/png' })
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'भरा हुआ फॉर्म — Kagaz AI',
          text: 'Kagaz AI से भरा गया फॉर्म।',
          files: [file],
        })
        return
      } catch { /* fall through */ }
    }
    const text = encodeURIComponent('Kagaz AI से मेरा फॉर्म भरा गया।')
    window.open(`https://wa.me/?text=${text}`, '_blank')
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const errorCount   = validationErrors.filter((e) => e.severity === 'error').length
  const warningCount = validationErrors.filter((e) => e.severity === 'warning').length
  const isValidated  = appState === 'validated' || appState === 'downloading'
  const isLoading    = appState === 'filling' || appState === 'validating'

  // ── Blocking screen while checking Aadhaar ────────────────────────────────
  if (aadhaarReady === null || aadhaarReady === false) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <svg className="animate-spin h-8 w-8 text-primary" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <p className="text-gray-500 text-sm">जाँच हो रही है… / Checking…</p>
        </div>
      </div>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-cream flex flex-col">
      {/* Header */}
      <header className="bg-primary shadow-md sticky top-0 z-30">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.push('/')} className="text-green-200 hover:text-white text-xl" aria-label="Back">←</button>
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center flex-shrink-0">
            <span className="text-white font-black text-sm">K</span>
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-white font-bold text-base leading-tight truncate">
              {fillResult?.formType ?? 'फॉर्म भरें'}
            </h1>
            <p className="text-green-200 text-xs">Fill Any Form · AI Auto-Fill</p>
          </div>
          <button onClick={() => router.push('/onboard')} className="text-green-200 text-xs hover:text-white">
            📋 Docs
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-5 flex flex-col gap-5">

        {/* ── Upload zone ─────────────────────────────────────────────────── */}
        {appState === 'upload' && !formFile && (
          <div className="flex flex-col gap-4">
            <div className="text-center py-2">
              <p className="text-gray-700 font-bold text-lg">खाली फॉर्म अपलोड करें</p>
              <p className="text-gray-400 text-sm">Upload blank form · JPEG, PNG, or WebP</p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleFileChange}
            />

            <div className="flex gap-3">
              {/* Upload file */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 border-2 border-dashed border-accent rounded-2xl py-10 flex flex-col items-center gap-2 hover:bg-orange-50 transition"
              >
                <span className="text-4xl">📤</span>
                <span className="text-accent font-bold text-sm">फाइल अपलोड करें</span>
                <span className="text-gray-400 text-xs">Upload file</span>
              </button>
              {/* Camera */}
              <button
                onClick={() => {
                  const tmp = document.createElement('input')
                  tmp.type = 'file'; tmp.accept = 'image/jpeg,image/png,image/webp'; tmp.capture = 'environment'
                  tmp.onchange = (e) => {
                    const f = (e.target as HTMLInputElement).files?.[0]
                    if (f) { const ev = { target: { files: [f] } } as unknown as React.ChangeEvent<HTMLInputElement>; handleFileChange(ev) }
                  }
                  tmp.click()
                }}
                className="flex-1 border-2 border-dashed border-primary rounded-2xl py-10 flex flex-col items-center gap-2 hover:bg-green-50 transition"
              >
                <span className="text-4xl">📷</span>
                <span className="text-primary font-bold text-sm">फोटो लें</span>
                <span className="text-gray-400 text-xs">Take photo</span>
              </button>
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-blue-700 text-sm">
              💡 <strong>टिप:</strong> फॉर्म को पूरी तरह फ्रेम में रखें, रोशनी अच्छी हो।
            </div>
          </div>
        )}

        {/* ── Filling spinner ──────────────────────────────────────────────── */}
        {appState === 'filling' && (
          <div className="flex flex-col items-center gap-6 py-10">
            {formImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={formImageUrl} alt="Form" className="max-h-48 rounded-xl shadow object-contain opacity-50" />
            )}
            <svg className="animate-spin h-10 w-10 text-primary" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <p className="text-primary font-bold text-base">AI भर रहा है…</p>
            <p className="text-gray-400 text-sm text-center">
              Reading your form and matching your documents…<br />
              <span className="text-xs">(This may take 30–40 seconds)</span>
            </p>
          </div>
        )}

        {/* ── Fill error ───────────────────────────────────────────────────── */}
        {fillError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-4 flex flex-col gap-2">
            <p className="text-red-700 font-bold text-sm">⚠️ {fillError}</p>
            <button
              onClick={() => { setFormFile(null); setFormImageUrl(null); setFillError(null); setAppState('upload') }}
              className="self-start text-red-500 text-sm underline"
            >
              दोबारा कोशिश करें / Try again
            </button>
          </div>
        )}

        {/* ── Filled form view ─────────────────────────────────────────────── */}
        {(appState === 'filled' || isValidated) && fillResult && (
          <div className="flex flex-col gap-4">

            {/* Summary bar */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-primary font-bold text-sm">✅ {fillResult.fields.length} फील्ड भरे गए</p>
                <p className="text-gray-400 text-xs">{fillResult.fields.length} fields auto-filled</p>
              </div>
              <button
                onClick={() => { setFormFile(null); setFormImageUrl(null); setFillResult(null); setFilledImageUrl(null); setValidationErrors([]); setAppState('upload') }}
                className="text-gray-400 text-xs hover:text-gray-600 underline"
              >
                नया फॉर्म
              </button>
            </div>

            {/* ── FILLED FORM IMAGE (canvas-baked) ── */}
            <div className="rounded-xl overflow-hidden shadow-lg border border-gray-200 bg-white">
              {filledImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={filledImageUrl}
                  alt="Filled form"
                  className="w-full block"
                />
              ) : (
                /* Loading canvas render */
                <div className="relative">
                  {formImageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={formImageUrl} alt="Form" className="w-full block opacity-50" />
                  )}
                  <div className="absolute inset-0 flex items-center justify-center bg-white/60">
                    <svg className="animate-spin h-8 w-8 text-primary" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  </div>
                </div>
              )}
            </div>

            {/* ── Filled fields list ── */}
            <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                <p className="text-gray-700 font-bold text-sm">भरे गए फील्ड / Filled Fields</p>
              </div>
              <div className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
                {fillResult.fields.filter(f => f.value && f.value !== 'null').map((field, i) => {
                  const err = validationErrors.find((e) => e.field.toLowerCase() === field.label.toLowerCase())
                  return (
                    <div key={i} className="px-4 py-2.5 flex items-start gap-3">
                      <span
                        className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                        style={{ background: err ? (err.severity === 'error' ? '#DC2626' : '#D97706') : '#1B6B3A' }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-gray-500 text-xs">{field.label}</p>
                        <p className="text-gray-900 text-sm font-medium">{field.value}</p>
                        {err && (
                          <p className={`text-xs mt-0.5 ${err.severity === 'error' ? 'text-red-600' : 'text-amber-600'}`}>
                            {err.severity === 'error' ? '⛔' : '⚠️'} {err.message}
                          </p>
                        )}
                      </div>
                      {field.source && field.source !== 'null' && (
                        <span
                          className="text-xs px-2 py-0.5 rounded-full text-white flex-shrink-0"
                          style={{ background: sourceColor(field.source) }}
                        >
                          {field.source}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Validation results */}
            {isValidated && validationErrors.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className={`px-4 py-2.5 flex items-center gap-2 ${errorCount > 0 ? 'bg-red-50' : 'bg-amber-50'}`}>
                  <span>{errorCount > 0 ? '⛔' : '⚠️'}</span>
                  <p className={`font-bold text-sm ${errorCount > 0 ? 'text-red-700' : 'text-amber-700'}`}>
                    {errorCount} गलती · {warningCount} चेतावनी मिली
                  </p>
                </div>
                <div className="divide-y divide-gray-100">
                  {validationErrors.map((e, i) => (
                    <div key={i} className="px-4 py-3 flex items-start gap-3">
                      <span className={`text-sm flex-shrink-0 mt-0.5 ${e.severity === 'error' ? 'text-red-500' : 'text-amber-500'}`}>
                        {e.severity === 'error' ? '⛔' : '⚠️'}
                      </span>
                      <div>
                        <p className="text-gray-700 font-medium text-sm">{e.field}</p>
                        <p className="text-gray-500 text-xs">{e.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {isValidated && validationErrors.length === 0 && (
              <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-3">
                <span className="text-2xl">✅</span>
                <div>
                  <p className="text-green-700 font-bold text-sm">सभी फील्ड सही हैं!</p>
                  <p className="text-green-600 text-xs">All fields validated successfully.</p>
                </div>
              </div>
            )}

            {/* Instructions */}
            {fillResult.instructions && (
              <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
                <p className="text-blue-800 text-xs font-bold mb-1">📌 निर्देश / Instructions</p>
                <p className="text-blue-700 text-sm leading-relaxed">{fillResult.instructions}</p>
              </div>
            )}

            {/* Unfilled fields */}
            {fillResult.unfilled?.length > 0 && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
                <p className="text-gray-600 text-xs font-bold mb-1.5">✍️ खुद भरें — Fill manually</p>
                <div className="flex flex-wrap gap-1.5">
                  {fillResult.unfilled.map((f, i) => {
                    const label = typeof f === 'string' ? f : (f as {label?: string}).label ?? JSON.stringify(f)
                    return (
                      <span key={`${label}-${i}`} className="bg-white border border-gray-300 text-gray-600 text-xs px-2 py-0.5 rounded-full">{label}</span>
                    )
                  })}
                </div>
              </div>
            )}

            {validateError && (
              <p className="text-red-500 text-xs text-center">{validateError}</p>
            )}

            {/* ── Action buttons ── */}
            <div className="flex flex-col gap-3 pb-4">
              {!isValidated && (
                <button
                  onClick={handleValidate}
                  disabled={isLoading}
                  className="flex items-center justify-center gap-2 border-2 border-primary text-primary font-bold py-3.5 rounded-2xl text-sm hover:bg-green-50 transition disabled:opacity-60"
                >
                  {appState === 'validating' ? (
                    <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg> जाँच हो रही है…</>
                  ) : <>🔍 गलती जाँचें — Validate</>}
                </button>
              )}

              <div className="flex gap-3">
                <button
                  onClick={handleDownload}
                  disabled={!filledImageUrl || isLoading}
                  className="flex-1 bg-primary text-white font-bold py-3.5 rounded-2xl text-sm shadow hover:bg-primary/90 transition flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  ⬇️ डाउनलोड
                </button>

                <button
                  onClick={handleWhatsApp}
                  disabled={!filledImageUrl || isLoading}
                  className="flex-1 bg-[#25D366] text-white font-bold py-3.5 rounded-2xl text-sm shadow hover:bg-[#1ebe59] transition flex items-center justify-center gap-2 disabled:opacity-40"
                >
                  📤 WhatsApp
                </button>
              </div>

              <button onClick={() => router.push('/')} className="text-gray-400 text-sm text-center underline">
                🏠 होम पर वापस जाएं
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Hidden img for canvas reference — only rendered when a URL exists */}
      {formImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={hiddenImgRef} src={formImageUrl} alt="" className="hidden" />
      )}

      <footer className="text-center py-3 border-t border-gray-100">
        <p className="text-gray-400 text-xs">Kagaz AI · AI-Powered Form Filling · Azure AI</p>
      </footer>
    </div>
  )
}
