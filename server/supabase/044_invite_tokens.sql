-- One-time tokens for new user invite links. Only service_role (e.g. Edge Functions) should access.
-- Used by send-invite-email (insert) and get-invite-credentials (select + delete).

CREATE TABLE IF NOT EXISTS public.invite_tokens (
  token uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  temp_password text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.invite_tokens ENABLE ROW LEVEL SECURITY;

-- No policies for anon/authenticated: only service_role can access (used from Edge Functions).
-- Service role bypasses RLS by default.
GRANT ALL ON public.invite_tokens TO service_role;

COMMENT ON TABLE public.invite_tokens IS 'One-time tokens for new user sign-in links; read once then deleted.';
