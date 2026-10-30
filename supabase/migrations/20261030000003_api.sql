-- =====================================================================
--  CFB Pointage — API (schéma public, exposé par Supabase)
--   • Lecture : vues security_invoker → la RLS de « pointage » s'applique
--   • Écriture : fonctions security definer qui contrôlent QUI fait QUOI
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Calculs métier (privés)
-- ---------------------------------------------------------------------
create or replace function pointage.periode_de(p_compteur text, d date) returns date
language sql stable security definer set search_path = '' as $$
  select case c.periodicite
           when 'annuelle'      then date_trunc('year', d)::date
           when 'trimestrielle' then date_trunc('quarter', d)::date
           else date '2000-01-01'
         end
  from pointage.compteurs c where c.code = p_compteur
$$;

-- Minutes de travail prévues entre deux dates (hors WE selon régime, hors jours fériés)
create or replace function pointage.minutes_ouvrees(p uuid, debut date, fin date) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(count(*)::int * max(r.minutes_par_jour), 0)
  from pointage.personnes pe
  join pointage.regimes r on r.id = pe.regime_id
  cross join generate_series(debut, fin, interval '1 day') g(j)
  where pe.id = p
    and extract(isodow from g.j) <= r.jours_par_semaine
    and not exists (select 1 from pointage.jours_feries f where f.jour = g.j::date)
$$;

create or replace function pointage.minutes_demande(
  p uuid, p_type pointage.type_demande, debut date, fin date, p_minutes int
) returns int
language sql stable security definer set search_path = '' as $$
  select case p_type
           when 'conge_jours'         then pointage.minutes_ouvrees(p, debut, fin)
           when 'conge_demi_jour'     then pointage.minutes_ouvrees(p, debut, debut) / 2
           when 'conge_heures'        then p_minutes
           when 'correction_pointage' then 0
         end
$$;

-- Solde disponible = grand livre − demandes en attente sur le même compteur/période
create or replace function pointage.solde_disponible(p uuid, p_compteur text, d date) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(minutes) from pointage.mouvements_compteur
                   where personne_id = p and compteur_code = p_compteur
                     and periode_debut = pointage.periode_de(p_compteur, d)), 0)
       - coalesce((select sum(dm.minutes_decomptees) from pointage.demandes dm
                   join pointage.codes_absence ca on ca.code = dm.code_absence
                   where dm.personne_id = p and ca.compteur_code = p_compteur
                     and dm.statut in ('a_valider_n1', 'a_traiter_rh')
                     and pointage.periode_de(p_compteur, dm.date_debut) = pointage.periode_de(p_compteur, d)), 0)::int
$$;

-- Classement réseau à partir de l'IP de la requête (lue, comparée, jamais stockée)
create or replace function pointage.lieu_requete() returns pointage.lieu_pointage
language plpgsql stable security definer set search_path = '' as $$
declare
  h  json := nullif(current_setting('request.headers', true), '')::json;
  ip inet;
begin
  begin
    ip := trim(split_part(coalesce(h->>'cf-connecting-ip', h->>'x-real-ip', h->>'x-forwarded-for'), ',', 1))::inet;
  exception when others then
    return 'inconnu';
  end;
  if ip is null then return 'inconnu'; end if;
  return case when exists (select 1 from pointage.reseaux_cfb where ip <<= plage)
              then 'reseau_cfb' else 'externe' end;
end $$;

create or replace function pointage.exiger_personne() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := pointage.moi();
begin
  if v is null then
    raise exception 'Compte non reconnu par CFB Pointage' using errcode = '42501';
  end if;
  return v;
end $$;

create or replace function pointage.exiger_role(variadic roles pointage.role_app[]) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := pointage.exiger_personne();
begin
  if pointage.mon_role() <> all (roles) then
    raise exception 'Action réservée à : %', array_to_string(roles, ', ') using errcode = '42501';
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 2. Pointage
-- ---------------------------------------------------------------------
-- 1 tap : sens et type déduits si non fournis. Rejouable hors ligne grâce à p_client_id.
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
  v_moi   uuid := pointage.exiger_personne();
  v_h     timestamptz := coalesce(p_horodatage, now());
  v_dern  pointage.pointages;
  v_sens  pointage.sens_pointage;
  v_lieu  pointage.lieu_pointage;
  v_type  text;
  v_row   pointage.pointages;
begin
  if p_source not in ('mobile', 'web', 'teams') then
    raise exception 'Source % réservée au système', p_source;
  end if;

  if p_client_id is not null then
    select * into v_row from pointage.pointages where personne_id = v_moi and client_id = p_client_id;
    if found then return to_jsonb(v_row); end if;     -- déjà synchronisé
  end if;

  if v_h < now() - interval '72 hours' then
    raise exception 'Pointage de plus de 72 h : fais une demande de correction';
  end if;

  select * into v_dern from pointage.pointages
  where personne_id = v_moi and not annule
    and pointage.jour_bxl(horodatage) = pointage.jour_bxl(v_h) and horodatage <= v_h
  order by horodatage desc limit 1;

  v_sens := coalesce(p_sens, case when v_dern.sens = 'entree' then 'sortie' else 'entree' end::pointage.sens_pointage);

  -- Pointage différé (synchro) : on ne connaît pas le réseau au moment réel
  v_lieu := case when p_horodatage is not null and p_horodatage < now() - interval '2 minutes'
                 then 'inconnu' else pointage.lieu_requete() end;

  v_type := coalesce(p_type_code,
                     case when v_sens = 'sortie' and v_dern.sens = 'entree' then v_dern.type_code end,
                     case v_lieu when 'externe' then 'TT' else 'BUREAU' end);

  insert into pointage.pointages (personne_id, horodatage, sens, type_code, source, lieu, remarque, client_id, cree_par)
  values (v_moi, v_h, v_sens, v_type, p_source, v_lieu, p_remarque, p_client_id, v_moi)
  returning * into v_row;

  return to_jsonb(v_row);
end $$;

-- Annulation : le travailleur dans les 15 min (erreur de tap), la RH à tout moment
create or replace function public.annuler_pointage(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_moi uuid := pointage.exiger_personne();
  v_p   pointage.pointages;
begin
  select * into v_p from pointage.pointages where id = p_id for update;
  if not found or v_p.annule then raise exception 'Pointage introuvable ou déjà annulé'; end if;
  if not (pointage.mon_role() in ('rh', 'admin')
          or (v_p.personne_id = v_moi and v_p.cree_le > now() - interval '15 minutes')) then
    raise exception 'Annulation non autorisée : fais une demande de correction' using errcode = '42501';
  end if;
  update pointage.pointages set annule = true, annule_par = v_moi, annule_le = now() where id = p_id;
end $$;

create or replace function public.corriger_pointage_rh(
  p_personne_id uuid, p_horodatage timestamptz, p_sens pointage.sens_pointage,
  p_type_code text default 'BUREAU', p_remarque text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_moi uuid := pointage.exiger_role('rh', 'admin');
  v_row pointage.pointages;
begin
  insert into pointage.pointages (personne_id, horodatage, sens, type_code, source, remarque, cree_par)
  values (p_personne_id, p_horodatage, p_sens, p_type_code, 'correction_rh', p_remarque, v_moi)
  returning * into v_row;
  return to_jsonb(v_row);
end $$;

-- ---------------------------------------------------------------------
-- 3. Demandes
-- ---------------------------------------------------------------------
-- Simulation : ce que la demande décompterait + chevauchement dans le service
create or replace function public.simuler_demande(
  p_type pointage.type_demande, p_code_absence text, p_debut date, p_fin date,
  p_demi pointage.demi_journee default null, p_minutes int default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_moi      uuid := pointage.exiger_personne();
  v_minutes  int  := pointage.minutes_demande(v_moi, p_type, p_debut, p_fin, p_minutes);
  v_compteur text;
  v_negatif  boolean;
  v_dispo    int;
  v_service  uuid;
  v_seuil    int;
  v_effectif int;
  v_absents  int;
begin
  select ca.compteur_code, coalesce(c.autorise_negatif, false) into v_compteur, v_negatif
  from pointage.codes_absence ca left join pointage.compteurs c on c.code = ca.compteur_code
  where ca.code = p_code_absence;

  if v_compteur is not null then
    v_dispo := pointage.solde_disponible(v_moi, v_compteur, p_debut);
  end if;

  select pe.service_id, s.seuil_absence_pct into v_service, v_seuil
  from pointage.personnes pe join pointage.services s on s.id = pe.service_id where pe.id = v_moi;

  select count(*) into v_effectif from pointage.personnes
  where service_id = v_service and type = 'interne' and (date_sortie is null or date_sortie >= p_debut);

  select count(distinct d.personne_id) into v_absents
  from pointage.demandes d join pointage.personnes pe on pe.id = d.personne_id
  where pe.service_id = v_service and d.personne_id <> v_moi
    and d.type <> 'correction_pointage'
    and d.statut in ('a_valider_n1', 'a_traiter_rh', 'accordee')
    and daterange(d.date_debut, d.date_fin, '[]') && daterange(p_debut, p_fin, '[]');

  return jsonb_build_object(
    'minutes',          v_minutes,
    'compteur',         v_compteur,
    'solde_avant',      v_dispo,
    'solde_apres',      v_dispo - v_minutes,
    'solde_suffisant',  v_compteur is null or v_negatif or v_dispo >= v_minutes,
    'collegues_absents', v_absents,
    'effectif_service', v_effectif,
    'seuil_depasse',    v_effectif > 0 and (v_absents + 1) * 100 > v_seuil * v_effectif
  );
end $$;

create or replace function public.soumettre_demande(
  p_type pointage.type_demande,
  p_code_absence text default null,
  p_debut date default null,
  p_fin date default null,
  p_demi pointage.demi_journee default null,
  p_minutes int default null,
  p_pointage_propose jsonb default null,
  p_commentaire text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_moi   uuid := pointage.exiger_personne();
  v_code  pointage.codes_absence;
  v_sim   jsonb;
  v_n1    boolean;
  v_row   pointage.demandes;
begin
  p_fin := coalesce(p_fin, p_debut);

  if p_type = 'correction_pointage' then
    if p_pointage_propose is null
       or (p_pointage_propose->>'horodatage') is null
       or (p_pointage_propose->>'sens') not in ('entree', 'sortie') then
      raise exception 'Correction incomplète : horodatage et sens requis';
    end if;
    p_debut := pointage.jour_bxl((p_pointage_propose->>'horodatage')::timestamptz);
    p_fin := p_debut;
    if p_debut > current_date then raise exception 'Correction dans le futur impossible'; end if;
    v_n1 := true;
  else
    select * into v_code from pointage.codes_absence where code = p_code_absence and actif;
    if not found or not v_code.demandable then
      raise exception 'Code d''absence % non demandable', coalesce(p_code_absence, '∅');
    end if;
    v_n1 := v_code.validation_n1;

    if exists (
      select 1 from pointage.demandes d
      where d.personne_id = v_moi and d.type <> 'correction_pointage'
        and d.statut in ('a_valider_n1', 'a_traiter_rh', 'accordee')
        and daterange(d.date_debut, d.date_fin, '[]') && daterange(p_debut, p_fin, '[]')
        and (d.type = 'conge_jours' or p_type = 'conge_jours'
             or (d.type = 'conge_demi_jour' and p_type = 'conge_demi_jour' and d.demi = p_demi))
    ) then
      raise exception 'Tu as déjà une demande sur cette période';
    end if;

    v_sim := public.simuler_demande(p_type, p_code_absence, p_debut, p_fin, p_demi, p_minutes);
    if (v_sim->>'minutes')::int = 0 then
      raise exception 'Aucun jour ouvré sur cette période';
    end if;
    if not (v_sim->>'solde_suffisant')::boolean then
      raise exception 'Solde insuffisant : % min disponibles, % min demandées',
        v_sim->>'solde_avant', v_sim->>'minutes';
    end if;
  end if;

  insert into pointage.demandes (personne_id, type, code_absence, date_debut, date_fin, demi, minutes,
                                 minutes_decomptees, pointage_propose, commentaire, statut)
  values (v_moi, p_type, p_code_absence, p_debut, p_fin, p_demi, p_minutes,
          coalesce((v_sim->>'minutes')::int, 0), p_pointage_propose, p_commentaire,
          case when v_n1 and exists (select 1 from pointage.valideurs_n1(v_moi))
               then 'a_valider_n1' else 'a_traiter_rh' end::pointage.statut_demande)
  returning * into v_row;

  return to_jsonb(v_row) || jsonb_build_object('simulation', v_sim);
end $$;

-- Validation N+1, unitaire ou en lot (tout ou rien)
create or replace function public.decider_n1(p_ids uuid[], p_accorder boolean, p_commentaire text default null)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_moi uuid := pointage.exiger_personne();
  v_d   pointage.demandes;
  n     int := 0;
begin
  if coalesce(cardinality(p_ids), 0) = 0 then
    raise exception 'Aucune demande sélectionnée';
  end if;
  if not p_accorder and nullif(trim(p_commentaire), '') is null then
    raise exception 'Un refus doit être motivé';
  end if;
  for v_d in select * from pointage.demandes where id = any (p_ids) order by numero for update loop
    if v_d.statut <> 'a_valider_n1' then
      raise exception 'Demande n°% déjà traitée (%)', v_d.numero, v_d.statut;
    end if;
    if not pointage.est_valideur_de(v_d.personne_id) then
      raise exception 'Tu n''es pas valideur pour la demande n°%', v_d.numero using errcode = '42501';
    end if;
    update pointage.demandes
       set statut = case when p_accorder then 'a_traiter_rh' else 'refusee' end::pointage.statut_demande,
           valideur_n1_id = v_moi, decision_n1_le = now(), commentaire_n1 = p_commentaire
     where id = v_d.id;
    n := n + 1;
  end loop;
  if n <> cardinality(p_ids) then
    raise exception 'Certaines demandes sont introuvables';
  end if;
  return n;
end $$;

-- Finalisation RH : décompte du solde ou création du pointage corrigé
create or replace function public.traiter_rh(p_id uuid, p_accorder boolean, p_commentaire text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_moi      uuid := pointage.exiger_role('rh', 'admin');
  v_d        pointage.demandes;
  v_compteur text;
  v_negatif  boolean;
  p          jsonb;
begin
  select * into v_d from pointage.demandes where id = p_id for update;
  if not found or v_d.statut <> 'a_traiter_rh' then
    raise exception 'Demande introuvable ou pas à traiter';
  end if;
  if v_d.personne_id = v_moi and pointage.mon_role() <> 'admin' then
    raise exception 'Tu ne peux pas traiter ta propre demande' using errcode = '42501';
  end if;
  if not p_accorder and nullif(trim(p_commentaire), '') is null then
    raise exception 'Un refus doit être motivé';
  end if;

  if p_accorder then
    select ca.compteur_code, coalesce(c.autorise_negatif, false) into v_compteur, v_negatif
    from pointage.codes_absence ca left join pointage.compteurs c on c.code = ca.compteur_code
    where ca.code = v_d.code_absence;

    if v_compteur is not null and v_d.minutes_decomptees > 0 then
      -- solde_disponible déduit déjà cette demande (en attente) : il doit rester ≥ 0
      if not v_negatif and pointage.solde_disponible(v_d.personne_id, v_compteur, v_d.date_debut) < 0 then
        raise exception 'Solde insuffisant au moment de l''accord';
      end if;
      insert into pointage.mouvements_compteur (personne_id, compteur_code, periode_debut, date_effet,
                                                type, minutes, demande_id, motif, cree_par)
      values (v_d.personne_id, v_compteur, pointage.periode_de(v_compteur, v_d.date_debut), v_d.date_debut,
              'prise', -v_d.minutes_decomptees, v_d.id, 'Demande n°' || v_d.numero, v_moi);
    end if;

    if v_d.type = 'correction_pointage' then
      p := v_d.pointage_propose;
      insert into pointage.pointages (personne_id, horodatage, sens, type_code, source, demande_id, remarque, cree_par)
      values (v_d.personne_id, (p->>'horodatage')::timestamptz, (p->>'sens')::pointage.sens_pointage,
              coalesce(p->>'type_code', 'BUREAU'), 'demande', v_d.id, v_d.commentaire, v_moi);
    end if;
  end if;

  update pointage.demandes
     set statut = case when p_accorder then 'accordee' else 'refusee' end::pointage.statut_demande,
         traite_rh_par = v_moi, traite_rh_le = now(), commentaire_rh = p_commentaire
   where id = p_id;
end $$;

-- Annulation : le demandeur tant que ce n'est pas commencé ; la RH à tout moment (hors clôture)
create or replace function public.annuler_demande(p_id uuid, p_motif text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_moi uuid := pointage.exiger_personne();
  v_rh  boolean := pointage.mon_role() in ('rh', 'admin');
  v_d   pointage.demandes;
  m     pointage.mouvements_compteur;
begin
  select * into v_d from pointage.demandes where id = p_id for update;
  if not found or v_d.statut in ('refusee', 'annulee') then
    raise exception 'Demande introuvable ou déjà clôturée';
  end if;
  if not (v_rh or (v_d.personne_id = v_moi and (v_d.statut <> 'accordee' or v_d.date_debut > current_date))) then
    raise exception 'Annulation non autorisée' using errcode = '42501';
  end if;

  if v_d.statut = 'accordee' then
    for m in select * from pointage.mouvements_compteur where demande_id = p_id and type = 'prise' loop
      insert into pointage.mouvements_compteur (personne_id, compteur_code, periode_debut, date_effet,
                                                type, minutes, demande_id, motif, cree_par)
      values (m.personne_id, m.compteur_code, m.periode_debut, m.date_effet,
              'annulation', -m.minutes, p_id, coalesce(p_motif, 'Annulation demande n°' || v_d.numero), v_moi);
    end loop;
    update pointage.pointages set annule = true, annule_par = v_moi, annule_le = now()
     where demande_id = p_id and not annule;
  end if;

  update pointage.demandes set statut = 'annulee', commentaire_rh = coalesce(p_motif, commentaire_rh)
   where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- 4. RH : soldes, délégations, clôture
-- ---------------------------------------------------------------------
create or replace function public.mouvement_solde_rh(
  p_personne_id uuid, p_compteur text, p_minutes int,
  p_type pointage.type_mouvement default 'ajustement',
  p_date_effet date default current_date, p_motif text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_moi uuid := pointage.exiger_role('rh', 'admin');
begin
  if p_type not in ('ouverture', 'attribution', 'ajustement', 'report', 'expiration') then
    raise exception 'Type % réservé au système', p_type;
  end if;
  if nullif(trim(p_motif), '') is null and p_type = 'ajustement' then
    raise exception 'Un ajustement doit être motivé';
  end if;
  insert into pointage.mouvements_compteur (personne_id, compteur_code, periode_debut, date_effet, type, minutes, motif, cree_par)
  values (p_personne_id, p_compteur, pointage.periode_de(p_compteur, p_date_effet), p_date_effet,
          p_type, p_minutes, p_motif, v_moi);
end $$;

-- Un responsable délègue sa validation ; la RH peut le faire pour lui
create or replace function public.deleguer(p_delegue_id uuid, p_debut date, p_fin date, p_delegant_id uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_moi uuid := pointage.exiger_personne();
  v_delegant uuid := coalesce(p_delegant_id, v_moi);
  v_id uuid;
begin
  if v_delegant <> v_moi and pointage.mon_role() not in ('rh', 'admin') then
    raise exception 'Délégation pour autrui réservée à la RH' using errcode = '42501';
  end if;
  if not exists (select 1 from pointage.responsables_service where personne_id = v_delegant) then
    raise exception 'Seul un responsable peut déléguer';
  end if;
  insert into pointage.delegations (delegant_id, delegue_id, periode)
  values (v_delegant, p_delegue_id, daterange(p_debut, p_fin, '[]'))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.cloturer_mois(p_mois date, p_export_hash text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_moi uuid := pointage.exiger_role('rh', 'admin');
begin
  p_mois := date_trunc('month', p_mois)::date;
  if p_mois >= date_trunc('month', current_date)::date then
    raise exception 'On ne clôture qu''un mois terminé';
  end if;
  if exists (select 1 from pointage.demandes d
             where d.statut in ('a_valider_n1', 'a_traiter_rh')
               and date_trunc('month', d.date_debut)::date <= p_mois) then
    raise exception 'Des demandes sont encore en attente sur cette période';
  end if;
  insert into pointage.clotures (mois, cloture_par, export_hash) values (p_mois, v_moi, p_export_hash);
end $$;

-- ---------------------------------------------------------------------
-- 5. Lecture : vues sous RLS
-- ---------------------------------------------------------------------
create view public.mon_profil with (security_invoker = true) as
select p.id, p.prenom, p.nom, p.email, p.role, p.type, s.nom as service, r.minutes_par_jour,
       exists (select 1 from pointage.responsables_service rs where rs.personne_id = p.id) as est_responsable
from pointage.personnes p
join pointage.services s on s.id = p.service_id
join pointage.regimes r on r.id = p.regime_id
where p.id = pointage.moi();

create view public.personnes with (security_invoker = true) as
select p.id, p.prenom, p.nom, p.email, p.role, p.type, p.service_id, s.nom as service,
       p.partenaire_isp, p.matricule, p.date_entree, p.date_sortie
from pointage.personnes p join pointage.services s on s.id = p.service_id;

create view public.pointages with (security_invoker = true) as
select id, personne_id, horodatage, pointage.jour_bxl(horodatage) as jour, sens, type_code, source, lieu,
       remarque, annule, cree_le
from pointage.pointages;

create view public.demandes with (security_invoker = true) as
select d.id, d.numero, d.personne_id, pe.prenom, pe.nom, d.type, d.code_absence, ca.libelle as libelle_absence,
       d.date_debut, d.date_fin, d.demi, d.minutes_decomptees, d.pointage_propose, d.commentaire, d.statut,
       d.valideur_n1_id, d.decision_n1_le, d.commentaire_n1, d.traite_rh_le, d.commentaire_rh, d.cree_le,
       pointage.est_valideur_de(d.personne_id) as je_peux_valider
from pointage.demandes d
join pointage.personnes pe on pe.id = d.personne_id
left join pointage.codes_absence ca on ca.code = d.code_absence;

create view public.soldes with (security_invoker = true) as
select m.personne_id, m.compteur_code, c.libelle, c.ordre, m.periode_debut,
       coalesce(sum(m.minutes) filter (where m.type in ('ouverture','attribution','report','ajustement')), 0) as attribue_min,
       coalesce(-sum(m.minutes) filter (where m.type in ('prise','annulation')), 0)                          as pris_min,
       sum(m.minutes)                                                                                          as reste_min
from pointage.mouvements_compteur m
join pointage.compteurs c on c.code = m.compteur_code
where c.visible_travailleur or pointage.mon_role() in ('rh', 'admin') or m.personne_id <> pointage.moi()
group by 1, 2, 3, 4, 5;

create view public.anomalies with (security_invoker = true) as
select pt.personne_id, pointage.jour_bxl(pt.horodatage) as jour, 'sortie_manquante'::text as code,
       'Sortie manquante' as libelle
from pointage.pointages pt
where not pt.annule and pointage.jour_bxl(pt.horodatage) < current_date
group by pt.personne_id, pointage.jour_bxl(pt.horodatage)
having count(*) filter (where pt.sens = 'entree') > count(*) filter (where pt.sens = 'sortie');

create view public.types_pointage with (security_invoker = true) as
select code, libelle, compte_comme_travail, icone, ordre from pointage.types_pointage where actif;

create view public.codes_absence with (security_invoker = true) as
select code, libelle, compteur_code, validation_n1, justificatif_requis, couleur
from pointage.codes_absence where actif and demandable;

-- « Qui est là aujourd'hui » : visible par tous les internes, motif masqué si confidentiel
create or replace function public.presence_jour()
returns table (personne_id uuid, prenom text, nom text, service text, statut text)
language sql stable security definer set search_path = '' as $$
  with dernier as (
    select distinct on (pt.personne_id) pt.personne_id, pt.sens, pt.type_code
    from pointage.pointages pt
    where not pt.annule and pointage.jour_bxl(pt.horodatage) = current_date
    order by pt.personne_id, pt.horodatage desc
  ),
  absent as (
    select distinct on (d.personne_id) d.personne_id, ca.libelle, ca.motif_confidentiel
    from pointage.demandes d join pointage.codes_absence ca on ca.code = d.code_absence
    where d.statut = 'accordee' and d.type in ('conge_jours', 'conge_demi_jour')
      and current_date between d.date_debut and d.date_fin
  )
  select p.id, p.prenom, p.nom, s.nom,
    case
      when a.personne_id is not null then
        case when a.motif_confidentiel and not pointage.peut_voir(p.id) then 'Absent' else a.libelle end
      when dp.sens = 'entree' and dp.type_code = 'TT' then 'Télétravail'
      when dp.sens = 'entree' then 'Présent'
      when dp.sens = 'sortie' then 'Parti'
      else 'Pas encore pointé'
    end
  from pointage.personnes p
  join pointage.services s on s.id = p.service_id
  left join dernier dp on dp.personne_id = p.id
  left join absent  a  on a.personne_id = p.id
  where pointage.exiger_personne() is not null
    and (p.date_sortie is null or p.date_sortie >= current_date) and p.type = 'interne'
  order by s.nom, p.nom
$$;

-- ---------------------------------------------------------------------
-- 6. Droits API : rien pour anon, exécution pour authenticated
-- ---------------------------------------------------------------------
revoke all on function public.pointer, public.annuler_pointage, public.corriger_pointage_rh,
                       public.simuler_demande, public.soumettre_demande, public.decider_n1,
                       public.traiter_rh, public.annuler_demande, public.mouvement_solde_rh,
                       public.deleguer, public.cloturer_mois, public.presence_jour
  from public, anon;
grant execute on function public.pointer, public.annuler_pointage, public.corriger_pointage_rh,
                          public.simuler_demande, public.soumettre_demande, public.decider_n1,
                          public.traiter_rh, public.annuler_demande, public.mouvement_solde_rh,
                          public.deleguer, public.cloturer_mois, public.presence_jour
  to authenticated;

revoke all on public.mon_profil, public.personnes, public.pointages, public.demandes, public.soldes,
              public.anomalies, public.types_pointage, public.codes_absence
  from public, anon;
grant select on public.mon_profil, public.personnes, public.pointages, public.demandes, public.soldes,
                public.anomalies, public.types_pointage, public.codes_absence
  to authenticated;
