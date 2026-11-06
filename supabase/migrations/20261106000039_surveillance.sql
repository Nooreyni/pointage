-- =====================================================================
--  CFB Pointage — surveillance : l'IT est prévenue si l'outil tombe en panne en silence (06/11/2026)
--  Toutes les heures : tâches planifiées qui ne tournent plus ou échouent, service d'envoi en erreur, file d'envoi
--  bloquée, rafale d'erreurs dans l'appli. En cas de problème : alerte à l'admin général (une fois par jour et par
--  problème). L'état est aussi visible dans Réglages › Journal (admin, admin RH). Les notifications non délivrées
--  faute de canal (ni appareil ni e-mail) sont signalées comme avertissement, sans alerte : c'est un réglage, pas une panne.
-- =====================================================================
create or replace function pointage.verifier_sante(p_maintenant timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_pb   jsonb := '[]'::jsonb;   -- problèmes (déclenchent une alerte)
  v_av   jsonb := '[]'::jsonb;   -- avertissements (affichés seulement)
  v_info jsonb := '{}'::jsonb;
  r      record;
  n      int;
begin
  -- 1. Tâches planifiées (si pg_cron est installé)
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    for r in execute $q$
      select j.jobname, j.schedule, j.active,
             max(d.end_time) filter (where d.status = 'succeeded') as dernier_ok,
             count(*) filter (where d.status <> 'succeeded' and d.start_time > $1 - interval '2 hours') as echecs
      from cron.job j left join cron.job_run_details d on d.jobid = j.jobid
      where j.jobname like 'cfb-%' group by j.jobname, j.schedule, j.active $q$ using p_maintenant
    loop
      v_info := v_info || jsonb_build_object(r.jobname, r.dernier_ok);
      if not r.active then
        v_pb := v_pb || jsonb_build_object('code', 'tache_inactive:' || r.jobname, 'titre', 'Tâche planifiée désactivée : ' || r.jobname);
      elsif r.echecs > 0 then
        v_pb := v_pb || jsonb_build_object('code', 'tache_echec:' || r.jobname, 'titre', 'Tâche planifiée en échec : ' || r.jobname,
                                           'detail', r.echecs || ' échec(s) sur les 2 dernières heures');
      elsif r.jobname in ('cfb-rappels', 'cfb-envoi')
            and (r.dernier_ok is null or r.dernier_ok < p_maintenant - case when r.jobname = 'cfb-envoi' then interval '30 minutes' else interval '1 hour' end) then
        v_pb := v_pb || jsonb_build_object('code', 'tache_arretee:' || r.jobname, 'titre', 'Tâche planifiée arrêtée : ' || r.jobname,
                                           'detail', 'dernier passage réussi : ' || coalesce(to_char(r.dernier_ok at time zone 'Europe/Brussels', 'DD/MM HH24:MI'), 'jamais'));
      end if;
    end loop;
  end if;

  -- 2. Service d'envoi : réponses en erreur sur les 2 dernières heures (si pg_net est installé)
  if exists (select 1 from pg_namespace where nspname = 'net') and exists (select 1 from pointage.configuration where cle = 'envoi_url' and valeur is not null) then
    execute $q$ select count(*) from net._http_response where created > $1 - interval '2 hours'
                and (status_code is distinct from 200 or error_msg is not null) $q$ into n using p_maintenant;
    if n >= 3 then
      v_pb := v_pb || jsonb_build_object('code', 'envoi_erreur', 'titre', 'Le service d''envoi des notifications répond en erreur',
                                         'detail', n || ' appel(s) en erreur sur les 2 dernières heures');
    end if;
  end if;

  -- 3. File d'envoi bloquée : notifications ni envoyées ni abandonnées depuis plus d'une heure
  select count(*) into n from pointage.notifications
  where envoi_termine_le is null and cree_le < p_maintenant - interval '1 hour' and cree_le > p_maintenant - interval '2 days';
  if n >= 3 then
    v_pb := v_pb || jsonb_build_object('code', 'file_bloquee', 'titre', 'Des notifications attendent depuis plus d''une heure',
                                       'detail', n || ' notification(s) en attente : le service d''envoi ne passe plus');
  end if;

  -- 4. Rafale d'erreurs dans l'appli
  select count(*) into n from pointage.erreurs_appli where quand > p_maintenant - interval '1 hour';
  if n >= 10 then
    v_pb := v_pb || jsonb_build_object('code', 'erreurs_appli', 'titre', 'Beaucoup d''erreurs dans l''appli', 'detail', n || ' erreur(s) en une heure');
  end if;

  -- Avertissement : notifications non délivrées faute de canal (24 h)
  select count(*) as nb, count(distinct personne_id) as gens into r from pointage.notifications
  where envoi_erreur like 'aucun canal%' and envoi_termine_le > p_maintenant - interval '1 day';
  if r.nb > 0 then
    v_av := v_av || jsonb_build_object('code', 'sans_canal', 'titre', r.nb || ' notification(s) non délivrée(s) sur 24 h',
                                       'detail', r.gens || ' personne(s) sans notifications activées ni e-mail de secours');
  end if;

  return jsonb_build_object('ok', jsonb_array_length(v_pb) = 0, 'problemes', v_pb, 'avertissements', v_av,
                            'derniers_passages', v_info, 'verifie_le', p_maintenant);
end $$;

-- Toutes les heures : alerte à l'admin général (une fois par jour et par problème)
create or replace function pointage.surveiller(p_maintenant timestamptz default now()) returns int
language plpgsql security definer set search_path = '' as $$
declare v jsonb := pointage.verifier_sante(p_maintenant); p jsonb; a uuid; n int := 0;
begin
  for p in select * from jsonb_array_elements(v->'problemes') loop
    for a in select id from pointage.personnes where role = 'admin' and auth_user_id is not null
               and (date_sortie is null or date_sortie >= (p_maintenant at time zone 'Europe/Brussels')::date) loop
      perform pointage.notifier(a, 'alerte_technique', 'tech:' || (p->>'code') || ':' || to_char(p_maintenant at time zone 'Europe/Brussels', 'YYYY-MM-DD'),
                                p->>'titre', coalesce(p->>'detail', '') || ' — voir Réglages › Journal.', '/reglages/journal');
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;

-- Lecture pour l'appli (Réglages › Journal)
create or replace function public.sante_systeme() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform pointage.exiger_role('admin', 'admin_rh');
  return pointage.verifier_sante(now());
end $$;

revoke all on function pointage.verifier_sante(timestamptz), pointage.surveiller(timestamptz) from public, anon, authenticated;
revoke all on function public.sante_systeme() from public, anon;
grant execute on function public.sante_systeme() to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('cfb-surveillance', '7 * * * *', 'select pointage.surveiller()');
  end if;
end $$;

select pointage.fixer_fuseau();
