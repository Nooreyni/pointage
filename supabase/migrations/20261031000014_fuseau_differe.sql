-- =====================================================================
--  CFB Pointage — fuseau horaire (audit R7) et pointages différés (audit R4)
--
--  R7 : Supabase tourne en UTC. Entre minuit et 1-2 h (heure belge), « aujourd'hui » était la
--       veille côté serveur (présence, anomalies, clôture, rappels…). Désormais le calcul ne
--       dépend plus du réglage du serveur : chaque fonction s'exécute en Europe/Brussels et les
--       vues utilisent pointage.aujourdhui(). Même résultat sur Supabase, un serveur interne, etc.
--  R4 : un pointage à une heure passée (synchro hors ligne) est marqué « différé », visible du
--       N+1 et de la RH, avec délai maximal et alerte au N+1 réglables. Heure future refusée.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Fuseau
-- ---------------------------------------------------------------------
create or replace function pointage.aujourdhui() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Europe/Brussels')::date
$$;

alter table pointage.mouvements_compteur alter column date_effet set default pointage.aujourdhui();

-- Réglage du serveur aussi (affichage, requêtes manuelles) quand c'est permis (Supabase : oui)
do $$
begin
  execute format('alter database %I set timezone to %L', current_database(), 'Europe/Brussels');
exception when insufficient_privilege then
  raise notice 'Fuseau de la base non modifiable ici : les fonctions restent en Europe/Brussels';
end $$;

create or replace view public.mon_profil with (security_invoker = true) as
select p.id, p.prenom, p.nom, p.email, p.role, p.type, s.nom as service, r.libelle as regime, r.minutes_jour,
       exists (select 1 from pointage.responsables_service rs where rs.personne_id = p.id) as est_chef_service
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
       p.date_entree, p.date_sortie, p.auth_user_id is not null as compte_lie, r.regime_id, r.regime, r.regime_depuis
from pointage.personnes p
join pointage.services s on s.id = p.service_id
left join lateral (
  select pr.regime_id, rg.libelle as regime, pr.debut as regime_depuis
  from pointage.personne_regimes pr join pointage.regimes rg on rg.id = pr.regime_id
  where pr.personne_id = p.id and pr.debut <= pointage.aujourdhui()
  order by pr.debut desc limit 1) r on true
where pointage.mon_role() = any (array['admin', 'admin_rh']::pointage.role_app[]);

create or replace view public.admin_services with (security_invoker = true) as
select s.id, s.nom, s.parent_id, s.couleur, s.seuil_absence_pct, s.actif,
       coalesce((select array_agg(rs.personne_id) from pointage.responsables_service rs where rs.service_id = s.id), '{}'::uuid[]) as chefs,
       (select count(*) from pointage.personnes p
         where p.service_id = s.id and (p.date_sortie is null or p.date_sortie >= pointage.aujourdhui())) as effectif
from pointage.services s;

create or replace view public.anomalies with (security_invoker = true) as
with j as (
  select * from pointage.journees_set(pointage.aujourdhui() - 62, pointage.aujourdhui() - 1, (select array_agg(id) from pointage.personnes))
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
group by j.personne_id, date_trunc('week', j.jour::timestamp)
having sum(j.preste) > pointage.param('max_semaine_min');

-- ---------------------------------------------------------------------
-- 2. Pointages différés
-- ---------------------------------------------------------------------
insert into pointage.parametres (cle, valeur, unite, libelle, categorie, provisoire, source) values
  ('differe_max_h',          72, 'h',   'Pointage hors ligne accepté jusqu''à (au-delà : « Corriger un pointage »)', 'Temps de travail', true, 'Valeur initiale'),
  ('differe_alerte_n1_min',  60, 'min', 'Prévenir le N+1 d''un pointage envoyé en différé de plus de (0 = jamais)', 'Rappels', true, 'Proposition')
on conflict (cle) do nothing;

-- Différé = envoyé (cree_le) plus de 2 min après l'heure déclarée, hors corrections (déjà tracées)
alter table pointage.pointages
  add column differe_min int generated always as (
    case when source in ('mobile', 'web') and cree_le - horodatage > interval '2 minutes'
         then (extract(epoch from cree_le - horodatage) / 60)::int end) stored;

-- Verrou de clôture : la colonne calculée n'est pas encore remplie dans NEW (avant écriture) → exclue de la comparaison
create or replace function pointage.bloquer_pointage_cloture() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and current_setting('pointage.purge', true) = 'on' and new.ip is null
     and (to_jsonb(new) - 'ip' - 'differe_min') = (to_jsonb(old) - 'ip' - 'differe_min') then
    return new;
  end if;
  if (tg_op = 'UPDATE' and pointage.mois_cloture(pointage.jour_bxl(old.horodatage)))
     or pointage.mois_cloture(pointage.jour_bxl(new.horodatage)) then
    raise exception 'Période clôturée : modification impossible';
  end if;
  return new;
end $$;

create or replace view public.pointages with (security_invoker = true) as
select id, personne_id, horodatage, pointage.jour_bxl(horodatage) as jour, sens, type_code, source, lieu,
       case when personne_id = pointage.moi() or pointage.mon_role() in ('rh', 'admin_rh', 'admin')
                 or pointage.param('ip_visible_n1') = 1 then ip end as ip,
       remarque, annule, annule_motif, cree_le,
       differe_min is not null as differe, differe_min
from pointage.pointages;

create or replace function public.pointer(
  p_type_code  text default null,
  p_remarque   text default null,
  p_client_id  uuid default null,
  p_horodatage timestamptz default null,   -- fourni uniquement par la synchro hors ligne
  p_sens       pointage.sens_pointage default null,
  p_source     pointage.source_pointage default 'web'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_moi  uuid := pointage.exiger_personne();
  v_h    timestamptz := coalesce(p_horodatage, now());
  v_ip   inet := pointage.ip_requete();
  v_dern pointage.pointages;
  v_sens pointage.sens_pointage;
  v_lieu pointage.lieu_pointage;
  v_row  pointage.pointages;
  v_differe boolean := p_horodatage is not null and p_horodatage < now() - interval '2 minutes';
  v_alerte int := coalesce(pointage.param('differe_alerte_n1_min'), 0);
  v      uuid;
begin
  if p_source not in ('mobile', 'web') then
    raise exception 'Source % réservée', p_source;
  end if;

  if p_client_id is not null then
    select * into v_row from pointage.pointages where personne_id = v_moi and client_id = p_client_id;
    if found then return to_jsonb(v_row); end if;      -- déjà synchronisé
  end if;

  if v_h > now() + interval '2 minutes' then
    raise exception 'Heure de pointage dans le futur : vérifie l''heure de ton appareil';
  end if;
  if v_differe and p_client_id is null then
    raise exception 'Pour une heure passée, utilise « Corriger un pointage »';
  end if;
  if v_h < now() - make_interval(hours => coalesce(pointage.param('differe_max_h'), 72)) then
    raise exception 'Pointage de plus de % h : utilise « Corriger un pointage »', coalesce(pointage.param('differe_max_h'), 72);
  end if;

  select * into v_dern from pointage.pointages
  where personne_id = v_moi and not annule
    and pointage.jour_bxl(horodatage) = pointage.jour_bxl(v_h) and horodatage <= v_h
  order by horodatage desc limit 1;

  v_sens := coalesce(p_sens, case when v_dern.sens = 'entree' then 'sortie' else 'entree' end::pointage.sens_pointage);
  -- Pointage différé (synchro) : l'IP actuelle n'est pas celle du moment réel
  if v_differe then
    v_ip := null;
  end if;
  v_lieu := pointage.lieu_de(v_ip);

  insert into pointage.pointages (personne_id, horodatage, sens, type_code, source, lieu, ip, remarque, client_id, cree_par)
  values (v_moi, v_h, v_sens,
          coalesce(p_type_code,
                   case when v_sens = 'sortie' and v_dern.sens = 'entree' then v_dern.type_code end,
                   case v_lieu when 'externe' then 'TT' else 'BUREAU' end),
          p_source, v_lieu, v_ip, p_remarque, p_client_id, v_moi)
  returning * into v_row;

  if v_differe and v_alerte > 0 and now() - v_h >= make_interval(mins => v_alerte) then
    for v in select pointage.valideurs_n1(v_moi) loop
      perform pointage.notifier(v, 'pointage_differe', 'differe:' || v_row.id,
        pointage.nom_complet(v_moi) || ' : pointage envoyé en différé',
        initcap(v_sens::text) || ' déclarée à ' || to_char(v_h at time zone 'Europe/Brussels', 'DD/MM HH24:MI')
          || ', reçue à ' || to_char(now() at time zone 'Europe/Brussels', 'DD/MM HH24:MI') || ' (hors ligne)',
        '/equipe/pointages/' || v_row.id);
    end loop;
  end if;

  return to_jsonb(v_row);
end $$;

-- ---------------------------------------------------------------------
-- 3. Toutes les fonctions du projet calculent en heure belge, quel que soit le serveur
--    (à relancer après toute migration qui recrée des fonctions : un test le vérifie)
-- ---------------------------------------------------------------------
create or replace function pointage.fixer_fuseau() returns int
language plpgsql set search_path = '' as $$
declare f record; n int := 0;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
           where ns.nspname in ('pointage', 'public') and p.prokind = 'f' and p.provolatile <> 'i' and p.proowner = current_user::regrole
             and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
             and not coalesce('TimeZone=Europe/Brussels' = any (p.proconfig), false) loop
    execute format('alter function %s set timezone to %L', f.sig, 'Europe/Brussels');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function pointage.fixer_fuseau() from public, anon, authenticated;
select pointage.fixer_fuseau();
