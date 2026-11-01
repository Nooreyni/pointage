-- =====================================================================
--  CFB Pointage — jours de télétravail habituels (fixés à l'avance par personne)
--  • Ces jours-là, le pointage est « Télétravail » automatiquement (sauf au réseau du bureau) ;
--    la personne peut toujours choisir un autre type au moment de pointer.
--  • L'équipe voit « Télétravail prévu » tant que la personne n'a pas pointé.
--  • Définis par la RH, l'admin RH, l'admin ou le N+1 ; par la personne elle-même si le réglage l'autorise.
-- =====================================================================
create table if not exists pointage.teletravail_prevu (
  personne_id uuid not null references pointage.personnes(id),
  jour        smallint not null check (jour between 1 and 7),      -- 1 = lundi … 7 = dimanche
  primary key (personne_id, jour)
);
alter table pointage.teletravail_prevu enable row level security;
create policy lecture on pointage.teletravail_prevu for select to authenticated using (pointage.peut_voir(personne_id));

insert into pointage.parametres (cle, valeur, unite, libelle, categorie, provisoire, source) values
  ('teletravail_modifiable_employe', 0, 'booleen', 'Chacun peut modifier lui-même ses jours de télétravail habituels', 'Temps de travail', true,
   'Proposition : par défaut RH, admin et N+1')
on conflict (cle) do nothing;

create or replace function pointage.jours_teletravail(p uuid) returns smallint[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(jour order by jour), '{}') from pointage.teletravail_prevu where personne_id = p
$$;

create or replace function pointage.peut_definir_teletravail(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select pointage.mon_role() in ('rh', 'admin_rh', 'admin') or pointage.est_valideur_de(p)
      or (p = pointage.moi() and coalesce(pointage.param('teletravail_modifiable_employe'), 0) = 1)
$$;

-- Lecture pour l'appli : jours + droit de modifier
create or replace function public.teletravail_de(p_personne uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform pointage.exiger_personne();
  if not pointage.peut_voir(p_personne) then raise exception 'Non autorisé' using errcode = '42501'; end if;
  return jsonb_build_object('jours', to_jsonb(pointage.jours_teletravail(p_personne)),
                            'modifiable', pointage.peut_definir_teletravail(p_personne));
end $$;

create or replace function public.definir_teletravail(p_personne uuid, p_jours int[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pointage.exiger_personne();
  if not pointage.peut_definir_teletravail(p_personne) then
    raise exception 'Seuls la RH, l''admin ou le responsable peuvent définir les jours de télétravail' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(coalesce(p_jours, '{}')) j where j not between 1 and 7) then
    raise exception 'Jour invalide (1 = lundi … 7 = dimanche)';
  end if;
  delete from pointage.teletravail_prevu where personne_id = p_personne;
  insert into pointage.teletravail_prevu (personne_id, jour)
  select p_personne, j from (select distinct unnest(coalesce(p_jours, '{}')) j) x;
end $$;

-- Profil : + jours de télétravail habituels
create or replace view public.mon_profil with (security_invoker = true) as
select p.id, p.prenom, p.nom, p.email, p.role, p.type, s.nom as service, r.libelle as regime, r.minutes_jour,
       exists (select 1 from pointage.responsables_service rs where rs.personne_id = p.id) as est_chef_service,
       pointage.jours_teletravail(p.id) as jours_teletravail
from pointage.personnes p
join pointage.services s on s.id = p.service_id
left join lateral (
  select pr.personne_id, pr.debut, pr.regime_id, rg.id, rg.libelle, rg.contrat, rg.minutes_jour, rg.minutes_semaine, rg.actif
  from pointage.personne_regimes pr join pointage.regimes rg on rg.id = pr.regime_id
  where pr.personne_id = p.id and pr.debut <= pointage.aujourdhui()
  order by pr.debut desc limit 1) r on true
where p.id = pointage.moi();

-- Présence du jour : « Télétravail prévu » tant que la personne n'a pas pointé
create or replace function public.presence_jour()
returns table (personne_id uuid, prenom text, nom text, service text, mon_service boolean, statut text, depuis timestamptz)
language sql stable security definer set search_path = '' as $$
  with dernier as (
    select distinct on (pt.personne_id) pt.personne_id, pt.sens, pt.horodatage, tp.libelle_presence
    from pointage.pointages pt join pointage.types_pointage tp on tp.code = pt.type_code
    where not pt.annule and pointage.jour_bxl(pt.horodatage) = current_date
    order by pt.personne_id, pt.horodatage desc
  ),
  absent as (
    select distinct on (d.personne_id) d.personne_id, ca.libelle
    from pointage.demandes d join pointage.codes_absence ca on ca.code = d.code_absence
    where d.statut = 'accordee' and d.type = 'conge_jours' and current_date between d.date_debut and d.date_fin
  )
  select p.id, p.prenom, p.nom, s.nom,
         p.service_id = (select service_id from pointage.personnes where id = pointage.exiger_personne()),
         case
           when a.personne_id is not null then
             case when pointage.peut_voir(p.id) then a.libelle else 'Absent' end
           when dp.sens = 'entree' then dp.libelle_presence
           when dp.sens = 'sortie' then 'Parti'
           when pointage.minutes_prevues(p.id, current_date) = 0 then 'Pas prévu aujourd''hui'
           when exists (select 1 from pointage.teletravail_prevu t where t.personne_id = p.id and t.jour = extract(isodow from current_date))
             then 'Télétravail prévu'
           else 'Pas encore pointé'
         end,
         dp.horodatage
  from pointage.personnes p
  join pointage.services s on s.id = p.service_id
  left join dernier dp on dp.personne_id = p.id
  left join absent  a  on a.personne_id = p.id
  where p.date_entree <= current_date and (p.date_sortie is null or p.date_sortie >= current_date)
  order by 5 desc, s.nom, p.nom
$$;

create or replace function public.pointer(
  p_type_code  text default null,
  p_remarque   text default null,
  p_client_id  uuid default null,
  p_horodatage timestamptz default null,   -- fourni uniquement par la synchro hors ligne
  p_sens       pointage.sens_pointage default null,
  p_source     pointage.source_pointage default 'web'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_moi  uuid := pointage.exiger_personne();
  v_h    timestamptz := coalesce(p_horodatage, now());
  v_ip   inet := pointage.ip_requete();
  v_dern pointage.pointages;
  v_sens pointage.sens_pointage;
  v_lieu pointage.lieu_pointage;
  v_row  pointage.pointages;
  v_differe boolean := p_horodatage is not null and p_horodatage < now() - interval '2 minutes';
  v_alerte int := coalesce(pointage.param('differe_alerte_n1_min'), 0);
  v_rebond int := coalesce(pointage.param('anti_rebond_s'), 0);
  v_recent timestamptz;
  v      uuid;
begin
  if p_source not in ('mobile', 'web') then
    raise exception 'Source % réservée', p_source;
  end if;

  if p_client_id is not null then
    select * into v_row from pointage.pointages where personne_id = v_moi and client_id = p_client_id;
    if found then return to_jsonb(v_row); end if;      -- déjà synchronisé
  end if;

  if v_h > now() + interval '2 minutes' then
    raise exception 'Heure de pointage dans le futur : vérifie l''heure de ton appareil';
  end if;
  if v_differe and p_client_id is null then
    raise exception 'Pour une heure passée, utilise « Corriger un pointage »';
  end if;
  if v_h < now() - make_interval(hours => coalesce(pointage.param('differe_max_h'), 72)) then
    raise exception 'Pointage de plus de % h : utilise « Corriger un pointage »', coalesce(pointage.param('differe_max_h'), 72);
  end if;

  -- Double appui : un second pointage dans les N secondes est refusé (le premier est déjà enregistré)
  if not v_differe and v_rebond > 0 then
    select max(horodatage) into v_recent from pointage.pointages
     where personne_id = v_moi and not annule and source in ('mobile', 'web') and cree_le > now() - make_interval(secs => v_rebond);
    if v_recent is not null then
      raise exception 'Tu viens déjà de pointer (à %). Si c''était une erreur, annule ce pointage.',
        to_char(v_recent at time zone 'Europe/Brussels', 'HH24:MI:SS');
    end if;
  end if;

  select * into v_dern from pointage.pointages
  where personne_id = v_moi and not annule
    and pointage.jour_bxl(horodatage) = pointage.jour_bxl(v_h) and horodatage <= v_h
  order by horodatage desc limit 1;

  v_sens := coalesce(p_sens, case when v_dern.sens = 'entree' then 'sortie' else 'entree' end::pointage.sens_pointage);
  -- Pointage différé (synchro) : l'IP actuelle n'est pas celle du moment réel
  if v_differe then
    v_ip := null;
  end if;
  v_lieu := pointage.lieu_de(v_ip);

  insert into pointage.pointages (personne_id, horodatage, sens, type_code, source, lieu, ip, remarque, client_id, cree_par)
  values (v_moi, v_h, v_sens,
          coalesce(p_type_code,
                   case when v_sens = 'sortie' and v_dern.sens = 'entree' then v_dern.type_code end,
                   -- Type automatique : au bureau (réseau CFB) → Bureau ; jour de télétravail habituel → Télétravail ;
                   -- ailleurs → Télétravail. La personne peut toujours choisir un autre type en pointant.
                   case when v_lieu = 'reseau_cfb' then 'BUREAU'
                        when exists (select 1 from pointage.teletravail_prevu t
                                     where t.personne_id = v_moi and t.jour = extract(isodow from pointage.jour_bxl(v_h))) then 'TT'
                        when v_lieu = 'externe' then 'TT'
                        else 'BUREAU' end),
          p_source, v_lieu, v_ip, p_remarque, p_client_id, v_moi)
  returning * into v_row;

  if v_differe and v_alerte > 0 and now() - v_h >= make_interval(mins => v_alerte) then
    for v in select pointage.valideurs_n1(v_moi) loop
      perform pointage.notifier(v, 'pointage_differe', 'differe:' || v_row.id,
        pointage.nom_complet(v_moi) || ' : pointage envoyé en différé',
        initcap(v_sens::text) || ' déclarée à ' || to_char(v_h at time zone 'Europe/Brussels', 'DD/MM HH24:MI')
          || ', reçue à ' || to_char(now() at time zone 'Europe/Brussels', 'DD/MM HH24:MI') || ' (hors ligne)',
        '/equipe/pointages/' || v_row.id);
    end loop;
  end if;

  return to_jsonb(v_row);
end $$;

revoke execute on function pointage.jours_teletravail(uuid), pointage.peut_definir_teletravail(uuid) from public, anon, authenticated;
grant execute on function pointage.jours_teletravail(uuid) to authenticated;     -- utilisée par la vue mon_profil
revoke all on function public.teletravail_de(uuid), public.definir_teletravail(uuid, int[]) from public, anon;
grant execute on function public.teletravail_de(uuid), public.definir_teletravail(uuid, int[]) to authenticated;
select pointage.fixer_fuseau();
