-- 015: job_events — sistema de timeline viva por trabajo
CREATE TABLE IF NOT EXISTS job_events (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id     uuid        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  event_type text        NOT NULL,
  message    text        NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE job_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "participants can read job events" ON job_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM jobs j
      WHERE j.id = job_events.job_id
        AND (
          j.client_id = auth.uid()
          OR j.professional_id IN (
            SELECT id FROM professionals WHERE user_id = auth.uid()
          )
        )
    )
  );

CREATE POLICY "authenticated can insert job events" ON job_events
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

ALTER PUBLICATION supabase_realtime ADD TABLE job_events;
