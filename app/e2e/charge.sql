-- Test de charge (base locale uniquement) : ~120 personnes, 2 mois de pointages, puis temps des requêtes les plus lourdes.
-- Usage : e2e/base-locale.sh start ; psql -h localhost -p 5499 -U postgres -f e2e/charge.sql ; e2e/base-locale.sh stop
\set ON_ERROR_STOP 1
\timing off
set client_min_messages = warning;

-- 1. 110 personnes de plus, réparties dans les services existants, temps plein
insert into pointage.personnes (nom, prenom, email, role, type, service_id, date_entree)
select 'Charge' || g, 'P' || g, 'charge' || g || '@cfb.test', 'employe', 'interne',
       (select id from pointage.services order by id offset (g % (select count(*) from pointage.services)) limit 1), '2024-01-01'
from generate_series(1, 110) g;
insert into pointage.personne_regimes (personne_id, debut, regime_id)
select id, '2024-01-01', 1 from pointage.personnes where email like 'charge%';

-- 2. Deux mois de pointages (jours ouvrés, ~8h→16h30, 5 % d'oublis de sortie, 3 % de jours sans pointage)
insert into pointage.pointages (personne_id, horodatage, sens, source, cree_par, cree_le)
select p.id, (j + time '08:00' + (random() * 40 || ' minutes')::interval) at time zone 'Europe/Brussels', 'entree', 'web', p.id, now()
from pointage.personnes p, generate_series(current_date - 60, current_date - 1, interval '1 day') j
where extract(isodow from j) < 6 and random() > 0.03;
insert into pointage.pointages (personne_id, horodatage, sens, source, cree_par, cree_le)
select pt.personne_id, pt.horodatage + interval '8 hours 30 minutes', 'sortie', 'web', pt.personne_id, now()
from pointage.pointages pt where pt.sens = 'entree' and random() > 0.05;
analyze;
select count(*) as personnes from pointage.personnes \gset
select count(*) as pointages from pointage.pointages \gset
\echo Personnes : :personnes  Pointages : :pointages

-- 3. Temps des écrans de gestion (en tant que RH) et d'un employé
create temp table mesures (ecran text, ms numeric);
grant all on mesures to authenticated;
create or replace function pg_temp.mesurer(ecran text, sql text) returns void language plpgsql as $$
declare t0 timestamptz := clock_timestamp(); begin execute sql; insert into mesures values (ecran, round(extract(epoch from clock_timestamp() - t0)::numeric * 1000, 1)); end $$;

select null from (select set_config('request.jwt.claims', json_build_object('sub', auth_user_id, 'role', 'authenticated')::text, false)
from pointage.personnes where email = 'nadia.benali@cfb.test') x;
set role authenticated;
select pg_temp.mesurer('Suivi RH : jours à régulariser (tous)', 'select count(*) from public.anomalies');
select pg_temp.mesurer('Équipe › Ce mois (rapport mensuel)', format('select count(*) from public.rapport_mensuel(%L)', date_trunc('month', current_date)::date));
select pg_temp.mesurer('Rapports › Tableau de bord', format('select public.stats_direction(%L)', (date_trunc('month', current_date) - interval '1 month')::date));
select pg_temp.mesurer('Équipe › Aujourd''hui', 'select count(*) from public.presence_jour()');
select pg_temp.mesurer('Personnes (liste)', 'select count(*) from public.admin_personnes');
select pg_temp.mesurer('Clôture : état du mois', format('select public.etat_cloture(%L)', (date_trunc('month', current_date) - interval '1 month')::date));
reset role;
select null from (select set_config('request.jwt.claims', json_build_object('sub', auth_user_id, 'role', 'authenticated')::text, false)
from pointage.personnes where email = 'sofia.janssens@cfb.test') x;
set role authenticated;
select pg_temp.mesurer('Employé : Mon mois (journées)', format('select count(*) from public.journees(null, %L, %L)', date_trunc('month', current_date)::date, current_date));
select pg_temp.mesurer('Employé : pointer', 'select public.pointer(null, null, gen_random_uuid())');
reset role;
select ecran, ms from mesures order by ms desc;
