-- 030 — Registro web de prestador SOLO con Google (bolt.com.ar/prestadores)
-- La landing pasó a un alta de un toque con Google: se crea el lead con el
-- nombre/email de la cuenta y el resto (WhatsApp, oficio, DNI, documentos) se
-- completa después por el link personal (completar.html?t=TOKEN).
--
-- Esta función le devuelve al profesional SU propio link cuando vuelve a entrar
-- con Google, sin exponer la tabla: anon no puede leer prestador_leads (RLS),
-- así que sin esto un trabajador que ya se registró no podría recuperar su link
-- salvo por el mail.
--
-- Seguridad: solo `authenticated`, solo cuentas de GOOGLE (el email viene
-- verificado por el proveedor) y solo devuelve el token del lead cuyo email
-- coincide con el del JWT. Se exige provider='google' porque el proyecto tiene
-- signup por email con autoconfirmación: sin ese filtro, alguien podría crear
-- una cuenta con el mail de otro y pedir su token.
-- De paso vincula user_id (auth.users) al lead, como hace el alta desde la app.
-- Idempotente.

create or replace function public.prestador_mi_token()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claims json := nullif(current_setting('request.jwt.claims', true), '')::json;
  v_email  text := lower(coalesce(v_claims ->> 'email', ''));
  v_prov   text := coalesce(v_claims -> 'app_metadata' ->> 'provider', '');
  v_uid    uuid := auth.uid();
  v_id     uuid;
  v_token  text;
begin
  if v_uid is null or v_email = '' or v_prov <> 'google' then
    return null;
  end if;

  select id, completar_token into v_id, v_token
    from prestador_leads
   where lower(email) = v_email
   order by created_at desc
   limit 1;

  if v_id is null then return null; end if;

  -- Leads viejos (o de la app) pueden no tener token: se lo generamos ahora.
  if v_token is null or length(v_token) < 10 then
    v_token := gen_random_uuid()::text;
  end if;

  update prestador_leads
     set completar_token = v_token,
         user_id = coalesce(user_id, v_uid)
   where id = v_id;

  return v_token;
end $$;

revoke all on function public.prestador_mi_token() from public;
revoke all on function public.prestador_mi_token() from anon;
grant execute on function public.prestador_mi_token() to authenticated;
