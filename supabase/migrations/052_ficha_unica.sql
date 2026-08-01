-- 052 — Un dato se carga una vez y aparece en todos lados
--
-- Maxi (1-ago-2026): "no debería quedar en ningún lado nunca nada sin llenar,
-- porque los datos los pone una sola vez el usuario y con eso basta para poder
-- llenar cada campo, aunque los datos vayan a diferentes carpetas debería haber
-- una que traiga los datos de las otras a todas".
--
-- Hoy los datos de una misma persona viven en tres lugares:
--   auth.users        el mail con el que entra
--   prestador_leads   lo que dejó al anotarse
--   professionals     su ficha de trabajo
-- y cada pantalla leía UNO SOLO. Por eso el panel mostraba "Mail: no figura"
-- en la tarjeta de Maxi: su mail esta en auth.users, y el panel lo buscaba en
-- prestador_leads, donde el no tiene nada. El dato existia; nadie lo iba a
-- buscar.
--
-- Esto arma la carpeta que faltaba, en dos capas:
--   1. ficha_prestadores(): al LEER, cada campo sale de la primera fuente que
--      lo tenga. Ademas dice de donde salio y que falta de verdad.
--   2. Al ESCRIBIR, los huecos se rellenan solos entre las tablas, para que la
--      app tambien lo vea y no dependa de que alguien mire el panel.
--
-- Sin acentos ni barras invertidas. Seguro de correr varias veces.

-- ── 1. La lectura unificada ─────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.ficha_prestadores();

CREATE OR REPLACE FUNCTION public.ficha_prestadores()
RETURNS TABLE (
  user_id         uuid,
  professional_id uuid,
  lead_id         uuid,
  nombre          text,
  apellido        text,
  email           text,
  email_origen    text,
  telefono        text,
  telefono_origen text,
  falta           text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  -- Datos de contacto de terceros: solo para quien administra.
  IF NOT public.is_admin() THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      p.user_id                                       AS uid,
      p.id                                            AS pid,
      l.id                                            AS lid,
      NULLIF(TRIM(COALESCE(p.first_name, '')), '')    AS p_nom,
      NULLIF(TRIM(COALESCE(l.nombre, '')), '')        AS l_nom,
      NULLIF(TRIM(COALESCE(p.last_name, '')), '')     AS p_ape,
      NULLIF(TRIM(COALESCE(l.apellido, '')), '')      AS l_ape,
      NULLIF(TRIM(COALESCE(l.email, '')), '')         AS l_mail,
      NULLIF(TRIM(COALESCE(u.email, '')), '')         AS u_mail,
      NULLIF(REGEXP_REPLACE(COALESCE(p.phone, ''), '[^0-9]', '', 'g'), '')    AS p_tel,
      NULLIF(REGEXP_REPLACE(COALESCE(l.telefono, ''), '[^0-9]', '', 'g'), '') AS l_tel
    FROM professionals p
    LEFT JOIN auth.users u ON u.id = p.user_id
    LEFT JOIN LATERAL (
      SELECT * FROM prestador_leads x
       WHERE x.user_id = p.user_id
       ORDER BY x.created_at DESC
       LIMIT 1
    ) l ON true
  )
  SELECT
    b.uid,
    b.pid,
    b.lid,
    COALESCE(b.p_nom, b.l_nom),
    COALESCE(b.p_ape, b.l_ape),
    COALESCE(b.l_mail, b.u_mail),
    CASE WHEN b.l_mail IS NOT NULL THEN 'registro'
         WHEN b.u_mail IS NOT NULL THEN 'cuenta'
         ELSE NULL END,
    COALESCE(b.p_tel, b.l_tel),
    CASE WHEN b.p_tel IS NOT NULL THEN 'ficha'
         WHEN b.l_tel IS NOT NULL THEN 'registro'
         ELSE NULL END,
    -- Lo que no esta en ninguna de las tres: hay que pedirlo, no es un hueco
    -- de la base sino un dato que nadie cargo nunca.
    ARRAY_REMOVE(ARRAY[
      CASE WHEN COALESCE(b.p_nom, b.l_nom) IS NULL THEN 'nombre' END,
      CASE WHEN COALESCE(b.l_mail, b.u_mail) IS NULL THEN 'email' END,
      CASE WHEN COALESCE(b.p_tel, b.l_tel) IS NULL THEN 'telefono' END
    ], NULL)
  FROM base b;
END;
$$;

REVOKE ALL ON FUNCTION public.ficha_prestadores() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ficha_prestadores() TO authenticated;

COMMENT ON FUNCTION public.ficha_prestadores() IS
  'Una fila por profesional con cada dato resuelto desde la primera fuente que lo tenga (ficha, registro o cuenta), mas lo que falta de verdad. Solo admin.';

-- ── 2. Que los huecos se rellenen solos ─────────────────────────────────────
-- La lectura unificada arregla lo que se VE. Esto arregla lo que se GUARDA,
-- para que la app —que lee las tablas directo— tampoco vea huecos.
CREATE OR REPLACE FUNCTION public.completar_huecos_prestador(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tel  text;
  v_mail text;
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;

  -- El telefono, de donde sea que este.
  SELECT COALESCE(
           NULLIF(REGEXP_REPLACE(COALESCE(p.phone, ''), '[^0-9]', '', 'g'), ''),
           NULLIF(REGEXP_REPLACE(COALESCE(l.telefono, ''), '[^0-9]', '', 'g'), '')
         )
    INTO v_tel
    FROM professionals p
    LEFT JOIN LATERAL (
      SELECT * FROM prestador_leads x WHERE x.user_id = p.user_id
       ORDER BY x.created_at DESC LIMIT 1
    ) l ON true
   WHERE p.user_id = p_user_id;

  -- El mail: el del registro o, si no hay, el de la cuenta con la que entra.
  SELECT COALESCE(
           NULLIF(TRIM(COALESCE(l.email, '')), ''),
           NULLIF(TRIM(COALESCE(u.email, '')), '')
         )
    INTO v_mail
    FROM auth.users u
    LEFT JOIN LATERAL (
      SELECT * FROM prestador_leads x WHERE x.user_id = u.id
       ORDER BY x.created_at DESC LIMIT 1
    ) l ON true
   WHERE u.id = p_user_id;

  -- Se escribe SOLO donde falta. Asi el UPDATE no toca ninguna fila en la
  -- segunda pasada y la cadena de triggers se corta sola.
  IF v_tel IS NOT NULL THEN
    UPDATE professionals SET phone = v_tel
     WHERE user_id = p_user_id
       AND COALESCE(REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g'), '') = '';

    UPDATE prestador_leads SET telefono = v_tel
     WHERE user_id = p_user_id
       AND COALESCE(REGEXP_REPLACE(COALESCE(telefono, ''), '[^0-9]', '', 'g'), '') = '';
  END IF;

  IF v_mail IS NOT NULL THEN
    UPDATE prestador_leads SET email = v_mail
     WHERE user_id = p_user_id
       AND COALESCE(TRIM(COALESCE(email, '')), '') = '';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_completar_huecos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Nunca puede tumbar la operacion que lo disparo: completar datos es una
  -- mejora, no una condicion para poder guardar.
  BEGIN
    PERFORM public.completar_huecos_prestador(NEW.user_id);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_huecos_professionals ON public.professionals;
CREATE TRIGGER trg_huecos_professionals
AFTER INSERT OR UPDATE OF phone ON public.professionals
FOR EACH ROW
WHEN (NEW.user_id IS NOT NULL AND pg_trigger_depth() < 3)
EXECUTE FUNCTION public.trg_completar_huecos();

DROP TRIGGER IF EXISTS trg_huecos_leads ON public.prestador_leads;
CREATE TRIGGER trg_huecos_leads
AFTER INSERT OR UPDATE OF telefono, email, user_id ON public.prestador_leads
FOR EACH ROW
WHEN (NEW.user_id IS NOT NULL AND pg_trigger_depth() < 3)
EXECUTE FUNCTION public.trg_completar_huecos();

-- ── 3. Rellenar lo que ya estaba a medias ───────────────────────────────────
DO $$
DECLARE u uuid;
BEGIN
  FOR u IN SELECT user_id FROM professionals WHERE user_id IS NOT NULL LOOP
    PERFORM public.completar_huecos_prestador(u);
  END LOOP;
END $$;

-- Verificacion. No usa ficha_prestadores() a proposito: esa exige ser admin y
-- en el editor de SQL no hay sesion, asi que devolveria vacio y no probaria nada.
SELECT 'MIG052 ' || coalesce(p.first_name, '')
       || ' -> mail=' || coalesce(
            nullif(trim(coalesce(l.email, '')), ''),
            nullif(trim(coalesce(u.email, '')), ''), 'SIGUE SIN MAIL')
       || ' | tel=' || coalesce(
            nullif(regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g'), ''),
            nullif(regexp_replace(coalesce(l.telefono, ''), '[^0-9]', '', 'g'), ''),
            'HAY QUE PEDIRLO') AS r
  FROM professionals p
  LEFT JOIN auth.users u ON u.id = p.user_id
  LEFT JOIN LATERAL (
    SELECT * FROM prestador_leads x WHERE x.user_id = p.user_id
     ORDER BY x.created_at DESC LIMIT 1
  ) l ON true
 ORDER BY p.first_name;
