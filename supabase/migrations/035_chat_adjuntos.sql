-- ─────────────────────────────────────────────────────────────────────────────
-- 035 — Adjuntos en el chat: audios, fotos, videos y archivos
--
-- Hasta ahora el chat del trabajo era sólo texto, y muchas cosas del oficio no
-- se explican escribiendo: el ruido que hace el motor, el modelo que está en la
-- etiqueta, el presupuesto en PDF.
--
-- `content` SE SIGUE USANDO SIEMPRE, incluso cuando hay adjunto: lleva una
-- descripción corta ("📷 Foto", "🎤 Audio 0:14"). Así las versiones viejas de la
-- app, que no saben nada de adjuntos, muestran algo legible en vez de un globo
-- vacío, y las notificaciones tienen qué decir.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS attachment_url      text,
  ADD COLUMN IF NOT EXISTS attachment_type     text,      -- image | video | audio | file
  ADD COLUMN IF NOT EXISTS attachment_name     text,      -- nombre original, para los archivos
  ADD COLUMN IF NOT EXISTS attachment_size     integer,   -- bytes
  ADD COLUMN IF NOT EXISTS attachment_duration integer;   -- segundos (audio y video)

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_attachment_type_check;
ALTER TABLE messages
  ADD CONSTRAINT messages_attachment_type_check
  CHECK (attachment_type IS NULL OR attachment_type IN ('image', 'video', 'audio', 'file'));

COMMENT ON COLUMN messages.attachment_url IS
  'Archivo adjunto en el bucket chat-media. `content` igual trae una descripción corta para las apps viejas.';

-- ─── Bucket de los adjuntos ──────────────────────────────────────────────────
-- Público como `avatars`, por coherencia con lo que ya hay (las fotos del
-- problema viven ahí). Los nombres llevan un uuid al azar, así que no se pueden
-- adivinar. Si algún día se maneja documentación sensible, hay que pasarlo a
-- privado + URLs firmadas, y ahí cambia también cómo se muestran.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('chat-media', 'chat-media', true, 26214400)     -- 25 MB, el tope de los videos
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 26214400;

-- Sube el que esté logueado, y sólo dentro de la carpeta del trabajo.
DROP POLICY IF EXISTS "chat_media_insert" ON storage.objects;
CREATE POLICY "chat_media_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chat-media');

DROP POLICY IF EXISTS "chat_media_select" ON storage.objects;
CREATE POLICY "chat_media_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'chat-media');

-- Borrar sólo lo propio (la ruta arranca con el id del usuario).
DROP POLICY IF EXISTS "chat_media_delete_own" ON storage.objects;
CREATE POLICY "chat_media_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'chat-media' AND (storage.foldername(name))[1] = auth.uid()::text);
