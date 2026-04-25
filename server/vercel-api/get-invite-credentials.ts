const API_BASE_URL = (process.env.API_BASE_URL || '').replace(/\/$/, '')

export default async function handler(
  req: { method?: string; query?: Record<string, string | string[] | undefined> },
  res: { setHeader: (n: string, v: string) => void; status: (c: number) => { end: () => void; json: (b: unknown) => void; send: (b: string) => void } },
) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    return res.status(204).end()
  }

  if (req.method !== 'GET') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const token =
    typeof req.query?.token === 'string' ? req.query.token : Array.isArray(req.query?.token) ? req.query.token[0] : ''
  if (!token) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    return res.status(400).json({ error: 'Missing token' })
  }

  if (!API_BASE_URL) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    return res.status(500).json({ error: 'API_BASE_URL is not configured' })
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/get-invite-credentials?token=${encodeURIComponent(token)}`, {
      method: 'GET',
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
    res.status(500).json({ error: 'Failed to get credentials' })
  }
}
