-- =====================================================================
--  CFB Pointage — audit approfondi : règles de calcul complétées (réglables)
--  1. Travail un jour non prévu (week-end, férié, jour off d'un temps partiel) : par défaut les
--     heures vont en « heures à valider » (N+1 / RH), pas en boni automatique — application de la
--     règle confirmée « pas d'heures sup, exceptions validées manuellement ». Réglable.
--  2. Double appui : un second pointage dans les 60 s est refusé avec un message clair. Réglable.
-- =====================================================================
insert into pointage.parametres (cle, valeur, unite, libelle, categorie, provisoire, source) values
  ('jour_non_prevu_a_valider', 1, 'booleen', 'Heures prestées un jour non prévu (week-end, férié…) : à valider par le N+1 / la RH plutôt qu''en boni',
   'Temps de travail', true, 'Règle CFB : pas d''heures sup, exceptions validées manuellement'),
  ('anti_rebond_s', 60, 's', 'Refuser un second pointage moins de … secondes après le précédent (double appui, 0 = jamais)',
   'Temps de travail', true, 'Proposition (protection contre le double appui)')
on conflict (cle) do nothing;

create or replace function pointage.journees_set(p_debut date, p_fin date, p_ids uuid[])
returns table (
  personne_id uuid, jour date, prevues int, absence int, a_prester int, nb_pointages int,
  brut int, pause_deduite int, preste int, boni int, depassement int, complete boolean
)
language sql stable security definer set search_path = '' as $$
  with par as (
    select pointage.param('pause_midi_min') as pm, pointage.param('pause_seuil_min') as ps, pointage.param('max_jour_min') as mj,
           coalesce(pointage.param('jour_non_prevu_a_valider'), 1) as jnp
  ),
  prev as (
    select pe.id, g.d::date as d,
           case when f.jour is not null then 0
                when pe.date_entree > g.d or (pe.date_sortie is not null and pe.date_sortie < g.d) then 0
                else coalesce(r.minutes_jour[extract(isodow from g.d)::int], 0) end as prevues
    from pointage.personnes pe
    cross join generate_series(p_debut, p_fin, interval '1 day') g(d)
    left join pointage.jours_feries f on f.jour = g.d::date
    left join lateral (select rg.minutes_jour from pointage.personne_regimes pr join pointage.regimes rg on rg.id = pr.regime_id
                       where pr.personne_id = pe.id and pr.debut <= g.d::date order by pr.debut desc limit 1) r on true
    where pe.id = any (p_ids)
  ),
  abs as (
    select p.id, p.d,
           least(p.prevues, coalesce(sum(case dm.type
             when 'conge_jours'     then p.prevues
             when 'conge_demi_jour' then p.prevues / 2
             when 'conge_heures'    then dm.minutes end), 0))::int as absence
    from prev p
    left join pointage.demandes dm on dm.personne_id = p.id and dm.statut = 'accordee' and p.d between dm.date_debut and dm.date_fin
    group by p.id, p.d, p.prevues
  ),
  pts as (
    select pt.personne_id, pointage.jour_bxl(pt.horodatage) as d, pt.sens, pt.horodatage,
           lag(pt.sens) over w as sp, lead(pt.sens) over w as ss, lead(pt.horodatage) over w as hs
    from pointage.pointages pt
    where pt.personne_id = any (p_ids) and not pt.annule
      and pt.horodatage >= (p_debut::timestamp at time zone 'Europe/Brussels')
      and pt.horodatage <  ((p_fin + 1)::timestamp at time zone 'Europe/Brussels')
    window w as (partition by pt.personne_id, pointage.jour_bxl(pt.horodatage) order by pt.horodatage)
  ),
  agg as (
    select personne_id as id, d, count(*)::int as nb,
           coalesce(sum(extract(epoch from hs - horodatage) / 60) filter (where sens = 'entree' and ss = 'sortie'), 0)::int as brut,
           coalesce(sum(extract(epoch from hs - horodatage) / 60) filter (where sens = 'sortie' and ss = 'entree'), 0)::int as pp,
           count(*) filter (where (sens = 'entree' and ss is distinct from 'sortie')
                               or (sens = 'sortie' and sp is distinct from 'entree')) = 0 as complete
    from pts group by personne_id, d
  ),
  calc as (
    select p.id, p.d, p.prevues, a.absence, coalesce(g.nb, 0) as nb, coalesce(g.brut, 0) as brut,
           coalesce(g.complete, true) as complete,
           case when coalesce(g.brut, 0) > par.ps then greatest(0, par.pm - coalesce(g.pp, 0)) else 0 end as pause,
           par.mj, par.jnp
    from prev p join abs a on a.id = p.id and a.d = p.d left join agg g on g.id = p.id and g.d = p.d cross join par
  )
  select id, d, prevues, absence, prevues - absence, nb, brut, pause, brut - pause,
         -- Jour non prévu (week-end, férié, jour off d'un temps partiel) : rien en boni, tout « à valider »
         case when nb = 0 or not complete then 0 when prevues = 0 and jnp = 1 then 0
              else least(brut - pause, mj) - (prevues - absence) end,
         case when not complete then 0 when prevues = 0 and jnp = 1 then brut - pause
              else greatest(0, brut - pause - mj) end,
         complete
  from calc
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
                   case v_lieu when 'externe' then 'TT' else 'BUREAU' end),
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

revoke execute on function pointage.journees_set(date, date, uuid[]) from public, anon;
grant execute on function pointage.journees_set(date, date, uuid[]) to authenticated;
select pointage.fixer_fuseau();
