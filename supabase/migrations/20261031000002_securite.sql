-- =====================================================================
--  CFB Pointage — contexte utilisateur, hiérarchie, intégrité, RLS
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Utilitaires
-- ---------------------------------------------------------------------
create or replace function pointage.jour_bxl(t timestamptz) returns date
language sql immutable set search_path = '' as $$
  select (t at time zone 'Europe/Brussels')::date
$$;

create or replace function pointage.param(p_cle text) returns int
language sql stable security definer set search_path = '' as $$
  select valeur from pointage.parametres where cle = p_cle
$$;

create or replace function pointage.mois_cloture(d date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from pointage.clotures where mois = date_trunc('month', d)::date)
$$;

-- ---------------------------------------------------------------------
-- 2. Contexte utilisateur (Supabase Auth → personne)
-- ---------------------------------------------------------------------
create or replace function pointage.moi() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from pointage.personnes
  where auth_user_id = auth.uid()
    and (date_sortie is null or date_sortie >= current_date)
$$;

create or replace function pointage.mon_role() returns pointage.role_app
language sql stable security definer set search_path = '' as $$
  select role from pointage.personnes where id = pointage.moi()
$$;

-- Liaison automatique au premier login SSO (e-mail Entra vérifié par le tenant CFB)
create or replace function pointage.lier_compte() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update pointage.personnes set auth_user_id = new.id
   where email = lower(new.email) and auth_user_id is null;
  return new;
end $$;

create trigger trg_lier_compte after insert on auth.users
  for each row execute function pointage.lier_compte();

-- ---------------------------------------------------------------------
-- 3. Hiérarchie
-- ---------------------------------------------------------------------
-- Absent toute la journée (congé jour(s) accordé)
create or replace function pointage.absent_le(p uuid, d date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from pointage.demandes
                 where personne_id = p and statut = 'accordee' and type = 'conge_jours'
                   and d between date_debut and date_fin)
$$;

-- N+1 d'une personne à une date :
--   chefs de son service (hors elle-même et hors chefs absents),
--   sinon chefs du service parent (service sans chef, chef qui demande pour lui, chef absent).
create or replace function pointage.valideurs_n1(p uuid, d date default current_date) returns setof uuid
language sql stable security definer set search_path = '' as $$
  with s as (select service_id from pointage.personnes where id = p),
  directs as (
    select rs.personne_id from pointage.responsables_service rs join s on s.service_id = rs.service_id
    where rs.personne_id <> p and not pointage.absent_le(rs.personne_id, d)
  ),
  parents as (
    select rs.personne_id
    from pointage.services sv
    join s on s.service_id = sv.id
    join pointage.responsables_service rs on rs.service_id = sv.parent_id
    where rs.personne_id <> p
  )
  select personne_id from directs
  union
  select personne_id from parents where not exists (select 1 from directs)
$$;

-- Puis-je accepter/refuser pour p ? Jamais pour moi-même.
create or replace function pointage.est_valideur_de(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p <> pointage.moi() and (
       pointage.moi() in (select pointage.valideurs_n1(p))
    or pointage.mon_role() = 'direction'
    or (pointage.mon_role() in ('responsable_isp', 'admin_rh')
        and exists (select 1 from pointage.personnes where id = p and type = 'isp'))
    or exists (select 1 from pointage.acces_services a join pointage.personnes pe on pe.service_id = a.service_id
               where a.personne_id = pointage.moi() and pe.id = p and a.peut_valider))
$$;

create or replace function pointage.peut_voir(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p = pointage.moi()
      or pointage.mon_role() in ('rh', 'admin_rh', 'direction', 'admin')
      or pointage.est_valideur_de(p)
      or exists (select 1 from pointage.acces_services a join pointage.personnes pe on pe.service_id = a.service_id
                 where a.personne_id = pointage.moi() and pe.id = p)
$$;

-- ---------------------------------------------------------------------
-- 4. Workflow des demandes
-- ---------------------------------------------------------------------
create or replace function pointage.verifier_demande() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.statut <> 'en_attente' then
      raise exception 'Une demande est créée « en attente »';
    end if;
  elsif new.statut is distinct from old.statut
        and not ((old.statut = 'en_attente' and new.statut in ('accordee', 'refusee', 'annulee'))
                 or (old.statut = 'accordee' and new.statut = 'annulee')) then
    raise exception 'Transition interdite : % → %', old.statut, new.statut;
  end if;
  if tg_op = 'UPDATE' and (new.personne_id, new.type, new.code_absence, new.date_debut, new.date_fin, new.minutes_decomptees)
                       is distinct from (old.personne_id, old.type, old.code_absence, old.date_debut, old.date_fin, old.minutes_decomptees) then
    raise exception 'Une demande ne peut pas être modifiée : annule-la et refais-en une';
  end if;
  new.maj_le := now();
  return new;
end $$;

create trigger trg_demandes_workflow before insert or update on pointage.demandes
  for each row execute function pointage.verifier_demande();

-- ---------------------------------------------------------------------
-- 5. Clôture : aucune écriture sur un mois clôturé (ancienne ET nouvelle valeur)
-- ---------------------------------------------------------------------
create or replace function pointage.bloquer_pointage_cloture() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (tg_op = 'UPDATE' and pointage.mois_cloture(pointage.jour_bxl(old.horodatage)))
     or pointage.mois_cloture(pointage.jour_bxl(new.horodatage)) then
    raise exception 'Période clôturée : modification impossible';
  end if;
  return new;
end $$;

create trigger trg_pointages_cloture before insert or update on pointage.pointages
  for each row execute function pointage.bloquer_pointage_cloture();

create or replace function pointage.bloquer_demande_cloture() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Une demande en attente sur un mois clôturé peut encore être refusée/annulée,
  -- mais pas créée, accordée, ni annulée si elle était accordée.
  if (tg_op = 'INSERT' or new.statut = 'accordee' or old.statut = 'accordee')
     and pointage.mois_cloture(new.date_debut) then
    raise exception 'Période % clôturée : demande impossible', to_char(new.date_debut, 'MM/YYYY');
  end if;
  return new;
end $$;

create trigger trg_demandes_cloture before insert or update on pointage.demandes
  for each row execute function pointage.bloquer_demande_cloture();

create or replace function pointage.bloquer_mouvement_cloture() returns trigger
language plpgsql set search_path = '' as $$
begin
  if pointage.mois_cloture(new.date_effet) then
    raise exception 'Période % clôturée : mouvement impossible', to_char(new.date_effet, 'MM/YYYY');
  end if;
  return new;
end $$;

create trigger trg_mouvements_cloture before insert on pointage.mouvements_compteur
  for each row execute function pointage.bloquer_mouvement_cloture();

create or replace function pointage.bloquer_hs_cloture() returns trigger
language plpgsql set search_path = '' as $$
begin
  if pointage.mois_cloture(new.jour) then
    raise exception 'Période % clôturée : décision impossible', to_char(new.jour, 'MM/YYYY');
  end if;
  return new;
end $$;

create trigger trg_hs_cloture before insert or update on pointage.decisions_hs
  for each row execute function pointage.bloquer_hs_cloture();

-- ---------------------------------------------------------------------
-- 6. Audit + immutabilité
-- ---------------------------------------------------------------------
create or replace function pointage.auditer() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ligne jsonb := to_jsonb(coalesce(new, old));
begin
  insert into pointage.journal_audit (table_nom, ligne_id, action, avant, apres, acteur_id)
  values (tg_table_name,
          coalesce(v_ligne->>'id', concat_ws(':', v_ligne->>'personne_id', v_ligne->>'service_id', v_ligne->>'jour')),
          tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          pointage.moi());
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['personnes', 'personne_regimes', 'responsables_service', 'acces_services',
                           'pointages', 'demandes', 'decisions_hs', 'mouvements_compteur', 'clotures', 'parametres'] loop
    execute format('create trigger trg_audit after insert or update or delete on pointage.%I
                    for each row execute function pointage.auditer()', t);
  end loop;
end $$;

create or replace function pointage.interdire_modif() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'Table % en lecture seule (append-only)', tg_table_name; end $$;

create trigger trg_immuable before update or delete on pointage.journal_audit       for each row execute function pointage.interdire_modif();
create trigger trg_immuable before update or delete on pointage.mouvements_compteur for each row execute function pointage.interdire_modif();
create trigger trg_no_delete before delete on pointage.pointages                   for each row execute function pointage.interdire_modif();
create trigger trg_no_delete before delete on pointage.demandes                    for each row execute function pointage.interdire_modif();

-- ---------------------------------------------------------------------
-- 7. Droits : lecture seule pour « authenticated », sous RLS. Aucune écriture directe.
-- ---------------------------------------------------------------------
revoke all on schema pointage from public;
revoke all on all tables in schema pointage from public, anon, authenticated;
revoke all on all functions in schema pointage from public;
grant usage on schema pointage to authenticated;

grant select on pointage.personnes, pointage.services, pointage.regimes, pointage.personne_regimes,
                pointage.pointages, pointage.demandes, pointage.decisions_hs, pointage.mouvements_compteur,
                pointage.compteurs, pointage.codes_absence, pointage.types_pointage, pointage.jours_feries,
                pointage.journal_audit, pointage.clotures, pointage.notifications, pointage.parametres,
                pointage.responsables_service, pointage.acces_services
  to authenticated;

grant execute on function pointage.jour_bxl(timestamptz), pointage.moi(), pointage.mon_role(),
                          pointage.peut_voir(uuid), pointage.est_valideur_de(uuid), pointage.param(text)
  to authenticated;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'pointage' loop
    execute format('alter table pointage.%I enable row level security', t);
  end loop;
end $$;

create policy lecture on pointage.personnes           for select to authenticated using (pointage.peut_voir(id));
create policy lecture on pointage.personne_regimes    for select to authenticated using (pointage.peut_voir(personne_id));
create policy lecture on pointage.pointages           for select to authenticated using (pointage.peut_voir(personne_id));
create policy lecture on pointage.demandes            for select to authenticated using (pointage.peut_voir(personne_id));
create policy lecture on pointage.decisions_hs        for select to authenticated using (pointage.peut_voir(personne_id));
create policy lecture on pointage.mouvements_compteur for select to authenticated using (pointage.peut_voir(personne_id));
create policy lecture on pointage.notifications       for select to authenticated using (personne_id = pointage.moi());
create policy lecture on pointage.journal_audit       for select to authenticated using (pointage.mon_role() in ('rh', 'admin_rh', 'admin'));
create policy lecture on pointage.clotures            for select to authenticated using (pointage.moi() is not null);
create policy lecture on pointage.acces_services      for select to authenticated
  using (personne_id = pointage.moi() or pointage.mon_role() in ('direction', 'admin', 'admin_rh'));

-- Référentiels : lisibles par toute personne reconnue
do $$
declare t text;
begin
  foreach t in array array['services', 'regimes', 'compteurs', 'codes_absence', 'types_pointage',
                           'jours_feries', 'parametres', 'responsables_service'] loop
    execute format('create policy lecture on pointage.%I for select to authenticated
                    using (pointage.moi() is not null)', t);
  end loop;
end $$;
