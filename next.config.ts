import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['@azure/ai-form-recognizer', 'openai', '@anthropic-ai/sdk'],
}

export default nextConfig
