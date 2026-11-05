-- =====================================================================
--  CFB Pointage — personnes « actives » = celles qui ont un compte (05/11/2026)
--  On peut importer tout le personnel d'avance : tant qu'une personne n'a pas de compte de connexion, elle n'apparaît
--  nulle part dans l'interface (équipe du jour, récaps, anomalies, rapports, rappels, clôture, congés annuels), sauf dans
--  Gestion › Personnes où la RH lui crée son compte. Dès que le compte est créé, elle apparaît partout.
--  Fonctions reprises à l'identique de leur dernière version, avec la seule condition « a un compte » ajoutée.
-- =====================================================================

-- public.presence_jour
CREATE OR REPLACE FUNCTION public.presence_jour()
 RETURNS TABLE(personne_id uuid, prenom text, nom text, service text, mon_service boolean, statut text, depuis timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'Europe/Brussels'
AS $function$
  with dernier as (
    select distinct on (pt.personne_id) pt.personne_id, pt.sens, pt.horodatage, tp.libelle_presence
    from pointage.pointages pt join pointage.types_pointage tp on tp.code = pt.type_code
    where not pt.annule and pointage.jour_bxl(pt.horodatage) = current_date
    order by pt.personne_id, pt.horodatage desc
  ),
  absent as (
    select distinct on (d.personne_id) d.personne_id, ca.libelle
    from pointage.demandes d join pointage.codes_absence ca on ca.code = d.code_absence
    where d.statut = 'accordee' and d.type = 'conge_jours' and current_date between d.date_debut and d.date_fin
  )
  select p.id, p.prenom, p.nom, s.nom,
         p.service_id = (select service_id from pointage.personnes where id = pointage.exiger_personne()),
         case
           when a.personne_id is not null then
             case when pointage.peut_voir(p.id) then a.libelle else 'Absent' end
           when dp.sens = 'entree' then dp.libelle_presence
           when dp.sens = 'sortie' then 'Parti'
           when pointage.minutes_prevues(p.id, current_date) = 0 then 'Pas prévu aujourd''hui'
           when exists (select 1 from pointage.teletravail_prevu t where t.personne_id = p.id and t.jour = extract(isodow from current_date))
             then 'Télétravail prévu'
           else 'Pas encore pointé'
         end,
         dp.horodatage
  from pointage.personnes p
  join pointage.services s on s.id = p.service_id
  left join dernier dp on dp.personne_id = p.id
  left join absent  a  on a.personne_id = p.id
  where p.date_entree <= current_date and (p.date_sortie is null or p.date_sortie >= current_date) and p.auth_user_id is not null
  order by 5 desc, s.nom, p.nom
$function$;

-- public.rapport_mensuel
CREATE OR REPLACE FUNCTION public.rapport_mensuel(p_mois date)
 RETURNS TABLE(personne_id uuid, prenom text, nom text, service text, regime text, jours_prevus integer, jours_presents integer, jours_tt integer, a_prester integer, preste integer, boni integer, conges integer, maladie integer, autres_absences integer, jours_non_justifies integer, jours_incomplets integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'Europe/Brussels'
AS $function$
declare
  v_moi   uuid := pointage.exiger_personne();
  v_debut date := date_trunc('month', p_mois)::date;
  v_fin   date := least((date_trunc('month', p_mois) + interval '1 month - 1 day')::date, current_date - 1);
  v_ids   uuid[];
begin
  select coalesce(array_agg(p.id), '{}') into v_ids
  from pointage.personnes p
  where p.id <> v_moi and pointage.peut_voir(p.id)
    and p.date_entree <= v_fin and (p.date_sortie is null or p.date_sortie >= v_debut) and p.auth_user_id is not null;
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
end $function$;

-- public.rapport_cpas
CREATE OR REPLACE FUNCTION public.rapport_cpas(p_mois date)
 RETURNS TABLE(personne_id uuid, prenom text, nom text, partenaire text, service text, regime text, a_prester integer, preste integer, conges integer, absence_justifiee integer, absence_maladie integer, jours_non_justifies integer, jours_incomplets integer, ecart integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'Europe/Brussels'
AS $function$
declare
  v_debut date := date_trunc('month', p_mois)::date;
  v_fin   date := least((date_trunc('month', p_mois) + interval '1 month - 1 day')::date, current_date - 1);
begin
  perform pointage.exiger_role('responsable_isp', 'admin_rh', 'rh', 'direction', 'admin');
  return query
  with j as (
    select * from pointage.journees_set(v_debut, v_fin, (select array_agg(id) from pointage.personnes where type = 'isp' and auth_user_id is not null))
  ),
  cat as (
    select j.personne_id, sum(case when ca.categorie = 'conge' then m.minutes else 0 end) as conges,
           sum(case when ca.categorie = 'autre' then m.minutes else 0 end) as justifiee,
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
         coalesce(max(c.conges), 0)::int, coalesce(max(c.justifiee), 0)::int, coalesce(max(c.maladie), 0)::int,
         (count(*) filter (where j.nb_pointages = 0 and j.a_prester > 0))::int,
         (count(*) filter (where j.nb_pointages > 0 and not j.complete))::int,
         (sum(j.preste) - sum(j.a_prester))::int
  from j
  join pointage.personnes pe on pe.id = j.personne_id
  join pointage.services s on s.id = pe.service_id
  left join cat c on c.personne_id = pe.id
  group by pe.id, pe.prenom, pe.nom, pe.partenaire_isp, s.nom
  order by pe.nom;
end $function$;

-- public.rapport_teletravail
CREATE OR REPLACE FUNCTION public.rapport_teletravail(p_mois date)
 RETURNS TABLE(personne_id uuid, prenom text, nom text, service text, jours_tt integer, dates date[], jours_habituels smallint[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'Europe/Brussels'
AS $function$
declare
  v_debut date := date_trunc('month', p_mois)::date;
  v_fin   date := least((date_trunc('month', p_mois) + interval '1 month - 1 day')::date, current_date);
begin
  perform pointage.exiger_role('rh', 'admin_rh', 'direction', 'admin');
  return query
  with tt as (
    select distinct pt.personne_id, pointage.jour_bxl(pt.horodatage) as jour
    from pointage.pointages pt
    where not pt.annule and pt.type_code = 'TT'
      and pt.horodatage >= (v_debut::timestamp at time zone 'Europe/Brussels')
      and pt.horodatage <  ((v_fin + 1)::timestamp at time zone 'Europe/Brussels')
  )
  select pe.id, pe.prenom, pe.nom, s.nom,
         (select count(*) from tt where tt.personne_id = pe.id)::int,
         coalesce((select array_agg(tt.jour order by tt.jour) from tt where tt.personne_id = pe.id), '{}'),
         pointage.jours_teletravail(pe.id)
  from pointage.personnes pe
  join pointage.services s on s.id = pe.service_id
  where pe.date_entree <= v_fin and (pe.date_sortie is null or pe.date_sortie >= v_debut) and pe.auth_user_id is not null
    and (exists (select 1 from tt where tt.personne_id = pe.id) or exists (select 1 from pointage.teletravail_prevu t where t.personne_id = pe.id))
  order by s.nom, pe.nom, pe.prenom;
end $function$;

-- public.rapport_teletravail_mois
CREATE OR REPLACE FUNCTION public.rapport_teletravail_mois(p_mois date)
 RETURNS TABLE(personne_id uuid, prenom text, nom text, service text, jours_tt integer, dates date[], jours_habituels smallint[], indemnite_centimes integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'Europe/Brussels'
AS $function$
declare
  v_debut date := date_trunc('month', p_mois)::date;
  v_fin   date := least((date_trunc('month', p_mois) + interval '1 month - 1 day')::date, current_date);
begin
  perform pointage.exiger_role('rh', 'admin_rh', 'direction', 'admin');
  return query
  with tt as (
    select distinct pt.personne_id, pointage.jour_bxl(pt.horodatage) as jour
    from pointage.pointages pt
    where not pt.annule and pt.type_code = 'TT'
      and pt.horodatage >= (v_debut::timestamp at time zone 'Europe/Brussels')
      and pt.horodatage <  ((v_fin + 1)::timestamp at time zone 'Europe/Brussels')
  ), n as (select t.personne_id, count(*)::int as jours, array_agg(t.jour order by t.jour) as dates from tt t group by t.personne_id)
  select pe.id, pe.prenom, pe.nom, s.nom, coalesce(n.jours, 0), coalesce(n.dates, '{}'), pointage.jours_teletravail(pe.id),
         pointage.indemnite_tt(coalesce(n.jours, 0))
  from pointage.personnes pe
  join pointage.services s on s.id = pe.service_id
  left join n on n.personne_id = pe.id
  where pe.date_entree <= v_fin and (pe.date_sortie is null or pe.date_sortie >= v_debut) and pe.auth_user_id is not null
    and (n.personne_id is not null or exists (select 1 from pointage.teletravail_prevu t where t.personne_id = pe.id))
  order by s.nom, pe.nom, pe.prenom;
end $function$;

-- public.stats_direction
CREATE OR REPLACE FUNCTION public.stats_direction(p_mois date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'Europe/Brussels'
AS $function$
declare
  v_debut date := date_trunc('month', p_mois)::date;
  v_fin   date := least((date_trunc('month', p_mois) + interval '1 month - 1 day')::date, current_date - 1);
  v_ids   uuid[];
  v_services jsonb;
  v_tendance jsonb;
  v_demandes jsonb;
  v_seuil int := coalesce(pointage.param('stats_seuil_anonymat'), 0);
begin
  perform pointage.exiger_role('direction', 'admin', 'rh', 'admin_rh');
  select array_agg(id) into v_ids from pointage.personnes
  where date_entree <= v_fin and (date_sortie is null or date_sortie >= v_debut) and auth_user_id is not null;

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
                               (select array_agg(id) from pointage.personnes where auth_user_id is not null)) j
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

  -- Confidentialité : les services trop petits sont regroupés ; la maladie est masquée si le groupe reste petit
  if v_seuil > 1 then
    select coalesce(jsonb_agg(x order by (x->>'regroupe')::boolean nulls first, x->>'service'), '[]'::jsonb) into v_services
    from (
      select e as x from jsonb_array_elements(v_services) e where (e->>'effectif')::int >= v_seuil
      union all
      select jsonb_build_object(
        'service', 'Petits services (moins de ' || v_seuil || ' pers.)', 'regroupe', true,
        'effectif', sum((e->>'effectif')::int), 'prevues', sum((e->>'prevues')::numeric), 'preste', sum((e->>'preste')::numeric),
        'absence_conge', sum((e->>'absence_conge')::numeric),
        'absence_maladie', case when sum((e->>'effectif')::int) < v_seuil then null else sum((e->>'absence_maladie')::numeric) end,
        -- maladie masquée : versée dans « autres » pour que le taux d'absence global reste juste
        'absence_autre', sum((e->>'absence_autre')::numeric)
                         + case when sum((e->>'effectif')::int) < v_seuil then sum((e->>'absence_maladie')::numeric) else 0 end,
        'jours_presence', sum((e->>'jours_presence')::int),
        'jours_tt', sum((e->>'jours_tt')::int), 'anomalies', sum((e->>'anomalies')::int))
      from jsonb_array_elements(v_services) e where (e->>'effectif')::int < v_seuil
      having count(*) > 0
    ) t;
  end if;

  return jsonb_build_object('debut', v_debut, 'fin', v_fin, 'services', v_services, 'seuil_anonymat', v_seuil,
                            'tendance', coalesce(v_tendance, '[]'::jsonb), 'demandes', v_demandes);
end $function$;

-- public.etat_cloture
CREATE OR REPLACE FUNCTION public.etat_cloture(p_mois date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'Europe/Brussels'
AS $function$
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
    from pointage.journees_set(v_debut, least(v_fin, current_date - 1), (select array_agg(id) from pointage.personnes where auth_user_id is not null)) j
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
end $function$;

-- public.cloturer_mois
CREATE OR REPLACE FUNCTION public.cloturer_mois(p_mois date, p_export_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'Europe/Brussels'
AS $function$
declare
  v_moi      uuid := pointage.exiger_role('rh', 'admin_rh', 'admin');
  v_fin      date;
  v_suivant  date;
  v_reports  int := 0;
  v_alertes  int := 0;
  v_compteurs int;
  r          record;
begin
  p_mois := date_trunc('month', p_mois)::date;
  v_fin := (p_mois + interval '1 month - 1 day')::date;
  if p_mois >= date_trunc('month', current_date)::date then
    raise exception 'On ne clôture qu''un mois terminé';
  end if;
  if exists (select 1 from pointage.clotures) and not exists (select 1 from pointage.clotures where mois = (p_mois - interval '1 month')::date)
     and not exists (select 1 from pointage.clotures where mois > p_mois) then
    raise exception 'Clôture d''abord %', to_char((select max(mois) + interval '1 month' from pointage.clotures), 'MM/YYYY');
  end if;
  if exists (select 1 from pointage.clotures where mois > p_mois) then
    raise exception 'Un mois plus récent est déjà clôturé';
  end if;
  if exists (select 1 from pointage.demandes d where d.statut = 'en_attente'
             and date_trunc('month', d.date_debut)::date <= p_mois) then
    raise exception 'Des demandes sont encore en attente sur cette période';
  end if;

  -- Fin de période de référence → le boni passe à la période suivante
  v_suivant := v_fin + 1;
  if pointage.debut_periode_boni(v_suivant) = v_suivant then
    for r in
      select pe.id, pointage.solde_boni(pe.id, v_fin) as boni
      from pointage.personnes pe
      where pe.date_entree <= v_fin and (pe.date_sortie is null or pe.date_sortie >= p_mois) and pe.auth_user_id is not null
    loop
      if r.boni <> 0 then
        insert into pointage.mouvements_compteur (personne_id, compteur_code, periode_debut, date_effet, type, minutes, motif, cree_par)
        values (r.id, 'BONI', v_suivant, v_suivant, 'report', r.boni, 'Report fin de période ' || to_char(v_fin, 'MM/YYYY'), v_moi);
        v_reports := v_reports + 1;
      end if;
      if r.boni > pointage.param('boni_report_max_min') or r.boni < pointage.param('boni_report_min_min') then
        v_alertes := v_alertes + 1;  -- hors limites : à régulariser par la RH (pas de perte automatique)
      end if;
    end loop;
  end if;

  -- Fin de période des compteurs (année, trimestre) : report / perte selon la règle de chaque compteur
  v_compteurs := pointage.reporter_compteurs(v_fin, v_moi);

  insert into pointage.clotures (mois, cloture_par, export_hash) values (p_mois, v_moi, p_export_hash);
  return jsonb_build_object('mois', p_mois, 'reports_boni', v_reports, 'boni_hors_limites', v_alertes, 'reports_compteurs', v_compteurs);
end $function$;

-- pointage.proposition_conges
CREATE OR REPLACE FUNCTION pointage.proposition_conges(p_annee integer)
 RETURNS TABLE(personne_id uuid, prenom text, nom text, regime text, mois_presence numeric, minutes integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'Europe/Brussels'
AS $function$
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
  where (pe.date_sortie is null or pe.date_sortie >= make_date(p_annee, 1, 1)) and pe.auth_user_id is not null
    and r.id is not null
$function$;

-- pointage.generer_rappels
CREATE OR REPLACE FUNCTION pointage.generer_rappels(p_maintenant timestamp with time zone DEFAULT now())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'Europe/Brussels'
AS $function$
declare
  v_local   timestamp := p_maintenant at time zone 'Europe/Brussels';
  v_jour    date := v_local::date;
  v_min     int  := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  v_fin_mois date := (date_trunc('month', v_jour) + interval '1 month - 1 day')::date;
  v_avant   int;
  v_apres   int;
  r         record;
begin
  select count(*) into v_avant from pointage.notifications;

  -- 1. Entrée oubliée : jour prévu, aucune absence, aucun pointage, 30 min après l'heure habituelle
  for r in
    select pe.id, pointage.heure_habituelle(pe.id, 'entree', v_jour) as h_in,
                  pointage.heure_habituelle(pe.id, 'sortie', v_jour) as h_out
    from pointage.personnes pe
    where pe.date_entree <= v_jour and (pe.date_sortie is null or pe.date_sortie >= v_jour) and pe.auth_user_id is not null
      and pointage.minutes_prevues(pe.id, v_jour) > pointage.minutes_absence(pe.id, v_jour)
      and not exists (select 1 from pointage.pointages pt where pt.personne_id = pe.id and not pt.annule
                      and pointage.jour_bxl(pt.horodatage) = v_jour)
  loop
    if v_min >= r.h_in + pointage.param('rappel_entree_delai_min') and v_min < r.h_out then
      perform pointage.notifier(r.id, 'oubli_entree', 'oubli_entree:' || v_jour,
        'Tu as oublié de pointer ?',
        'Tu arrives d''habitude vers ' || to_char(make_time(r.h_in / 60, r.h_in % 60, 0), 'HH24:MI') || '.',
        '/pointer?suggestion=' || r.h_in);
    end if;
  end loop;

  -- 2. Sortie oubliée : toujours « entrée » 1 h après l'heure habituelle de sortie
  for r in
    select pe.id, pointage.heure_habituelle(pe.id, 'sortie', v_jour) as h_out
    from pointage.personnes pe
    where (select pt.sens from pointage.pointages pt where pt.personne_id = pe.id and not pt.annule
           and pointage.jour_bxl(pt.horodatage) = v_jour order by pt.horodatage desc limit 1) = 'entree'
  loop
    if v_min >= r.h_out + pointage.param('rappel_sortie_delai_min') then
      perform pointage.notifier(r.id, 'oubli_sortie', 'oubli_sortie:' || v_jour,
        'Tu as fini ta journée ?',
        'Tu pars d''habitude vers ' || to_char(make_time(r.h_out / 60, r.h_out % 60, 0), 'HH24:MI') || '. Pense à pointer ta sortie.',
        '/pointer?suggestion=' || r.h_out);
    end if;
  end loop;

  -- 3. Fin de mois : J-5 aux personnes en anomalie, J-2 aux N+1
  if v_fin_mois - v_jour = pointage.param('rappel_fin_mois_employe_j') then
    for r in
      select pe.id, count(*) as nb
      from pointage.personnes pe
      cross join lateral generate_series(date_trunc('month', v_jour)::date, v_jour - 1, interval '1 day') g(d)
      cross join lateral pointage.journee(pe.id, g.d::date) j
      where pe.auth_user_id is not null and ((j.nb_pointages = 0 and j.a_prester > 0) or (j.nb_pointages > 0 and not j.complete))
      group by pe.id
    loop
      perform pointage.notifier(r.id, 'fin_mois', 'fin_mois:' || to_char(v_jour, 'YYYY-MM'),
        r.nb || ' jour(s) à régulariser avant la fin du mois',
        'Corrige-les en 1 clic pour que la RH puisse clôturer.', '/anomalies');
    end loop;
  end if;

  if v_fin_mois - v_jour = pointage.param('rappel_fin_mois_n1_j') then
    for r in
      select v.id as n1, count(distinct pe.id) as nb
      from pointage.personnes pe
      cross join lateral generate_series(date_trunc('month', v_jour)::date, v_jour - 1, interval '1 day') g(d)
      cross join lateral pointage.journee(pe.id, g.d::date) j
      cross join lateral pointage.valideurs_n1(pe.id, v_jour) v(id)
      where pe.auth_user_id is not null and ((j.nb_pointages = 0 and j.a_prester > 0) or (j.nb_pointages > 0 and not j.complete))
      group by v.id
    loop
      perform pointage.notifier(r.n1, 'fin_mois_equipe', 'fin_mois_equipe:' || to_char(v_jour, 'YYYY-MM'),
        r.nb || ' personne(s) de ton équipe ont encore des anomalies',
        'La clôture du mois approche.', '/equipe/anomalies');
    end loop;
  end if;

  -- 4. Demandes en attente depuis trop longtemps → relance des destinataires (1 fois par jour)
  for r in
    select d.id, d.numero, d.personne_id from pointage.demandes d
    where d.statut = 'en_attente'
      and d.cree_le < p_maintenant - make_interval(days => pointage.param('relance_demande_jours'))
  loop
    perform pointage.notifier(v, 'relance_demande', 'relance:' || r.id || ':' || v_jour,
      'Demande n°' || r.numero || ' de ' || pointage.nom_complet(r.personne_id) || ' en attente',
      'Elle attend ta décision depuis plus de ' || pointage.param('relance_demande_jours') || ' jours.',
      '/validation/' || r.id)
    from pointage.destinataires_demande(r.personne_id) v;
  end loop;

  select count(*) into v_apres from pointage.notifications;
  return v_apres - v_avant;
end $function$;

-- Personnes visibles : sans compte, invisibles (sauf soi-même)
create or replace view public.personnes with (security_invoker = true) as
SELECT p.id,
    p.prenom,
    p.nom,
    p.email,
    p.role,
    p.type,
    p.service_id,
    s.nom AS service,
    p.partenaire_isp,
    p.matricule,
    p.date_entree,
    p.date_sortie,
    pointage.est_valideur_de(p.id) AS je_peux_valider
   FROM pointage.personnes p
     JOIN pointage.services s ON s.id = p.service_id
  WHERE p.auth_user_id is not null OR p.id = pointage.moi();

-- Anomalies : seulement les personnes qui ont un compte
create or replace view public.anomalies with (security_invoker = true) as
WITH j AS (
         SELECT journees_set.personne_id,
            journees_set.jour,
            journees_set.prevues,
            journees_set.absence,
            journees_set.a_prester,
            journees_set.nb_pointages,
            journees_set.brut,
            journees_set.pause_deduite,
            journees_set.preste,
            journees_set.boni,
            journees_set.depassement,
            journees_set.complete
           FROM pointage.journees_set(pointage.aujourdhui() - 62, pointage.aujourdhui() - 1, ( SELECT array_agg(personnes.id) AS array_agg
                   FROM pointage.personnes WHERE personnes.auth_user_id is not null)) journees_set(personne_id, jour, prevues, absence, a_prester, nb_pointages, brut, pause_deduite, preste, boni, depassement, complete)
        )
 SELECT j.personne_id,
    j.jour,
        CASE
            WHEN j.nb_pointages = 0 THEN 'absent'::text
            ELSE 'pointages_incomplets'::text
        END AS code,
        CASE
            WHEN j.nb_pointages = 0 THEN 'Absent sans justification'::text
            ELSE 'Pointages incomplets (sortie manquante ?)'::text
        END AS libelle
   FROM j
  WHERE j.nb_pointages = 0 AND j.a_prester > 0 OR j.nb_pointages > 0 AND NOT j.complete
UNION ALL
 SELECT j.personne_id,
    max(j.jour) AS jour,
    'semaine_max'::text AS code,
    ('Plus de '::text || (pointage.param('max_semaine_min'::text) / 60)) || ' h prestées dans la semaine'::text AS libelle
   FROM j
  GROUP BY j.personne_id, (date_trunc('week'::text, j.jour::timestamp without time zone))
 HAVING sum(j.preste) > pointage.param('max_semaine_min'::text);

select pointage.fixer_fuseau();
