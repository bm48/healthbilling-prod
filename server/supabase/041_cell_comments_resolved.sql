-- Add resolved flag to cell_comments (when resolved, show tick on cell)
ALTER TABLE cell_comments
  ADD COLUMN IF NOT EXISTS resolved BOOLEAN NOT NULL DEFAULT false;
