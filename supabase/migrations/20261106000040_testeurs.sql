-- =====================================================================
--  CFB Pointage — testeurs et avis (06/11/2026)
--  Avant le pilote, quelques personnes (RH, direction) testent l'outil et donnent leur avis.
--  Un « testeur » voit une visite guidée à sa première ouverture et un bouton « Mon avis » sur chaque écran ;
--  dans Réglages › Paramètres, il peut commenter chaque réglage (confirmer, proposer autre chose).
--  Chaque avis prévient l'admin général, qui les retrouve dans Réglages › Avis et les marque « Traité ».
-- =====================================================================
alter table pointage.personnes add column if not exists testeur boolean not null default false;

create table if not exists pointage.avis (
  id          bigint generated always as identity primary key,
  personne_id uuid not null references pointage.personnes(id),
  type        text not null check (type in ('probleme', 'idee', 'question', 'ok', 'reglage_ok', 'reglage_changer')),
  ecran       text check (char_length(ecran) <= 60),
  parametre   text check (char_length(parametre) <= 80),
  message     text check (char_length(message) <= 2000),
  cree_le     timestamptz not null default now(),
  traite_le   timestamptz,
  traite_par  uuid references pointage.personnes(id)
);
create index if not exists avis_ouverts_idx on pointage.avis (cree_le desc) where traite_le is null;
create index if not exists avis_personne_idx on pointage.avis (personne_id, cree_le desc);
create index if not exists avis_traite_par_idx on pointage.avis (traite_par);
alter table pointage.avis enable row level security;   -- aucun accès direct : tout passe par les fonctions ci-dessous

create or replace function pointage.libelle_avis(t text) returns text language sql immutable set search_path = '' as $$
  select case t when 'probleme' then 'Problème' when 'idee' then 'Idée' when 'question' then 'Question' when 'ok' then 'Ça me va'
                when 'reglage_ok' then 'Réglage confirmé' when 'reglage_changer' then 'Réglage à changer' else t end
$$;

-- Donner un avis (toute personne connectée ; le bouton n'est montré qu'aux testeurs). 30 par jour au plus.
create or replace function public.donner_avis(p_type text, p_message text default null, p_ecran text default null, p_parametre text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_moi uuid := pointage.exiger_personne();
  v_id  bigint;
  v_dest uuid;
  v_libelle text;
begin
  if p_type is null or p_type not in ('probleme', 'idee', 'question', 'ok', 'reglage_ok', 'reglage_changer') then raise exception 'Choisis le type d''avis'; end if;
  if p_type in ('probleme', 'idee', 'question', 'reglage_changer') and nullif(trim(p_message), '') is null then raise exception 'Écris quelques mots'; end if;
  if (select count(*) from pointage.avis where personne_id = v_moi and cree_le > now() - interval '1 day') >= 30 then
    raise exception 'Déjà 30 avis aujourd''hui : merci ! Continue demain';
  end if;
  insert into pointage.avis (personne_id, type, ecran, parametre, message)
  values (v_moi, p_type, nullif(left(trim(p_ecran), 60), ''), nullif(left(trim(p_parametre), 80), ''), nullif(left(trim(p_message), 2000), ''))
  returning id into v_id;
  select libelle into v_libelle from pointage.parametres where cle = p_parametre;
  for v_dest in select id from pointage.personnes where role = 'admin' and auth_user_id is not null and id <> v_moi
                  and (date_sortie is null or date_sortie >= pointage.aujourdhui()) loop
    perform pointage.notifier(v_dest, 'avis_testeur', 'avis:' || v_id,
      pointage.libelle_avis(p_type) || ' — ' || pointage.nom_complet(v_moi),
      concat_ws(' · ', coalesce(v_libelle, nullif(trim(p_ecran), '')), nullif(left(trim(p_message), 200), '')), '/reglages/avis');
  end loop;
  return v_id;
end $$;

-- Avis reçus (admin général) : ouverts d'abord, puis les 100 derniers traités
create or replace function public.avis_recus()
returns table (id bigint, personne_id uuid, prenom text, nom text, role text, type text, ecran text, parametre text,
               parametre_libelle text, message text, cree_le timestamptz, traite_le timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform pointage.exiger_role('admin');
  return query
  (select a.id, p.id, p.prenom, p.nom, p.role::text, a.type, a.ecran, a.parametre, pa.libelle, a.message, a.cree_le, a.traite_le
   from pointage.avis a join pointage.personnes p on p.id = a.personne_id left join pointage.parametres pa on pa.cle = a.parametre
   where a.traite_le is null order by a.cree_le desc)
  union all
  (select a.id, p.id, p.prenom, p.nom, p.role::text, a.type, a.ecran, a.parametre, pa.libelle, a.message, a.cree_le, a.traite_le
   from pointage.avis a join pointage.personnes p on p.id = a.personne_id left join pointage.parametres pa on pa.cle = a.parametre
   where a.traite_le is not null order by a.traite_le desc limit 100);
end $$;

create or replace function public.traiter_avis(p_id bigint, p_traite boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
declare v_moi uuid := pointage.exiger_role('admin');
begin
  update pointage.avis set traite_le = case when p_traite then coalesce(traite_le, now()) end, traite_par = case when p_traite then v_moi end
  where id = p_id;
  if not found then raise exception 'Avis introuvable'; end if;
end $$;

-- Mes avis envoyés (le testeur voit ce qu'il a déjà dit et si c'est traité)
create or replace function public.mes_avis() returns table (id bigint, type text, ecran text, parametre text, message text, cree_le timestamptz, traite_le timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.id, a.type, a.ecran, a.parametre, a.message, a.cree_le, a.traite_le from pointage.avis a
  where a.personne_id = pointage.moi() order by a.cree_le desc limit 50
$$;

-- Désigner / retirer un testeur (admin général). Désigner relance la visite guidée à sa prochaine ouverture.
create or replace function public.definir_testeur(p_personne uuid, p_testeur boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pointage.exiger_role('admin');
  update pointage.personnes set testeur = p_testeur,
         accueil_fait_le = case when p_testeur and not testeur then null else accueil_fait_le end
  where id = p_personne;
  if not found then raise exception 'Personne introuvable'; end if;
end $$;

-- Profil et fiche : + testeur (colonne ajoutée en fin de vue)
create or replace view public.mon_profil with (security_invoker = true) as
select p.id, p.prenom, p.nom, p.email, p.role, p.type, s.nom as service, r.libelle as regime, r.minutes_jour,
       exists (select 1 from pointage.responsables_service rs where rs.personne_id = p.id) as est_chef_service,
       pointage.jours_teletravail(p.id) as jours_teletravail,
       p.heure_arrivee, p.heure_depart, p.accueil_fait_le, p.testeur
from pointage.personnes p
join pointage.services s on s.id = p.service_id
left join lateral (
  select pr.personne_id, pr.debut, pr.regime_id, rg.id, rg.libelle, rg.contrat, rg.minutes_jour, rg.minutes_semaine, rg.actif
  from pointage.personne_regimes pr join pointage.regimes rg on rg.id = pr.regime_id
  where pr.personne_id = p.id and pr.debut <= pointage.aujourdhui()
  order by pr.debut desc limit 1) r on true
where p.id = pointage.moi();

create or replace view public.admin_personnes with (security_invoker = true) as
select p.id, p.prenom, p.nom, p.email, p.matricule, p.role, p.type, p.partenaire_isp, p.service_id, s.nom as service,
       p.date_entree, p.date_sortie, p.auth_user_id is not null as compte_lie, r.regime_id, r.regime, r.regime_depuis,
       p.heure_arrivee, p.heure_depart, p.testeur
from pointage.personnes p
join pointage.services s on s.id = p.service_id
left join lateral (
  select pr.regime_id, rg.libelle as regime, pr.debut as regime_depuis
  from pointage.personne_regimes pr join pointage.regimes rg on rg.id = pr.regime_id
  where pr.personne_id = p.id and pr.debut <= pointage.aujourdhui()
  order by pr.debut desc limit 1) r on true
where pointage.mon_role() = any (array['admin', 'admin_rh', 'rh', 'direction']::pointage.role_app[]);

revoke all on function public.donner_avis(text, text, text, text), public.avis_recus(), public.traiter_avis(bigint, boolean),
                       public.mes_avis(), public.definir_testeur(uuid, boolean) from public, anon;
grant execute on function public.donner_avis(text, text, text, text), public.avis_recus(), public.traiter_avis(bigint, boolean),
                          public.mes_avis(), public.definir_testeur(uuid, boolean) to authenticated;

revoke all on function pointage.libelle_avis(text) from public, anon, authenticated;

select pointage.fixer_fuseau();
