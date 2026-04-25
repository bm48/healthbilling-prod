-- Optional: run manually, or let the server create this on startup (see db.ts).
CREATE TABLE IF NOT EXISTS public.server_refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT server_refresh_tokens_token_hash_key UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS idx_server_refresh_tokens_user_id
  ON public.server_refresh_tokens (user_id);

CREATE INDEX IF NOT EXISTS idx_server_refresh_tokens_expires_at
  ON public.server_refresh_tokens (expires_at)
  WHERE revoked_at IS NULL;
