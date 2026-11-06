-- =====================================================================
--  CFB Pointage — suivi du lancement (06/11/2026)
--  Pendant le pilote puis le lancement : qui a un compte, s'est connecté, pointe, a activé les notifications,
--  a fini la visite guidée. Sert à savoir qui relancer, sans demander aux gens. RH, admin RH, direction, admin.
--  Les personnes encore sans compte sont comptées par service (elles n'apparaissent nulle part ailleurs).
-- =====================================================================
create or replace function public.suivi_adoption()
returns table (personne_id uuid, prenom text, nom text, service text, role text, testeur boolean,
               compte_cree_le timestamptz, derniere_connexion timestamptz, accueil_fait_le timestamptz,
               appareils int, dernier_pointage timestamptz, pointages_7j int, avis int)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform pointage.exiger_role('rh', 'admin_rh', 'admin');
  return query
  select p.id, p.prenom, p.nom, s.nom, p.role::text, p.testeur,
         u.created_at, u.last_sign_in_at, p.accueil_fait_le,
         (select count(*)::int from pointage.push_abonnements a where a.personne_id = p.id),
         (select max(pt.horodatage) from pointage.pointages pt where pt.personne_id = p.id and not pt.annule),
         (select count(*)::int from pointage.pointages pt where pt.personne_id = p.id and not pt.annule
            and pt.horodatage > now() - interval '7 days'),
         (select count(*)::int from pointage.avis av where av.personne_id = p.id)
  from pointage.personnes p
  join pointage.services s on s.id = p.service_id
  left join auth.users u on u.id = p.auth_user_id
  where p.auth_user_id is not null and (p.date_sortie is null or p.date_sortie >= pointage.aujourdhui())
  order by s.nom, p.nom, p.prenom;
end $$;

-- Personnes importées sans compte, par service (pour savoir qui il reste à inviter)
create or replace function public.sans_compte_par_service()
returns table (service_id uuid, service text, sans_compte int, avec_compte int)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform pointage.exiger_role('rh', 'admin_rh', 'admin');
  return query
  select s.id, s.nom,
         count(*) filter (where p.auth_user_id is null)::int,
         count(*) filter (where p.auth_user_id is not null)::int
  from pointage.services s
  join pointage.personnes p on p.service_id = s.id and (p.date_sortie is null or p.date_sortie >= pointage.aujourdhui())
  group by s.id, s.nom order by s.nom;
end $$;

revoke all on function public.suivi_adoption(), public.sans_compte_par_service() from public, anon;
grant execute on function public.suivi_adoption(), public.sans_compte_par_service() to authenticated;

select pointage.fixer_fuseau();
