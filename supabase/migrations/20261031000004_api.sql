-- =====================================================================
--  CFB Pointage — API (schéma public, exposé par Supabase)
--   • Lecture : vues security_invoker → la RLS de « pointage » s'applique
--   • Écriture : fonctions security definer qui contrôlent QUI fait QUOI
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Garde-fous et utilitaires privés
-- ---------------------------------------------------------------------
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

-- IP de la requête (première adresse transmise par le proxy)
create or replace function pointage.ip_requete() returns inet
language plpgsql stable security definer set search_path = '' as $$
declare h json := nullif(current_setting('request.headers', true), '')::json;
begin
  return trim(split_part(coalesce(h->>'cf-connecting-ip', h->>'x-real-ip', h->>'x-forwarded-for'), ',', 1))::inet;
exception when others then
  return null;
end $$;

create or replace function pointage.lieu_de(ip inet) returns pointage.lieu_pointage
language sql stable security definer set search_path = '' as $$
  select case when ip is null then 'inconnu'
              when exists (select 1 from pointage.reseaux_cfb where ip <<= plage) then 'reseau_cfb'
              else 'externe' end::pointage.lieu_pointage
$$;

create or replace function pointage.notifier(
  p uuid, p_type text, p_cle text, p_titre text, p_corps text default null, p_lien text default null
) returns void
language sql security definer set search_path = '' as $$
  insert into pointage.notifications (personne_id, type, cle, titre, corps, lien)
  values (p, p_type, p_cle, p_titre, p_corps, p_lien)
  on conflict (personne_id, cle) do nothing
$$;

-- Qui reçoit une demande : N+1 effectifs, valideurs ISP, accès délégués, direction abonnée au service
create or replace function pointage.destinataires_demande(p uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select v from pointage.valideurs_n1(p) v
  union
  select pe.id from pointage.personnes pe
  where pe.role in ('responsable_isp', 'admin_rh') and pe.id <> p
    and exists (select 1 from pointage.personnes x where x.id = p and x.type = 'isp')
  union
  select a.personne_id from pointage.acces_services a join pointage.personnes x on x.service_id = a.service_id
  where x.id = p and a.peut_valider and a.personne_id <> p
  union
  select ab.personne_id from pointage.abonnements_service ab join pointage.personnes x on x.service_id = ab.service_id
  where x.id = p and ab.personne_id <> p
$$;

create or replace function pointage.nom_complet(p uuid) returns text
language sql stable security definer set search_path = '' as $$
  select prenom || ' ' || nom from pointage.personnes where id = p
$$;

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
  v_moi  uuid := pointage.exiger_personne();
  v_h    timestamptz := coalesce(p_horodatage, now());
  v_ip   inet := pointage.ip_requete();
  v_dern pointage.pointages;
  v_sens pointage.sens_pointage;
  v_lieu pointage.lieu_pointage;
  v_row  pointage.pointages;
begin
  if p_source not in ('mobile', 'web') then
    raise exception 'Source % réservée', p_source;
  end if;

  if p_client_id is not null then
    select * into v_row from pointage.pointages where personne_id = v_moi and client_id = p_client_id;
    if found then return to_jsonb(v_row); end if;      -- déjà synchronisé
  end if;

  if v_h < now() - interval '72 hours' then
    raise exception 'Pointage de plus de 72 h : utilise « Corriger un pointage »';
  end if;

  select * into v_dern from pointage.pointages
  where personne_id = v_moi and not annule
    and pointage.jour_bxl(horodatage) = pointage.jour_bxl(v_h) and horodatage <= v_h
  order by horodatage desc limit 1;

  v_sens := coalesce(p_sens, case when v_dern.sens = 'entree' then 'sortie' else 'entree' end::pointage.sens_pointage);
  -- Pointage différé (synchro) : l'IP actuelle n'est pas celle du moment réel
  if p_horodatage is not null and p_horodatage < now() - interval '2 minutes' then
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

  return to_jsonb(v_row);
end $$;

-- Oubli de pointage corrigé par l'employé : auto-validé, le N+1 est informé et peut revenir dessus
create or replace function public.corriger_pointage(
  p_horodatage timestamptz, p_sens pointage.sens_pointage,
  p_type_code text default 'BUREAU', p_remarque text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_moi uuid := pointage.exiger_personne();
  v_row pointage.pointages;
  v     uuid;
begin
  if p_horodatage > now() then
    raise exception 'Correction dans le futur impossible';
  end if;
  if p_horodatage < date_trunc('month', now()) - interval '1 month' then
    raise exception 'Correction trop ancienne : contacte la RH';
  end if;

  insert into pointage.pointages (personne_id, horodatage, sens, type_code, source, ip, remarque, cree_par)
  values (v_moi, p_horodatage, p_sens, p_type_code, 'correction', pointage.ip_requete(), p_remarque, v_moi)
  returning * into v_row;

  for v in select pointage.valideurs_n1(v_moi) loop
    perform pointage.notifier(v, 'correction_pointage', 'correction:' || v_row.id,
      pointage.nom_complet(v_moi) || ' a corrigé un pointage',
      to_char(p_horodatage at time zone 'Europe/Brussels', 'DD/MM HH24:MI') || ' — ' || p_sens::text
        || coalesce(' — ' || p_remarque, ''),
      '/equipe/pointages/' || v_row.id);
  end loop;
  return to_jsonb(v_row);
end $$;

-- Annulation : l'employé dans les 15 min (erreur de tap) ; N+1, RH, direction avec motif
create or replace function public.annuler_pointage(p_id uuid, p_motif text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_moi uuid := pointage.exiger_personne();
  v_p   pointage.pointages;
begin
  select * into v_p from pointage.pointages where id = p_id for update;
  if not found or v_p.annule or not pointage.peut_voir(v_p.personne_id) then
    raise exception 'Pointage introuvable ou déjà annulé';
  end if;
  if v_p.personne_id = v_moi and v_p.cree_le > now() - interval '15 minutes' then
    null;
  elsif v_p.personne_id <> v_moi
        and (pointage.est_valideur_de(v_p.personne_id) or pointage.mon_role() in ('rh', 'admin_rh')) then
    if nullif(trim(p_motif), '') is null then
      raise exception 'Motif obligatoire pour annuler le pointage d''un collègue';
    end if;
    perform pointage.notifier(v_p.personne_id, 'pointage_annule', 'annule:' || p_id,
      'Un de tes pointages a été annulé', p_motif, '/pointages');
  else
    raise exception 'Annulation non autorisée' using errcode = '42501';
  end if;
  update pointage.pointages set annule = true, annule_par = v_moi, annule_le = now(), annule_motif = p_motif
   where id = p_id;
end $$;

create or replace function public.corriger_pointage_rh(
  p_personne_id uuid, p_horodatage timestamptz, p_sens pointage.sens_pointage,
  p_type_code text default 'BUREAU', p_remarque text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_moi uuid := pointage.exiger_role('rh', 'admin_rh', 'admin');
  v_row pointage.pointages;
begin
  insert into pointage.pointages (personne_id, horodatage, sens, type_code, source, remarque, cree_par)
  values (p_personne_id, p_horodatage, p_sens, p_type_code, 'rh', p_remarque, v_moi)
  returning * into v_row;
  return to_jsonb(v_row);
end $$;

-- ---------------------------------------------------------------------
-- 3. Demandes
-- ---------------------------------------------------------------------
create or replace function public.simuler_demande(
  p_type pointage.type_demande, p_code_absence text, p_debut date, p_fin date default null,
  p_demi pointage.demi_journee default null, p_minutes int default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_moi      uuid := pointage.exiger_personne();
  v_fin      date := coalesce(p_fin, p_debut);
  v_minutes  int  := pointage.minutes_demande(v_moi, p_type, p_debut, v_fin, p_minutes);
  v_compteur text;
  v_dispo    int;
  v_service  uuid;
  v_seuil    int;
  v_effectif int;
  v_absents  int;
begin
  select ca.compteur_code into v_compteur from pointage.codes_absence ca where ca.code = p_code_absence;
  if v_compteur is not null then
    v_dispo := pointage.solde_disponible(v_moi, v_compteur, p_debut);
  end if;

  select pe.service_id, s.seuil_absence_pct into v_service, v_seuil
  from pointage.personnes pe join pointage.services s on s.id = pe.service_id where pe.id = v_moi;

  select count(*) into v_effectif from pointage.personnes
  where service_id = v_service and (date_sortie is null or date_sortie >= p_debut);

  select count(distinct d.personne_id) into v_absents
  from pointage.demandes d join pointage.personnes pe on pe.id = d.personne_id
  where pe.service_id = v_service and d.personne_id <> v_moi
    and d.statut in ('en_attente', 'accordee')
    and daterange(d.date_debut, d.date_fin, '[]') && daterange(p_debut, v_fin, '[]');

  return jsonb_build_object(
    'minutes',           v_minutes,
    'compteur',          v_compteur,
    'solde_avant',       v_dispo,
    'solde_apres',       v_dispo - v_minutes,
    'solde_negatif',     v_compteur is not null and v_dispo - v_minutes < 0,
    'collegues_absents', v_absents,
    'effectif_service',  v_effectif,
    'seuil_depasse',     v_effectif > 0 and (v_absents + 1) * 100 > v_seuil * v_effectif
  );
end $$;

create or replace function public.soumettre_demande(
  p_type pointage.type_demande,
  p_code_absence text,
  p_debut date,
  p_fin date default null,
  p_demi pointage.demi_journee default null,
  p_minutes int default null,
  p_commentaire text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_moi  uuid := pointage.exiger_personne();
  v_code pointage.codes_absence;
  v_sim  jsonb;
  v_row  pointage.demandes;
  v      uuid;
begin
  p_fin := coalesce(p_fin, p_debut);
  select * into v_code from pointage.codes_absence where code = p_code_absence and actif;
  if not found or not v_code.demandable then
    raise exception 'Code d''absence % non demandable', coalesce(p_code_absence, '∅');
  end if;

  if exists (
    select 1 from pointage.demandes d
    where d.personne_id = v_moi and d.statut in ('en_attente', 'accordee')
      and daterange(d.date_debut, d.date_fin, '[]') && daterange(p_debut, p_fin, '[]')
      and (d.type = 'conge_jours' or p_type = 'conge_jours'
           or (d.type = 'conge_demi_jour' and p_type = 'conge_demi_jour' and d.demi = p_demi))
  ) then
    raise exception 'Tu as déjà une demande sur cette période';
  end if;

  v_sim := public.simuler_demande(p_type, p_code_absence, p_debut, p_fin, p_demi, p_minutes);
  if (v_sim->>'minutes')::int = 0 then
    raise exception 'Aucune heure prévue sur cette période (week-end, férié ou jour non presté)';
  end if;
  if (v_sim->>'solde_negatif')::boolean
     and not (select autorise_negatif from pointage.compteurs where code = v_code.compteur_code) then
    raise exception 'Solde insuffisant : % min disponibles, % min demandées', v_sim->>'solde_avant', v_sim->>'minutes';
  end if;

  insert into pointage.demandes (personne_id, type, code_absence, date_debut, date_fin, demi, minutes,
                                 minutes_decomptees, commentaire, cree_par)
  values (v_moi, p_type, p_code_absence, p_debut, p_fin, p_demi, p_minutes,
          (v_sim->>'minutes')::int, p_commentaire, v_moi)
  returning * into v_row;

  for v in select pointage.destinataires_demande(v_moi) loop
    perform pointage.notifier(v, 'demande_a_traiter', 'demande:' || v_row.id,
      pointage.nom_complet(v_moi) || ' demande ' || lower(v_code.libelle),
      to_char(p_debut, 'DD/MM') || case when p_fin <> p_debut then ' → ' || to_char(p_fin, 'DD/MM') else '' end
        || case when (v_sim->>'seuil_depasse')::boolean then ' — ⚠ seuil d''absence du service dépassé' else '' end,
      '/validation/' || v_row.id);
  end loop;

  return to_jsonb(v_row) || jsonb_build_object('simulation', v_sim);
end $$;

-- Décision du N+1 (définitive), unitaire ou en lot (tout ou rien)
create or replace function public.decider(p_ids uuid[], p_accorder boolean, p_commentaire text default null)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_moi uuid := pointage.exiger_personne();
  v_d   pointage.demandes;
  v_cpt text;
  n     int := 0;
begin
  if coalesce(cardinality(p_ids), 0) = 0 then
    raise exception 'Aucune demande sélectionnée';
  end if;
  if not p_accorder and nullif(trim(p_commentaire), '') is null then
    raise exception 'Un refus doit être motivé';
  end if;
  for v_d in select * from pointage.demandes where id = any (p_ids) order by numero for update loop
    if v_d.statut <> 'en_attente' then
      raise exception 'Demande n°% déjà traitée (%)', v_d.numero, v_d.statut;
    end if;
    if not pointage.est_valideur_de(v_d.personne_id) then
      raise exception 'Tu n''es pas valideur pour la demande n°%', v_d.numero using errcode = '42501';
    end if;

    if p_accorder then
      select compteur_code into v_cpt from pointage.codes_absence where code = v_d.code_absence;
      if v_cpt is not null and v_d.minutes_decomptees > 0 then
        insert into pointage.mouvements_compteur (personne_id, compteur_code, periode_debut, date_effet,
                                                  type, minutes, demande_id, motif, cree_par)
        values (v_d.personne_id, v_cpt, pointage.periode_de(v_cpt, v_d.date_debut), v_d.date_debut,
                'prise', -v_d.minutes_decomptees, v_d.id, 'Demande n°' || v_d.numero, v_moi);
      end if;
    end if;

    update pointage.demandes
       set statut = case when p_accorder then 'accordee' else 'refusee' end::pointage.statut_demande,
           decide_par = v_moi, decide_le = now(), commentaire_decision = p_commentaire
     where id = v_d.id;

    perform pointage.notifier(v_d.personne_id, 'demande_decidee', 'decision:' || v_d.id,
      'Ta demande n°' || v_d.numero || ' est ' || case when p_accorder then 'accordée ✅' else 'refusée' end,
      p_commentaire, '/demandes/' || v_d.id);
    n := n + 1;
  end loop;
  if n <> cardinality(p_ids) then
    raise exception 'Certaines demandes sont introuvables';
  end if;
  return n;
end $$;

-- La RH « constate » (pas de décision)
create or replace function public.constater(p_ids uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare v_moi uuid := pointage.exiger_role('rh', 'admin_rh', 'admin'); n int;
begin
  update pointage.demandes set constate_par = v_moi, constate_le = now()
   where id = any (p_ids) and statut = 'accordee' and constate_le is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- Annulation : le demandeur tant que c'est en attente ou pas commencé ; valideur et RH à tout moment
create or replace function public.annuler_demande(p_id uuid, p_motif text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_moi uuid := pointage.exiger_personne();
  v_d   pointage.demandes;
  m     pointage.mouvements_compteur;
begin
  select * into v_d from pointage.demandes where id = p_id for update;
  if not found or v_d.statut in ('refusee', 'annulee') or not pointage.peut_voir(v_d.personne_id) then
    raise exception 'Demande introuvable ou déjà clôturée';
  end if;
  if not ((v_d.personne_id = v_moi and (v_d.statut = 'en_attente' or v_d.date_debut > current_date))
          or pointage.est_valideur_de(v_d.personne_id)
          or pointage.mon_role() in ('rh', 'admin_rh', 'admin')) then
    raise exception 'Annulation non autorisée' using errcode = '42501';
  end if;

  if v_d.statut = 'accordee' then
    for m in select * from pointage.mouvements_compteur where demande_id = p_id and type = 'prise' loop
      insert into pointage.mouvements_compteur (personne_id, compteur_code, periode_debut, date_effet,
                                                type, minutes, demande_id, motif, cree_par)
      values (m.personne_id, m.compteur_code, m.periode_debut, m.date_effet,
              'annulation', -m.minutes, p_id, coalesce(p_motif, 'Annulation demande n°' || v_d.numero), v_moi);
    end loop;
  end if;

  update pointage.demandes set statut = 'annulee', commentaire_decision = coalesce(p_motif, commentaire_decision)
   where id = p_id;

  if v_d.personne_id <> v_moi then
    perform pointage.notifier(v_d.personne_id, 'demande_annulee', 'annulee:' || p_id,
      'Ta demande n°' || v_d.numero || ' a été annulée', p_motif, '/demandes/' || p_id);
  end if;
end $$;

-- Absence encodée par la RH (maladie, accident de travail…) : accordée directement
create or replace function public.encoder_absence_rh(
  p_personne_id uuid, p_code_absence text, p_debut date, p_fin date default null,
  p_type pointage.type_demande default 'conge_jours', p_demi pointage.demi_journee default null,
  p_minutes int default null, p_commentaire text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_moi uuid := pointage.exiger_role('rh', 'admin_rh', 'admin');
  v_id  uuid;
  v_cpt text;
  v_min int;
begin
  p_fin := coalesce(p_fin, p_debut);
  v_min := pointage.minutes_demande(p_personne_id, p_type, p_debut, p_fin, p_minutes);
  insert into pointage.demandes (personne_id, type, code_absence, date_debut, date_fin, demi, minutes,
                                 minutes_decomptees, commentaire, encode_par_rh, cree_par)
  values (p_personne_id, p_type, p_code_absence, p_debut, p_fin, p_demi, p_minutes, v_min, p_commentaire, true, v_moi)
  returning id into v_id;

  select compteur_code into v_cpt from pointage.codes_absence where code = p_code_absence;
  if v_cpt is not null and v_min > 0 then
    insert into pointage.mouvements_compteur (personne_id, compteur_code, periode_debut, date_effet,
                                              type, minutes, demande_id, motif, cree_par)
    values (p_personne_id, v_cpt, pointage.periode_de(v_cpt, p_debut), p_debut, 'prise', -v_min, v_id, 'Encodé RH', v_moi);
  end if;

  update pointage.demandes set statut = 'accordee', decide_par = v_moi, decide_le = now(),
                               constate_par = v_moi, constate_le = now()
   where id = v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 4. Heures au-delà du maximum journalier (pas d'heures sup par défaut)
-- ---------------------------------------------------------------------
create or replace function public.decider_heures(p_personne_id uuid, p_jour date, p_accorder boolean, p_commentaire text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_moi uuid := pointage.exiger_personne();
  v_dep int;
begin
  if not (pointage.est_valideur_de(p_personne_id) or pointage.mon_role() in ('rh', 'admin_rh')) then
    raise exception 'Non autorisé' using errcode = '42501';
  end if;
  select depassement into v_dep from pointage.journee(p_personne_id, p_jour);
  if coalesce(v_dep, 0) = 0 then
    raise exception 'Aucune heure à valider ce jour-là';
  end if;
  insert into pointage.decisions_hs (personne_id, jour, minutes, accordee, commentaire, decide_par)
  values (p_personne_id, p_jour, v_dep, p_accorder, p_commentaire, v_moi);
  if p_accorder then
    insert into pointage.mouvements_compteur (personne_id, compteur_code, periode_debut, date_effet, type, minutes, motif, cree_par)
    values (p_personne_id, 'RECUP', pointage.periode_de('RECUP', p_jour), p_jour, 'hs_validees', v_dep,
            'Heures validées du ' || to_char(p_jour, 'DD/MM/YYYY') || coalesce(' — ' || p_commentaire, ''), v_moi);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. RH : soldes, congés annuels, clôture
-- ---------------------------------------------------------------------
create or replace function public.mouvement_solde_rh(
  p_personne_id uuid, p_compteur text, p_minutes int,
  p_type pointage.type_mouvement default 'ajustement',
  p_date_effet date default current_date, p_motif text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_moi uuid := pointage.exiger_role('rh', 'admin_rh', 'admin');
begin
  if p_type not in ('ouverture', 'attribution', 'ajustement', 'report', 'expiration') then
    raise exception 'Type % réservé au système', p_type;
  end if;
  if p_type = 'ajustement' and nullif(trim(p_motif), '') is null then
    raise exception 'Un ajustement doit être motivé';
  end if;
  insert into pointage.mouvements_compteur (personne_id, compteur_code, periode_debut, date_effet, type, minutes, motif, cree_par)
  values (p_personne_id, p_compteur, pointage.periode_de(p_compteur, p_date_effet), p_date_effet,
          p_type, p_minutes, p_motif, v_moi);
end $$;

-- Validation en 1 clic de la proposition de congés annuels (idempotent)
create or replace function public.attribuer_conges(p_annee int, p_personnes uuid[] default null) returns int
language plpgsql security definer set search_path = '' as $$
declare v_moi uuid := pointage.exiger_role('rh', 'admin_rh', 'admin'); n int;
begin
  insert into pointage.mouvements_compteur (personne_id, compteur_code, periode_debut, date_effet, type, minutes, motif, cree_par)
  select pc.personne_id, 'CONGE_LEGAL', make_date(p_annee, 1, 1), make_date(p_annee, 1, 1), 'attribution', pc.minutes,
         format('Congés %s : %s mois de présence en %s, régime %s', p_annee, pc.mois_presence, p_annee - 1, pc.regime), v_moi
  from pointage.proposition_conges(p_annee) pc
  where pc.minutes > 0
    and (p_personnes is null or pc.personne_id = any (p_personnes))
    and not exists (select 1 from pointage.mouvements_compteur m
                    where m.personne_id = pc.personne_id and m.compteur_code = 'CONGE_LEGAL'
                      and m.periode_debut = make_date(p_annee, 1, 1) and m.type = 'attribution');
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.proposition_conges(p_annee int)
returns table (personne_id uuid, prenom text, nom text, regime text, mois_presence numeric, minutes int)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform pointage.exiger_role('rh', 'admin_rh', 'admin');
  return query select * from pointage.proposition_conges(p_annee);
end $$;

-- Clôture mensuelle. En fin de période de référence : report automatique du boni.
create or replace function public.cloturer_mois(p_mois date, p_export_hash text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_moi      uuid := pointage.exiger_role('rh', 'admin_rh', 'admin');
  v_fin      date;
  v_suivant  date;
  v_reports  int := 0;
  v_alertes  int := 0;
  r          record;
begin
  p_mois := date_trunc('month', p_mois)::date;
  v_fin := (p_mois + interval '1 month - 1 day')::date;
  if p_mois >= date_trunc('month', current_date)::date then
    raise exception 'On ne clôture qu''un mois terminé';
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

  insert into pointage.clotures (mois, cloture_par, export_hash) values (p_mois, v_moi, p_export_hash);
  return jsonb_build_object('mois', p_mois, 'reports_boni', v_reports, 'boni_hors_limites', v_alertes);
end $$;

-- ---------------------------------------------------------------------
-- 6. Paramétrage (direction / admin)
-- ---------------------------------------------------------------------
create or replace function public.donner_acces_service(p_personne_id uuid, p_service_id uuid, p_peut_valider boolean default false)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_moi uuid := pointage.exiger_role('direction', 'admin');
begin
  insert into pointage.acces_services (personne_id, service_id, peut_valider, accorde_par)
  values (p_personne_id, p_service_id, p_peut_valider, v_moi)
  on conflict (personne_id, service_id) do update set peut_valider = excluded.peut_valider,
                                                     accorde_par = excluded.accorde_par, accorde_le = now();
end $$;

create or replace function public.retirer_acces_service(p_personne_id uuid, p_service_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pointage.exiger_role('direction', 'admin');
  delete from pointage.acces_services where personne_id = p_personne_id and service_id = p_service_id;
end $$;

-- La direction choisit les services dont elle reçoit aussi les demandes
create or replace function public.suivre_service(p_service_id uuid, p_suivre boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_moi uuid := pointage.exiger_role('direction', 'admin');
begin
  if p_suivre then
    insert into pointage.abonnements_service values (v_moi, p_service_id) on conflict do nothing;
  else
    delete from pointage.abonnements_service where personne_id = v_moi and service_id = p_service_id;
  end if;
end $$;

create or replace function public.modifier_parametre(p_cle text, p_valeur int, p_source text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pointage.exiger_role('admin', 'admin_rh');
  if nullif(trim(p_source), '') is null then
    raise exception 'Indique la source (ex. règlement de travail art. X)';
  end if;
  update pointage.parametres set valeur = p_valeur, provisoire = false, source = p_source where cle = p_cle;
  if not found then raise exception 'Paramètre % inconnu', p_cle; end if;
end $$;

-- ---------------------------------------------------------------------
-- 7. Notifications
-- ---------------------------------------------------------------------
create or replace function public.enregistrer_push(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_moi uuid := pointage.exiger_personne();
begin
  insert into pointage.push_abonnements (personne_id, endpoint, p256dh, auth)
  values (v_moi, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set personne_id = v_moi, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;

create or replace function public.marquer_lu(p_ids bigint[] default null) returns int
language plpgsql security definer set search_path = '' as $$
declare v_moi uuid := pointage.exiger_personne(); n int;
begin
  update pointage.notifications set lu_le = now()
   where personne_id = v_moi and lu_le is null and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 8. Lecture
-- ---------------------------------------------------------------------
create view public.mon_profil with (security_invoker = true) as
select p.id, p.prenom, p.nom, p.email, p.role, p.type, s.nom as service, r.libelle as regime, r.minutes_jour,
       exists (select 1 from pointage.responsables_service rs where rs.personne_id = p.id) as est_chef_service
from pointage.personnes p
join pointage.services s on s.id = p.service_id
left join lateral (select * from pointage.personne_regimes pr join pointage.regimes rg on rg.id = pr.regime_id
                   where pr.personne_id = p.id and pr.debut <= current_date order by pr.debut desc limit 1) r on true
where p.id = pointage.moi();

create view public.personnes with (security_invoker = true) as
select p.id, p.prenom, p.nom, p.email, p.role, p.type, p.service_id, s.nom as service,
       p.partenaire_isp, p.matricule, p.date_entree, p.date_sortie,
       pointage.est_valideur_de(p.id) as je_peux_valider
from pointage.personnes p join pointage.services s on s.id = p.service_id;

create view public.pointages with (security_invoker = true) as
select id, personne_id, horodatage, pointage.jour_bxl(horodatage) as jour, sens, type_code, source, lieu, ip,
       remarque, annule, annule_motif, cree_le
from pointage.pointages;

create view public.demandes with (security_invoker = true) as
select d.id, d.numero, d.personne_id, pe.prenom, pe.nom, d.type, d.code_absence, ca.libelle as libelle_absence,
       ca.code_court, d.date_debut, d.date_fin, d.demi, d.minutes_decomptees, d.commentaire, d.statut,
       d.decide_par, d.decide_le, d.commentaire_decision, d.constate_le, d.encode_par_rh, d.cree_le,
       d.statut = 'en_attente' and pointage.est_valideur_de(d.personne_id) as je_peux_valider
from pointage.demandes d
join pointage.personnes pe on pe.id = d.personne_id
join pointage.codes_absence ca on ca.code = d.code_absence;

create view public.soldes with (security_invoker = true) as
select m.personne_id, m.compteur_code, c.libelle, c.ordre, m.periode_debut,
       coalesce(sum(m.minutes) filter (where m.type in ('ouverture','attribution','report','ajustement','hs_validees')), 0) as attribue_min,
       coalesce(-sum(m.minutes) filter (where m.type in ('prise','annulation')), 0) as pris_min,
       sum(m.minutes) as reste_min
from pointage.mouvements_compteur m
join pointage.compteurs c on c.code = m.compteur_code
where m.compteur_code <> 'BONI'
  and (c.visible_employe or pointage.mon_role() in ('rh', 'admin_rh', 'admin') or m.personne_id <> pointage.moi())
group by 1, 2, 3, 4, 5;

-- Anomalies des 62 derniers jours (jours passés)
create view public.anomalies with (security_invoker = true) as
select pe.id as personne_id, j.jour,
       case when j.nb_pointages = 0 then 'absent' else 'pointages_incomplets' end as code,
       case when j.nb_pointages = 0 then 'Absent sans justification'
            else 'Pointages incomplets (sortie manquante ?)' end as libelle
from pointage.personnes pe
cross join lateral generate_series(current_date - 62, current_date - 1, interval '1 day') g(d)
cross join lateral pointage.journee(pe.id, g.d::date) j
where (j.nb_pointages = 0 and j.a_prester > 0) or (j.nb_pointages > 0 and not j.complete);

create view public.types_pointage with (security_invoker = true) as
select code, libelle, ordre from pointage.types_pointage where actif;

create view public.codes_absence with (security_invoker = true) as
select code, libelle, code_court, compteur_code, justificatif_requis, couleur, ordre
from pointage.codes_absence where actif and demandable;

create view public.mes_notifications with (security_invoker = true) as
select id, type, titre, corps, lien, cree_le, lu_le from pointage.notifications;

create view public.parametres with (security_invoker = true) as
select cle, valeur, unite, libelle, provisoire, source from pointage.parametres;

-- Journées calculées d'une personne visible
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
  return query select j.* from generate_series(p_debut, p_fin, interval '1 day') g(d)
                cross join lateral pointage.journee(p_personne_id, g.d::date) j;
end $$;

create or replace function public.solde_boni(p_personne_id uuid default null) returns int
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := coalesce(p_personne_id, pointage.exiger_personne());
begin
  if not pointage.peut_voir(v) then raise exception 'Non autorisé' using errcode = '42501'; end if;
  return pointage.solde_boni(v, current_date);
end $$;

-- Heures au-delà du maximum journalier sans décision
create or replace function public.heures_a_valider()
returns table (personne_id uuid, prenom text, nom text, jour date, minutes int)
language sql stable security definer set search_path = '' as $$
  select pe.id, pe.prenom, pe.nom, j.jour, j.depassement
  from pointage.personnes pe
  cross join lateral generate_series(current_date - 62, current_date - 1, interval '1 day') g(d)
  cross join lateral pointage.journee(pe.id, g.d::date) j
  where j.depassement > 0
    and pointage.exiger_personne() is not null
    and (pointage.est_valideur_de(pe.id) or pointage.mon_role() in ('rh', 'admin_rh'))
    and not exists (select 1 from pointage.decisions_hs h where h.personne_id = pe.id and h.jour = j.jour)
$$;

-- « Qui est là aujourd'hui » : tout le monde voit présent/absent ; le motif seulement si autorisé
create or replace function public.presence_jour()
returns table (personne_id uuid, prenom text, nom text, service text, mon_service boolean, statut text, depuis timestamptz)
language sql stable security definer set search_path = '' as $$
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
           else 'Pas encore pointé'
         end,
         dp.horodatage
  from pointage.personnes p
  join pointage.services s on s.id = p.service_id
  left join dernier dp on dp.personne_id = p.id
  left join absent  a  on a.personne_id = p.id
  where p.date_entree <= current_date and (p.date_sortie is null or p.date_sortie >= current_date)
  order by 5 desc, s.nom, p.nom
$$;

-- ---------------------------------------------------------------------
-- 9. Droits API : rien pour anon, exécution pour authenticated
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in (
             'pointer', 'corriger_pointage', 'annuler_pointage', 'corriger_pointage_rh', 'simuler_demande',
             'soumettre_demande', 'decider', 'constater', 'annuler_demande', 'encoder_absence_rh', 'decider_heures',
             'mouvement_solde_rh', 'attribuer_conges', 'proposition_conges', 'cloturer_mois', 'donner_acces_service',
             'retirer_acces_service', 'suivre_service', 'modifier_parametre', 'enregistrer_push', 'marquer_lu',
             'journees', 'solde_boni', 'heures_a_valider', 'presence_jour') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

grant execute on function pointage.journee(uuid, date) to authenticated;

revoke all on public.mon_profil, public.personnes, public.pointages, public.demandes, public.soldes, public.anomalies,
              public.types_pointage, public.codes_absence, public.mes_notifications, public.parametres
  from public, anon;
grant select on public.mon_profil, public.personnes, public.pointages, public.demandes, public.soldes, public.anomalies,
                public.types_pointage, public.codes_absence, public.mes_notifications, public.parametres
  to authenticated;
