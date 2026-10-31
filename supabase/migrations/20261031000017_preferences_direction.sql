-- =====================================================================
--  CFB Pointage — préférences de la direction : services dont elle reçoit aussi les demandes
--  (la fonction suivre_service existait ; il manquait la lecture pour l'écran)
-- =====================================================================
create or replace function public.services_suivis()
returns table (service_id uuid, nom text, suivi boolean, effectif int, chef_absent_aujourdhui boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_moi uuid := pointage.exiger_role('direction', 'admin');
begin
  return query
  select s.id, s.nom,
         exists (select 1 from pointage.abonnements_service a where a.personne_id = v_moi and a.service_id = s.id),
         (select count(*)::int from pointage.personnes p
           where p.service_id = s.id and (p.date_sortie is null or p.date_sortie >= pointage.aujourdhui())),
         exists (select 1 from pointage.responsables_service rs where rs.service_id = s.id and pointage.absent_le(rs.personne_id, pointage.aujourdhui()))
  from pointage.services s
  where s.actif
  order by s.nom;
end $$;
revoke all on function public.services_suivis() from public, anon;
grant execute on function public.services_suivis() to authenticated;

select pointage.fixer_fuseau();
