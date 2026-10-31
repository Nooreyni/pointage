-- =====================================================================
--  CFB Pointage — envoi des notifications (audit R9)
--  Les rappels étaient créés en base mais jamais envoyés. Désormais :
--    1. chaque nouvelle notification « réveille » le service d'envoi (pg_net → fonction Edge) ;
--    2. le service envoie un push Web (VAPID) sur les appareils de la personne,
--       et un e-mail de secours (Microsoft 365) si aucun appareil n'a reçu le push ;
--    3. un passage toutes les 5 min reprend ce qui a échoué (réseau, service indisponible).
--  Les secrets (clé privée VAPID, accès Microsoft 365) ne sont jamais dans le code : ils sont
--  enregistrés à l'installation dans pointage.configuration (table non exposée), remis au seul
--  service d'envoi contre le secret partagé. Voir docs/deploiement.md.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Configuration texte de l'installation (non exposée ; seules les clés « publiques » sont lisibles)
-- ---------------------------------------------------------------------
create table if not exists pointage.configuration (
  cle      text primary key,
  valeur   text,
  publique boolean not null default false,
  libelle  text not null
);
alter table pointage.configuration enable row level security;   -- aucune politique : invisible via l'API

insert into pointage.configuration (cle, valeur, publique, libelle) values
  ('vapid_public',     null, true,  'Clé publique VAPID (notifications push)'),
  ('vapid_prive',      null, false, 'Clé privée VAPID'),
  ('vapid_contact',    null, false, 'Contact déclaré aux services push (mailto:…)'),
  ('envoi_url',        null, false, 'Adresse du service d''envoi (fonction Edge envoyer-notifications)'),
  ('envoi_secret',     null, false, 'Secret partagé avec le service d''envoi'),
  ('appli_url',        null, true,  'Adresse de l''application (liens des e-mails)'),
  ('ms_tenant_id',     null, false, 'Microsoft 365 : identifiant du tenant (e-mail de secours)'),
  ('ms_client_id',     null, false, 'Microsoft 365 : identifiant de l''application (Mail.Send)'),
  ('ms_client_secret', null, false, 'Microsoft 365 : secret de l''application'),
  ('ms_expediteur',    null, false, 'Microsoft 365 : boîte expéditrice (ex. pointage@…)')
on conflict (cle) do nothing;

-- Réservé à l'installateur (SQL) : pointage.configurer('vapid_public', '…')
create or replace function pointage.configurer(p_cle text, p_valeur text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update pointage.configuration set valeur = nullif(trim(p_valeur), '') where cle = p_cle;
  if not found then raise exception 'Clé de configuration % inconnue', p_cle; end if;
end $$;
revoke all on function pointage.configurer(text, text) from public, anon, authenticated;

create or replace function public.config_publique() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(cle, valeur), '{}'::jsonb) from pointage.configuration where publique
$$;

-- Configuration complète pour le service d'envoi, remise seulement contre le bon secret
create or replace function public.config_envoi(p_secret text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_secret text;
begin
  select valeur into v_secret from pointage.configuration where cle = 'envoi_secret';
  if v_secret is null or p_secret is null or v_secret <> p_secret then
    raise exception 'Secret d''envoi invalide' using errcode = '42501';
  end if;
  return (select jsonb_object_agg(cle, valeur) from pointage.configuration where cle not in ('envoi_secret'));
end $$;

-- ---------------------------------------------------------------------
-- 2. Réglages (modifiables dans Admin → Paramètres)
-- ---------------------------------------------------------------------
insert into pointage.parametres (cle, valeur, unite, libelle, categorie, provisoire, source) values
  ('push_actif',             1, 'booleen', 'Envoyer les notifications push sur les appareils', 'Notifications', false, 'Règle CFB : push en priorité'),
  ('email_secours',          1, 'booleen', 'Envoyer un e-mail si aucun appareil n''a reçu la notification', 'Notifications', false, 'Règle CFB : e-mail en secours'),
  ('notification_validite_h', 24, 'h',     'Ne plus envoyer une notification restée en attente depuis plus de', 'Notifications', true, 'Proposition')
on conflict (cle) do nothing;

-- ---------------------------------------------------------------------
-- 3. État d'envoi
-- ---------------------------------------------------------------------
alter table pointage.notifications
  add column if not exists envoi_tentatives int not null default 0,
  add column if not exists envoi_reserve_jusqua timestamptz,
  add column if not exists envoi_termine_le timestamptz,
  add column if not exists envoi_erreur text;
create index if not exists notifications_a_envoyer on pointage.notifications (cree_le) where envoi_termine_le is null;
-- Les notifications déjà présentes (créées avant l'envoi) ne partent pas d'un coup
update pointage.notifications set envoi_termine_le = now(), envoi_erreur = 'antérieure à la mise en service'
 where envoi_termine_le is null;

alter table pointage.push_abonnements add column if not exists dernier_succes timestamptz;

-- Désabonnement d'un appareil (déconnexion, refus des notifications)
create or replace function public.retirer_push(p_endpoint text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_moi uuid := pointage.exiger_personne();
begin
  delete from pointage.push_abonnements where endpoint = p_endpoint and personne_id = v_moi;
end $$;

create or replace function public.mes_appareils() returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from pointage.push_abonnements where personne_id = pointage.moi()
$$;

-- ---------------------------------------------------------------------
-- 4. API du service d'envoi (rôle service_role uniquement)
-- ---------------------------------------------------------------------
-- Réserve un lot (pas de double envoi si deux passages se chevauchent) et renvoie tout le nécessaire
create or replace function public.notifications_a_envoyer(p_limite int default 100) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb; v_validite int := coalesce(pointage.param('notification_validite_h'), 24);
begin
  -- trop anciennes : abandonnées (un rappel d'oubli de la veille n'a plus de sens)
  update pointage.notifications set envoi_termine_le = now(), envoi_erreur = 'expirée sans envoi'
   where envoi_termine_le is null and cree_le < now() - make_interval(hours => v_validite);
  update pointage.notifications set envoi_termine_le = now(), envoi_erreur = 'personne partie'
   where envoi_termine_le is null
     and personne_id in (select id from pointage.personnes where date_sortie < pointage.aujourdhui());

  with lot as (
    select n.id from pointage.notifications n
    where n.envoi_termine_le is null and (n.envoi_reserve_jusqua is null or n.envoi_reserve_jusqua < now())
    order by n.cree_le
    limit greatest(p_limite, 1)
    for update skip locked
  ), reserve as (
    update pointage.notifications n
       set envoi_reserve_jusqua = now() + interval '2 minutes', envoi_tentatives = n.envoi_tentatives + 1
      from lot where n.id = lot.id
    returning n.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'titre', r.titre, 'corps', r.corps, 'type', r.type, 'cree_le', r.cree_le,
           'tentative', r.envoi_tentatives,
           'push_deja', r.push_envoye_le is not null, 'mail_deja', r.mail_envoye_le is not null,
           'email', p.email, 'prenom', p.prenom,
           'abonnements', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'endpoint', a.endpoint, 'p256dh', a.p256dh, 'auth', a.auth))
                                     from pointage.push_abonnements a where a.personne_id = r.personne_id), '[]'::jsonb)
         ) order by r.cree_le), '[]'::jsonb)
    into v
  from reserve r join pointage.personnes p on p.id = r.personne_id
  where p.date_sortie is null or p.date_sortie >= pointage.aujourdhui();

  return jsonb_build_object('push', coalesce(pointage.param('push_actif'), 1) = 1,
                            'email', coalesce(pointage.param('email_secours'), 1) = 1,
                            'notifications', v);
end $$;

-- Résultats : [{id, push_ok, mail_ok, erreur, expires: [uuid], reussis: [uuid]}]
create or replace function public.resultats_envoi(p_resultats jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare r jsonb; n int := 0;
begin
  for r in select * from jsonb_array_elements(coalesce(p_resultats, '[]')) loop
    delete from pointage.push_abonnements
     where id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(r->'expires', '[]')) x);
    update pointage.push_abonnements set dernier_succes = now()
     where id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(r->'reussis', '[]')) x);
    update pointage.notifications n set
      push_envoye_le = case when (r->>'push_ok')::boolean then coalesce(n.push_envoye_le, now()) else n.push_envoye_le end,
      mail_envoye_le = case when (r->>'mail_ok')::boolean then coalesce(n.mail_envoye_le, now()) else n.mail_envoye_le end,
      envoi_erreur = nullif(r->>'erreur', ''),
      envoi_reserve_jusqua = null,
      -- terminé si livré, ou rien à faire (ni appareil ni e-mail possible), ou 5 essais
      envoi_termine_le = case when coalesce((r->>'push_ok')::boolean, false) or coalesce((r->>'mail_ok')::boolean, false)
                                   or coalesce((r->>'definitif')::boolean, false) or n.envoi_tentatives >= 5
                              then now() end
     where n.id = (r->>'id')::bigint;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 5. Réveil du service : à chaque nouvelle notification + toutes les 5 min (reprises)
-- ---------------------------------------------------------------------
create or replace function pointage.reveiller_envoi() returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
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

create or replace function pointage.trg_reveiller_envoi() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pointage.reveiller_envoi();
  return null;
end $$;

drop trigger if exists trg_envoi_notifications on pointage.notifications;
create trigger trg_envoi_notifications after insert on pointage.notifications
  for each statement execute function pointage.trg_reveiller_envoi();

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('cfb-envoi', '*/5 * * * *', 'select pointage.reveiller_envoi()');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. Droits
-- ---------------------------------------------------------------------
revoke all on function pointage.reveiller_envoi(), pointage.trg_reveiller_envoi() from public, anon, authenticated;
revoke all on function public.notifications_a_envoyer(int), public.resultats_envoi(jsonb) from public, anon, authenticated;
grant execute on function public.notifications_a_envoyer(int), public.resultats_envoi(jsonb) to service_role;
revoke all on function public.retirer_push(text), public.mes_appareils(), public.config_publique() from public, anon;
grant execute on function public.retirer_push(text), public.mes_appareils(), public.config_publique() to authenticated;
grant execute on function public.config_publique() to service_role;
revoke all on function public.config_envoi(text) from public, anon, authenticated;
grant execute on function public.config_envoi(text) to service_role;

select pointage.fixer_fuseau();
