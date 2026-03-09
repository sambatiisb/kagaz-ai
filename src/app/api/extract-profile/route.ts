import { NextRequest, NextResponse } from 'next/server'
import { AzureOpenAI } from 'openai'
import { DocumentAnalysisClient, AzureKeyCredential } from '@azure/ai-form-recognizer'

export const runtime = 'nodejs'
export const maxDuration = 60

function getOpenAIClient() {
  const endpoint   = process.env.AZURE_OPENAI_ENDPOINT
  const apiKey     = process.env.AZURE_OPENAI_API_KEY
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT
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

// ── Per-document extraction prompts ──────────────────────────────────────────

const PROMPTS: Record<string, string> = {
  aadhaar: `Extract all data from this Aadhaar card. Return JSON:
{
  "name": "full name as printed",
  "dob": "DD/MM/YYYY",
  "gender": "Male or Female or Other",
  "aadhaarNumber": "12-digit number formatted as XXXX XXXX XXXX",
  "address": "complete address as on card",
  "pincode": "6-digit pincode or null",
  "state": "state name or null",
  "fatherName": "father name if visible or null",
  "motherName": "mother name if visible or null"
}`,

  pan: `Extract all data from this PAN card. Return JSON:
{
  "name": "name as printed on card",
  "panNumber": "10-character PAN e.g. ABCDE1234F",
  "dob": "DD/MM/YYYY",
  "fatherName": "father name as on card or null"
}`,

  bank: `Extract data from this bank passbook or statement. Return JSON:
{
  "accountHolderName": "account holder full name",
  "accountNumber": "account number",
  "ifsc": "IFSC code",
  "bankName": "bank name",
  "branchName": "branch name or null",
  "accountType": "Savings or Current or null"
}`,

  rationCard: `Extract data from this ration card. Return JSON:
{
  "cardNumber": "ration card number",
  "headOfFamily": "head of family name",
  "address": "address or null",
  "category": "APL or BPL or AAY or null"
}`,

  passport: `Extract data from this passport. Return JSON:
{
  "name": "full name as on passport",
  "passportNumber": "passport number",
  "dob": "DD/MM/YYYY",
  "gender": "Male or Female",
  "expiryDate": "DD/MM/YYYY or null",
  "placeOfBirth": "place of birth or null",
  "nationality": "nationality or null"
}`,
}

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file    = formData.get('file')    as File   | null
    const docType = formData.get('docType') as string | null

    if (!file || !docType) {
      return NextResponse.json({ error: 'file and docType are required.' }, { status: 400 })
    }
    const prompt = PROMPTS[docType]
    if (!prompt) {
      return NextResponse.json({ error: `Unknown docType: ${docType}` }, { status: 400 })
    }

    const bytes  = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // Step 1: Azure DI OCR
    const di      = getDIClient()
    const poller  = await di.beginAnalyzeDocument('prebuilt-document', buffer)
    const diResult = await poller.pollUntilDone()
    const text    = diResult.content?.trim() ?? ''

    if (!text) {
      return NextResponse.json(
        { error: 'Could not read document. Please try a clearer image.' },
        { status: 422 }
      )
    }

    // Also append key-value pairs for extra accuracy
    let kvText = ''
    const pairs = (diResult.keyValuePairs ?? []).filter(
      (kv) => kv.key?.content && kv.value?.content && (kv.confidence ?? 0) > 0.4
    )
    if (pairs.length > 0) {
      kvText = '\n\nDetected fields:\n' + pairs.map((kv) => `• ${kv.key!.content}: ${kv.value!.content}`).join('\n')
    }

    // Step 2: GPT structures the data
    const { client, deployment } = getOpenAIClient()
    const completion = await client.chat.completions.create({
      model: deployment,
      max_tokens: 512,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You extract structured data from Indian government identity documents. Return only valid JSON with the exact schema requested. Use null for missing fields.',
        },
        {
          role: 'user',
          content: `${prompt}\n\nText extracted from document:\n${text}${kvText}`,
        },
      ],
    })

    const data = JSON.parse(completion.choices[0]?.message?.content ?? '{}')
    return NextResponse.json({ docType, data })
  } catch (error) {
    console.error('[kagaz-ai] extract-profile error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to extract document data.' },
      { status: 500 }
    )
  }
}
