-- =====================================================================
--  CFB Pointage — gestion RH courante
--  • Compteurs d'une personne : historique des mouvements (qui, quand, pourquoi).
--  • Départ (offboarding) : aperçu de l'impact, puis enregistrement (date de sortie, demandes après
--    le départ annulées). Les accès délégués deviennent sans effet avec le compte (plus de connexion). Rien n'est supprimé : l'historique reste (obligations
--    de conservation) ; l'accès s'arrête de lui-même le lendemain de la date de sortie.
--  • Journal des modifications lisible (admin, admin RH).
-- =====================================================================

-- Historique des compteurs d'une personne
create or replace function public.mouvements_personne(p_personne uuid)
returns table (id bigint, compteur_code text, compteur text, date_effet date, type text, minutes int, motif text, par text, cree_le timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform pointage.exiger_personne();
  if not (p_personne = pointage.moi() or pointage.mon_role() in ('rh', 'admin_rh', 'admin')) then
    raise exception 'Non autorisé' using errcode = '42501';
  end if;
  return query
  select m.id, m.compteur_code, c.libelle, m.date_effet, m.type::text, m.minutes, m.motif,
         coalesce(pointage.nom_complet(m.cree_par), 'Calcul automatique'), m.cree_le
  from pointage.mouvements_compteur m join pointage.compteurs c on c.code = m.compteur_code
  where m.personne_id = p_personne and m.compteur_code <> 'BONI'
    and (c.visible_employe or pointage.mon_role() in ('rh', 'admin_rh', 'admin'))
  order by m.date_effet desc, m.id desc
  limit 300;
end $$;

-- Départ : ce qui sera touché (aucune modification)
create or replace function public.preparer_depart(p_personne uuid, p_date date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform pointage.exiger_role('rh', 'admin_rh', 'admin');
  if not exists (select 1 from pointage.personnes where id = p_personne) then raise exception 'Personne introuvable'; end if;
  select jsonb_build_object(
    'soldes', coalesce((select jsonb_agg(jsonb_build_object('compteur', c.libelle, 'reste_min', s.reste) order by c.ordre)
                        from (select compteur_code, sum(minutes)::int as reste from pointage.mouvements_compteur
                              where personne_id = p_personne and compteur_code <> 'BONI'
                                and periode_debut <= p_date group by compteur_code having sum(minutes) <> 0) s
                        join pointage.compteurs c on c.code = s.compteur_code), '[]'::jsonb),
    'demandes_apres', (select count(*) from pointage.demandes where personne_id = p_personne
                         and statut in ('en_attente', 'accordee') and date_debut > p_date),
    'chef_de', coalesce((select jsonb_agg(s.nom) from pointage.responsables_service r join pointage.services s on s.id = r.service_id
                         where r.personne_id = p_personne), '[]'::jsonb),
    'acces_delegues', (select count(*) from pointage.acces_services where personne_id = p_personne),
    'demandes_a_valider', (select count(*) from pointage.demandes d where d.statut = 'en_attente'
                            and p_personne in (select pointage.valideurs_n1(d.personne_id)))
  ) into r;
  return r;
end $$;

-- Départ : enregistrement (réversible tant que la date n'est pas passée : annuler_depart)
create or replace function public.enregistrer_depart(p_personne uuid, p_date date, p_motif text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_moi uuid := pointage.exiger_role('rh', 'admin_rh', 'admin');
  v_annulees int;
begin
  if p_personne = v_moi then raise exception 'Tu ne peux pas enregistrer ton propre départ'; end if;
  if exists (select 1 from pointage.personnes where id = p_personne and role = 'admin') and pointage.mon_role() <> 'admin' then
    raise exception 'Seul un admin général peut enregistrer le départ d''un admin général' using errcode = '42501';
  end if;
  update pointage.personnes set date_sortie = p_date where id = p_personne and date_entree <= p_date;
  if not found then raise exception 'Date de départ avant la date d''entrée, ou personne introuvable'; end if;
  with a as (
    update pointage.demandes set statut = 'annulee', decide_par = v_moi, decide_le = now(),
           commentaire_decision = coalesce(nullif(trim(p_motif), ''), 'Départ du CFB le ' || to_char(p_date, 'DD/MM/YYYY'))
    where personne_id = p_personne and statut in ('en_attente', 'accordee') and date_debut > p_date
    returning 1)
  select count(*) into v_annulees from a;
  return jsonb_build_object('demandes_annulees', v_annulees);
end $$;

create or replace function public.annuler_depart(p_personne uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pointage.exiger_role('rh', 'admin_rh', 'admin');
  update pointage.personnes set date_sortie = null where id = p_personne and date_sortie is not null;
  if not found then raise exception 'Aucun départ enregistré pour cette personne'; end if;
end $$;

-- Journal des modifications (lecture humaine)
create or replace function public.journal_modifications(p_limite int default 200, p_table text default null, p_depuis date default null)
returns table (id bigint, quand timestamptz, qui text, objet text, action text, champs text[], avant jsonb, apres jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform pointage.exiger_role('admin', 'admin_rh');
  return query
  select j.id, j.quand, coalesce(pointage.nom_complet(j.acteur_id), 'Système'), j.table_nom, j.action,
         coalesce((select array_agg(k order by k) from jsonb_object_keys(coalesce(j.apres, j.avant)) k
                   where j.action <> 'UPDATE' or (j.avant -> k) is distinct from (j.apres -> k)), '{}'),
         j.avant, j.apres
  from pointage.journal_audit j
  where (p_table is null or j.table_nom = p_table) and (p_depuis is null or j.quand >= p_depuis)
  order by j.quand desc, j.id desc
  limit least(greatest(p_limite, 1), 1000);
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.mouvements_personne(uuid)', 'public.preparer_depart(uuid, date)', 'public.enregistrer_depart(uuid, date, text)',
                           'public.annuler_depart(uuid)', 'public.journal_modifications(int, text, date)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
select pointage.fixer_fuseau();
