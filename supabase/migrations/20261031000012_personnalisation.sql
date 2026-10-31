-- =====================================================================
--  CFB Pointage — personnalisation poussée
--  Les règles sans réponse ferme deviennent des réglages (valeur par défaut + modifiable) :
--  confidentialité (IP, petits services), conservation, report des compteurs, ISP,
--  max hebdomadaire, rappels manuels. Permet de réinstaller l'outil ailleurs sans recoder.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Paramètres : catégories + nouveaux réglages (0/1 = non/oui)
-- ---------------------------------------------------------------------
alter table pointage.parametres add column categorie text not null default 'Temps de travail';
update pointage.parametres set categorie = 'Congés' where cle in ('conges_semaines');
update pointage.parametres set categorie = 'Rappels' where cle like 'rappel_%' or cle like 'relance_%' or cle like 'heure_%_defaut';

insert into pointage.parametres (cle, valeur, unite, libelle, categorie, provisoire, source) values
  ('ip_visible_n1',              1, 'booleen',  'Le N+1 voit l''adresse IP des pointages de son équipe', 'Confidentialité', false, 'Décision CFB du 31/10/2026'),
  ('stats_seuil_anonymat',       3, 'personnes', 'Regrouper les statistiques des services de moins de (0 = jamais)', 'Confidentialité', true, 'Proposition'),
  ('conservation_ip_mois',       0, 'mois',     'Effacer l''adresse IP après (0 = aussi longtemps que les pointages)', 'Conservation', false, 'Décision CFB du 31/10/2026'),
  ('conservation_pointages_ans', 0, 'ans',      'Supprimer les pointages des mois clôturés après (0 = jamais)', 'Conservation', true, 'À décider'),
  ('isp_conges',                 1, 'booleen',  'Les ISP demandent leurs congés dans l''application', 'Congés', false, 'Décision CFB du 31/10/2026'),
  ('rappel_manuel_delai_min',   60, 'min',      'Délai minimum entre deux rappels manuels à la même personne', 'Rappels', true, 'Proposition');

create or replace view public.parametres with (security_invoker = true) as
select cle, valeur, unite, libelle, provisoire, source, categorie from pointage.parametres;

create or replace function public.modifier_parametre(p_cle text, p_valeur int, p_source text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_unite text;
begin
  perform pointage.exiger_role('admin', 'admin_rh');
  if nullif(trim(p_source), '') is null then
    raise exception 'Indique la source (ex. règlement de travail art. X)';
  end if;
  select unite into v_unite from pointage.parametres where cle = p_cle;
  if not found then raise exception 'Paramètre % inconnu', p_cle; end if;
  if v_unite = 'booleen' and p_valeur not in (0, 1) then raise exception 'Valeur attendue : oui ou non'; end if;
  if v_unite <> 'min' and p_valeur < 0 then raise exception 'Valeur négative impossible'; end if;
  update pointage.parametres set valeur = p_valeur, provisoire = false, source = p_source where cle = p_cle;
end $$;

-- ---------------------------------------------------------------------
-- 2. Compteurs : règle de fin de période réglable (perdu / reporté / reporté avec plafond, vers quel compteur)
-- ---------------------------------------------------------------------
alter table pointage.compteurs
  add column report_mode text not null default 'total' check (report_mode in ('perdu', 'total', 'plafonne')),
  add column report_vers text references pointage.compteurs(code),
  add column report_plafond_min int check (report_plafond_min >= 0),
  add column regle_provisoire boolean not null default true;
-- Par défaut : rien n'est perdu (report intégral). Congés : année → année passée → année −2 → perdu (structure Dinclock).
update pointage.compteurs set report_vers = 'CONGE_N1' where code = 'CONGE_LEGAL';
update pointage.compteurs set report_vers = 'CONGE_N2' where code = 'CONGE_N1';
update pointage.compteurs set report_mode = 'perdu'   where code = 'CONGE_N2';

create or replace view public.compteurs with (security_invoker = true) as
select code, libelle, periodicite, visible_employe, autorise_negatif, ordre, actif, report_mode, report_vers, report_plafond_min, regle_provisoire
from pointage.compteurs;

create or replace function public.enregistrer_compteur(
  p_code text, p_libelle text, p_periodicite pointage.periodicite, p_autorise_negatif boolean, p_visible_employe boolean,
  p_report_mode text, p_report_vers text default null, p_report_plafond_min int default null, p_actif boolean default true
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pointage.exiger_role('admin', 'admin_rh');
  if p_report_mode = 'plafonne' and p_report_plafond_min is null then raise exception 'Indique le plafond de report'; end if;
  insert into pointage.compteurs (code, libelle, periodicite, autorise_negatif, visible_employe, report_mode, report_vers,
                                  report_plafond_min, actif, regle_provisoire)
  values (upper(trim(p_code)), trim(p_libelle), p_periodicite, p_autorise_negatif, p_visible_employe, p_report_mode,
          nullif(p_report_vers, ''), p_report_plafond_min, p_actif, false)
  on conflict (code) do update set libelle = excluded.libelle, periodicite = excluded.periodicite,
    autorise_negatif = excluded.autorise_negatif, visible_employe = excluded.visible_employe, report_mode = excluded.report_mode,
    report_vers = excluded.report_vers, report_plafond_min = excluded.report_plafond_min, actif = excluded.actif, regle_provisoire = false;
end $$;

-- Applique la règle de fin de période à tous les compteurs dont la période se termine le jour p_fin
create or replace function pointage.reporter_compteurs(p_fin date, p_acteur uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  c record; r record;
  v_cible text; v_transfert int; n int := 0;
begin
  for c in select * from pointage.compteurs
           where actif and ((periodicite = 'annuelle' and p_fin = (date_trunc('year', p_fin) + interval '1 year - 1 day')::date)
                         or (periodicite = 'trimestrielle' and p_fin = (date_trunc('quarter', p_fin) + interval '3 months - 1 day')::date))
  loop
    v_cible := coalesce(c.report_vers, c.code);
    for r in select personne_id, sum(minutes)::int as solde from pointage.mouvements_compteur
             where compteur_code = c.code and periode_debut = pointage.periode_de(c.code, p_fin)
             group by personne_id having sum(minutes) <> 0
    loop
      v_transfert := case
        when r.solde < 0 then r.solde                                          -- une dette suit toujours la personne
        when c.report_mode = 'perdu' then 0
        when c.report_mode = 'plafonne' then least(r.solde, c.report_plafond_min)
        else r.solde end;
      if v_transfert <> 0 then
        insert into pointage.mouvements_compteur (personne_id, compteur_code, periode_debut, date_effet, type, minutes, motif, cree_par)
        values (r.personne_id, c.code, pointage.periode_de(c.code, p_fin), p_fin, 'report', -v_transfert,
                'Report vers ' || v_cible, p_acteur),
               (r.personne_id, v_cible, pointage.periode_de(v_cible, p_fin + 1), p_fin + 1, 'report', v_transfert,
                'Report depuis ' || c.code || ' (' || to_char(p_fin, 'MM/YYYY') || ')', p_acteur);
      end if;
      if r.solde - v_transfert <> 0 then
        insert into pointage.mouvements_compteur (personne_id, compteur_code, periode_debut, date_effet, type, minutes, motif, cree_par)
        values (r.personne_id, c.code, pointage.periode_de(c.code, p_fin), p_fin, 'expiration', -(r.solde - v_transfert),
                'Solde non reportable (' || c.report_mode || ')', p_acteur);
      end if;
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 3. Fonctions complétées (statistiques, CPAS, clôture, anomalies)
-- ---------------------------------------------------------------------
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
  v_seuil int := coalesce(pointage.param('stats_seuil_anonymat'), 0);
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
end $$;

drop function public.rapport_cpas(date);
create or replace function public.rapport_cpas(p_mois date)
returns table (personne_id uuid, prenom text, nom text, partenaire text, service text, regime text,
               a_prester int, preste int, conges int, absence_justifiee int, absence_maladie int,
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
end $$;

create or replace function public.cloturer_mois(p_mois date, p_export_hash text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
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
      where pe.date_entree <= v_fin and (pe.date_sortie is null or pe.date_sortie >= p_mois)
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
end $$;

create or replace view public.anomalies with (security_invoker = true) as
with j as (
  select * from pointage.journees_set(current_date - 62, current_date - 1, (select array_agg(id) from pointage.personnes))
)
select j.personne_id, j.jour,
       case when j.nb_pointages = 0 then 'absent' else 'pointages_incomplets' end as code,
       case when j.nb_pointages = 0 then 'Absent sans justification'
            else 'Pointages incomplets (sortie manquante ?)' end as libelle
from j
where (j.nb_pointages = 0 and j.a_prester > 0) or (j.nb_pointages > 0 and not j.complete)
union all
select j.personne_id, max(j.jour), 'semaine_max',
       'Plus de ' || (pointage.param('max_semaine_min') / 60) || ' h prestées dans la semaine'
from j
group by j.personne_id, date_trunc('week', j.jour)
having sum(j.preste) > pointage.param('max_semaine_min');

-- ---------------------------------------------------------------------
-- 4. Confidentialité : IP visible selon le réglage
-- ---------------------------------------------------------------------
create or replace view public.pointages with (security_invoker = true) as
select id, personne_id, horodatage, pointage.jour_bxl(horodatage) as jour, sens, type_code, source, lieu,
       case when personne_id = pointage.moi() or pointage.mon_role() in ('rh', 'admin_rh', 'admin')
                 or pointage.param('ip_visible_n1') = 1 then ip end as ip,
       remarque, annule, annule_motif, cree_le
from pointage.pointages;

-- ---------------------------------------------------------------------
-- 5. ISP : congés activables
-- ---------------------------------------------------------------------
create or replace function pointage.verifier_conges_isp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not new.encode_par_rh and pointage.param('isp_conges') = 0
     and exists (select 1 from pointage.personnes where id = new.personne_id and type = 'isp') then
    raise exception 'Les congés des ISP ne sont pas gérés dans l''application (réglage)';
  end if;
  return new;
end $$;
create trigger trg_conges_isp before insert on pointage.demandes for each row execute function pointage.verifier_conges_isp();

-- ---------------------------------------------------------------------
-- 6. Rappel manuel (chef, RH, direction, admin) à une ou plusieurs personnes
-- ---------------------------------------------------------------------
create or replace function public.envoyer_rappel(p_ids uuid[], p_message text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_moi uuid := pointage.exiger_personne();
  v_id uuid; n int := 0;
  v_tranche text := to_char(date_trunc('minute', now())
                    - make_interval(mins => extract(minute from now())::int % greatest(pointage.param('rappel_manuel_delai_min'), 1)),
                    'YYYY-MM-DD"T"HH24:MI');
begin
  foreach v_id in array coalesce(p_ids, '{}') loop
    if v_id = v_moi or not (pointage.est_valideur_de(v_id) or pointage.mon_role() in ('rh', 'admin_rh', 'admin', 'direction')) then
      raise exception 'Rappel non autorisé pour cette personne' using errcode = '42501';
    end if;
    insert into pointage.notifications (personne_id, type, cle, titre, corps, lien)
    values (v_id, 'rappel_manuel', 'rappel:' || v_moi || ':' || v_tranche,
            'Rappel de ' || pointage.nom_complet(v_moi),
            coalesce(nullif(trim(p_message), ''), 'Pense à régulariser tes pointages (oubli d''entrée ou de sortie).'), '/anomalies')
    on conflict (personne_id, cle) do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 7. Conservation des données (lancé chaque nuit)
-- ---------------------------------------------------------------------
create or replace function pointage.interdire_modif() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'pointages' and current_setting('pointage.purge', true) = 'on' then
    return old;   -- suppression autorisée uniquement par la purge de conservation
  end if;
  raise exception 'Table % en lecture seule (append-only)', tg_table_name;
end $$;

-- Verrou de clôture : seule la purge peut effacer l'IP d'un pointage clôturé (aucune autre colonne ne bouge)
create or replace function pointage.bloquer_pointage_cloture() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and current_setting('pointage.purge', true) = 'on' and new.ip is null
     and (to_jsonb(new) - 'ip') = (to_jsonb(old) - 'ip') then
    return new;
  end if;
  if (tg_op = 'UPDATE' and pointage.mois_cloture(pointage.jour_bxl(old.horodatage)))
     or pointage.mois_cloture(pointage.jour_bxl(new.horodatage)) then
    raise exception 'Période clôturée : modification impossible';
  end if;
  return new;
end $$;

create or replace function pointage.purger_donnees() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_ip int := 0; v_pt int := 0; v_mois int := pointage.param('conservation_ip_mois'); v_ans int := pointage.param('conservation_pointages_ans');
begin
  perform set_config('pointage.purge', 'on', true);
  if v_mois > 0 then
    update pointage.pointages set ip = null
     where ip is not null and horodatage < now() - make_interval(months => v_mois)
       and pointage.mois_cloture(pointage.jour_bxl(horodatage));
    get diagnostics v_ip = row_count;
  end if;
  if v_ans > 0 then
    delete from pointage.pointages pt
     where pt.horodatage < now() - make_interval(years => v_ans)
       and exists (select 1 from pointage.clotures c where c.mois = date_trunc('month', pointage.jour_bxl(pt.horodatage))::date);
    get diagnostics v_pt = row_count;
  end if;
  perform set_config('pointage.purge', 'off', true);
  return jsonb_build_object('ip_effacees', v_ip, 'pointages_supprimes', v_pt);
end $$;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    perform cron.schedule('cfb-conservation', '17 3 * * *', 'select pointage.purger_donnees()');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 8. Droits
-- ---------------------------------------------------------------------
revoke all on public.compteurs from public, anon;
grant select on public.compteurs, public.parametres to authenticated;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('enregistrer_compteur', 'envoyer_rappel', 'rapport_cpas', 'modifier_parametre') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
