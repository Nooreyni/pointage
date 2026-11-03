-- Vérification d'une installation CFB Pointage (lecture seule : ne modifie rien).
-- psql "$DB_URL" -f scripts/verifier-installation.sql   — ou à coller dans l'éditeur SQL de Supabase.
with c(ok, controle, detail) as (
  select (select count(*) from pg_tables where schemaname = 'pointage' and not rowsecurity) = 0,
         'Sécurité : RLS activée sur toutes les tables', (select string_agg(tablename, ', ') from pg_tables where schemaname = 'pointage' and not rowsecurity)
  union all
  select not exists (select 1 from information_schema.role_table_grants where table_schema = 'pointage' and grantee in ('anon', 'authenticated')
                     and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
         'Sécurité : aucune écriture directe dans les tables (tout passe par les fonctions contrôlées)',
         (select string_agg(distinct table_name || ' (' || privilege_type || ')', ', ') from information_schema.role_table_grants
          where table_schema = 'pointage' and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'))
  union all
  select not exists (select 1 from information_schema.role_table_grants where table_schema = 'pointage' and grantee = 'anon'),
         'Sécurité : rien de lisible sans être connecté', null
  union all
  select not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
                       and p.proname not in ('config_publique')),
         'Sécurité : aucune fonction sensible ouverte aux visiteurs non connectés', null
  union all
  select not exists (select 1 from pointage.personnes where email like '%@cfb.test'),
         'Données : aucun compte fictif de développement (@cfb.test)', (select count(*)::text || ' compte(s)' from pointage.personnes where email like '%@cfb.test')
  union all
  select exists (select 1 from pointage.personnes where role = 'admin' and date_sortie is null),
         'Comptes : au moins un admin général', null
  union all
  -- (requête dynamique : pg_cron n'existe que sur Supabase / un serveur où il est installé)
  select case when to_regclass('cron.job') is null then false else (xpath('/row/n/text()', query_to_xml(
           $q$select count(*) as n from cron.job where jobname in ('cfb-rappels', 'cfb-envoi', 'cfb-conservation', 'cfb-anonymisation')$q$,
           false, true, '')))[1]::text::int = 4 end,
         'Tâches planifiées : rappels, envoi, conservation, anonymisation',
         case when to_regclass('cron.job') is null then 'pg_cron absent' end
  union all
  select coalesce((select valeur <> '' from pointage.configuration where cle = 'vapid_public'), false),
         'Notifications : clés d’envoi configurées (scripts/generer-config-envoi.mjs)', null
  union all
  select coalesce((select valeur like 'https://%' from pointage.configuration where cle = 'appli_url'), false),
         'Notifications : adresse de l’appli renseignée (liens des e-mails)', (select valeur from pointage.configuration where cle = 'appli_url')
  union all
  select (select count(*) from pointage.parametres where provisoire) = 0,
         'Règles : plus aucune valeur « à confirmer »', (select count(*)::text || ' valeur(s) à confirmer dans Réglages › Paramètres' from pointage.parametres where provisoire)
  union all
  select exists (select 1 from pointage.jours_feries where jour >= current_date),
         'Calendrier : jours fériés à venir encodés', null
)
select case when ok then '✅' else '❌' end as etat, controle, coalesce(detail, '') as detail from c;

-- Empreinte des fonctions (comparer avec celle de la version testée : voir docs/passation.md)
select count(*) as nb_fonctions,
       md5(string_agg(n.nspname || '.' || p.proname || ':' || md5(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s+', '', 'g')),
           ',' order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))) as empreinte
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('pointage', 'public') and p.prokind = 'f';
