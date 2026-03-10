import { NextRequest, NextResponse } from 'next/server'
import { AzureOpenAI } from 'openai'
import { DocumentAnalysisClient, AzureKeyCredential } from '@azure/ai-form-recognizer'

export const runtime = 'nodejs'
export const maxDuration = 120

// ── Clients ───────────────────────────────────────────────────────────────────
function getOpenAIClient() {
  const endpoint   = process.env.AZURE_OPENAI_ENDPOINT
  const apiKey     = process.env.AZURE_OPENAI_API_KEY
  const deployment = process.env.AZURE_OPENAI_VISION_DEPLOYMENT || process.env.AZURE_OPENAI_DEPLOYMENT
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? '2024-02-01'
  if (!endpoint || !apiKey || !deployment) throw new Error('Azure OpenAI not configured.')
  return { client: new AzureOpenAI({ endpoint, apiKey, deployment, apiVersion }), deployment }
}

function getDIClient() {
  const endpoint = process.env.AZURE_DI_ENDPOINT
  const key      = process.env.AZURE_DI_KEY
  if (!endpoint || !key) throw new Error('Azure Document Intelligence not configured.')
  return new DocumentAnalysisClient(endpoint, new AzureKeyCredential(key))
}

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

// ── Bounding box helper ────────────────────────────────────────────────────────
// CRITICAL: @azure/ai-form-recognizer SDK v5 transforms the REST API's flat
// number[] polygons into {x,y}[] Point2D objects via toBoundingPolygon().
// So at runtime, polygon is ALWAYS {x,y}[] even though TypeScript types say number[].
// We must extract x and y from the objects, not treat them as a flat array.
// W and H are the page dimensions in the same unit as the coordinates (pixels for images).
type PolygonPoint = { x: number; y: number }
function polygonToBbox(polygon: PolygonPoint[] | number[] | undefined, W: number, H: number) {
  if (!polygon || polygon.length < 4) return null

  let xs: number[], ys: number[]
  if (typeof polygon[0] === 'object' && polygon[0] !== null) {
    // Point2D[] — the SDK-transformed format (always the case with v5)
    const pts = polygon as PolygonPoint[]
    xs = pts.map(p => p.x)
    ys = pts.map(p => p.y)
  } else {
    // Flat number[] — kept as fallback for raw REST responses
    const nums = polygon as number[]
    xs = nums.filter((_, i) => i % 2 === 0)
    ys = nums.filter((_, i) => i % 2 === 1)
  }

  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  const x1 = clamp((Math.min(...xs) / W) * 100, 0.5, 98)
  const y1 = clamp((Math.min(...ys) / H) * 100, 0.5, 98)
  const x2 = clamp((Math.max(...xs) / W) * 100, 1.5, 99)
  const y2 = clamp((Math.max(...ys) / H) * 100, 1.5, 99)
  return { x1, y1, x2, y2, xCtr: (x1 + x2) / 2, yCtr: (y1 + y2) / 2 }
}

// ── Is this cell content a blank/value slot? ──────────────────────────────────
function isBlankCell(content: string): boolean {
  const t = content.trim()
  // Empty, underscores, dashes, dots, colon-only → blank slot
  return t.length === 0 || /^[\s_\-\.\:]+$/.test(t)
}

// ── Is this cell a field label? ───────────────────────────────────────────────
function isLabelCell(content: string): boolean {
  const t = content.trim()
  return t.length >= 2 && t.length <= 80 && !isBlankCell(t)
}

export async function POST(request: NextRequest) {
  try {
    const formData   = await request.formData()
    const file       = formData.get('file')    as File   | null
    const profileStr = formData.get('profile') as string | null

    if (!file || !profileStr) {
      return NextResponse.json({ error: 'file and profile are required.' }, { status: 400 })
    }
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      return NextResponse.json({ error: 'Only JPEG, PNG, or WebP images are supported.' }, { status: 400 })
    }

    const profile = JSON.parse(profileStr)
    const bytes   = await file.arrayBuffer()
    const buffer  = Buffer.from(bytes)

    // ── Step 1: Azure DI — extract layout, tables, KV pairs ─────────────────
    const diClient = getDIClient()
    const poller   = await diClient.beginAnalyzeDocument(
      'prebuilt-layout',   // layout model is better for blank forms than prebuilt-document
      buffer
    )
    const diResult = await poller.pollUntilDone()

    // Normalise coordinates: divide by page dimension (same units as polygon coords).
    const pageW = diResult.pages?.[0]?.width  ?? 8.5
    const pageH = diResult.pages?.[0]?.height ?? 11
    const W = pageW
    const H = pageH

    // ── 1a. Collect text lines ─────────────────────────────────────────────
    const textLines: Array<{ text: string; x1: number; y1: number; x2: number; y2: number; yCtr: number }> = []
    for (const page of diResult.pages ?? []) {
      for (const line of page.lines ?? []) {
        const b = polygonToBbox(line.polygon as number[] | undefined, W, H)
        if (b) textLines.push({ text: line.content, x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2, yCtr: b.yCtr })
      }
    }

    // ── 1b. Find field positions from TABLE structure (most accurate) ────────
    // Indian government forms are grids: label cells → blank cells in same row
    interface FieldSlot {
      label: string   // what the field asks for
      xPct: number    // left edge of blank space
      yPct: number    // vertical centre of blank space
      widthPct: number
      source: 'table' | 'kv' | 'inline'
    }
    const fieldSlots: FieldSlot[] = []

    for (const table of diResult.tables ?? []) {
      // Build a row-indexed map of cells
      type CellEntry = { colIndex: number; content: string; bbox: ReturnType<typeof polygonToBbox> }
      const rowMap = new Map<number, CellEntry[]>()

      for (const cell of table.cells ?? []) {
        const region = cell.boundingRegions?.[0]
        if (!region?.polygon) continue
        const bbox = polygonToBbox(region.polygon as unknown as number[] | undefined, W, H)
        if (!bbox) continue
        if (!rowMap.has(cell.rowIndex)) rowMap.set(cell.rowIndex, [])
        rowMap.get(cell.rowIndex)!.push({
          colIndex: cell.columnIndex,
          content:  cell.content?.trim() ?? '',
          bbox,
        })
      }

      // For each row, scan left→right: label cell followed by blank cells = field.
      // IMPORTANT: Aadhaar-style forms use character-box GRIDS — each tiny box is
      // its own table cell (e.g. "Full Name:" followed by 24 tiny blank cells).
      // We must merge ALL consecutive blank cells after a label into one wide
      // bounding box so the text is placed over the full input area.
      for (const [, cells] of rowMap) {
        cells.sort((a, b) => a.colIndex - b.colIndex)

        let i = 0
        while (i < cells.length) {
          const cur = cells[i]

          if (!isLabelCell(cur.content)) { i++; continue }

          // Collect ALL consecutive blank cells that follow this label
          let mergedX1: number | null = null
          let mergedX2: number | null = null
          let mergedY1: number | null = null
          let mergedY2: number | null = null
          let blankCount = 0
          let lastBlankIdx = i

          for (let j = i + 1; j < cells.length; j++) {
            const nc = cells[j]
            if (!isBlankCell(nc.content) || !nc.bbox) break
            if (mergedX1 === null) mergedX1 = nc.bbox.x1
            mergedX2 = nc.bbox.x2
            if (mergedY1 === null) mergedY1 = nc.bbox.y1
            mergedY2 = nc.bbox.y2
            blankCount++
            lastBlankIdx = j
          }

          if (blankCount > 0
              && mergedX1 !== null && mergedX2 !== null
              && mergedY1 !== null && mergedY2 !== null) {
            fieldSlots.push({
              label:    cur.content.replace(/:\s*$/, '').trim(),
              xPct:     mergedX1 + 1,
              yPct:     (mergedY1 + mergedY2) / 2,
              widthPct: Math.max(5, mergedX2 - mergedX1 - 2),
              source:   'table',
            })
            i = lastBlankIdx + 1  // skip past all consumed blank cells
          } else {
            i++
          }
        }
      }
    }

    // ── 1c. KV pairs (fallback for non-table forms) ────────────────────────
    for (const kv of (diResult as { keyValuePairs?: Array<{
      key?: { content?: string; boundingRegions?: Array<{ polygon?: number[] }> };
      value?: { content?: string; boundingRegions?: Array<{ polygon?: number[] }> };
    }> }).keyValuePairs ?? []) {
      if (!kv.key?.content) continue
      const label = kv.key.content.replace(/:\s*$/, '').trim()
      // Skip if already captured from table
      if (fieldSlots.some(s => s.label.toLowerCase() === label.toLowerCase())) continue

      const kReg = kv.key.boundingRegions?.[0]
      const vReg = kv.value?.boundingRegions?.[0]
      const kb   = polygonToBbox(kReg?.polygon as number[] | undefined, W, H)
      const vb   = vReg ? polygonToBbox(vReg.polygon as number[] | undefined, W, H) : null

      if (vb) {
        fieldSlots.push({ label, xPct: vb.x1 + 1, yPct: vb.yCtr, widthPct: Math.max(5, vb.x2 - vb.x1 - 2), source: 'kv' })
      } else if (kb) {
        // No value region — estimate: start just after the label's right edge
        fieldSlots.push({ label, xPct: kb.x2 + 2, yPct: kb.yCtr, widthPct: 40, source: 'inline' })
      }
    }

    // ── 1d. Inline text-only fallback (forms with no table/kv structure) ────
    // For forms like Aadhaar where character-box grids don't produce table cells:
    //   - Labels appear as text lines (e.g. "Full Name:" at x≈5–21%)
    //   - Input boxes are EMPTY so they generate no text lines
    //   - ALL input boxes start at the SAME X position (the right-column start)
    //     regardless of label length — "C/o:" and "House No./Bldg./Apt:" both
    //     have their boxes at the same X. We must not place text at each label's
    //     own right-edge or short labels land inside their own text.
    if (fieldSlots.length === 0) {
      // Pass 1: collect all candidate label lines
      const candidateLines: typeof textLines = []
      for (const line of textLines) {
        if (!line.text.trim().endsWith(':') && !line.text.trim().match(/name|dob|date|address|no\.|number|pin|village|town|city|district|state|landmark|road|lane|sector|locality|post|office|c\/o/i)) continue
        candidateLines.push(line)
      }

      // Pass 2: find the right-column start = the WIDEST label's right edge + gap.
      // Only consider labels whose x2 is in the main left column (< 50%),
      // ignoring page headers that span full width.
      const mainColX2s = candidateLines.map(l => l.x2).filter(x => x < 50)
      const rightColStart = mainColX2s.length > 0
        ? Math.max(...mainColX2s) + 4   // widest label right edge + gap to clear border
        : 23                             // fallback

      // Pass 3: build field slots, all with the same consistent X start
      for (const line of candidateLines) {
        const label = line.text.replace(/:\s*$/, '').trim()
        if (fieldSlots.some(s => s.label.toLowerCase() === label.toLowerCase())) continue
        fieldSlots.push({
          label,
          xPct:     rightColStart,              // consistent across all fields
          yPct:     line.yCtr,                  // same row as the label
          widthPct: Math.max(40, 92 - rightColStart),
          source:   'inline',
        })
      }
    }

    console.log(`[fill-form] DI found ${fieldSlots.length} field slots:`,
      fieldSlots.map(s => `"${s.label}" @(${Math.round(s.xPct)}%,${Math.round(s.yPct)}%) [${s.source}]`)
    )

    // ── Step 2: Phi-4 — match profile values to field labels ────────────────
    // Phi-4 only does TEXT MATCHING here. Positions are already from Azure DI.
    const { client, deployment } = getOpenAIClient()

    const systemPrompt = 'You are an expert at matching user profile data to Indian government form fields. Return ONLY valid JSON.'

    const userPrompt = `A blank Indian government form was scanned. Azure Document Intelligence found these field slots (label + blank-space position as % of page):

FIELD SLOTS FOUND:
${JSON.stringify(fieldSlots.map(s => ({
  label: s.label,
  xPct: Math.round(s.xPct),
  yPct: Math.round(s.yPct),
  widthPct: Math.round(s.widthPct),
  detectionMethod: s.source,
})), null, 2)}

USER PROFILE (fill fields from this data):
${JSON.stringify(profile, null, 2)}

TASK:
1. For each field slot, find the best matching value from the user profile.
2. Use the EXACT xPct/yPct/widthPct from the field slot — do NOT change them.
3. Identify which document the value came from (Aadhaar / PAN / Bank / RationCard / Passport).
4. Skip fields that need manual input: Signature, Photo, Thumb impression, Witness.
5. List all form field labels (even ones you couldn't fill) in context for "formType".

FIELD MATCHING RULES (follow exactly):
- "Full Name" / "Name" → full name of the person
- "Aadhaar Number" → Aadhaar card number
- "Date of Birth" / "DOB" → date of birth in DD/MM/YYYY format
- "Father's Name" / "Husband's Name" / "C/o" → guardian/parent name
- "House No" / "Flat No" / "Building" → house/flat/building number only
- "Street" / "Road" / "Lane" → street or road name only
- "Landmark" → nearby landmark
- "Area" / "Locality" / "Sector" / "Colony" → area or locality (neighbourhood)
- "Village" / "Town" / "City" → city or town name
- "Post Office" → post office name
- "District" → district name
- "State" → state name (e.g. Delhi, Maharashtra)
- "PIN Code" / "Pincode" → 6-digit postal PIN code
- Do NOT put a city name in an Area/Locality field
- Do NOT put a PIN code in a State field

Return ONLY this JSON:
{
  "formType": "name of this form",
  "fields": [
    {
      "label": "Name",
      "value": "Prakash Ranjan",
      "source": "Aadhaar",
      "xPct": 22,
      "yPct": 18,
      "widthPct": 55,
      "confidence": 0.95
    }
  ],
  "unfilled": ["Signature", "Photo"],
  "instructions": "any submission notes"
}`

    const completion = await client.chat.completions.create({
      model: deployment,
      max_tokens: 2048,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
    })

    const raw    = completion.choices[0]?.message?.content ?? '{}'
    const result = JSON.parse(raw)

    if (!result.fields || !Array.isArray(result.fields)) {
      return NextResponse.json({ error: 'Could not identify form fields. Please try a clearer image.' }, { status: 422 })
    }

    // Strip fields where Phi-4 returned null / the literal string "null" / no coordinates
    type RawField = { label: string; value: string | null; xPct: number | null; yPct: number | null }
    result.fields = result.fields.filter((f: RawField) =>
      f.value && f.value !== 'null' && f.value !== 'N/A' &&
      f.xPct != null && f.yPct != null &&
      !isNaN(f.xPct) && !isNaN(f.yPct)
    )

    // Normalise unfilled to plain strings (Phi-4 sometimes returns objects)
    if (Array.isArray(result.unfilled)) {
      result.unfilled = result.unfilled.map((u: unknown) =>
        typeof u === 'string' ? u : (u as {label?: string})?.label ?? String(u)
      )
    }

    console.log('[fill-form] filled fields:',
      result.fields.map((f: { label: string; xPct: number; yPct: number; value: string }) =>
        `${f.label}: (${f.xPct}%, ${f.yPct}%) = "${f.value}"`
      )
    )

    return NextResponse.json(result)
  } catch (error) {
    console.error('[kagaz-ai] fill-form error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fill form.' },
      { status: 500 }
    )
  }
}
