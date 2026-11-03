-- =====================================================================
--  CFB Pointage — remontée des erreurs de l'appli (pilote, exploitation)
--  Un écran qui plante chez quelqu'un est enregistré (message technique, écran, version, navigateur)
--  pour que l'IT le voie sans attendre qu'on le signale. Pas de contenu saisi, pas de données de pointage.
--  Limite : 20 erreurs par personne et par jour (volume négligeable) ; consultation des 90 derniers jours. Lecture : admin et admin RH.
-- =====================================================================
create table if not exists pointage.erreurs_appli (
  id          bigint generated always as identity primary key,
  quand       timestamptz not null default now(),
  personne_id uuid references pointage.personnes(id),
  ecran       text,
  message     text not null,
  version     text,
  navigateur  text
);
create index if not exists erreurs_appli_quand_idx on pointage.erreurs_appli (quand desc);
create index if not exists erreurs_appli_personne_idx on pointage.erreurs_appli (personne_id);
alter table pointage.erreurs_appli enable row level security;

create or replace function public.signaler_erreur(p_message text, p_ecran text default null, p_version text default null, p_navigateur text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_moi uuid := pointage.moi();
begin
  if v_moi is null or nullif(trim(p_message), '') is null then return; end if;
  if (select count(*) from pointage.erreurs_appli where personne_id = v_moi and quand > now() - interval '1 day') >= 20 then return; end if;
  insert into pointage.erreurs_appli (personne_id, ecran, message, version, navigateur)
  values (v_moi, left(p_ecran, 60), left(p_message, 500), left(p_version, 40), left(p_navigateur, 160));
end $$;

create or replace function public.erreurs_recentes(p_jours int default 7)
returns table (quand timestamptz, qui text, ecran text, message text, version text, navigateur text, fois bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform pointage.exiger_role('admin', 'admin_rh');
  return query
  select max(e.quand), pointage.nom_complet(e.personne_id), e.ecran, e.message, max(e.version), max(e.navigateur), count(*)
  from pointage.erreurs_appli e where e.quand > now() - make_interval(days => greatest(1, least(p_jours, 90)))
  group by e.personne_id, e.ecran, e.message order by 1 desc limit 200;
end $$;

revoke all on function public.signaler_erreur(text, text, text, text) from public, anon;
grant execute on function public.signaler_erreur(text, text, text, text) to authenticated;
revoke all on function public.erreurs_recentes(int) from public, anon;
grant execute on function public.erreurs_recentes(int) to authenticated;
select pointage.fixer_fuseau();
