-- =====================================================================
--  CFB Pointage — moteur de rappels (lancé toutes les 15 min par pg_cron)
--  Produit des lignes dans pointage.notifications ; l'envoi push / e-mail
--  est fait par une Edge Function qui lit les notifications non envoyées.
-- =====================================================================

create or replace function pointage.generer_rappels(p_maintenant timestamptz default now()) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_local   timestamp := p_maintenant at time zone 'Europe/Brussels';
  v_jour    date := v_local::date;
  v_min     int  := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  v_fin_mois date := (date_trunc('month', v_jour) + interval '1 month - 1 day')::date;
  v_avant   int;
  v_apres   int;
  r         record;
begin
  select count(*) into v_avant from pointage.notifications;

  -- 1. Entrée oubliée : jour prévu, aucune absence, aucun pointage, 30 min après l'heure habituelle
  for r in
    select pe.id, pointage.heure_habituelle(pe.id, 'entree', v_jour) as h_in,
                  pointage.heure_habituelle(pe.id, 'sortie', v_jour) as h_out
    from pointage.personnes pe
    where pe.date_entree <= v_jour and (pe.date_sortie is null or pe.date_sortie >= v_jour)
      and pointage.minutes_prevues(pe.id, v_jour) > pointage.minutes_absence(pe.id, v_jour)
      and not exists (select 1 from pointage.pointages pt where pt.personne_id = pe.id and not pt.annule
                      and pointage.jour_bxl(pt.horodatage) = v_jour)
  loop
    if v_min >= r.h_in + pointage.param('rappel_entree_delai_min') and v_min < r.h_out then
      perform pointage.notifier(r.id, 'oubli_entree', 'oubli_entree:' || v_jour,
        'Tu as oublié de pointer ?',
        'Tu arrives d''habitude vers ' || to_char(make_time(r.h_in / 60, r.h_in % 60, 0), 'HH24:MI') || '.',
        '/pointer?suggestion=' || r.h_in);
    end if;
  end loop;

  -- 2. Sortie oubliée : toujours « entrée » 1 h après l'heure habituelle de sortie
  for r in
    select pe.id, pointage.heure_habituelle(pe.id, 'sortie', v_jour) as h_out
    from pointage.personnes pe
    where (select pt.sens from pointage.pointages pt where pt.personne_id = pe.id and not pt.annule
           and pointage.jour_bxl(pt.horodatage) = v_jour order by pt.horodatage desc limit 1) = 'entree'
  loop
    if v_min >= r.h_out + pointage.param('rappel_sortie_delai_min') then
      perform pointage.notifier(r.id, 'oubli_sortie', 'oubli_sortie:' || v_jour,
        'Tu as fini ta journée ?',
        'Tu pars d''habitude vers ' || to_char(make_time(r.h_out / 60, r.h_out % 60, 0), 'HH24:MI') || '. Pense à pointer ta sortie.',
        '/pointer?suggestion=' || r.h_out);
    end if;
  end loop;

  -- 3. Fin de mois : J-5 aux personnes en anomalie, J-2 aux N+1
  if v_fin_mois - v_jour = pointage.param('rappel_fin_mois_employe_j') then
    for r in
      select pe.id, count(*) as nb
      from pointage.personnes pe
      cross join lateral generate_series(date_trunc('month', v_jour)::date, v_jour - 1, interval '1 day') g(d)
      cross join lateral pointage.journee(pe.id, g.d::date) j
      where (j.nb_pointages = 0 and j.a_prester > 0) or (j.nb_pointages > 0 and not j.complete)
      group by pe.id
    loop
      perform pointage.notifier(r.id, 'fin_mois', 'fin_mois:' || to_char(v_jour, 'YYYY-MM'),
        r.nb || ' jour(s) à régulariser avant la fin du mois',
        'Corrige-les en 1 clic pour que la RH puisse clôturer.', '/anomalies');
    end loop;
  end if;

  if v_fin_mois - v_jour = pointage.param('rappel_fin_mois_n1_j') then
    for r in
      select v.id as n1, count(distinct pe.id) as nb
      from pointage.personnes pe
      cross join lateral generate_series(date_trunc('month', v_jour)::date, v_jour - 1, interval '1 day') g(d)
      cross join lateral pointage.journee(pe.id, g.d::date) j
      cross join lateral pointage.valideurs_n1(pe.id, v_jour) v(id)
      where (j.nb_pointages = 0 and j.a_prester > 0) or (j.nb_pointages > 0 and not j.complete)
      group by v.id
    loop
      perform pointage.notifier(r.n1, 'fin_mois_equipe', 'fin_mois_equipe:' || to_char(v_jour, 'YYYY-MM'),
        r.nb || ' personne(s) de ton équipe ont encore des anomalies',
        'La clôture du mois approche.', '/equipe/anomalies');
    end loop;
  end if;

  -- 4. Demandes en attente depuis trop longtemps → relance des destinataires (1 fois par jour)
  for r in
    select d.id, d.numero, d.personne_id from pointage.demandes d
    where d.statut = 'en_attente'
      and d.cree_le < p_maintenant - make_interval(days => pointage.param('relance_demande_jours'))
  loop
    perform pointage.notifier(v, 'relance_demande', 'relance:' || r.id || ':' || v_jour,
      'Demande n°' || r.numero || ' de ' || pointage.nom_complet(r.personne_id) || ' en attente',
      'Elle attend ta décision depuis plus de ' || pointage.param('relance_demande_jours') || ' jours.',
      '/validation/' || r.id)
    from pointage.destinataires_demande(r.personne_id) v;
  end loop;

  select count(*) into v_apres from pointage.notifications;
  return v_apres - v_avant;
end $$;

-- Planification (Supabase : pg_cron disponible ; ignoré en local)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('cfb-rappels', '*/15 * * * *', 'select pointage.generer_rappels()');
  end if;
end $$;
