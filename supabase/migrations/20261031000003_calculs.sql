-- =====================================================================
--  CFB Pointage — moteur de calcul (journées, boni, soldes, congés)
-- =====================================================================

-- Régime en vigueur pour une personne à une date
create or replace function pointage.regime_du(p uuid, d date) returns pointage.regimes
language sql stable security definer set search_path = '' as $$
  select r.* from pointage.personne_regimes pr join pointage.regimes r on r.id = pr.regime_id
  where pr.personne_id = p and pr.debut <= d
  order by pr.debut desc limit 1
$$;

-- Minutes prévues par le régime (0 si férié, hors contrat)
create or replace function pointage.minutes_prevues(p uuid, d date) returns int
language sql stable security definer set search_path = '' as $$
  select case
           when exists (select 1 from pointage.jours_feries where jour = d) then 0
           when not exists (select 1 from pointage.personnes pe where pe.id = p and pe.date_entree <= d
                            and (pe.date_sortie is null or pe.date_sortie >= d)) then 0
           else coalesce((pointage.regime_du(p, d)).minutes_jour[extract(isodow from d)::int], 0)
         end
$$;

-- Minutes couvertes par des absences accordées ce jour-là
create or replace function pointage.minutes_absence(p uuid, d date) returns int
language sql stable security definer set search_path = '' as $$
  select least(pointage.minutes_prevues(p, d), coalesce(sum(
           case dm.type
             when 'conge_jours'     then pointage.minutes_prevues(p, d)
             when 'conge_demi_jour' then pointage.minutes_prevues(p, d) / 2
             when 'conge_heures'    then dm.minutes
           end), 0))::int
  from pointage.demandes dm
  where dm.personne_id = p and dm.statut = 'accordee' and d between dm.date_debut and dm.date_fin
$$;

-- Début de la période de référence du boni (par défaut : trimestre)
create or replace function pointage.debut_periode_boni(d date) returns date
language sql stable security definer set search_path = '' as $$
  select make_date(extract(year from d)::int,
                   ((extract(month from d)::int - 1) / pointage.param('boni_periode_mois')) * pointage.param('boni_periode_mois') + 1,
                   1)
$$;

-- Une journée de travail calculée
--   preste = paires entrée→sortie − pause non pointée (déduite si la journée dépasse le seuil)
--   boni   = preste plafonné au maximum journalier − à prester
--   depassement = au-delà du maximum journalier → « heures à valider » (pas d'heures sup par défaut)
create or replace function pointage.journee(p uuid, d date)
returns table (
  jour date, prevues int, absence int, a_prester int, nb_pointages int,
  brut int, pause_deduite int, preste int, boni int, depassement int, complete boolean
)
language sql stable security definer set search_path = '' as $$
  with pts as (
    select pt.sens, pt.horodatage,
           lag(pt.sens) over w as sens_precedent,
           lead(pt.sens) over w as sens_suivant, lead(pt.horodatage) over w as h_suivant
    from pointage.pointages pt
    join pointage.types_pointage tp on tp.code = pt.type_code
    where pt.personne_id = p and not pt.annule and pointage.jour_bxl(pt.horodatage) = d
    window w as (order by pt.horodatage)
  ),
  agg as (
    select count(*)::int as nb,
           coalesce(sum(extract(epoch from h_suivant - horodatage) / 60)
                    filter (where sens = 'entree' and sens_suivant = 'sortie'), 0)::int as brut,
           coalesce(sum(extract(epoch from h_suivant - horodatage) / 60)
                    filter (where sens = 'sortie' and sens_suivant = 'entree'), 0)::int as pause_pointee,
           count(*) filter (where (sens = 'entree' and sens_suivant is distinct from 'sortie')
                               or (sens = 'sortie' and sens_precedent is distinct from 'entree')) = 0 as complete
    from pts
  ),
  base as (
    select pointage.minutes_prevues(p, d) as prevues, pointage.minutes_absence(p, d) as absence, agg.*
    from agg
  ),
  calc as (
    select b.*,
           case when b.brut > pointage.param('pause_seuil_min')
                then greatest(0, pointage.param('pause_midi_min') - b.pause_pointee) else 0 end as pause
    from base b
  )
  select d, prevues, absence, prevues - absence, nb, brut, pause, brut - pause,
         case when nb = 0 or not complete then 0
              else least(brut - pause, pointage.param('max_jour_min')) - (prevues - absence) end,
         case when complete then greatest(0, brut - pause - pointage.param('max_jour_min')) else 0 end,
         complete
  from calc
$$;

-- Boni courant = report de la période précédente (posé à la clôture) + boni des jours complets depuis le début de période
create or replace function pointage.solde_boni(p uuid, d date default current_date) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(minutes) from pointage.mouvements_compteur
                   where personne_id = p and compteur_code = 'BONI'
                     and periode_debut = pointage.debut_periode_boni(d)), 0)::int
       + coalesce((select sum(j.boni) from generate_series(pointage.debut_periode_boni(d), d, interval '1 day') g(x)
                   cross join lateral pointage.journee(p, g.x::date) j), 0)::int
$$;

-- Période d'un compteur
create or replace function pointage.periode_de(p_compteur text, d date) returns date
language sql stable security definer set search_path = '' as $$
  select case c.periodicite
           when 'annuelle'      then date_trunc('year', d)::date
           when 'trimestrielle' then date_trunc('quarter', d)::date
           else date '2000-01-01'
         end
  from pointage.compteurs c where c.code = p_compteur
$$;

-- Minutes décomptées par une demande (selon les heures prévues de chaque jour)
create or replace function pointage.minutes_demande(
  p uuid, p_type pointage.type_demande, debut date, fin date, p_minutes int
) returns int
language sql stable security definer set search_path = '' as $$
  select case p_type
           when 'conge_jours'     then (select coalesce(sum(pointage.minutes_prevues(p, g.d::date)), 0)::int
                                        from generate_series(debut, fin, interval '1 day') g(d))
           when 'conge_demi_jour' then pointage.minutes_prevues(p, debut) / 2
           when 'conge_heures'    then p_minutes
         end
$$;

-- Solde disponible = grand livre − demandes en attente sur le même compteur/période
create or replace function pointage.solde_disponible(p uuid, p_compteur text, d date) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(minutes) from pointage.mouvements_compteur
                   where personne_id = p and compteur_code = p_compteur
                     and periode_debut = pointage.periode_de(p_compteur, d)), 0)::int
       - coalesce((select sum(dm.minutes_decomptees) from pointage.demandes dm
                   join pointage.codes_absence ca on ca.code = dm.code_absence
                   where dm.personne_id = p and ca.compteur_code = p_compteur and dm.statut = 'en_attente'
                     and pointage.periode_de(p_compteur, dm.date_debut) = pointage.periode_de(p_compteur, d)), 0)::int
$$;

-- Proposition de congés annuels : 4 semaines du régime au 1er janvier,
-- au prorata des mois de présence de l'année précédente (provisoire, validé par la RH)
create or replace function pointage.proposition_conges(p_annee int)
returns table (personne_id uuid, prenom text, nom text, regime text, mois_presence numeric, minutes int)
language sql stable security definer set search_path = '' as $$
  select pe.id, pe.prenom, pe.nom, r.libelle,
         m.mois,
         round(pointage.param('conges_semaines') * r.minutes_semaine * m.mois / 12)::int
  from pointage.personnes pe
  cross join lateral (select (pointage.regime_du(pe.id, make_date(p_annee, 1, 1))).*) r
  cross join lateral (
    select greatest(pe.date_entree, make_date(p_annee - 1, 1, 1)) as debut,
           least(coalesce(pe.date_sortie, make_date(p_annee - 1, 12, 31)), make_date(p_annee - 1, 12, 31)) as fin
  ) b
  cross join lateral (
    select case when b.debut > b.fin then 0
                else (extract(year from b.fin) * 12 + extract(month from b.fin))
                   - (extract(year from b.debut) * 12 + extract(month from b.debut)) + 1
           end::numeric as mois
  ) m
  where (pe.date_sortie is null or pe.date_sortie >= make_date(p_annee, 1, 1))
    and r.id is not null
$$;

-- Heure habituelle (minutes depuis minuit) : médiane des 20 derniers jours travaillés
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
    (select (percentile_cont(0.5) within group (order by extract(epoch from (h at time zone 'Europe/Brussels')::time) / 60))::int
     from jours having count(*) >= 5),
    pointage.param(case when p_sens = 'entree' then 'heure_entree_defaut' else 'heure_sortie_defaut' end))
$$;
