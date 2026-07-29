-- ============================================================
--  REPARACIÓN — los prestadores registrados nunca quedaron como profesionales
-- ------------------------------------------------------------
--  Problema (29-jul-2026): los formularios web guardan en `prestador_leads`,
--  pero la app decide si alguien es trabajador mirando `professionals`
--  (professionalService.getByUserId → .from('professionals').eq('user_id', ...)).
--  Nadie escribía en `professionals`, así que todos los registrados aparecían
--  como usuarios comunes al instalar la app.
--
--  NO hace falta que reinstalen: la app relee `professionals` en cada arranque
--  (App.js → useEffect que depende de session.user.id → loadProfessionalAndJobs).
--  Con crear la fila alcanza; la próxima vez que abran BOLT ya son trabajadores.
--
--  Correr en Supabase → SQL Editor. PRIMERO el paso 1 (solo mira, no toca nada).
-- ============================================================


-- ── PASO 1 · DIAGNÓSTICO (no modifica nada) ─────────────────────────────
-- Quiénes hay, quiénes tienen cuenta de Google enganchada y a quiénes les
-- falta la fila de profesional.

SELECT
  l.id,
  l.nombre || ' ' || COALESCE(l.apellido,'')          AS quien,
  l.email,
  l.telefono,
  l.profesion,
  l.estado                                            AS estado_del_lead,
  CASE WHEN l.user_id IS NULL
       THEN '❌ SIN cuenta de Google (no se puede arreglar por SQL)'
       ELSE '✅ tiene cuenta de Google'
  END                                                 AS cuenta,
  CASE WHEN p.id IS NOT NULL
       THEN '✅ YA es profesional (' || p.verification_status || ')'
       ELSE '⛔ le falta la fila en professionals'
  END                                                 AS en_la_app
FROM prestador_leads l
LEFT JOIN professionals p ON p.user_id = l.user_id
ORDER BY (l.user_id IS NULL), l.created_at DESC;


-- ── PASO 1.5 · VINCULAR POR EMAIL (correr cada vez que entre alguien) ───
-- ⚠️ OJO CON ESTA IDEA EQUIVOCADA: "entran con Google y se activan solos".
--    NO pasa. Entrar con Google sólo crea la cuenta en auth.users; la fila de
--    `professionals` no la crea nadie. Probado el 29-jul: José Palacios y
--    Hernán Speeli YA habían entrado con Google y seguían figurando como
--    usuarios comunes hasta que se corrió este UPDATE.
--
-- Esto engancha el lead con la cuenta que la persona ya creó al entrar. Después
-- del UPDATE hay que correr igual los pasos 2 y 3, que son los que crean el
-- profesional de verdad.

UPDATE prestador_leads l
SET user_id = u.id
FROM auth.users u
WHERE l.user_id IS NULL
  AND NULLIF(TRIM(l.email), '') IS NOT NULL
  AND lower(TRIM(l.email)) = lower(u.email);


-- ── PASO 2 · EL ARREGLO ─────────────────────────────────────────────────
-- Crea la fila que falta en `professionals` para cada lead que tenga cuenta
-- de Google. DISTINCT ON se queda con el lead más nuevo de cada cuenta (si
-- alguien se anotó dos veces, no lo duplica).
--
-- ⚠️ REVISÁ EL PASO 1 ANTES. Esto los deja 'approved' (activos, reciben
--    trabajos) porque son los que YA revisaste.
--
-- 📌 Los documentos NO son un requisito para recibir trabajo. nearby_workers
--    (migración 017) sólo exige TRES cosas, y ninguna es papeles:
--      · verification_status = 'approved'   ← lo resuelve este script
--      · available = TRUE                   ← lo prende el trabajador en la app
--      · location IS NOT NULL               ← se llena al prender el radar
--    Así que sí: entran a laburar con los datos incompletos. Pero si no abren
--    la app y activan el radar, no les va a llegar nada — y esa es la causa
--    número uno de "no me llega ningún trabajo", no la aprobación.

INSERT INTO professionals (
  user_id, first_name, last_name, phone, criminal_record_confirmed, verification_status
)
SELECT DISTINCT ON (l.user_id)
  l.user_id,
  COALESCE(NULLIF(TRIM(l.nombre),   ''), 'Sin nombre'),
  COALESCE(NULLIF(TRIM(l.apellido), ''), ''),
  COALESCE(REGEXP_REPLACE(COALESCE(l.telefono,''), '\D', '', 'g'), ''),
  false,
  'approved'                    -- ← cambiá a 'pending' si querés revisarlos primero
FROM prestador_leads l
WHERE l.user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM professionals p WHERE p.user_id = l.user_id)
ORDER BY l.user_id, l.created_at DESC;   -- el lead más reciente de cada cuenta


-- ── PASO 3 · LOS OFICIOS Y EL PRECIO ────────────────────────────────────
-- Sin esto quedan como profesionales pero sin rubro, así que no les llega
-- ningún trabajo: nearby_workers busca por profession_id.
-- Usa la tabla N:N que ya mantiene el trigger (migración 031).
-- El piso de $30.000 es el mismo que exige el registro de la app.

INSERT INTO professional_professions (professional_id, profession_id, min_price)
SELECT DISTINCT
  p.id,
  lp.profesion_id,
  GREATEST(COALESCE(NULLIF(REGEXP_REPLACE(COALESCE(l.precio_visita,''), '\D', '', 'g'), '')::int, 30000), 30000)
FROM prestador_leads l
JOIN professionals p              ON p.user_id = l.user_id
JOIN prestador_lead_profesiones lp ON lp.lead_id = l.id
WHERE l.user_id IS NOT NULL
  AND lp.profesion_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM professional_professions pp
    WHERE pp.professional_id = p.id AND pp.profession_id = lp.profesion_id
  );


-- ── PASO 4 · VERIFICAR ──────────────────────────────────────────────────
-- Tiene que aparecer cada uno con su oficio. Si alguno sale con
-- "sin oficio", ese no va a recibir trabajos: cargale el rubro a mano.

SELECT
  p.first_name || ' ' || p.last_name  AS profesional,
  p.phone,
  p.verification_status               AS estado,
  COALESCE(STRING_AGG(pr.name || ' ($' || pp.min_price || ')', ', '), '⛔ sin oficio') AS oficios,
  -- Las dos condiciones que dependen del trabajador, no de nosotros:
  CASE
    WHEN p.verification_status <> 'approved' THEN '⛔ falta aprobarlo'
    WHEN NOT COALESCE(p.available, false)    THEN '⏸ no prendió el radar en la app'
    WHEN p.location IS NULL                  THEN '⏸ sin ubicación (no abrió la app todavía)'
    ELSE '✅ puede recibir trabajos AHORA'
  END                                 AS puede_trabajar
FROM professionals p
LEFT JOIN professional_professions pp ON pp.professional_id = p.id
LEFT JOIN professions pr              ON pr.id = pp.profession_id
GROUP BY p.id, p.first_name, p.last_name, p.phone, p.verification_status, p.available, p.location
ORDER BY p.created_at DESC;
