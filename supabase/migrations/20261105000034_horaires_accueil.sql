-- Horaires habituels déclarés + parcours d'accueil (05/11/2026)
--
-- 1. Chaque personne peut indiquer ses horaires habituels (ex. 8h30 → 16h30). Ils servent aux rappels (« tu n'as pas
--    pointé »), à l'heure proposée quand on corrige un oubli et à la fin de journée estimée. Ils ne changent PAS le calcul
--    des heures dues ni du boni (c'est le régime qui compte). Vide = l'outil apprend les habitudes (médiane des pointages),
--    puis valeur par défaut des réglages.
-- 2. Parcours d'accueil : la date à laquelle la personne l'a terminé (ou passé) est gardée côté serveur (tous appareils).

alter table pointage.personnes
  add column if not exists heure_arrivee smallint check (heure_arrivee between 0 and 1439),
  add column if not exists heure_depart  smallint check (heure_depart between 0 and 1439),
  add column if not exists accueil_fait_le timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'horaire_coherent') then
    alter table pointage.personnes add constraint horaire_coherent
      check (heure_arrivee is null or heure_depart is null or heure_depart > heure_arrivee);
  end if;
end $$;

-- Heure habituelle : 1) déclarée  2) apprise (médiane des 20 derniers jours, 5 minimum)  3) défaut des réglages
create or replace function pointage.heure_habituelle(p uuid, p_sens pointage.sens_pointage, avant date default current_date)
returns int
language sql stable security definer set search_path = '' as $$
  with jours as (
    select pointage.jour_bxl(horodatage) as j,
           case when p_sens = 'entree' then min(horodatage) else max(horodatage) end as h
    from pointage.pointages
    where personne_id = p and not annule and sens = p_sens and pointage.jour_bxl(horodatage) < avant
    group by 1 order by 1 desc limit 20
  )
  select coalesce(
    (select case when p_sens = 'entree' then pe.heure_arrivee else pe.heure_depart end::int from pointage.personnes pe where pe.id = p),
    (select (percentile_cont(0.5) within group (order by extract(epoch from (h at time zone 'Europe/Brussels')::time) / 60))::int
     from jours having count(*) >= 5),
    pointage.param(case when p_sens = 'entree' then 'heure_entree_defaut' else 'heure_sortie_defaut' end))
$$;

-- Qui peut fixer les horaires habituels : la personne elle-même, son responsable, la gestion (RH, admin RH, direction, admin)
create or replace function public.definir_horaire(p_arrivee int, p_depart int, p_personne uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_moi uuid := pointage.exiger_personne();
  v_p   uuid := coalesce(p_personne, v_moi);
begin
  if v_p <> v_moi and not (pointage.mon_role() in ('rh', 'admin_rh', 'admin', 'direction') or pointage.est_valideur_de(v_p)) then
    raise exception 'Non autorisé' using errcode = '42501';
  end if;
  if (p_arrivee is null) <> (p_depart is null) then raise exception 'Indique l''heure d''arrivée et l''heure de départ'; end if;
  if p_arrivee is not null and (p_arrivee not between 0 and 1439 or p_depart not between 0 and 1439) then raise exception 'Heure invalide'; end if;
  if p_arrivee is not null and p_depart <= p_arrivee then raise exception 'L''heure de départ doit suivre l''heure d''arrivée'; end if;
  update pointage.personnes set heure_arrivee = p_arrivee, heure_depart = p_depart where id = v_p;
end $$;

-- Lecture pour l'appli : horaire déclaré (ou null) + horaire utilisé (déclaré, appris ou par défaut)
create or replace function public.horaire_de(p_personne uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_moi uuid := pointage.exiger_personne();
  v_p   uuid := coalesce(p_personne, v_moi);
  v     pointage.personnes;
begin
  if v_p <> v_moi and not pointage.peut_voir(v_p) then raise exception 'Non autorisé' using errcode = '42501'; end if;
  select * into v from pointage.personnes where id = v_p;
  return jsonb_build_object('arrivee', v.heure_arrivee, 'depart', v.heure_depart,
    'utilise_arrivee', pointage.heure_habituelle(v_p, 'entree', pointage.aujourdhui()),
    'utilise_depart', pointage.heure_habituelle(v_p, 'sortie', pointage.aujourdhui()),
    'modifiable', v_p = v_moi or pointage.mon_role() in ('rh', 'admin_rh', 'admin', 'direction') or pointage.est_valideur_de(v_p));
end $$;

-- Parcours d'accueil terminé (ou passé) : ne plus le proposer
create or replace function public.terminer_accueil() returns void
language plpgsql security definer set search_path = '' as $$
begin
  update pointage.personnes set accueil_fait_le = coalesce(accueil_fait_le, now()) where id = pointage.exiger_personne();
end $$;

-- Profil : + horaires déclarés + accueil (colonnes ajoutées en fin de vue)
create or replace view public.mon_profil with (security_invoker = true) as
select p.id, p.prenom, p.nom, p.email, p.role, p.type, s.nom as service, r.libelle as regime, r.minutes_jour,
       exists (select 1 from pointage.responsables_service rs where rs.personne_id = p.id) as est_chef_service,
       pointage.jours_teletravail(p.id) as jours_teletravail,
       p.heure_arrivee, p.heure_depart, p.accueil_fait_le
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
       p.heure_arrivee, p.heure_depart
from pointage.personnes p
join pointage.services s on s.id = p.service_id
left join lateral (
  select pr.regime_id, rg.libelle as regime, pr.debut as regime_depuis
  from pointage.personne_regimes pr join pointage.regimes rg on rg.id = pr.regime_id
  where pr.personne_id = p.id and pr.debut <= pointage.aujourdhui()
  order by pr.debut desc limit 1) r on true
where pointage.mon_role() = any (array['admin', 'admin_rh', 'rh', 'direction']::pointage.role_app[]);

revoke all on function public.definir_horaire(int, int, uuid), public.horaire_de(uuid), public.terminer_accueil() from public, anon;
grant execute on function public.definir_horaire(int, int, uuid), public.horaire_de(uuid), public.terminer_accueil() to authenticated;

select pointage.fixer_fuseau();
