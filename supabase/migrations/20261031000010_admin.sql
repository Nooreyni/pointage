-- =====================================================================
--  CFB Pointage — l'admin général a tous les droits
--  (valider les demandes de tous, annuler un pointage, décider des heures au-delà du max)
-- =====================================================================

create or replace function pointage.est_valideur_de(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p <> pointage.moi() and (
       pointage.moi() in (select pointage.valideurs_n1(p))
    or pointage.mon_role() in ('direction', 'admin')
    or (pointage.mon_role() in ('responsable_isp', 'admin_rh')
        and exists (select 1 from pointage.personnes where id = p and type = 'isp'))
    or exists (select 1 from pointage.acces_services a join pointage.personnes pe on pe.service_id = a.service_id
               where a.personne_id = pointage.moi() and pe.id = p and a.peut_valider))
$$;

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
        and (pointage.est_valideur_de(v_p.personne_id) or pointage.mon_role() in ('rh', 'admin_rh', 'admin')) then
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

create or replace function public.decider_heures(p_personne_id uuid, p_jour date, p_accorder boolean, p_commentaire text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_moi uuid := pointage.exiger_personne();
  v_dep int;
begin
  if not (pointage.est_valideur_de(p_personne_id) or pointage.mon_role() in ('rh', 'admin_rh', 'admin')) then
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

create or replace function public.heures_a_valider()
returns table (personne_id uuid, prenom text, nom text, jour date, minutes int)
language plpgsql stable security definer set search_path = '' as $$
declare v_ids uuid[];
begin
  perform pointage.exiger_personne();
  select array_agg(pe.id) into v_ids from pointage.personnes pe
  where pointage.est_valideur_de(pe.id) or pointage.mon_role() in ('rh', 'admin_rh', 'admin');
  return query
  select pe.id, pe.prenom, pe.nom, j.jour, j.depassement
  from pointage.journees_set(current_date - 62, current_date - 1, coalesce(v_ids, '{}')) j
  join pointage.personnes pe on pe.id = j.personne_id
  where j.depassement > 0
    and not exists (select 1 from pointage.decisions_hs h where h.personne_id = j.personne_id and h.jour = j.jour)
  order by j.jour desc;
end $$;
