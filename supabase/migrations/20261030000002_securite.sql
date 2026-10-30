-- =====================================================================
--  CFB Pointage — règles d'intégrité, contexte utilisateur, RLS
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Utilitaires
-- ---------------------------------------------------------------------
create or replace function pointage.jour_bxl(t timestamptz) returns date
language sql immutable set search_path = '' as $$
  select (t at time zone 'Europe/Brussels')::date
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

-- Valideurs N+1 d'une personne : responsables de son service (hors elle-même),
-- sinon responsables du service parent (cas du responsable qui demande pour lui).
create or replace function pointage.valideurs_n1(p uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  with s as (select service_id from pointage.personnes where id = p),
  directs as (
    select rs.personne_id from pointage.responsables_service rs join s on s.service_id = rs.service_id
    where rs.personne_id <> p
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

-- Puis-je valider pour p ? (valideur direct ou délégué d'un valideur, jamais pour moi-même)
create or replace function pointage.est_valideur_de(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p <> pointage.moi() and exists (
    select 1 from pointage.valideurs_n1(p) v(id)
    where v.id = pointage.moi()
       or v.id in (select delegant_id from pointage.delegations
                   where delegue_id = pointage.moi() and current_date <@ periode))
$$;

create or replace function pointage.peut_voir(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p = pointage.moi()
      or pointage.mon_role() in ('rh', 'admin')
      or pointage.est_valideur_de(p)
      or (pointage.mon_role() = 'referent_isp'
          and exists (select 1 from pointage.personnes where id = p and type = 'isp'))
$$;

-- Liaison automatique au premier login SSO : par e-mail Entra (vérifié par le tenant CFB).
-- Une adresse inconnue crée un compte Auth sans aucun accès aux données.
create or replace function pointage.lier_compte() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update pointage.personnes
     set auth_user_id = new.id
   where email = lower(new.email) and auth_user_id is null;
  return new;
end $$;

create trigger trg_lier_compte after insert on auth.users
  for each row execute function pointage.lier_compte();

-- ---------------------------------------------------------------------
-- 3. Workflow des demandes
-- ---------------------------------------------------------------------
insert into pointage.transitions_demande values
  ('brouillon',    'a_valider_n1'),
  ('brouillon',    'a_traiter_rh'),
  ('brouillon',    'annulee'),
  ('a_valider_n1', 'a_traiter_rh'),
  ('a_valider_n1', 'refusee'),
  ('a_valider_n1', 'annulee'),
  ('a_traiter_rh', 'accordee'),
  ('a_traiter_rh', 'refusee'),
  ('a_traiter_rh', 'annulee'),
  ('accordee',     'annulee');

create or replace function pointage.verifier_demande() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.statut not in ('brouillon', 'a_valider_n1', 'a_traiter_rh') then
      raise exception 'Une demande ne peut pas être créée au statut %', new.statut;
    end if;
  elsif new.statut is distinct from old.statut then
    if not exists (select 1 from pointage.transitions_demande where de = old.statut and vers = new.statut) then
      raise exception 'Transition interdite : % → %', old.statut, new.statut;
    end if;
  end if;
  if tg_op = 'UPDATE' and (new.personne_id, new.type, new.date_debut, new.date_fin, new.minutes_decomptees)
                       is distinct from (old.personne_id, old.type, old.date_debut, old.date_fin, old.minutes_decomptees)
     and old.statut <> 'brouillon' then
    raise exception 'Une demande soumise ne peut plus être modifiée (annule-la et refais-en une)';
  end if;
  new.maj_le := now();
  return new;
end $$;

create trigger trg_demandes_workflow before insert or update on pointage.demandes
  for each row execute function pointage.verifier_demande();

-- ---------------------------------------------------------------------
-- 4. Clôture : aucune écriture sur un mois clôturé (ancienne ET nouvelle valeur)
-- ---------------------------------------------------------------------
create or replace function pointage.bloquer_pointage_cloture() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and pointage.mois_cloture(pointage.jour_bxl(old.horodatage)) then
    raise exception 'Période % clôturée : modification impossible', to_char(pointage.jour_bxl(old.horodatage), 'MM/YYYY');
  end if;
  if pointage.mois_cloture(pointage.jour_bxl(new.horodatage)) then
    raise exception 'Période % clôturée : modification impossible', to_char(pointage.jour_bxl(new.horodatage), 'MM/YYYY');
  end if;
  return new;
end $$;

create trigger trg_pointages_cloture before insert or update on pointage.pointages
  for each row execute function pointage.bloquer_pointage_cloture();

create or replace function pointage.bloquer_demande_cloture() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- On peut encore annuler/refuser une demande en attente qui chevauche un mois clôturé,
  -- mais pas en créer ni en accorder une, ni annuler une demande déjà accordée.
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

-- ---------------------------------------------------------------------
-- 5. Audit + immutabilité
-- ---------------------------------------------------------------------
create or replace function pointage.auditer() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into pointage.journal_audit (table_nom, ligne_id, action, avant, apres, acteur_id)
  values (tg_table_name,
          coalesce(new.id, old.id)::text,
          tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          pointage.moi());
  return coalesce(new, old);
end $$;

create trigger trg_audit_personnes  after insert or update or delete on pointage.personnes           for each row execute function pointage.auditer();
create trigger trg_audit_pointages  after insert or update or delete on pointage.pointages           for each row execute function pointage.auditer();
create trigger trg_audit_demandes   after insert or update or delete on pointage.demandes            for each row execute function pointage.auditer();
create trigger trg_audit_mouvements after insert or update or delete on pointage.mouvements_compteur for each row execute function pointage.auditer();
create trigger trg_audit_delegations after insert or update or delete on pointage.delegations        for each row execute function pointage.auditer();

create or replace function pointage.interdire_modif() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'Table % en lecture seule (append-only)', tg_table_name; end $$;

create trigger trg_audit_immuable     before update or delete on pointage.journal_audit       for each row execute function pointage.interdire_modif();
create trigger trg_mouvements_immuab  before update or delete on pointage.mouvements_compteur for each row execute function pointage.interdire_modif();
create trigger trg_pointages_no_delete before delete on pointage.pointages                    for each row execute function pointage.interdire_modif();
create trigger trg_demandes_no_delete  before delete on pointage.demandes                     for each row execute function pointage.interdire_modif();

-- ---------------------------------------------------------------------
-- 6. Droits : lecture seule pour « authenticated », sous RLS. Aucune écriture directe.
--    Le schéma « pointage » n'est pas exposé par l'API REST ; ces droits servent
--    aux vues security_invoker du schéma public.
-- ---------------------------------------------------------------------
revoke all on schema pointage from public;
revoke all on all tables in schema pointage from public, anon, authenticated;
revoke all on all functions in schema pointage from public;
grant usage on schema pointage to authenticated;

grant select on pointage.personnes, pointage.services, pointage.regimes, pointage.pointages,
                pointage.demandes, pointage.mouvements_compteur, pointage.compteurs,
                pointage.codes_absence, pointage.types_pointage, pointage.jours_feries,
                pointage.journal_audit, pointage.clotures
  to authenticated;

grant execute on function pointage.jour_bxl(timestamptz), pointage.moi(), pointage.mon_role(),
                          pointage.peut_voir(uuid), pointage.est_valideur_de(uuid),
                          pointage.mois_cloture(date)
  to authenticated;

-- RLS partout (défense en profondeur, même sur les tables non accordées)
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'pointage' loop
    execute format('alter table pointage.%I enable row level security', t);
  end loop;
end $$;

create policy lecture on pointage.personnes           for select to authenticated using (pointage.peut_voir(id));
create policy lecture on pointage.pointages           for select to authenticated using (pointage.peut_voir(personne_id));
create policy lecture on pointage.demandes            for select to authenticated using (pointage.peut_voir(personne_id));
create policy lecture on pointage.mouvements_compteur for select to authenticated using (pointage.peut_voir(personne_id));
create policy lecture on pointage.journal_audit       for select to authenticated using (pointage.mon_role() in ('rh', 'admin'));
create policy lecture on pointage.clotures            for select to authenticated using (pointage.mon_role() in ('rh', 'admin', 'direction'));

-- Référentiels : lisibles par toute personne reconnue
create policy lecture on pointage.services       for select to authenticated using (pointage.moi() is not null);
create policy lecture on pointage.regimes        for select to authenticated using (pointage.moi() is not null);
create policy lecture on pointage.compteurs      for select to authenticated using (pointage.moi() is not null);
create policy lecture on pointage.codes_absence  for select to authenticated using (pointage.moi() is not null);
create policy lecture on pointage.types_pointage for select to authenticated using (pointage.moi() is not null);
create policy lecture on pointage.jours_feries   for select to authenticated using (pointage.moi() is not null);
