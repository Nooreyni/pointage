-- =====================================================================
--  CFB Pointage — la RH gère les fiches des personnes (création, modification, régime)
--  Demande du 02/11/2026 : « Les RH doivent pouvoir créer des profils aussi ».
--  Garde-fou (sécurité, à valider) : la RH ne peut ni nommer ni modifier un admin général ou un admin RH
--  (pas d'élévation de ses propres droits) ; délier un compte reste réservé à l'admin / admin RH.
-- =====================================================================

-- Rôles qu'une personne connectée peut attribuer / modifier
create or replace function pointage.peut_gerer_role(p_role pointage.role_app) returns boolean
language sql stable security definer set search_path = '' as $$
  select case pointage.mon_role()
           when 'admin' then true
           when 'admin_rh' then p_role <> 'admin'
           when 'rh' then p_role not in ('admin', 'admin_rh')
           else false end
$$;

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
where pointage.mon_role() = any (array['admin', 'admin_rh', 'rh']::pointage.role_app[]);

create or replace function public.enregistrer_personne(
  p_id uuid, p_prenom text, p_nom text, p_email text, p_service_id uuid,
  p_role pointage.role_app default 'employe', p_type pointage.type_personne default 'interne',
  p_partenaire_isp text default null, p_matricule text default null,
  p_date_entree date default current_date, p_date_sortie date default null, p_regime_id smallint default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_moi uuid := pointage.exiger_role('admin', 'admin_rh', 'rh');
  v_id  uuid := p_id;
  v_ancien pointage.role_app;
begin
  if nullif(trim(p_prenom), '') is null or nullif(trim(p_nom), '') is null or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Prénom, nom et e-mail valide obligatoires';
  end if;
  if v_id is not null then
    select role into v_ancien from pointage.personnes where id = v_id;
    if v_ancien is not null and not pointage.peut_gerer_role(v_ancien) then
      raise exception 'Seul un % peut modifier cette personne', case when v_ancien = 'admin' then 'admin général' else 'admin RH ou admin général' end
        using errcode = '42501';
    end if;
  end if;
  if not pointage.peut_gerer_role(p_role) then
    raise exception 'Seul un % peut attribuer ce rôle', case when p_role = 'admin' then 'admin général' else 'admin RH ou admin général' end
      using errcode = '42501';
  end if;

  if v_id is null then
    if exists (select 1 from pointage.personnes where email = lower(trim(p_email))) then
      raise exception 'Cette adresse e-mail est déjà utilisée par une autre fiche';
    end if;
    if p_regime_id is null then raise exception 'Choisis un régime de travail'; end if;
    insert into pointage.personnes (prenom, nom, email, service_id, role, type, partenaire_isp, matricule, date_entree, date_sortie)
    values (trim(p_prenom), trim(p_nom), lower(trim(p_email)), p_service_id, p_role, p_type, nullif(trim(p_partenaire_isp), ''),
            nullif(trim(p_matricule), ''), p_date_entree, p_date_sortie)
    returning id into v_id;
    insert into pointage.personne_regimes (personne_id, debut, regime_id) values (v_id, p_date_entree, p_regime_id);
    perform pointage.lier_personne(v_id);
  else
    perform pointage.verifier_dernier_admin(v_id, p_role, p_date_sortie);
    if v_id = pointage.moi() and lower(trim(p_email)) <> (select email from pointage.personnes where id = v_id) then
      raise exception 'Tu ne peux pas changer ta propre adresse (ton compte serait délié) : demande à un autre admin';
    end if;
    if v_id = pointage.moi() and p_role <> v_ancien then
      raise exception 'Tu ne peux pas changer ton propre rôle : demande à un autre admin';
    end if;
    update pointage.personnes
       set prenom = trim(p_prenom), nom = trim(p_nom), email = lower(trim(p_email)), service_id = p_service_id, role = p_role,
           type = p_type, partenaire_isp = nullif(trim(p_partenaire_isp), ''), matricule = nullif(trim(p_matricule), ''),
           date_entree = p_date_entree, date_sortie = p_date_sortie,
           auth_user_id = case when email = lower(trim(p_email)) then auth_user_id end
     where id = v_id;
    if not found then raise exception 'Personne introuvable'; end if;
    perform pointage.lier_personne(v_id);
  end if;
  return v_id;
end $$;

create or replace function public.changer_regime(p_personne_id uuid, p_regime_id smallint, p_debut date) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pointage.exiger_role('admin', 'admin_rh', 'rh');
  if pointage.mois_cloture(p_debut) then
    raise exception 'Le mois de % est clôturé : choisis une date plus récente', to_char(p_debut, 'MM/YYYY');
  end if;
  insert into pointage.personne_regimes (personne_id, debut, regime_id) values (p_personne_id, p_debut, p_regime_id)
  on conflict (personne_id, debut) do update set regime_id = excluded.regime_id;
end $$;

create or replace function public.regime_personnalise(p_personne_id uuid, p_minutes_jour int[], p_debut date) returns smallint
language plpgsql security definer set search_path = '' as $$
declare
  v_id      smallint;
  v_jours   int;
  v_semaine int;
  v_plein   int;
  v_lib     text;
  v_noms    text[] := array['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
begin
  perform pointage.exiger_role('admin', 'admin_rh', 'rh');
  if cardinality(p_minutes_jour) <> 7 or exists (select 1 from unnest(p_minutes_jour) m where m < 0 or m > 720) then
    raise exception 'Indique les heures des 7 jours (entre 0 et 12 h)';
  end if;
  select count(*) filter (where m > 0), sum(m) into v_jours, v_semaine from unnest(p_minutes_jour) m;
  if v_jours = 0 then raise exception 'Choisis au moins un jour travaillé'; end if;

  select id into v_id from pointage.regimes where actif and minutes_jour = p_minutes_jour order by id limit 1;
  if v_id is null then
    select max(minutes_semaine) into v_plein from pointage.regimes where actif and contrat = 'temps_plein';
    v_lib := (case when v_semaine >= coalesce(v_plein, v_semaine) then 'Temps plein' else v_jours || '/5' end)
             || ' · ' || (select string_agg(v_noms[i], ' ' order by i) from generate_series(1, 7) i where p_minutes_jour[i] > 0)
             || ' (' || to_char(make_interval(mins => v_semaine), 'FMHH24"h"MI') || '/sem.)';
    while exists (select 1 from pointage.regimes where libelle = v_lib) loop v_lib := v_lib || '′'; end loop;
    insert into pointage.regimes (libelle, contrat, minutes_jour)
    values (v_lib, case when v_semaine >= coalesce(v_plein, v_semaine) then 'temps_plein' else 'temps_partiel' end::pointage.contrat, p_minutes_jour)
    returning id into v_id;
  end if;
  perform public.changer_regime(p_personne_id, v_id, p_debut);
  return v_id;
end $$;


-- Départ : mêmes garde-fous (la RH n'enregistre pas le départ d'un admin RH ou d'un admin général)
create or replace function public.enregistrer_depart(p_personne uuid, p_date date, p_motif text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_moi uuid := pointage.exiger_role('rh', 'admin_rh', 'admin');
  v_annulees int;
begin
  if p_personne = v_moi then raise exception 'Tu ne peux pas enregistrer ton propre départ'; end if;
  if not pointage.peut_gerer_role((select role from pointage.personnes where id = p_personne)) then
    raise exception 'Seul un admin RH ou un admin général peut enregistrer ce départ' using errcode = '42501';
  end if;
  update pointage.personnes set date_sortie = p_date where id = p_personne and date_entree <= p_date;
  if not found then raise exception 'Date de départ avant la date d''entrée, ou personne introuvable'; end if;
  with a as (
    update pointage.demandes set statut = 'annulee', decide_par = v_moi, decide_le = now(),
           commentaire_decision = coalesce(nullif(trim(p_motif), ''), 'Départ du CFB le ' || to_char(p_date, 'DD/MM/YYYY'))
    where personne_id = p_personne and statut in ('en_attente', 'accordee') and date_debut > p_date
    returning 1)
  select count(*) into v_annulees from a;
  return jsonb_build_object('demandes_annulees', v_annulees);
end $$;

revoke all on function pointage.peut_gerer_role(pointage.role_app) from public, anon, authenticated;
select pointage.fixer_fuseau();
