-- =====================================================================
--  CFB Pointage — performance : calcul des journées en une seule requête
--  (toutes les personnes × toutes les dates), au lieu d'un appel par journée.
--  pointage.journee() devient un simple cas particulier : une seule règle de calcul.
-- =====================================================================

create or replace function pointage.journees_set(p_debut date, p_fin date, p_ids uuid[])
returns table (
  personne_id uuid, jour date, prevues int, absence int, a_prester int, nb_pointages int,
  brut int, pause_deduite int, preste int, boni int, depassement int, complete boolean
)
language sql stable security definer set search_path = '' as $$
  with par as (
    select pointage.param('pause_midi_min') as pm, pointage.param('pause_seuil_min') as ps, pointage.param('max_jour_min') as mj
  ),
  prev as (
    select pe.id, g.d::date as d,
           case when f.jour is not null then 0
                when pe.date_entree > g.d or (pe.date_sortie is not null and pe.date_sortie < g.d) then 0
                else coalesce(r.minutes_jour[extract(isodow from g.d)::int], 0) end as prevues
    from pointage.personnes pe
    cross join generate_series(p_debut, p_fin, interval '1 day') g(d)
    left join pointage.jours_feries f on f.jour = g.d::date
    left join lateral (select rg.minutes_jour from pointage.personne_regimes pr join pointage.regimes rg on rg.id = pr.regime_id
                       where pr.personne_id = pe.id and pr.debut <= g.d::date order by pr.debut desc limit 1) r on true
    where pe.id = any (p_ids)
  ),
  abs as (
    select p.id, p.d,
           least(p.prevues, coalesce(sum(case dm.type
             when 'conge_jours'     then p.prevues
             when 'conge_demi_jour' then p.prevues / 2
             when 'conge_heures'    then dm.minutes end), 0))::int as absence
    from prev p
    left join pointage.demandes dm on dm.personne_id = p.id and dm.statut = 'accordee' and p.d between dm.date_debut and dm.date_fin
    group by p.id, p.d, p.prevues
  ),
  pts as (
    select pt.personne_id, pointage.jour_bxl(pt.horodatage) as d, pt.sens, pt.horodatage,
           lag(pt.sens) over w as sp, lead(pt.sens) over w as ss, lead(pt.horodatage) over w as hs
    from pointage.pointages pt
    where pt.personne_id = any (p_ids) and not pt.annule
      and pt.horodatage >= (p_debut::timestamp at time zone 'Europe/Brussels')
      and pt.horodatage <  ((p_fin + 1)::timestamp at time zone 'Europe/Brussels')
    window w as (partition by pt.personne_id, pointage.jour_bxl(pt.horodatage) order by pt.horodatage)
  ),
  agg as (
    select personne_id as id, d, count(*)::int as nb,
           coalesce(sum(extract(epoch from hs - horodatage) / 60) filter (where sens = 'entree' and ss = 'sortie'), 0)::int as brut,
           coalesce(sum(extract(epoch from hs - horodatage) / 60) filter (where sens = 'sortie' and ss = 'entree'), 0)::int as pp,
           count(*) filter (where (sens = 'entree' and ss is distinct from 'sortie')
                               or (sens = 'sortie' and sp is distinct from 'entree')) = 0 as complete
    from pts group by personne_id, d
  ),
  calc as (
    select p.id, p.d, p.prevues, a.absence, coalesce(g.nb, 0) as nb, coalesce(g.brut, 0) as brut,
           coalesce(g.complete, true) as complete,
           case when coalesce(g.brut, 0) > par.ps then greatest(0, par.pm - coalesce(g.pp, 0)) else 0 end as pause,
           par.mj
    from prev p join abs a on a.id = p.id and a.d = p.d left join agg g on g.id = p.id and g.d = p.d cross join par
  )
  select id, d, prevues, absence, prevues - absence, nb, brut, pause, brut - pause,
         case when nb = 0 or not complete then 0 else least(brut - pause, mj) - (prevues - absence) end,
         case when complete then greatest(0, brut - pause - mj) else 0 end,
         complete
  from calc
$$;

-- Une journée = cas particulier du calcul global
create or replace function pointage.journee(p uuid, d date)
returns table (
  jour date, prevues int, absence int, a_prester int, nb_pointages int,
  brut int, pause_deduite int, preste int, boni int, depassement int, complete boolean
)
language sql stable security definer set search_path = '' as $$
  select j.jour, j.prevues, j.absence, j.a_prester, j.nb_pointages, j.brut, j.pause_deduite, j.preste, j.boni, j.depassement, j.complete
  from pointage.journees_set(d, d, array[p]) j
$$;

create or replace function pointage.solde_boni(p uuid, d date default current_date) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(minutes) from pointage.mouvements_compteur
                   where personne_id = p and compteur_code = 'BONI'
                     and periode_debut = pointage.debut_periode_boni(d)), 0)::int
       + coalesce((select sum(j.boni) from pointage.journees_set(pointage.debut_periode_boni(d), d, array[p]) j), 0)::int
$$;

-- Anomalies : les personnes visibles (RLS de l'appelant) passées en une fois au calcul
create or replace view public.anomalies with (security_invoker = true) as
select j.personne_id, j.jour,
       case when j.nb_pointages = 0 then 'absent' else 'pointages_incomplets' end as code,
       case when j.nb_pointages = 0 then 'Absent sans justification'
            else 'Pointages incomplets (sortie manquante ?)' end as libelle
from pointage.journees_set(current_date - 62, current_date - 1, (select array_agg(id) from pointage.personnes)) j
where (j.nb_pointages = 0 and j.a_prester > 0) or (j.nb_pointages > 0 and not j.complete);

create or replace function public.journees(p_personne_id uuid, p_debut date, p_fin date)
returns table (jour date, prevues int, absence int, a_prester int, nb_pointages int,
               brut int, pause_deduite int, preste int, boni int, depassement int, complete boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not pointage.peut_voir(p_personne_id) then
    raise exception 'Non autorisé' using errcode = '42501';
  end if;
  if p_fin - p_debut > 400 then
    raise exception 'Période trop longue (max 400 jours)';
  end if;
  return query select j.jour, j.prevues, j.absence, j.a_prester, j.nb_pointages, j.brut, j.pause_deduite, j.preste,
                      j.boni, j.depassement, j.complete
               from pointage.journees_set(p_debut, p_fin, array[p_personne_id]) j order by j.jour;
end $$;

create or replace function public.heures_a_valider()
returns table (personne_id uuid, prenom text, nom text, jour date, minutes int)
language plpgsql stable security definer set search_path = '' as $$
declare v_ids uuid[];
begin
  perform pointage.exiger_personne();
  select array_agg(pe.id) into v_ids from pointage.personnes pe
  where pointage.est_valideur_de(pe.id) or pointage.mon_role() in ('rh', 'admin_rh');
  return query
  select pe.id, pe.prenom, pe.nom, j.jour, j.depassement
  from pointage.journees_set(current_date - 62, current_date - 1, coalesce(v_ids, '{}')) j
  join pointage.personnes pe on pe.id = j.personne_id
  where j.depassement > 0
    and not exists (select 1 from pointage.decisions_hs h where h.personne_id = j.personne_id and h.jour = j.jour)
  order by j.jour desc;
end $$;

create or replace function public.etat_cloture(p_mois date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_debut date := date_trunc('month', p_mois)::date;
  v_fin   date := (date_trunc('month', p_mois) + interval '1 month - 1 day')::date;
  v_anom  jsonb;
begin
  perform pointage.exiger_role('rh', 'admin_rh', 'admin');

  select coalesce(jsonb_agg(jsonb_build_object('personne_id', x.id, 'prenom', x.prenom, 'nom', x.nom, 'jours', x.nb)
                            order by x.nom), '[]'::jsonb)
    into v_anom
  from (
    select pe.id, pe.prenom, pe.nom, count(*) as nb
    from pointage.journees_set(v_debut, least(v_fin, current_date - 1), (select array_agg(id) from pointage.personnes)) j
    join pointage.personnes pe on pe.id = j.personne_id
    where (j.nb_pointages = 0 and j.a_prester > 0) or (j.nb_pointages > 0 and not j.complete)
    group by pe.id, pe.prenom, pe.nom
  ) x;

  return jsonb_build_object(
    'mois', v_debut,
    'deja_cloture', exists (select 1 from pointage.clotures where mois = v_debut),
    'derniere_cloture', (select max(mois) from pointage.clotures),
    'mois_termine', v_debut < date_trunc('month', current_date)::date,
    'anomalies', v_anom,
    'demandes_en_attente', (select count(*) from pointage.demandes d
                            where d.statut = 'en_attente' and date_trunc('month', d.date_debut)::date <= v_debut),
    'conges_a_constater', (select count(*) from pointage.demandes d
                           where d.statut = 'accordee' and d.constate_le is null and d.date_debut <= v_fin)
  );
end $$;

create or replace function public.stats_direction(p_mois date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_debut date := date_trunc('month', p_mois)::date;
  v_fin   date := least((date_trunc('month', p_mois) + interval '1 month - 1 day')::date, current_date - 1);
  v_ids   uuid[];
  v_services jsonb;
  v_tendance jsonb;
  v_demandes jsonb;
begin
  perform pointage.exiger_role('direction', 'admin', 'rh', 'admin_rh');
  select array_agg(id) into v_ids from pointage.personnes
  where date_entree <= v_fin and (date_sortie is null or date_sortie >= v_debut);

  with j as (select * from pointage.journees_set(v_debut, v_fin, coalesce(v_ids, '{}'))),
  -- absences par catégorie (mêmes règles que le calcul des journées)
  cat as (
    select j.personne_id, j.jour, ca.categorie,
           least(j.prevues, sum(case dm.type when 'conge_jours' then j.prevues when 'conge_demi_jour' then j.prevues / 2
                                             when 'conge_heures' then dm.minutes end))::int as minutes
    from j
    join pointage.demandes dm on dm.personne_id = j.personne_id and dm.statut = 'accordee' and j.jour between dm.date_debut and dm.date_fin
    join pointage.codes_absence ca on ca.code = dm.code_absence
    group by j.personne_id, j.jour, j.prevues, ca.categorie
  ),
  tt as (
    select distinct pt.personne_id, pointage.jour_bxl(pt.horodatage) as jour
    from pointage.pointages pt
    where not pt.annule and pt.sens = 'entree' and pt.type_code = 'TT'
      and pt.horodatage >= (v_debut::timestamp at time zone 'Europe/Brussels')
      and pt.horodatage <  ((v_fin + 1)::timestamp at time zone 'Europe/Brussels')
  )
  select coalesce(jsonb_agg(x order by x->>'service'), '[]'::jsonb) into v_services
  from (
    select jsonb_build_object(
      'service', s.nom,
      'effectif', count(distinct j.personne_id),
      'prevues', sum(j.prevues),
      'preste', sum(j.preste),
      'absence_conge',   coalesce(sum((select sum(c.minutes) from cat c where c.personne_id = j.personne_id and c.jour = j.jour and c.categorie = 'conge')), 0),
      'absence_maladie', coalesce(sum((select sum(c.minutes) from cat c where c.personne_id = j.personne_id and c.jour = j.jour and c.categorie = 'maladie')), 0),
      'absence_autre',   coalesce(sum((select sum(c.minutes) from cat c where c.personne_id = j.personne_id and c.jour = j.jour and c.categorie = 'autre')), 0),
      'jours_presence', count(*) filter (where j.nb_pointages > 0),
      'jours_tt', count(*) filter (where exists (select 1 from tt where tt.personne_id = j.personne_id and tt.jour = j.jour)),
      'anomalies', count(*) filter (where (j.nb_pointages = 0 and j.a_prester > 0) or (j.nb_pointages > 0 and not j.complete))
    ) as x
    from j join pointage.personnes pe on pe.id = j.personne_id join pointage.services s on s.id = pe.service_id
    group by s.nom
  ) t;

  -- Tendance sur 6 mois (approximation : une absence compte dans le mois où elle commence)
  with mois as (select g.m::date as mois from generate_series(v_debut - interval '5 months', v_debut, interval '1 month') g(m)),
  prevues as (
    select date_trunc('month', j.jour)::date as mois, sum(j.prevues) as minutes
    from pointage.journees_set((v_debut - interval '5 months')::date, (v_debut + interval '1 month - 1 day')::date,
                               (select array_agg(id) from pointage.personnes)) j
    group by 1
  ),
  presence as (
    select date_trunc('month', pointage.jour_bxl(pt.horodatage))::date as mois,
           count(distinct (pt.personne_id, pointage.jour_bxl(pt.horodatage))) as jours,
           count(distinct (pt.personne_id, pointage.jour_bxl(pt.horodatage))) filter (where pt.type_code = 'TT') as jours_tt
    from pointage.pointages pt
    where not pt.annule and pt.sens = 'entree'
      and pt.horodatage >= ((v_debut - interval '5 months')::date::timestamp at time zone 'Europe/Brussels')
    group by 1
  )
  select jsonb_agg(jsonb_build_object(
           'mois', m.mois,
           'taux_absence', round(100.0 * coalesce((select sum(dm.minutes_decomptees) from pointage.demandes dm
                                                   where dm.statut = 'accordee' and date_trunc('month', dm.date_debut)::date = m.mois), 0)
                                 / nullif(pv.minutes, 0), 1),
           'taux_tt', round(100.0 * pr.jours_tt / nullif(pr.jours, 0), 1)) order by m.mois)
    into v_tendance
  from mois m left join prevues pv on pv.mois = m.mois left join presence pr on pr.mois = m.mois;

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
  with j as (
    select * from pointage.journees_set(v_debut, v_fin, (select array_agg(id) from pointage.personnes where type = 'isp'))
  ),
  cat as (
    select j.personne_id, sum(case when ca.categorie = 'maladie' then 0 else m.minutes end) as justifiee,
           sum(case when ca.categorie = 'maladie' then m.minutes else 0 end) as maladie
    from j
    join pointage.demandes dm on dm.personne_id = j.personne_id and dm.statut = 'accordee' and j.jour between dm.date_debut and dm.date_fin
    join pointage.codes_absence ca on ca.code = dm.code_absence
    cross join lateral (select least(j.prevues, case dm.type when 'conge_jours' then j.prevues when 'conge_demi_jour' then j.prevues / 2
                                                             when 'conge_heures' then dm.minutes end) as minutes) m
    group by j.personne_id
  )
  select pe.id, pe.prenom, pe.nom, pe.partenaire_isp, s.nom, (pointage.regime_du(pe.id, v_fin)).libelle,
         sum(j.prevues)::int, sum(j.preste)::int,
         coalesce(max(c.justifiee), 0)::int, coalesce(max(c.maladie), 0)::int,
         (count(*) filter (where j.nb_pointages = 0 and j.a_prester > 0))::int,
         (count(*) filter (where j.nb_pointages > 0 and not j.complete))::int,
         (sum(j.preste) - sum(j.a_prester))::int
  from j
  join pointage.personnes pe on pe.id = j.personne_id
  join pointage.services s on s.id = pe.service_id
  left join cat c on c.personne_id = pe.id
  group by pe.id, pe.prenom, pe.nom, pe.partenaire_isp, s.nom
  order by pe.nom;
end $$;

grant execute on function pointage.journees_set(date, date, uuid[]) to authenticated;
