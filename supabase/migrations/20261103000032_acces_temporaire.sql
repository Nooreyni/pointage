-- =====================================================================
--  CFB Pointage — accès à un autre service limité dans le temps
--  Ex. un chef en congé : l'admin / la direction donne à un collègue l'accès (lecture + validation)
--  à son service jusqu'à une date. Après cette date, l'accès n'a plus d'effet (gardé pour l'historique).
--  Prolonge la règle confirmée « accès inter-services accordé par admin / direction ».
-- =====================================================================
alter table pointage.acces_services add column if not exists jusqu_au date;

create or replace function pointage.peut_voir(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p = pointage.moi()
      or pointage.mon_role() in ('rh', 'admin_rh', 'direction', 'admin')
      or pointage.est_valideur_de(p)
      or exists (select 1 from pointage.acces_services a join pointage.personnes pe on pe.service_id = a.service_id
                 where a.personne_id = pointage.moi() and pe.id = p
                   and (a.jusqu_au is null or a.jusqu_au >= pointage.aujourdhui()))
$$;

create or replace function pointage.est_valideur_de(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p <> pointage.moi() and (
       pointage.moi() in (select pointage.valideurs_n1(p))
    or pointage.mon_role() in ('direction', 'admin')
    or (pointage.mon_role() in ('responsable_isp', 'admin_rh')
        and exists (select 1 from pointage.personnes where id = p and type = 'isp'))
    or exists (select 1 from pointage.acces_services a join pointage.personnes pe on pe.service_id = a.service_id
               where a.personne_id = pointage.moi() and pe.id = p and a.peut_valider
                 and (a.jusqu_au is null or a.jusqu_au >= pointage.aujourdhui())))
$$;

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
    and (a.jusqu_au is null or a.jusqu_au >= pointage.aujourdhui())
  union
  select ab.personne_id from pointage.abonnements_service ab join pointage.personnes x on x.service_id = ab.service_id
  where x.id = p and ab.personne_id <> p
$$;

-- Accorder un accès, avec une date de fin facultative (nouvelle fonction : l'ancienne reste pour compatibilité)
create or replace function public.donner_acces(p_personne_id uuid, p_service_id uuid, p_peut_valider boolean default false, p_jusqu_au date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_moi uuid := pointage.exiger_role('direction', 'admin', 'admin_rh');
begin
  if p_jusqu_au is not null and p_jusqu_au < pointage.aujourdhui() then
    raise exception 'La date de fin est déjà passée';
  end if;
  if p_personne_id = v_moi and pointage.mon_role() <> 'admin' then
    raise exception 'Tu ne peux pas t''accorder un accès à toi-même';
  end if;
  insert into pointage.acces_services (personne_id, service_id, peut_valider, accorde_par, jusqu_au)
  values (p_personne_id, p_service_id, p_peut_valider, v_moi, p_jusqu_au)
  on conflict (personne_id, service_id) do update set peut_valider = excluded.peut_valider, jusqu_au = excluded.jusqu_au,
                                                     accorde_par = excluded.accorde_par, accorde_le = now();
  perform pointage.notifier(p_personne_id, 'acces_service', 'acces:' || p_service_id || ':' || coalesce(p_jusqu_au::text, '-'),
    'Accès au service ' || (select nom from pointage.services where id = p_service_id)
      || case when p_peut_valider then ' (lecture + validation)' else ' (lecture)' end,
    case when p_jusqu_au is null then null else 'Jusqu''au ' || to_char(p_jusqu_au, 'DD/MM/YYYY') || ' inclus.' end, '/conges');
end $$;

create or replace view public.admin_acces with (security_invoker = true) as
select a.personne_id, p.prenom, p.nom, a.service_id, s.nom as service, a.peut_valider, a.accorde_le,
       a.jusqu_au, (a.jusqu_au is null or a.jusqu_au >= pointage.aujourdhui()) as actif
from pointage.acces_services a
join pointage.personnes p on p.id = a.personne_id
join pointage.services s on s.id = a.service_id;

revoke all on function public.donner_acces(uuid, uuid, boolean, date) from public, anon;
grant execute on function public.donner_acces(uuid, uuid, boolean, date) to authenticated;
select pointage.fixer_fuseau();
