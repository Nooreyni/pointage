-- =====================================================================
--  CFB Pointage — récapitulatif du mois par personne (pilotage et préparation de la paie)
--  Mêmes calculs que la fiche de temps (journees_set). Chacun ne voit que les personnes
--  qu'il peut déjà voir (pointage.peut_voir) : RH, direction, admin → tout le monde ;
--  chef de service / accès délégué → son équipe.
-- =====================================================================
create or replace function public.rapport_mensuel(p_mois date)
returns table (personne_id uuid, prenom text, nom text, service text, regime text,
               jours_prevus int, jours_presents int, jours_tt int,
               a_prester int, preste int, boni int,
               conges int, maladie int, autres_absences int,
               jours_non_justifies int, jours_incomplets int)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_moi   uuid := pointage.exiger_personne();
  v_debut date := date_trunc('month', p_mois)::date;
  v_fin   date := least((date_trunc('month', p_mois) + interval '1 month - 1 day')::date, current_date - 1);
  v_ids   uuid[];
begin
  select coalesce(array_agg(p.id), '{}') into v_ids
  from pointage.personnes p
  where p.id <> v_moi and pointage.peut_voir(p.id)
    and p.date_entree <= v_fin and (p.date_sortie is null or p.date_sortie >= v_debut);
  if v_fin < v_debut or cardinality(v_ids) = 0 then return; end if;

  return query
  with j as (select * from pointage.journees_set(v_debut, v_fin, v_ids)),
  cat as (
    select j.personne_id,
           sum(case when ca.categorie = 'conge'   then m.minutes else 0 end) as conges,
           sum(case when ca.categorie = 'maladie' then m.minutes else 0 end) as maladie,
           sum(case when ca.categorie = 'autre'   then m.minutes else 0 end) as autres
    from j
    join pointage.demandes dm on dm.personne_id = j.personne_id and dm.statut = 'accordee' and j.jour between dm.date_debut and dm.date_fin
    join pointage.codes_absence ca on ca.code = dm.code_absence
    cross join lateral (select least(j.prevues, case dm.type when 'conge_jours' then j.prevues when 'conge_demi_jour' then j.prevues / 2
                                                             when 'conge_heures' then dm.minutes end) as minutes) m
    group by j.personne_id
  ),
  tt as (
    select pt.personne_id, count(distinct pointage.jour_bxl(pt.horodatage))::int as jours
    from pointage.pointages pt
    where pt.personne_id = any(v_ids) and not pt.annule and pt.type_code = 'TT'
      and pt.horodatage >= (v_debut::timestamp at time zone 'Europe/Brussels')
      and pt.horodatage <  ((v_fin + 1)::timestamp at time zone 'Europe/Brussels')
    group by pt.personne_id
  )
  select pe.id, pe.prenom, pe.nom, s.nom, (pointage.regime_du(pe.id, v_fin)).libelle,
         (count(*) filter (where j.prevues > 0))::int,
         (count(*) filter (where j.nb_pointages > 0))::int,
         coalesce(max(t.jours), 0)::int,
         sum(j.a_prester)::int, sum(j.preste)::int, sum(j.boni)::int,
         coalesce(max(c.conges), 0)::int, coalesce(max(c.maladie), 0)::int, coalesce(max(c.autres), 0)::int,
         (count(*) filter (where j.nb_pointages = 0 and j.a_prester > 0))::int,
         (count(*) filter (where j.nb_pointages > 0 and not j.complete))::int
  from j
  join pointage.personnes pe on pe.id = j.personne_id
  join pointage.services s on s.id = pe.service_id
  left join cat c on c.personne_id = pe.id
  left join tt t on t.personne_id = pe.id
  group by pe.id, pe.prenom, pe.nom, s.nom
  order by s.nom, pe.nom, pe.prenom;
end $$;

revoke all on function public.rapport_mensuel(date) from public, anon;
grant execute on function public.rapport_mensuel(date) to authenticated;
select pointage.fixer_fuseau();
