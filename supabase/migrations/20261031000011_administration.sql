-- =====================================================================
--  CFB Pointage — administration (admin général et admin RH)
--  Personnes, régimes, services et chefs, accès inter-services, paramètres,
--  jours fériés, plages réseau du CFB. Tout est tracé dans le journal d'audit.
-- =====================================================================

-- Audit : identifiant lisible aussi pour les tables sans « id »
create or replace function pointage.auditer() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ligne jsonb := to_jsonb(coalesce(new, old));
begin
  insert into pointage.journal_audit (table_nom, ligne_id, action, avant, apres, acteur_id)
  values (tg_table_name,
          coalesce(v_ligne->>'id', v_ligne->>'cle', v_ligne->>'plage',
                   nullif(concat_ws(':', v_ligne->>'personne_id', v_ligne->>'service_id', v_ligne->>'jour'), ''), '?'),
          tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          pointage.moi());
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['services', 'regimes', 'jours_feries', 'reseaux_cfb', 'codes_absence'] loop
    execute format('create trigger trg_audit after insert or update or delete on pointage.%I
                    for each row execute function pointage.auditer()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Lecture
-- ---------------------------------------------------------------------
create or replace view public.admin_personnes with (security_invoker = true) as
select p.id, p.prenom, p.nom, p.email, p.matricule, p.role, p.type, p.partenaire_isp, p.service_id, s.nom as service,
       p.date_entree, p.date_sortie, p.auth_user_id is not null as compte_lie,
       r.regime_id, r.regime, r.regime_depuis
from pointage.personnes p
join pointage.services s on s.id = p.service_id
left join lateral (select pr.regime_id, rg.libelle as regime, pr.debut as regime_depuis
                   from pointage.personne_regimes pr join pointage.regimes rg on rg.id = pr.regime_id
                   where pr.personne_id = p.id and pr.debut <= current_date order by pr.debut desc limit 1) r on true
where pointage.mon_role() in ('admin', 'admin_rh');

create or replace view public.admin_services with (security_invoker = true) as
select s.id, s.nom, s.parent_id, s.couleur, s.seuil_absence_pct, s.actif,
       coalesce((select array_agg(rs.personne_id) from pointage.responsables_service rs where rs.service_id = s.id), '{}') as chefs,
       (select count(*) from pointage.personnes p where p.service_id = s.id and (p.date_sortie is null or p.date_sortie >= current_date)) as effectif
from pointage.services s;

create or replace view public.regimes with (security_invoker = true) as
select id, libelle, contrat, minutes_jour, minutes_semaine, actif,
       (select count(*) from pointage.personne_regimes pr where pr.regime_id = r.id) as utilisations
from pointage.regimes r;

create or replace view public.admin_acces with (security_invoker = true) as
select a.personne_id, p.prenom, p.nom, a.service_id, s.nom as service, a.peut_valider, a.accorde_le
from pointage.acces_services a
join pointage.personnes p on p.id = a.personne_id
join pointage.services s on s.id = a.service_id;

create or replace view public.jours_feries with (security_invoker = true) as
select jour, libelle, recuperable from pointage.jours_feries;

create or replace function public.reseaux_cfb() returns table (plage text, libelle text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform pointage.exiger_role('admin');
  return query select r.plage::text, r.libelle from pointage.reseaux_cfb r order by r.plage;
end $$;

-- ---------------------------------------------------------------------
-- Écriture
-- ---------------------------------------------------------------------
create or replace function pointage.verifier_dernier_admin(p uuid, p_nouveau_role pointage.role_app, p_sortie date) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from pointage.personnes where id = p and role = 'admin')
     and (p_nouveau_role <> 'admin' or p_sortie is not null)
     and (select count(*) from pointage.personnes where role = 'admin' and date_sortie is null) <= 1 then
    raise exception 'Impossible : c''est le dernier admin général. Nomme d''abord un autre admin.';
  end if;
end $$;

-- Crée ou met à jour une personne. Un nouvel arrivant reçoit son régime à sa date d'entrée.
create or replace function public.enregistrer_personne(
  p_id uuid, p_prenom text, p_nom text, p_email text, p_service_id uuid,
  p_role pointage.role_app default 'employe', p_type pointage.type_personne default 'interne',
  p_partenaire_isp text default null, p_matricule text default null,
  p_date_entree date default current_date, p_date_sortie date default null, p_regime_id smallint default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_moi uuid := pointage.exiger_role('admin', 'admin_rh');
  v_id  uuid := p_id;
begin
  if nullif(trim(p_prenom), '') is null or nullif(trim(p_nom), '') is null or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Prénom, nom et e-mail valide obligatoires';
  end if;
  if p_role = 'admin' and pointage.mon_role() <> 'admin' then
    raise exception 'Seul un admin général peut nommer un admin général' using errcode = '42501';
  end if;
  if v_id is not null and pointage.mon_role() <> 'admin'
     and exists (select 1 from pointage.personnes where id = v_id and role = 'admin') then
    raise exception 'Seul un admin général peut modifier un admin général' using errcode = '42501';
  end if;

  if v_id is null then
    if p_regime_id is null then raise exception 'Choisis un régime de travail'; end if;
    insert into pointage.personnes (prenom, nom, email, service_id, role, type, partenaire_isp, matricule, date_entree, date_sortie)
    values (trim(p_prenom), trim(p_nom), lower(trim(p_email)), p_service_id, p_role, p_type, nullif(trim(p_partenaire_isp), ''),
            nullif(trim(p_matricule), ''), p_date_entree, p_date_sortie)
    returning id into v_id;
    insert into pointage.personne_regimes (personne_id, debut, regime_id) values (v_id, p_date_entree, p_regime_id);
    -- Compte Microsoft déjà connecté une fois avec cette adresse : liaison immédiate
    update pointage.personnes set auth_user_id = u.id from auth.users u
     where pointage.personnes.id = v_id and lower(u.email) = lower(trim(p_email));
  else
    perform pointage.verifier_dernier_admin(v_id, p_role, p_date_sortie);
    update pointage.personnes
       set prenom = trim(p_prenom), nom = trim(p_nom), email = lower(trim(p_email)), service_id = p_service_id, role = p_role,
           type = p_type, partenaire_isp = nullif(trim(p_partenaire_isp), ''), matricule = nullif(trim(p_matricule), ''),
           date_entree = p_date_entree, date_sortie = p_date_sortie
     where id = v_id;
    if not found then raise exception 'Personne introuvable'; end if;
  end if;
  return v_id;
end $$;

-- Changement de régime à une date (ex. passage en 4/5 au 1er janvier)
create or replace function public.changer_regime(p_personne_id uuid, p_regime_id smallint, p_debut date) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pointage.exiger_role('admin', 'admin_rh');
  if pointage.mois_cloture(p_debut) then
    raise exception 'Le mois de % est clôturé : choisis une date plus récente', to_char(p_debut, 'MM/YYYY');
  end if;
  insert into pointage.personne_regimes (personne_id, debut, regime_id) values (p_personne_id, p_debut, p_regime_id)
  on conflict (personne_id, debut) do update set regime_id = excluded.regime_id;
end $$;

create or replace function public.enregistrer_regime(
  p_id smallint, p_libelle text, p_contrat pointage.contrat, p_minutes_jour int[], p_actif boolean default true
) returns smallint
language plpgsql security definer set search_path = '' as $$
declare v_id smallint := p_id;
begin
  perform pointage.exiger_role('admin', 'admin_rh');
  if v_id is null then
    insert into pointage.regimes (libelle, contrat, minutes_jour, actif) values (trim(p_libelle), p_contrat, p_minutes_jour, p_actif)
    returning id into v_id;
  else
    -- Changer les heures d'un régime déjà utilisé réécrirait le passé : on crée plutôt un nouveau régime
    if exists (select 1 from pointage.personne_regimes where regime_id = v_id)
       and (select minutes_jour from pointage.regimes where id = v_id) is distinct from p_minutes_jour then
      raise exception 'Ce régime est déjà utilisé : crée un nouveau régime puis change celui des personnes concernées';
    end if;
    update pointage.regimes set libelle = trim(p_libelle), contrat = p_contrat, minutes_jour = p_minutes_jour, actif = p_actif
     where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.enregistrer_service(
  p_id uuid, p_nom text, p_parent_id uuid, p_couleur text default null, p_seuil_absence_pct smallint default 50,
  p_actif boolean default true, p_chefs uuid[] default '{}'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_id;
begin
  perform pointage.exiger_role('admin', 'admin_rh');
  if v_id is not null and p_parent_id = v_id then raise exception 'Un service ne peut pas être son propre parent'; end if;
  if v_id is null then
    insert into pointage.services (nom, parent_id, couleur, seuil_absence_pct, actif)
    values (trim(p_nom), p_parent_id, p_couleur, p_seuil_absence_pct, p_actif) returning id into v_id;
  else
    update pointage.services set nom = trim(p_nom), parent_id = p_parent_id, couleur = p_couleur,
                                 seuil_absence_pct = p_seuil_absence_pct, actif = p_actif where id = v_id;
  end if;
  delete from pointage.responsables_service where service_id = v_id and personne_id <> all (coalesce(p_chefs, '{}'));
  insert into pointage.responsables_service (service_id, personne_id)
  select v_id, c from unnest(coalesce(p_chefs, '{}')) c on conflict do nothing;
  return v_id;
end $$;

create or replace function public.enregistrer_ferie(p_jour date, p_libelle text, p_supprimer boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pointage.exiger_role('admin', 'admin_rh');
  if pointage.mois_cloture(p_jour) then raise exception 'Mois clôturé : jour férié non modifiable'; end if;
  if p_supprimer then
    delete from pointage.jours_feries where jour = p_jour;
  else
    insert into pointage.jours_feries (jour, libelle) values (p_jour, trim(p_libelle))
    on conflict (jour) do update set libelle = excluded.libelle;
  end if;
end $$;

create or replace function public.enregistrer_reseau(p_plage text, p_libelle text, p_supprimer boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pointage.exiger_role('admin');
  if p_supprimer then
    delete from pointage.reseaux_cfb where plage = p_plage::cidr;
  else
    insert into pointage.reseaux_cfb (plage, libelle) values (p_plage::cidr, trim(p_libelle))
    on conflict (plage) do update set libelle = excluded.libelle;
  end if;
exception when invalid_text_representation then
  raise exception 'Plage IP invalide (ex. 203.0.113.0/24)';
end $$;

-- L'admin RH peut aussi gérer les accès inter-services (en plus de la direction et de l'admin)
create or replace function public.donner_acces_service(p_personne_id uuid, p_service_id uuid, p_peut_valider boolean default false)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_moi uuid := pointage.exiger_role('direction', 'admin', 'admin_rh');
begin
  insert into pointage.acces_services (personne_id, service_id, peut_valider, accorde_par)
  values (p_personne_id, p_service_id, p_peut_valider, v_moi)
  on conflict (personne_id, service_id) do update set peut_valider = excluded.peut_valider,
                                                     accorde_par = excluded.accorde_par, accorde_le = now();
end $$;

create or replace function public.retirer_acces_service(p_personne_id uuid, p_service_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pointage.exiger_role('direction', 'admin', 'admin_rh');
  delete from pointage.acces_services where personne_id = p_personne_id and service_id = p_service_id;
end $$;

-- ---------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------
revoke all on public.admin_personnes, public.admin_services, public.regimes, public.admin_acces, public.jours_feries from public, anon;
grant select on public.admin_personnes, public.admin_services, public.regimes, public.admin_acces, public.jours_feries to authenticated;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('reseaux_cfb', 'enregistrer_personne', 'changer_regime', 'enregistrer_regime',
                                                        'enregistrer_service', 'enregistrer_ferie', 'enregistrer_reseau',
                                                        'donner_acces_service', 'retirer_acces_service') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
