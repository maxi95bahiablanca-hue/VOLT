-- 046 — Las fotos del problema NUNCA se subieron
--
-- Maxi (1-ago-2026): "chequea lo de la foto de la web tambien, que no llega al
-- trabajador con la plantilla del problema".
--
-- 🔴 LA CAUSA. La politica del bucket 'avatars' (migracion 002) exige que la
-- PRIMERA CARPETA sea el id del usuario:
--     WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
-- Pero las fotos del problema se suben a:
--     problem-photos/<userId>/archivo.jpg
--            ↑ la primera carpeta es "problem-photos", no el id
-- O sea que la politica las rechazaba TODAS. Ninguna foto del problema se
-- subio nunca, ni desde la web ni desde la app.
--
-- Y no se noto por como estaba escrito el codigo: el error se descartaba en
-- silencio (`if (!error)` sin else, y un `catch (e) {}` vacio), asi que el
-- pedido se creaba sin fotos y nadie se enteraba — ni el cliente, ni el
-- profesional que llegaba a ciegas, ni el panel.
--
-- Sin acentos ni barras invertidas: este SQL se copia y pega.
-- Seguro de correr varias veces.

-- El dueño sigue mandando a su propia carpeta (avatar), y ADEMAS se permite
-- problem-photos/<su id>/... y trabajos/<id del profesional>/...
DROP POLICY IF EXISTS "avatars_insert_own" ON storage.objects;
CREATE POLICY "avatars_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (
      -- avatar: <uid>/foto.jpg
      (storage.foldername(name))[1] = auth.uid()::text
      -- fotos del problema: problem-photos/<uid>/foto.jpg
      OR ((storage.foldername(name))[1] = 'problem-photos'
          AND (storage.foldername(name))[2] = auth.uid()::text)
      -- fotos de trabajos del profesional: trabajos/<professional_id>/foto.jpg
      OR ((storage.foldername(name))[1] = 'trabajos'
          AND EXISTS (SELECT 1 FROM professionals p
                       WHERE p.id::text = (storage.foldername(name))[2]
                         AND p.user_id = auth.uid()))
    )
  );

-- Lo mismo para reemplazar una foto ya subida.
DROP POLICY IF EXISTS "avatars_update_own" ON storage.objects;
CREATE POLICY "avatars_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR ((storage.foldername(name))[1] = 'problem-photos'
          AND (storage.foldername(name))[2] = auth.uid()::text)
      OR ((storage.foldername(name))[1] = 'trabajos'
          AND EXISTS (SELECT 1 FROM professionals p
                       WHERE p.id::text = (storage.foldername(name))[2]
                         AND p.user_id = auth.uid()))
    )
  );

-- Y que cada uno pueda borrar lo suyo (antes no habia politica de DELETE:
-- una foto subida no se podia sacar nunca mas).
DROP POLICY IF EXISTS "avatars_delete_own" ON storage.objects;
CREATE POLICY "avatars_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR ((storage.foldername(name))[1] = 'problem-photos'
          AND (storage.foldername(name))[2] = auth.uid()::text)
      OR ((storage.foldername(name))[1] = 'trabajos'
          AND EXISTS (SELECT 1 FROM professionals p
                       WHERE p.id::text = (storage.foldername(name))[2]
                         AND p.user_id = auth.uid()))
    )
  );
