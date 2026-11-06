-- =====================================================================
--  CFB Pointage — un chef de service sans compte compte comme « absent » (06/11/2026)
--  Le personnel est importé d'avance et les comptes sont créés au fil de l'eau. Tant qu'un chef de service n'a pas
--  de compte, il ne peut pas valider : les demandes de son service remontent à la direction, comme quand il est absent
--  (règle confirmée). Si personne à la direction n'a encore de compte, toute personne au rôle « direction » qui en a un
--  les reçoit (la direction peut décider pour tout le monde).
-- =====================================================================
create or replace function pointage.valideurs_n1(p uuid, d date default current_date) returns setof uuid
language sql stable security definer set search_path = '' as $$
  with s as (select service_id from pointage.personnes where id = p),
  directs as (
    select rs.personne_id from pointage.responsables_service rs join s on s.service_id = rs.service_id
    join pointage.personnes c on c.id = rs.personne_id
    where rs.personne_id <> p and c.auth_user_id is not null and not pointage.absent_le(rs.personne_id, d)
  ),
  parents as (
    select rs.personne_id
    from pointage.services sv
    join s on s.service_id = sv.id
    join pointage.responsables_service rs on rs.service_id = sv.parent_id
    join pointage.personnes c on c.id = rs.personne_id
    where rs.personne_id <> p and c.auth_user_id is not null
  ),
  direction as (
    select c.id as personne_id from pointage.personnes c
    where c.role = 'direction' and c.id <> p and c.auth_user_id is not null
      and (c.date_sortie is null or c.date_sortie >= d)
  )
  select personne_id from directs
  union
  select personne_id from parents where not exists (select 1 from directs)
  union
  select personne_id from direction where not exists (select 1 from directs) and not exists (select 1 from parents)
$$;

select pointage.fixer_fuseau();
