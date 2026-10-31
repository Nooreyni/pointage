-- =====================================================================
--  CFB Pointage — le passage de reprise (toutes les 5 min) n'appelle le service d'envoi
--  que s'il reste des notifications en attente (moins d'appels inutiles, rien ne change sinon)
-- =====================================================================
create or replace function pointage.reveiller_envoi() returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  if not exists (select 1 from pointage.notifications where envoi_termine_le is null) then
    return false;                       -- file vide : rien à faire
  end if;
  select valeur into v_url from pointage.configuration where cle = 'envoi_url';
  select valeur into v_secret from pointage.configuration where cle = 'envoi_secret';
  if v_url is null or v_secret is null
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    return false;                       -- service non configuré (dev local, installation en cours)
  end if;
  execute 'select net.http_post(url := $1, body := ''{}''::jsonb,
                                headers := jsonb_build_object(''Content-Type'', ''application/json'', ''x-cfb-secret'', $2),
                                timeout_milliseconds := 30000)'
    using v_url, v_secret;
  return true;
exception when others then
  return false;                         -- un souci d'envoi ne doit jamais bloquer un pointage ou une demande
end $$;
revoke execute on function pointage.reveiller_envoi() from public, anon, authenticated;
select pointage.fixer_fuseau();
