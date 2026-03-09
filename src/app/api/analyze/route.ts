import { NextRequest, NextResponse } from 'next/server'
import { AzureOpenAI } from 'openai'
import { DocumentAnalysisClient, AzureKeyCredential } from '@azure/ai-form-recognizer'

export const runtime = 'nodejs'
export const maxDuration = 60

function getOpenAIClient() {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT
  const apiKey = process.env.AZURE_OPENAI_API_KEY
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? '2024-02-01'
  if (!endpoint || !apiKey || !deployment) {
    throw new Error('Azure OpenAI not configured.')
  }
  return { client: new AzureOpenAI({ endpoint, apiKey, deployment, apiVersion }), deployment }
}

function getAzureDIClient() {
  const endpoint = process.env.AZURE_DI_ENDPOINT
  const key = process.env.AZURE_DI_KEY
  if (!endpoint || !key) throw new Error('Azure Document Intelligence not configured.')
  return new DocumentAnalysisClient(endpoint, new AzureKeyCredential(key))
}

/**
 * Step 1 — Azure Document Intelligence: OCR + key-value extraction.
 */
async function extractWithAzureDI(buffer: Buffer): Promise<string> {
  const client = getAzureDIClient()
  const poller = await client.beginAnalyzeDocument('prebuilt-document', buffer)
  const result = await poller.pollUntilDone()

  let text = result.content?.trim() ?? ''

  const usefulKV = (result.keyValuePairs ?? []).filter(
    (kv) => kv.key?.content && kv.value?.content && (kv.confidence ?? 0) > 0.5
  )
  if (usefulKV.length > 0) {
    text += '\n\nExtracted Fields:\n'
    for (const kv of usefulKV) {
      text += `• ${kv.key!.content}: ${kv.value!.content}\n`
    }
  }

  return text.trim()
}

/**
 * Step 2 — Azure OpenAI: explain extracted text in 3 simple sentences.
 * Uses JSON mode for reliable structured output.
 */
const SYSTEM_PROMPT = `You are Kagaz AI, helping rural Indian citizens understand government documents.
You always respond with a JSON object — nothing else.`

const buildUserPrompt = (extractedText: string) => `
Here is text extracted from a government document:
---
${extractedText}
---

Respond with this JSON:
{
  "document_type": "Short name of this document (e.g. Aadhaar Card, Land Record, Ration Card)",
  "what_it_is": "2-3 simple sentences describing what this document is, who issued it, what key details it contains (like name, dates, ID numbers, amounts), and why it matters.",
  "what_it_means": "One simple sentence: what does this mean for the person holding it?",
  "what_to_do": "One simple sentence: what specific action should the person take?",
  "what_it_is_hi": "Same content as what_it_is but in simple everyday Hindi (Devanagari script). Use village-level Hindi that any farmer or rural citizen can understand.",
  "what_it_means_hi": "Same content as what_it_means but in simple everyday Hindi (Devanagari script). Under 30 words.",
  "what_to_do_hi": "Same content as what_to_do but in simple everyday Hindi (Devanagari script). Under 30 words."
}

Rules:
- Very simple English for the English fields — explain like to someone with a 5th grade education
- Very simple Hindi for the _hi fields — no formal/literary Hindi, use common spoken words
- No legal, technical, or bureaucratic jargon in either language
- Specific and practical for India
- what_it_means and what_to_do must each be under 30 words (English)
- what_it_means_hi and what_to_do_hi must each be under 30 words (Hindi)
- If text is unclear, say so in both what_it_is and what_it_is_hi
`.trim()

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/tiff',
  'image/bmp',
  'application/pdf',
])

export async function POST(request: NextRequest) {
  try {
    if (!process.env.AZURE_OPENAI_ENDPOINT || !process.env.AZURE_OPENAI_API_KEY || !process.env.AZURE_OPENAI_DEPLOYMENT) {
      return NextResponse.json(
        { error: 'Azure OpenAI not configured. Set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, and AZURE_OPENAI_DEPLOYMENT.' },
        { status: 503 }
      )
    }
    if (!process.env.AZURE_DI_ENDPOINT || !process.env.AZURE_DI_KEY) {
      return NextResponse.json(
        { error: 'Azure Document Intelligence not configured. Set AZURE_DI_ENDPOINT and AZURE_DI_KEY.' },
        { status: 503 }
      )
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 })
    }
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large. Max 20MB.' }, { status: 400 })
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: 'Unsupported file type. Use JPEG, PNG, WebP, TIFF, BMP, or PDF.' },
        { status: 400 }
      )
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // ── Step 1: Azure Document Intelligence OCR ──────────────────────────────
    let extractedText: string
    try {
      extractedText = await extractWithAzureDI(buffer)
    } catch (err) {
      console.error('[kagaz-ai] Azure DI error:', err)
      return NextResponse.json(
        { error: 'Could not read document. Please try a clearer image.' },
        { status: 422 }
      )
    }

    if (!extractedText) {
      return NextResponse.json(
        { error: 'No text found in document. Please upload a clearer photo.' },
        { status: 422 }
      )
    }

    // ── Step 2: Azure OpenAI explanation ─────────────────────────────────────
    const { client, deployment } = getOpenAIClient()

    const completion = await client.chat.completions.create({
      model: deployment,
      max_tokens: 2048,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(extractedText) },
      ],
    })

    const responseText = completion.choices[0]?.message?.content ?? ''
    const result = JSON.parse(responseText)

    for (const field of ['document_type', 'what_it_is', 'what_it_means', 'what_to_do',
                         'what_it_is_hi', 'what_it_means_hi', 'what_to_do_hi']) {
      if (!result[field]) throw new Error(`Missing field in response: ${field}`)
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('[kagaz-ai] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to analyze document.' },
      { status: 500 }
    )
  }
}
