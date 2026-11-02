-- =====================================================================
--  CFB Pointage — conformité et agenda
--  • Anonymisation des personnes parties après N ans (réglable, 5 par défaut, 0 = jamais) : chaque nuit.
--    Nom, prénom, e-mail, matricule et lien de compte remplacés ; heures et absences gardées (statistiques).
--    Le journal d'audit reste inchangé (append-only, obligation de traçabilité).
--  • Double authentification pour admin / admin RH / RH : option (coupée). Activée, les actions réservées
--    à ces rôles exigent une session vérifiée par code (aal2).
--  • Agenda Outlook : lien personnel secret (abonnement iCalendar) avec ses congés accordés et les fériés.
-- =====================================================================
alter table pointage.personnes add column if not exists anonymise_le timestamptz;

insert into pointage.parametres (cle, valeur, unite, libelle, categorie, provisoire, source, ordre, aide) values
  ('anonymisation_depart_ans', 5, 'ans', 'Anonymiser les personnes parties après (0 = jamais)', 'Conservation', true,
   'Décision CFB du 02/11/2026 : 5 ans par défaut, à confirmer', 20,
   'Nom, e-mail et matricule effacés ; heures et absences gardées pour les statistiques.'),
  ('mfa_admin_rh', 0, 'booleen', 'Double authentification pour admin et RH', 'Sécurité', false,
   'Décision CFB du 02/11/2026 : pas pour le moment', 5,
   'Activée : ces comptes confirment leur connexion avec un code sur leur téléphone (application d''authentification).')
on conflict (cle) do nothing;

create or replace function pointage.anonymiser_partis() returns int
language plpgsql security definer set search_path = '' as $$
declare v_ans int := coalesce(pointage.param('anonymisation_depart_ans'), 0); n int;
begin
  if v_ans <= 0 then return 0; end if;
  update pointage.personnes
     set prenom = 'Personne', nom = 'partie ' || left(id::text, 8), email = 'anonyme-' || id::text || '@invalide.local',
         matricule = null, auth_user_id = null, anonymise_le = now()
   where anonymise_le is null and date_sortie is not null and date_sortie < current_date - make_interval(years => v_ans);
  get diagnostics n = row_count;
  return n;
end $$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('cfb-anonymisation', '41 3 * * *', 'select pointage.anonymiser_partis()');
  end if;
end $$;

-- Rôles réservés : si l'option est activée, admin / admin RH / RH doivent être en session vérifiée (aal2)
create or replace function pointage.exiger_role(variadic roles pointage.role_app[]) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := pointage.exiger_personne();
begin
  if pointage.mon_role() <> all (roles) then
    raise exception 'Action réservée à : %', array_to_string(roles, ', ') using errcode = '42501';
  end if;
  if coalesce(pointage.param('mfa_admin_rh'), 0) = 1 and pointage.mon_role() in ('admin', 'admin_rh', 'rh')
     and coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'Double authentification requise : confirme ta connexion avec ton code' using errcode = '42501';
  end if;
  return v;
end $$;

-- Agenda : un lien secret par personne (aucune lecture directe de la table)
create table if not exists pointage.agenda_jetons (
  personne_id uuid primary key references pointage.personnes(id),
  jeton       text not null unique,
  cree_le     timestamptz not null default now()
);
alter table pointage.agenda_jetons enable row level security;

create or replace function public.mon_lien_agenda(p_regenerer boolean default false) returns text
language plpgsql security definer set search_path = '' as $$
declare v_moi uuid := pointage.exiger_personne(); v_jeton text;
begin
  v_jeton := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into pointage.agenda_jetons (personne_id, jeton) values (v_moi, v_jeton)
  on conflict (personne_id) do update set jeton = case when p_regenerer then excluded.jeton else pointage.agenda_jetons.jeton end,
                                          cree_le = case when p_regenerer then now() else pointage.agenda_jetons.cree_le end;
  select jeton into v_jeton from pointage.agenda_jetons where personne_id = v_moi;
  return v_jeton;
end $$;

-- Pour la fonction serveur « agenda » uniquement (service_role)
create or replace function public.agenda_evenements(p_jeton text)
returns table (uid text, debut date, fin date, titre text, maj timestamptz)
language sql stable security definer set search_path = '' as $$
  with p as (select j.personne_id from pointage.agenda_jetons j join pointage.personnes pe on pe.id = j.personne_id
             where j.jeton = p_jeton and length(p_jeton) >= 32 and (pe.date_sortie is null or pe.date_sortie >= current_date))
  select 'conge-' || d.id::text, d.date_debut, d.date_fin,
         ca.libelle || case d.type when 'conge_demi_jour' then case d.demi when 'matin' then ' (matin)' else ' (après-midi)' end
                               when 'conge_heures' then ' (' || to_char(make_interval(mins => d.minutes_decomptees), 'FMHH24"h"MI') || ')' else '' end,
         coalesce(d.decide_le, d.cree_le)
  from pointage.demandes d join pointage.codes_absence ca on ca.code = d.code_absence
  where d.personne_id = (select personne_id from p) and d.statut = 'accordee'
    and d.date_fin >= current_date - 365 and d.date_debut <= current_date + 730
  union all
  select 'ferie-' || f.jour::text, f.jour, f.jour, 'Férié : ' || f.libelle, now()
  from pointage.jours_feries f
  where exists (select 1 from p) and f.jour between current_date - 365 and current_date + 730
$$;

revoke all on function pointage.anonymiser_partis() from public, anon, authenticated;
revoke all on function public.mon_lien_agenda(boolean) from public, anon;
grant execute on function public.mon_lien_agenda(boolean) to authenticated;
revoke all on function public.agenda_evenements(text) from public, anon, authenticated;
grant execute on function public.agenda_evenements(text) to service_role;
select pointage.fixer_fuseau();
