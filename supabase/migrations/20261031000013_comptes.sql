-- =====================================================================
--  CFB Pointage — liaison sûre des comptes (audit R2)
--  Avant : le compte était lié à la personne dès sa création, sans vérifier l'e-mail.
--          Quelqu'un pouvait créer un compte avec l'adresse d'un collègue et le bloquer.
--  Après : liaison uniquement si l'identité est vérifiée (e-mail confirmé, et par défaut
--          connexion via un fournisseur d'identité comme Microsoft Entra).
--          Réglable (Admin → Paramètres → Sécurité) pour d'autres structures / le dev.
-- =====================================================================

insert into pointage.parametres (cle, valeur, unite, libelle, categorie, provisoire, source) values
  ('liaison_sso_seulement', 1, 'booleen',
   'Lier un compte uniquement s''il se connecte via le fournisseur d''identité (Microsoft…), pas par e-mail + mot de passe',
   'Sécurité', false, 'Audit du 31/10/2026 (R2)')
on conflict (cle) do nothing;

-- Identité fiable : e-mail confirmé + (si réglé) au moins un fournisseur autre que « email »
create or replace function pointage.identite_fiable(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select u.email_confirmed_at is not null
       and (coalesce(pointage.param('liaison_sso_seulement'), 1) = 0
            or exists (select 1 from jsonb_array_elements_text(
                          coalesce(u.raw_app_meta_data -> 'providers',
                                   jsonb_build_array(coalesce(u.raw_app_meta_data ->> 'provider', 'email')))) f
                       where f <> 'email'))
    from auth.users u where u.id = p_user_id), false)
$$;

-- Lie une personne (non liée) au compte vérifié qui porte son e-mail. Renvoie true si lié.
create or replace function pointage.lier_personne(p_personne_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  select u.id into v_user
  from pointage.personnes p join auth.users u on lower(u.email) = p.email
  where p.id = p_personne_id and p.auth_user_id is null and pointage.identite_fiable(u.id)
    and not exists (select 1 from pointage.personnes x where x.auth_user_id = u.id);
  if v_user is null then return false; end if;
  update pointage.personnes set auth_user_id = v_user where id = p_personne_id;
  return true;
end $$;

-- Déclencheur : à la création du compte ET quand l'e-mail est confirmé / un fournisseur ajouté
create or replace function pointage.lier_compte() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if pointage.identite_fiable(new.id) then
    update pointage.personnes set auth_user_id = new.id
     where email = lower(new.email) and auth_user_id is null
       and not exists (select 1 from pointage.personnes x where x.auth_user_id = new.id);
  end if;
  return new;
end $$;

drop trigger if exists trg_lier_compte on auth.users;
create trigger trg_lier_compte after insert or update of email_confirmed_at, raw_app_meta_data, email on auth.users
  for each row execute function pointage.lier_compte();

-- Appelé par l'appli quand le compte n'est pas encore reconnu (personne ajoutée après le 1er login, e-mail corrigé…)
create or replace function public.lier_mon_compte() returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Non connecté' using errcode = '42501'; end if;
  if pointage.moi() is not null then return true; end if;
  select p.id into v_id from pointage.personnes p join auth.users u on lower(u.email) = p.email
  where u.id = auth.uid() and p.auth_user_id is null and (p.date_sortie is null or p.date_sortie >= current_date);
  if v_id is null then return false; end if;
  return pointage.lier_personne(v_id);
end $$;

-- Admin : délier un compte (mauvaise personne liée, changement d'adresse…). La personne sera reliée
-- à sa prochaine connexion avec une identité vérifiée.
create or replace function public.delier_compte(p_personne_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pointage.exiger_role('admin', 'admin_rh');
  if p_personne_id = pointage.moi() then raise exception 'Tu ne peux pas délier ton propre compte'; end if;
  if exists (select 1 from pointage.personnes where id = p_personne_id and role = 'admin') and pointage.mon_role() <> 'admin' then
    raise exception 'Seul un admin général peut délier un admin général' using errcode = '42501';
  end if;
  update pointage.personnes set auth_user_id = null where id = p_personne_id;
  if not found then raise exception 'Personne introuvable'; end if;
end $$;

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
    -- Compte déjà connecté une fois avec cette adresse (identité vérifiée) : liaison immédiate
    perform pointage.lier_personne(v_id);
  else
    perform pointage.verifier_dernier_admin(v_id, p_role, p_date_sortie);
    if v_id = pointage.moi() and lower(trim(p_email)) <> (select email from pointage.personnes where id = v_id) then
      raise exception 'Tu ne peux pas changer ta propre adresse (ton compte serait délié) : demande à un autre admin';
    end if;
    update pointage.personnes
       set prenom = trim(p_prenom), nom = trim(p_nom), email = lower(trim(p_email)), service_id = p_service_id, role = p_role,
           type = p_type, partenaire_isp = nullif(trim(p_partenaire_isp), ''), matricule = nullif(trim(p_matricule), ''),
           date_entree = p_date_entree, date_sortie = p_date_sortie,
           -- e-mail corrigé : l'ancien compte n'est plus celui de la personne
           auth_user_id = case when email = lower(trim(p_email)) then auth_user_id end
     where id = v_id;
    if not found then raise exception 'Personne introuvable'; end if;
    perform pointage.lier_personne(v_id);
  end if;
  return v_id;
end $$;

revoke all on function pointage.identite_fiable(uuid), pointage.lier_personne(uuid) from public, anon, authenticated;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('lier_mon_compte', 'delier_compte', 'enregistrer_personne') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
