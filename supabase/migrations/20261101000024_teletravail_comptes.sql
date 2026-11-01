-- =====================================================================
--  CFB Pointage — télétravail : chacun gère ses jours habituels, le N+1 est prévenu ;
--  comptage des jours de TT pour l'indemnité ; comptes avec mot de passe créés par la RH
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Jours de télétravail habituels : modifiables par la personne elle-même
--    (et toujours par la RH, l'admin RH, l'admin et le N+1). Le réglage devient inutile.
-- ---------------------------------------------------------------------
delete from pointage.parametres where cle = 'teletravail_modifiable_employe';

create or replace function pointage.peut_definir_teletravail(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p = pointage.moi() or pointage.mon_role() in ('rh', 'admin_rh', 'admin') or pointage.est_valideur_de(p)
$$;

create or replace function pointage.libelle_jours(j smallint[]) returns text
language sql immutable set search_path = '' as $$
  select coalesce(nullif(string_agg((array['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'])[x], ', ' order by x), ''), 'aucun')
  from unnest(j) x
$$;

-- Historique des changements (qui, quand, avant / après) via le journal d'audit
drop trigger if exists trg_audit on pointage.teletravail_prevu;
create trigger trg_audit after insert or update or delete on pointage.teletravail_prevu
  for each row execute function pointage.auditer();

create or replace function public.definir_teletravail(p_personne uuid, p_jours int[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_moi   uuid := pointage.exiger_personne();
  v_avant smallint[] := pointage.jours_teletravail(p_personne);
  v_apres smallint[];
  v       uuid;
begin
  if p_personne is null or not coalesce(pointage.peut_definir_teletravail(p_personne), false) then
    raise exception 'Tu ne peux pas modifier les jours de télétravail de cette personne' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(coalesce(p_jours, '{}')) j where j not between 1 and 7) then
    raise exception 'Jour invalide (1 = lundi … 7 = dimanche)';
  end if;
  select coalesce(array_agg(distinct j::smallint order by j::smallint), '{}') into v_apres from unnest(coalesce(p_jours, '{}')) j;
  if v_apres = v_avant then return; end if;

  delete from pointage.teletravail_prevu where personne_id = p_personne;
  insert into pointage.teletravail_prevu (personne_id, jour) select p_personne, j from unnest(v_apres) j;

  if p_personne = v_moi then
    -- Changement par la personne : son responsable (N+1) est prévenu
    for v in select pointage.valideurs_n1(v_moi) loop
      perform pointage.notifier(v, 'teletravail_modifie', 'tt:' || v_moi || ':' || extract(epoch from clock_timestamp()),
        pointage.nom_complet(v_moi) || ' a changé ses jours de télétravail',
        'Avant : ' || pointage.libelle_jours(v_avant) || ' → maintenant : ' || pointage.libelle_jours(v_apres),
        '/?onglet=equipe');
    end loop;
  else
    -- Changement par la RH / le responsable : la personne est prévenue
    perform pointage.notifier(p_personne, 'teletravail_modifie', 'tt:' || p_personne || ':' || extract(epoch from clock_timestamp()),
      'Tes jours de télétravail ont été modifiés',
      'Par ' || pointage.nom_complet(v_moi) || ' : ' || pointage.libelle_jours(v_apres) || ' (avant : ' || pointage.libelle_jours(v_avant) || ')',
      '/?onglet=compte');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Jours de télétravail du mois (indemnité) : un jour compte dès qu'il a
--    au moins un pointage « Télétravail » non annulé.
-- ---------------------------------------------------------------------
create or replace function public.rapport_teletravail(p_mois date)
returns table (personne_id uuid, prenom text, nom text, service text, jours_tt int, dates date[], jours_habituels smallint[])
language plpgsql stable security definer set search_path = '' as $$
declare
  v_debut date := date_trunc('month', p_mois)::date;
  v_fin   date := least((date_trunc('month', p_mois) + interval '1 month - 1 day')::date, current_date);
begin
  perform pointage.exiger_role('rh', 'admin_rh', 'direction', 'admin');
  return query
  with tt as (
    select distinct pt.personne_id, pointage.jour_bxl(pt.horodatage) as jour
    from pointage.pointages pt
    where not pt.annule and pt.type_code = 'TT'
      and pt.horodatage >= (v_debut::timestamp at time zone 'Europe/Brussels')
      and pt.horodatage <  ((v_fin + 1)::timestamp at time zone 'Europe/Brussels')
  )
  select pe.id, pe.prenom, pe.nom, s.nom,
         (select count(*) from tt where tt.personne_id = pe.id)::int,
         coalesce((select array_agg(tt.jour order by tt.jour) from tt where tt.personne_id = pe.id), '{}'),
         pointage.jours_teletravail(pe.id)
  from pointage.personnes pe
  join pointage.services s on s.id = pe.service_id
  where pe.date_entree <= v_fin and (pe.date_sortie is null or pe.date_sortie >= v_debut)
    and (exists (select 1 from tt where tt.personne_id = pe.id) or exists (select 1 from pointage.teletravail_prevu t where t.personne_id = pe.id))
  order by s.nom, pe.nom, pe.prenom;
end $$;

-- ---------------------------------------------------------------------
-- 3. Comptes avec mot de passe (créés par la RH via la fonction « gerer-comptes »)
--    preparer_compte : appelée AVEC le jeton de la RH → vérifie ses droits.
--    attacher_compte : appelée par la fonction serveur uniquement (service_role).
-- ---------------------------------------------------------------------
create or replace function public.preparer_compte(p_personne uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r record;
begin
  perform pointage.exiger_role('rh', 'admin_rh', 'admin');
  select p.id, p.prenom, p.nom, p.email, p.role, p.date_sortie,
         coalesce(p.auth_user_id, (select u.id from auth.users u where lower(u.email) = p.email
                                   and not exists (select 1 from pointage.personnes x where x.auth_user_id = u.id))) as compte
    into r from pointage.personnes p where p.id = p_personne;
  if r.id is null then raise exception 'Personne introuvable'; end if;
  if r.email is null or r.email = '' then raise exception 'Encode d''abord l''e-mail professionnel de la personne'; end if;
  if r.date_sortie is not null and r.date_sortie < current_date then raise exception 'Cette personne a quitté le CFB'; end if;
  if r.role = 'admin' and pointage.mon_role() <> 'admin' then
    raise exception 'Seul un admin général peut gérer le mot de passe d''un admin général' using errcode = '42501';
  end if;
  if r.id = pointage.moi() then
    raise exception 'Pour ton propre compte, utilise « Mon compte → Changer mon mot de passe »';
  end if;
  return jsonb_build_object('personne_id', r.id, 'email', r.email, 'nom', r.prenom || ' ' || r.nom, 'compte', r.compte, 'acteur', pointage.moi());
end $$;

create or replace function public.attacher_compte(p_personne uuid, p_user uuid, p_acteur uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update pointage.personnes set auth_user_id = p_user
   where id = p_personne and (auth_user_id is null or auth_user_id = p_user)
     and not exists (select 1 from pointage.personnes x where x.auth_user_id = p_user and x.id <> p_personne);
  if not found then raise exception 'Ce compte est déjà lié à une autre personne'; end if;
  insert into pointage.journal_audit (table_nom, ligne_id, action, apres, acteur_id)
  values ('comptes', p_personne::text, 'UPDATE', jsonb_build_object('mot_de_passe', 'généré par la RH'), p_acteur);
end $$;

revoke all on function pointage.libelle_jours(smallint[]) from public, anon, authenticated;
revoke all on function public.rapport_teletravail(date), public.preparer_compte(uuid) from public, anon;
grant execute on function public.rapport_teletravail(date), public.preparer_compte(uuid) to authenticated;
revoke all on function public.attacher_compte(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.attacher_compte(uuid, uuid, uuid) to service_role;
select pointage.fixer_fuseau();
