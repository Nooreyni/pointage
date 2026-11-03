-- =====================================================================
--  CFB Pointage — la direction gère comme l'admin RH (décision du 02/11/2026)
--  Suivi RH, Personnes, Rapports, Réglages. Seul l'admin général (IT) lui reste réservé.
--  • exiger_role : la direction passe partout où l'admin RH passe.
--  • Contrôles écrits en clair (« rh, admin_rh, admin ») : direction ajoutée.
--  • Inchangé (à décider par le CFB, RGPD) : la visibilité des adresses IP reste RH / admin.
--  • Double authentification (option) : s'applique aussi à la direction.
-- =====================================================================

create or replace function pointage.exiger_role(variadic roles pointage.role_app[]) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := pointage.exiger_personne(); r pointage.role_app := pointage.mon_role();
begin
  if r <> all (roles) and not (r = 'direction' and 'admin_rh' = any (roles)) then
    raise exception 'Action réservée à : %', array_to_string(roles, ', ') using errcode = '42501';
  end if;
  if coalesce(pointage.param('mfa_admin_rh'), 0) = 1 and r in ('admin', 'admin_rh', 'rh', 'direction')
     and coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'Double authentification requise : confirme ta connexion avec ton code' using errcode = '42501';
  end if;
  return v;
end $$;

create or replace function pointage.peut_gerer_role(p_role pointage.role_app) returns boolean
language sql stable security definer set search_path = '' as $$
  select case pointage.mon_role()
           when 'admin' then true
           when 'admin_rh' then p_role <> 'admin'
           when 'direction' then p_role <> 'admin'
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
where pointage.mon_role() = any (array['admin', 'admin_rh', 'rh', 'direction']::pointage.role_app[]);

alter policy lecture on pointage.journal_audit using (pointage.mon_role() in ('rh', 'admin_rh', 'admin', 'direction'));

update pointage.parametres set libelle = 'Double authentification pour admin, direction et RH' where cle = 'mfa_admin_rh';

-- Fonctions avec un contrôle de rôle écrit en clair : direction ajoutée (définitions reprises à l'identique)
CREATE OR REPLACE FUNCTION public.annuler_demande(p_id uuid, p_motif text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'Europe/Brussels'
AS $function$
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
          or pointage.mon_role() in ('rh', 'admin_rh', 'admin', 'direction')) then
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
end $function$;

CREATE OR REPLACE FUNCTION public.annuler_pointage(p_id uuid, p_motif text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'Europe/Brussels'
AS $function$
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
        and (pointage.est_valideur_de(v_p.personne_id) or pointage.mon_role() in ('rh', 'admin_rh', 'admin', 'direction')) then
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
end $function$;

CREATE OR REPLACE FUNCTION public.decider_heures(p_personne_id uuid, p_jour date, p_accorder boolean, p_commentaire text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'Europe/Brussels'
AS $function$
declare
  v_moi uuid := pointage.exiger_personne();
  v_dep int;
begin
  if not (pointage.est_valideur_de(p_personne_id) or pointage.mon_role() in ('rh', 'admin_rh', 'admin', 'direction')) then
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
end $function$;

CREATE OR REPLACE FUNCTION public.heures_a_valider()
 RETURNS TABLE(personne_id uuid, prenom text, nom text, jour date, minutes integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'Europe/Brussels'
AS $function$
declare v_ids uuid[];
begin
  perform pointage.exiger_personne();
  select array_agg(pe.id) into v_ids from pointage.personnes pe
  where pointage.est_valideur_de(pe.id) or pointage.mon_role() in ('rh', 'admin_rh', 'admin', 'direction');
  return query
  select pe.id, pe.prenom, pe.nom, j.jour, j.depassement
  from pointage.journees_set(current_date - 62, current_date - 1, coalesce(v_ids, '{}')) j
  join pointage.personnes pe on pe.id = j.personne_id
  where j.depassement > 0
    and not exists (select 1 from pointage.decisions_hs h where h.personne_id = j.personne_id and h.jour = j.jour)
  order by j.jour desc;
end $function$;

CREATE OR REPLACE FUNCTION public.mouvements_personne(p_personne uuid)
 RETURNS TABLE(id bigint, compteur_code text, compteur text, date_effet date, type text, minutes integer, motif text, par text, cree_le timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'Europe/Brussels'
AS $function$
begin
  perform pointage.exiger_personne();
  if not (p_personne = pointage.moi() or pointage.mon_role() in ('rh', 'admin_rh', 'admin', 'direction')) then
    raise exception 'Non autorisé' using errcode = '42501';
  end if;
  return query
  select m.id, m.compteur_code, c.libelle, m.date_effet, m.type::text, m.minutes, m.motif,
         coalesce(pointage.nom_complet(m.cree_par), 'Calcul automatique'), m.cree_le
  from pointage.mouvements_compteur m join pointage.compteurs c on c.code = m.compteur_code
  where m.personne_id = p_personne and m.compteur_code <> 'BONI'
    and (c.visible_employe or pointage.mon_role() in ('rh', 'admin_rh', 'admin', 'direction'))
  order by m.date_effet desc, m.id desc
  limit 300;
end $function$;

CREATE OR REPLACE FUNCTION pointage.peut_definir_teletravail(p uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'Europe/Brussels'
AS $function$
  select p = pointage.moi() or pointage.mon_role() in ('rh', 'admin_rh', 'admin', 'direction') or pointage.est_valideur_de(p)
$function$;

CREATE OR REPLACE FUNCTION pointage.peut_deposer_justificatif(p_personne uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'Europe/Brussels'
AS $function$
  select p_personne is not null and pointage.moi() is not null
     and (p_personne = pointage.moi() or pointage.mon_role() in ('rh', 'admin_rh', 'admin', 'direction'))
$function$;

CREATE OR REPLACE FUNCTION pointage.peut_lire_justificatif(p_personne uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'Europe/Brussels'
AS $function$
  select p_personne is not null and pointage.moi() is not null and (
    p_personne = pointage.moi()
    or pointage.mon_role() in ('rh', 'admin_rh', 'admin', 'direction')
    or (coalesce(pointage.param('justificatif_visible_n1'), 0) = 1 and pointage.est_valideur_de(p_personne)))
$function$;

select pointage.fixer_fuseau();
