-- =====================================================================
--  CFB Pointage — tableau de bord direction (agrégé par service) et rapport CPAS (ISP)
-- =====================================================================

-- Catégorie d'absence (ventilation des statistiques ; paramétrable par la RH)
alter table pointage.codes_absence
  add column categorie text not null default 'autre' check (categorie in ('conge', 'maladie', 'autre'));
update pointage.codes_absence set categorie = 'conge'   where compteur_code is not null or code = 'RECUP_JC';
update pointage.codes_absence set categorie = 'maladie' where code in ('MAL', 'MAL_3J', 'AT');

-- Minutes d'absence accordées un jour donné, par catégorie
create or replace function pointage.absences_jour(p uuid, d date)
returns table (categorie text, minutes int)
language sql stable security definer set search_path = '' as $$
  select ca.categorie,
         least(pointage.minutes_prevues(p, d), sum(case dm.type
           when 'conge_jours'     then pointage.minutes_prevues(p, d)
           when 'conge_demi_jour' then pointage.minutes_prevues(p, d) / 2
           when 'conge_heures'    then dm.minutes end))::int
  from pointage.demandes dm join pointage.codes_absence ca on ca.code = dm.code_absence
  where dm.personne_id = p and dm.statut = 'accordee' and d between dm.date_debut and dm.date_fin
  group by ca.categorie
$$;

-- Indicateurs d'un mois, agrégés par service (aucune donnée individuelle)
create or replace function public.stats_direction(p_mois date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_debut date := date_trunc('month', p_mois)::date;
  v_fin   date := least((date_trunc('month', p_mois) + interval '1 month - 1 day')::date, current_date - 1);
  v_services jsonb;
  v_tendance jsonb;
  v_demandes jsonb;
begin
  perform pointage.exiger_role('direction', 'admin', 'rh', 'admin_rh');

  with jours as (
    select pe.id, pe.service_id, g.d::date as d
    from pointage.personnes pe
    cross join lateral generate_series(v_debut, v_fin, interval '1 day') g(d)
    where pe.date_entree <= v_fin and (pe.date_sortie is null or pe.date_sortie >= v_debut)
  ),
  calc as (
    select j.service_id, j.id, j.d, jr.prevues, jr.preste, jr.nb_pointages, jr.complete, jr.a_prester,
           coalesce((select sum(a.minutes) from pointage.absences_jour(j.id, j.d) a where a.categorie = 'conge'), 0)   as abs_conge,
           coalesce((select sum(a.minutes) from pointage.absences_jour(j.id, j.d) a where a.categorie = 'maladie'), 0) as abs_maladie,
           coalesce((select sum(a.minutes) from pointage.absences_jour(j.id, j.d) a where a.categorie = 'autre'), 0)   as abs_autre,
           exists (select 1 from pointage.pointages pt where pt.personne_id = j.id and not pt.annule and pt.sens = 'entree'
                   and pt.type_code = 'TT' and pointage.jour_bxl(pt.horodatage) = j.d) as tt
    from jours j cross join lateral pointage.journee(j.id, j.d) jr
  )
  select coalesce(jsonb_agg(x order by x->>'service'), '[]'::jsonb) into v_services
  from (
    select jsonb_build_object(
      'service', s.nom,
      'effectif', count(distinct c.id),
      'prevues', sum(c.prevues),
      'preste', sum(c.preste),
      'absence_conge', sum(c.abs_conge),
      'absence_maladie', sum(c.abs_maladie),
      'absence_autre', sum(c.abs_autre),
      'jours_presence', count(*) filter (where c.nb_pointages > 0),
      'jours_tt', count(*) filter (where c.tt),
      'anomalies', count(*) filter (where (c.nb_pointages = 0 and c.a_prester > 0) or (c.nb_pointages > 0 and not c.complete))
    ) as x
    from calc c join pointage.services s on s.id = c.service_id
    group by s.nom
  ) t;

  -- Tendance sur 6 mois (approximation : une absence compte dans le mois où elle commence)
  select jsonb_agg(jsonb_build_object('mois', m.mois, 'taux_absence', m.taux_absence, 'taux_tt', m.taux_tt) order by m.mois)
    into v_tendance
  from (
    select mo.mois,
      round(100.0 * coalesce((select sum(dm.minutes_decomptees) from pointage.demandes dm
                               where dm.statut = 'accordee' and date_trunc('month', dm.date_debut)::date = mo.mois), 0)
            / nullif((select sum(pointage.minutes_prevues(pe.id, g.d::date))
                      from pointage.personnes pe
                      cross join lateral generate_series(mo.mois, (mo.mois + interval '1 month - 1 day')::date, interval '1 day') g(d)), 0), 1) as taux_absence,
      round(100.0 * (select count(distinct (pt.personne_id, pointage.jour_bxl(pt.horodatage))) from pointage.pointages pt
                     where not pt.annule and pt.sens = 'entree' and pt.type_code = 'TT'
                       and date_trunc('month', pointage.jour_bxl(pt.horodatage))::date = mo.mois)
            / nullif((select count(distinct (pt.personne_id, pointage.jour_bxl(pt.horodatage))) from pointage.pointages pt
                      where not pt.annule and pt.sens = 'entree'
                        and date_trunc('month', pointage.jour_bxl(pt.horodatage))::date = mo.mois), 0), 1) as taux_tt
    from generate_series(v_debut - interval '5 months', v_debut, interval '1 month') g(m)
    cross join lateral (select g.m::date as mois) mo
  ) m;

  select jsonb_build_object(
    'en_attente', count(*) filter (where statut = 'en_attente'),
    'accordees', count(*) filter (where statut = 'accordee' and decide_le::date between v_debut and v_fin and not encode_par_rh),
    'refusees', count(*) filter (where statut = 'refusee' and decide_le::date between v_debut and v_fin),
    'delai_moyen_heures', round((avg(extract(epoch from decide_le - cree_le) / 3600)
                                 filter (where decide_le::date between v_debut and v_fin and not encode_par_rh))::numeric, 1)
  ) into v_demandes
  from pointage.demandes;

  return jsonb_build_object('debut', v_debut, 'fin', v_fin, 'services', v_services,
                            'tendance', coalesce(v_tendance, '[]'::jsonb), 'demandes', v_demandes);
end $$;

-- Rapport mensuel des ISP pour le CPAS (heures prévues, prestées, absences)
create or replace function public.rapport_cpas(p_mois date)
returns table (personne_id uuid, prenom text, nom text, partenaire text, service text, regime text,
               a_prester int, preste int, absence_justifiee int, absence_maladie int,
               jours_non_justifies int, jours_incomplets int, ecart int)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_debut date := date_trunc('month', p_mois)::date;
  v_fin   date := least((date_trunc('month', p_mois) + interval '1 month - 1 day')::date, current_date - 1);
begin
  perform pointage.exiger_role('responsable_isp', 'admin_rh', 'rh', 'direction', 'admin');
  return query
  select pe.id, pe.prenom, pe.nom, pe.partenaire_isp, s.nom, (pointage.regime_du(pe.id, v_fin)).libelle,
         sum(j.prevues)::int,
         sum(j.preste)::int,
         coalesce(sum((select sum(a.minutes) from pointage.absences_jour(pe.id, g.d::date) a where a.categorie <> 'maladie')), 0)::int,
         coalesce(sum((select sum(a.minutes) from pointage.absences_jour(pe.id, g.d::date) a where a.categorie = 'maladie')), 0)::int,
         (count(*) filter (where j.nb_pointages = 0 and j.a_prester > 0))::int,
         (count(*) filter (where j.nb_pointages > 0 and not j.complete))::int,
         (sum(j.preste) - sum(j.a_prester))::int
  from pointage.personnes pe
  join pointage.services s on s.id = pe.service_id
  cross join lateral generate_series(greatest(v_debut, pe.date_entree), least(v_fin, coalesce(pe.date_sortie, v_fin)), interval '1 day') g(d)
  cross join lateral pointage.journee(pe.id, g.d::date) j
  where pe.type = 'isp'
  group by pe.id, pe.prenom, pe.nom, pe.partenaire_isp, s.nom
  order by pe.nom;
end $$;

-- La vue des codes expose aussi la catégorie
drop view if exists public.codes_absence;
create view public.codes_absence with (security_invoker = true) as
select code, libelle, code_court, compteur_code, demandable, justificatif_requis, couleur, ordre, categorie
from pointage.codes_absence where actif;

revoke all on public.codes_absence from public, anon;
grant select on public.codes_absence to authenticated;
revoke all on function public.stats_direction(date), public.rapport_cpas(date) from public, anon;
grant execute on function public.stats_direction(date), public.rapport_cpas(date) to authenticated;
