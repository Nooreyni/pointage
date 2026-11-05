-- Audit avant pilote (05/11/2026) : remarques des contrôles automatiques Supabase
-- 1. Fonction sans search_path figé (sécurité) ; 2. deux clés étrangères sans index (performance).
create or replace function pointage.libelle_champ(c text) returns text language sql immutable set search_path = '' as $$
  select case c when 'nom' then 'Nom ou prénom' when 'email' then 'E-mail' when 'service' then 'Service' when 'role' then 'Rôle'
                when 'regime' then 'Régime de travail' when 'horaire' then 'Horaires' else 'Autre' end
$$;
revoke all on function pointage.libelle_champ(text) from public, anon, authenticated;

create index if not exists signalements_traite_par_idx on pointage.signalements (traite_par);
create index if not exists parametres_parent_idx on pointage.parametres (parent);

select pointage.fixer_fuseau();
