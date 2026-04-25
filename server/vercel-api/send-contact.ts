/**
 * Vercel-style serverless proxy: forwards to the HealthBilling Node API.
 * Set `API_BASE_URL` to your deployed API origin (no trailing slash), e.g. https://api.example.com
 */
const API_BASE_URL = (process.env.API_BASE_URL || '').replace(/\/$/, '')

export default async function handler(
  req: { method?: string; body?: unknown },
  res: { setHeader: (n: string, v: string) => void; status: (c: number) => { end: () => void; json: (b: unknown) => void; send: (b: string) => void } },
) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!API_BASE_URL) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    return res.status(500).json({ error: 'API_BASE_URL is not configured' })
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/send-contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}),
    })
    const text = await response.text()
    res.setHeader('Access-Control-Allow-Origin', '*')
    const status = response.status
    try {
      res.status(status).json(text ? JSON.parse(text) : {})
    } catch {
      res.status(status).send(text)
    }
  } catch {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.status(500).json({ error: 'Failed to reach API' })
  }
}
