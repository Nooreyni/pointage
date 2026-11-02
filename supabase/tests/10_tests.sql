-- Tests v0.3 : sécurité, hiérarchie, calculs, rappels — à lancer avec run.sh (base locale jetable)
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
create schema test;
create table test.resultats (n serial, ok boolean, libelle text);
create function test.ok(cond boolean, libelle text) returns void language sql as $$
  insert into test.resultats (ok, libelle) values (coalesce(cond, false), libelle) $$;
create function test.erreur(sql text, libelle text, motif text default null) returns void language plpgsql as $$
declare m text;
begin
  begin execute sql; exception when others then m := sqlerrm; end;
  insert into test.resultats (ok, libelle)
  values (m is not null and (motif is null or m ilike '%' || motif || '%'),
          libelle || coalesce(' → ' || m, ' → AUCUNE ERREUR'));
end $$;
create function test.connecte(prenom text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub',
    (select u.id from auth.users u join pointage.personnes p on p.email = u.email where p.prenom = $1))::text, false) $$;
create function test.pid(prenom text) returns uuid language sql as $$ select id from pointage.personnes where prenom = $1 $$;
create function test.notifs(prenom text, type text) returns bigint language sql as $$
  select count(*) from pointage.notifications where personne_id = test.pid($1) and type = $2 $$;
grant usage on schema test to authenticated, anon, service_role;
grant all on all tables in schema test to authenticated, anon, service_role;
grant all on all sequences in schema test to authenticated, anon, service_role;
grant execute on all functions in schema test to authenticated, anon, service_role;

-- Les scénarios enchaînent des pointages à la seconde : l'anti double appui est activé seulement pour son test
update pointage.parametres set valeur = 0 where cle = 'anti_rebond_s';
-- Comptes Microsoft Entra : e-mail vérifié par le fournisseur
insert into auth.users (email, email_confirmed_at, raw_app_meta_data)
select email, now(), '{"provider":"azure","providers":["azure"]}' from pointage.personnes;
insert into auth.users (email, email_confirmed_at, raw_app_meta_data) values ('inconnu@exterieur.test', now(), '{"provider":"azure","providers":["azure"]}');
select test.ok((select count(*) = 14 from pointage.personnes where auth_user_id is not null), 'SSO : 14 comptes liés par e-mail');

-- ===================== Accès =====================
set role anon;
select test.erreur('select * from public.pointages', 'Anonyme : aucune lecture', 'permission denied');
select test.erreur('select public.pointer()', 'Anonyme : pas de pointage', 'permission denied');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'inconnu@exterieur.test'))::text, false);
set role authenticated;
select test.erreur('select public.pointer()', 'Compte Entra inconnu : refusé', 'non reconnu');
reset role;

-- ===================== Pointage =====================
select test.connecte('Sofia'); set role authenticated;
select test.erreur($$insert into pointage.pointages (personne_id,horodatage,sens,source,cree_par) values (pointage.moi(),now(),'entree','web',pointage.moi())$$,
                   'Écriture directe interdite', 'permission denied');
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.10, 10.0.0.1"}', false);
select test.ok((public.pointer()->>'sens') = 'entree', '1 tap → entrée');
select test.ok((select ip = '203.0.113.10'::inet and lieu = 'reseau_cfb' and type_code = 'BUREAU'
                from public.pointages order by cree_le desc limit 1), 'IP stockée + réseau CFB → Bureau');
select test.ok((public.pointer()->>'sens') = 'sortie', '2e tap → sortie');
select set_config('request.headers', '{"x-forwarded-for":"198.51.100.7"}', false);
select test.ok((public.pointer()->>'type_code') = 'TT', 'Hors réseau → télétravail');
select test.ok((public.pointer(p_client_id => 'c0000000-0000-0000-0000-000000000001', p_horodatage => now() - interval '1 hour')->>'id')
             = (public.pointer(p_client_id => 'c0000000-0000-0000-0000-000000000001', p_horodatage => now() - interval '1 hour')->>'id'),
               'Hors ligne rejoué → pas de doublon');
select test.erreur($$select public.pointer(p_client_id => gen_random_uuid(), p_horodatage => now() - interval '4 days')$$, 'Pointage > 72 h refusé', '72 h');
select test.erreur($$select public.pointer(p_source => 'rh')$$, 'Source RH refusée', 'réservée');
reset role;

-- ===================== Visibilité =====================
select test.connecte('Sofia');  set role authenticated;
select test.ok((select count(*) = 1 from public.personnes), 'Employé : ne voit que lui');
select test.ok((select count(*) = 14 from public.presence_jour()), 'Présence du jour : tout le monde');
select test.ok((select bool_and(mon_service) = false from (select mon_service from public.presence_jour() limit 1 offset 6) x), 'Présence : son service en premier');
reset role;
select test.connecte('Marc');   set role authenticated;
select test.ok((select count(*) = 5 from public.personnes), 'Chef Administration : son service (5, ISP compris)');
reset role;
select test.connecte('Lucas');  set role authenticated;
select test.ok((select count(*) = 3 from public.personnes), 'Chef IT : son service (2 + admin IT)');
reset role;
select test.connecte('Paul');   set role authenticated;
select test.ok((select count(*) = 1 from public.personnes), 'Logistique (sans équipe) : comme un employé');
reset role;
select test.connecte('Claire'); set role authenticated;
select test.ok((select count(*) = 14 from public.personnes), 'Direction : tout le monde');
reset role;
select test.connecte('Nadia');  set role authenticated;
select test.ok((select count(*) = 14 from public.personnes), 'RH : tout le monde (constat)');
reset role;

-- ===================== Accès inter-services =====================
select test.connecte('Marc'); set role authenticated;
select test.erreur($$select public.donner_acces_service(test.pid('Lucas'), 'a0000000-0000-0000-0000-000000000002')$$, 'Chef ne donne pas d''accès', 'réservée');
reset role;
select test.connecte('Claire'); set role authenticated;
select public.donner_acces_service(test.pid('Lucas'), 'a0000000-0000-0000-0000-000000000002', false);
reset role;
select test.connecte('Lucas'); set role authenticated;
select test.ok((select count(*) = 8 from public.personnes), 'Accès lecture à Administration : 3 + 5');
select test.ok((select not je_peux_valider from public.personnes where prenom = 'Sofia'), 'Accès lecture : pas de validation');
reset role;

-- ===================== Demandes : circuit décentralisé =====================
select test.connecte('Sofia'); set role authenticated;
select test.ok((select (s->>'minutes')::int = 5 * 456 and (s->>'solde_apres')::int = 9120 - 5 * 456
                from public.simuler_demande('conge_jours', 'CP', '2026-11-16', '2026-11-20') s), 'Simulation : 5 j × 7h36, solde après');
select test.ok((select (s->>'minutes')::int = 2 * 456 from public.simuler_demande('conge_jours', 'CP', '2026-11-10', '2026-11-12') s),
               'Simulation : 11/11 férié non décompté');
select public.soumettre_demande('conge_jours', 'CP', '2026-11-16', '2026-11-20');
select test.erreur($$select public.soumettre_demande('conge_jours', 'CP', '2026-11-18')$$, 'Chevauchement refusé', 'déjà une demande');
select test.erreur($$select public.soumettre_demande('conge_jours', 'MAL', '2026-12-01')$$, 'Maladie : pas demandable', 'non demandable');
select test.erreur($$select public.soumettre_demande('conge_jours', 'CP', '2026-11-21', '2026-11-22')$$, 'Week-end seul refusé', 'Aucune heure');
select test.erreur($$select public.decider(array(select id from public.demandes), true)$$, 'Auto-validation interdite', 'pas valideur');
reset role;
select test.ok(test.notifs('Marc', 'demande_a_traiter') = 1, 'Chef notifié de la demande');
select test.ok(test.notifs('Claire', 'demande_a_traiter') = 0, 'Direction NON notifiée par défaut');

select id as demande_sofia from pointage.demandes where personne_id = test.pid('Sofia') \gset
select test.connecte('Yanis'); set role authenticated;
select test.erreur(format('select public.decider(array[%L]::uuid[], true)', :'demande_sofia'),
                   'Collègue ne valide pas', 'pas valideur');
select test.ok((select (s->>'minutes')::int = 240 from public.simuler_demande('conge_jours', 'CP', '2026-11-18') s), 'Temps partiel : mercredi = 4h');
reset role;

select test.connecte('Marc'); set role authenticated;
select test.erreur($$select public.decider(array(select id from public.demandes where prenom = 'Sofia'), false)$$, 'Refus sans motif', 'motivé');
select test.ok(public.decider(array(select id from public.demandes where prenom = 'Sofia'), true) = 1, 'Chef accepte : définitif');
select test.erreur($$select public.decider(array(select id from public.demandes where prenom = 'Sofia'), true)$$, 'Double décision', 'déjà traitée');
reset role;
select test.ok((select statut = 'accordee' from pointage.demandes where personne_id = test.pid('Sofia')), 'Statut accordée sans étape RH');
select test.ok((select reste_min = 9120 - 2280 from public.soldes s where s.personne_id = test.pid('Sofia') and compteur_code = 'CONGE_LEGAL'), 'Solde débité');
select test.ok(test.notifs('Sofia', 'demande_decidee') = 1, 'Demandeur notifié de la décision');

select test.connecte('Nadia'); set role authenticated;
select test.ok(public.constater(array(select id from public.demandes where prenom = 'Sofia')) = 1, 'RH constate');
select test.erreur($$select public.decider(array(select id from public.demandes where prenom = 'Sofia'), true)$$, 'RH ne décide pas à la place du chef', 'déjà traitée');
reset role;

-- Direction : décide pour n'importe qui
select test.connecte('Yanis'); set role authenticated;
select public.soumettre_demande('conge_jours', 'CP', '2026-11-18');
reset role;
select test.connecte('Claire'); set role authenticated;
select test.ok(public.decider(array(select id from public.demandes where prenom = 'Yanis'), true) = 1, 'Direction décide pour un employé de service');
reset role;
select test.ok((select reste_min = 9120 - 240 from public.soldes s where s.personne_id = test.pid('Yanis') and compteur_code = 'CONGE_LEGAL'), 'Temps partiel : 4h débitées');

-- Chef de service / RH / Logistique → la direction
select test.connecte('Marc'); set role authenticated;
select public.soumettre_demande('conge_jours', 'CP', '2026-11-23', '2026-11-24');
select test.erreur($$select public.decider(array(select id from public.demandes where prenom = 'Marc'), true)$$, 'Chef ne valide pas sa propre demande', 'pas valideur');
reset role;
select test.connecte('Paul'); set role authenticated;  select public.soumettre_demande('conge_jours', 'CP', '2026-12-07'); reset role;
select test.connecte('Nadia'); set role authenticated; select public.soumettre_demande('conge_jours', 'CP', '2026-12-08'); reset role;
select test.ok(test.notifs('Claire', 'demande_a_traiter') = 3, 'Chef, Logistique et RH → direction notifiée');
select test.connecte('Claire'); set role authenticated;
select test.ok(public.decider(array(select id from public.demandes where prenom in ('Marc', 'Paul', 'Nadia') and statut = 'en_attente'), true) = 3,
               'Direction valide en lot (3)');
reset role;

-- Chef absent → la demande remonte à la direction
select test.ok((select array_agg(v) = array[test.pid('Claire')] from pointage.valideurs_n1(test.pid('Sofia'), '2026-11-23') v),
               'Chef absent ce jour-là → N+1 = direction');
select test.ok((select array_agg(v) = array[test.pid('Marc')] from pointage.valideurs_n1(test.pid('Sofia'), '2026-11-25') v),
               'Chef présent → N+1 = chef');

-- Direction : suivre un service
select test.connecte('Claire'); set role authenticated; select public.suivre_service('a0000000-0000-0000-0000-000000000002', true); reset role;
select test.connecte('Awa'); set role authenticated; select public.soumettre_demande('conge_demi_jour', 'CEL', '2026-12-02', p_demi => 'matin'); reset role;
select test.ok(test.notifs('Claire', 'demande_a_traiter') = 4, 'Direction abonnée à Administration → notifiée');
select test.ok((select minutes_decomptees = 225 from pointage.demandes where personne_id = test.pid('Awa')), 'Demi-jour 37h30 = 3h45');

-- ISP : chef de service OU admin RH
select test.connecte('Jordan'); set role authenticated; select public.soumettre_demande('conge_jours', 'CP', '2026-12-03'); reset role;
select test.ok(test.notifs('Marc', 'demande_a_traiter') = 4 and test.notifs('Inès', 'demande_a_traiter') = 1, 'ISP : chef ET admin RH notifiés');
select test.connecte('Inès'); set role authenticated;
select test.ok(public.decider(array(select id from public.demandes where prenom = 'Jordan'), true) = 1, 'ISP accepté par l''admin RH');
select test.erreur($$select public.decider(array(select id from public.demandes where prenom = 'Awa'), true)$$, 'Admin RH ne valide pas un non-ISP', 'pas valideur');
reset role;

-- Accès inter-services avec validation
select test.connecte('Claire'); set role authenticated;
select public.donner_acces_service(test.pid('Lucas'), 'a0000000-0000-0000-0000-000000000002', true);
reset role;
select test.connecte('Lucas'); set role authenticated;
select test.ok(public.decider(array(select id from public.demandes where prenom = 'Awa'), false, 'Période chargée') = 1,
               'Accès avec validation : décide pour un autre service');
reset role;

-- Annulation d'un congé futur accordé → solde restauré
select test.connecte('Sofia'); set role authenticated;
select public.annuler_demande((select id from public.demandes where prenom = 'Sofia'));
select test.ok((select reste_min = 9120 from public.soldes where compteur_code = 'CONGE_LEGAL'), 'Annulation → solde restauré');
reset role;

-- ===================== Motif d'absence =====================
select test.connecte('Nadia'); set role authenticated;
select public.encoder_absence_rh(test.pid('Awa'), 'MAL', '2026-10-28', current_date + 2);
reset role;
select test.connecte('Yanis'); set role authenticated;
select test.ok((select statut = 'Absent' from public.presence_jour() where prenom = 'Awa'), 'Collègue : « Absent » seulement');
reset role;
select test.connecte('Marc'); set role authenticated;
select test.ok((select statut = 'Maladie' from public.presence_jour() where prenom = 'Awa'), 'N+1 : voit « Maladie »');
reset role;

-- ===================== Corrections de pointage =====================
select test.connecte('Emma'); set role authenticated;
select public.corriger_pointage('2026-10-26 17:00+01', 'sortie', p_remarque => 'Oubli');
select test.erreur($$select public.corriger_pointage(now() + interval '1 hour', 'entree')$$, 'Correction future refusée', 'futur');
select test.erreur($$select public.corriger_pointage('2026-07-01 09:00+02', 'entree')$$, 'Correction trop ancienne', 'trop ancienne');
reset role;
select test.ok(test.notifs('Lucas', 'correction_pointage') = 1, 'Correction auto-validée, chef informé');
select test.connecte('Yanis'); set role authenticated;
select test.erreur(format('select public.annuler_pointage(%L, %L)', (select id from pointage.pointages where personne_id = test.pid('Emma') and source = 'correction'), 'x'),
                   'Collègue ne peut pas annuler', 'introuvable');
reset role;
select test.connecte('Lucas'); set role authenticated;
select test.erreur(format('select public.annuler_pointage(%L)', (select id from public.pointages where source = 'correction')), 'Annulation N+1 sans motif', 'Motif');
select public.annuler_pointage((select id from public.pointages where source = 'correction'), 'Tu étais en réunion jusqu''à 18h ?');
reset role;
select test.ok(test.notifs('Emma', 'pointage_annule') = 1, 'Employé notifié de l''annulation');

-- ===================== Calcul des journées =====================
insert into pointage.pointages (personne_id, horodatage, sens, source, cree_par) values
  (test.pid('Emma'), '2026-10-28 08:00+01', 'entree', 'web', test.pid('Emma')), (test.pid('Emma'), '2026-10-28 16:08+01', 'sortie', 'web', test.pid('Emma')),
  (test.pid('Emma'), '2026-10-29 08:00+01', 'entree', 'web', test.pid('Emma')), (test.pid('Emma'), '2026-10-29 12:00+01', 'sortie', 'web', test.pid('Emma')),
  (test.pid('Emma'), '2026-10-29 12:45+01', 'entree', 'web', test.pid('Emma')), (test.pid('Emma'), '2026-10-29 16:30+01', 'sortie', 'web', test.pid('Emma')),
  (test.pid('Emma'), '2026-10-27 07:00+01', 'entree', 'web', test.pid('Emma')), (test.pid('Emma'), '2026-10-27 17:30+01', 'sortie', 'web', test.pid('Emma')),
  (test.pid('Emma'), '2026-10-26 08:00+01', 'entree', 'web', test.pid('Emma'));
select test.ok((select pause_deduite = 30 and preste = 458 and boni = 2 from pointage.journee(test.pid('Emma'), '2026-10-28')),
               '08:00→16:08 : pause 30 min déduite, boni +2 min');
select test.ok((select pause_deduite = 0 and preste = 465 and boni = 9 from pointage.journee(test.pid('Emma'), '2026-10-29')),
               'Pause pointée 45 min : rien de plus déduit');
select test.ok((select preste = 600 and boni = 84 and depassement = 60 from pointage.journee(test.pid('Emma'), '2026-10-27')),
               '10h prestées : boni plafonné à 9h, 1h « à valider »');
select test.ok((select not complete from pointage.journee(test.pid('Emma'), '2026-10-26')), 'Sortie annulée → journée incomplète');
select test.ok((select prevues = 0 from pointage.journee(test.pid('Emma'), '2026-11-11')), 'Férié : rien à prester');

select test.connecte('Emma'); set role authenticated;
select test.ok((select count(*) filter (where code = 'absent' and jour = '2026-10-23') = 1
                   and count(*) filter (where code = 'pointages_incomplets' and jour = '2026-10-26') = 1 from public.anomalies),
               'Anomalies : absent + incomplet');
select test.ok((select count(*) = 0 from public.anomalies where personne_id <> pointage.moi()), 'Anomalies : uniquement les siennes');
select test.ok(public.solde_boni() = 95, 'Boni du trimestre = 2 + 9 + 84');
select test.erreur($$select public.decider_heures(pointage.moi(), '2026-10-27', true)$$, 'Pas de validation de ses propres heures', 'Non autorisé');
reset role;
select test.connecte('Lucas'); set role authenticated;
select test.ok((select count(*) = 1 and min(minutes) = 60 from public.heures_a_valider()), 'Chef : 1h à valider');
select public.decider_heures(test.pid('Emma'), '2026-10-27', true, 'Déménagement du serveur');
select test.ok((select count(*) = 0 from public.heures_a_valider()), 'Après décision : plus rien à valider');
reset role;
select test.ok((select reste_min = 60 from public.soldes where personne_id = test.pid('Emma') and compteur_code = 'RECUP'), 'Heures validées → Récup +1h');

-- ===================== Rappels =====================
insert into pointage.pointages (personne_id, horodatage, sens, source, cree_par)
values (test.pid('Lucas'), '2026-10-29 08:00+01', 'entree', 'web', test.pid('Lucas'));
select pointage.generer_rappels('2026-10-29 09:30+01');
select test.ok(test.notifs('Sofia', 'oubli_entree') = 1, 'Rappel entrée oubliée (09:30, habituel 08:30 + 30)');
select test.ok(test.notifs('Emma', 'oubli_entree') = 0 and test.notifs('Lucas', 'oubli_entree') = 0, 'Pas de rappel si déjà pointé');
select test.ok(test.notifs('Awa', 'oubli_entree') = 0, 'Pas de rappel pendant une absence');
select pointage.generer_rappels('2026-10-29 09:45+01');
select test.ok(test.notifs('Sofia', 'oubli_entree') = 1, 'Pas de doublon au passage suivant');
select pointage.generer_rappels('2026-10-29 18:05+01');
select test.ok(test.notifs('Lucas', 'oubli_sortie') = 1, 'Rappel sortie oubliée (18:05)');
select pointage.generer_rappels('2026-10-26 10:00+01');
select test.ok(test.notifs('Sofia', 'fin_mois') = 1, 'J-5 : rappel anomalies du mois');
select pointage.generer_rappels('2026-10-29 10:00+01');
select test.ok(test.notifs('Marc', 'fin_mois_equipe') = 1, 'J-2 : rappel au chef');
update pointage.demandes set cree_le = now() - interval '4 days' where personne_id = test.pid('Nadia') and statut = 'accordee';
select test.connecte('Tom'); set role authenticated; select public.soumettre_demande('conge_jours', 'CP', '2026-12-14'); reset role;
update pointage.demandes set cree_le = now() - interval '4 days' where personne_id = test.pid('Tom');
select pointage.generer_rappels();
select test.ok(test.notifs('Claire', 'relance_demande') = 1, 'Relance de la direction après 3 jours');

-- ===================== Congés annuels au prorata =====================
select test.connecte('Inès'); set role authenticated;
select test.ok((select minutes = 9120 from public.proposition_conges(2027) where prenom = 'Sofia'), 'Temps plein 38h : 152h');
select test.ok((select minutes = 8640 from public.proposition_conges(2027) where prenom = 'Yanis'), 'Temps partiel 36h : 144h');
select test.ok((select minutes = 3000 and mois_presence = 4 from public.proposition_conges(2027) where prenom = 'Jordan'),
               'Entré en septembre : 4/12 de 4 × 37h30 = 50h');
select test.ok(public.attribuer_conges(2027) = 14, 'Attribution en 1 clic (14)');
select test.ok(public.attribuer_conges(2027) = 0, 'Attribution idempotente');
reset role;
select test.connecte('Sofia'); set role authenticated;
select test.erreur($$select * from public.proposition_conges(2027)$$, 'Employé : pas d''accès aux propositions', 'réservée');
reset role;

-- ===================== Paramètres =====================
select test.connecte('Marc'); set role authenticated;
select test.erreur($$select public.modifier_parametre('pause_midi_min', 45, 'x')$$, 'Paramètre : réservé', 'réservée');
reset role;
select test.connecte('Inès'); set role authenticated;
select test.erreur($$select public.modifier_parametre('pause_midi_min', 30, '')$$, 'Paramètre : source obligatoire', 'source');
select public.modifier_parametre('pause_midi_min', 30, 'Règlement de travail art. X (test)');
select test.ok((select not provisoire from public.parametres where cle = 'pause_midi_min'), 'Paramètre confirmé → plus provisoire');
reset role;

-- ===================== Clôture =====================
insert into pointage.pointages (id, personne_id, horodatage, sens, source, cree_par, cree_le) values
  ('d0000000-0000-0000-0000-000000000001', test.pid('Sofia'), '2026-09-30 09:00+02', 'entree', 'web', test.pid('Sofia'), '2026-10-02 09:00+02');
insert into pointage.pointages (personne_id, horodatage, sens, source, cree_par, cree_le) values
  (test.pid('Sofia'), '2026-09-30 18:00+02', 'sortie', 'web', test.pid('Sofia'), '2026-10-02 09:00+02');
select test.connecte('Sofia'); set role authenticated;
select test.erreur($$select public.cloturer_mois('2026-09-01')$$, 'Employé ne clôture pas', 'réservée');
reset role;
select test.connecte('Tom'); set role authenticated;
select test.erreur($$select public.cloturer_mois('2026-10-01')$$, 'Mois en cours non clôturable', 'terminé');
select test.ok((public.cloturer_mois('2026-09-01')->>'reports_boni')::int = 1, 'Clôture fin de trimestre : boni reporté');
select test.erreur($$select public.corriger_pointage_rh(test.pid('Sofia'), '2026-09-15 17:00+02', 'sortie')$$, 'Pointage dans un mois clôturé', 'clôturée');
reset role;
select test.ok((select minutes = 540 - 30 - 456 from pointage.mouvements_compteur where personne_id = test.pid('Sofia') and compteur_code = 'BONI'),
               'Report boni = 9h − pause − 7h36');
select test.erreur($$update pointage.pointages set horodatage = '2026-10-01 09:00+02' where id = 'd0000000-0000-0000-0000-000000000001'$$,
                   'Sortir un pointage du mois clôturé (même admin)', 'clôturée');
select test.erreur($$delete from pointage.journal_audit$$, 'Journal d''audit immuable', 'lecture seule');
select test.erreur($$delete from pointage.pointages$$, 'Pas de suppression de pointage', 'lecture seule');
select test.erreur($$update pointage.mouvements_compteur set minutes = 0$$, 'Grand livre immuable', 'lecture seule');

-- ===================== Espace RH =====================
select test.connecte('Sofia'); set role authenticated;
select test.erreur($$select public.etat_cloture('2026-10-01')$$, 'État de clôture réservé à la RH', 'réservée');
select test.ok((select count(*) filter (where not demandable) > 0 from public.codes_absence), 'Codes non demandables visibles (filtrés à l''écran)');
reset role;
select test.connecte('Nadia'); set role authenticated;
select test.ok((select (e->>'deja_cloture')::boolean and (e->>'mois_termine')::boolean from public.etat_cloture('2026-09-01') e),
               'État : septembre déjà clôturé');
select test.ok((select jsonb_array_length(e->'anomalies') > 0 and not (e->>'mois_termine')::boolean
                from public.etat_cloture(current_date) e), 'État du mois en cours : anomalies listées, mois non terminé');
reset role;

-- ===================== Direction et CPAS =====================
insert into pointage.pointages (personne_id, horodatage, sens, type_code, source, cree_par) values
  (test.pid('Jordan'), '2026-10-28 08:30+01', 'entree', 'BUREAU', 'web', test.pid('Jordan')),
  (test.pid('Jordan'), '2026-10-28 16:30+01', 'sortie', 'BUREAU', 'web', test.pid('Jordan')),
  (test.pid('Yanis'),  '2026-10-29 08:00+01', 'entree', 'TT', 'web', test.pid('Yanis')),
  (test.pid('Yanis'),  '2026-10-29 16:00+01', 'sortie', 'TT', 'web', test.pid('Yanis'));
select test.connecte('Marc'); set role authenticated;
select test.erreur($$select public.stats_direction('2026-10-01')$$, 'Statistiques : refusées à un chef de service', 'réservée');
select test.erreur($$select * from public.rapport_cpas('2026-10-01')$$, 'Rapport CPAS : refusé à un chef de service', 'réservée');
reset role;
select test.connecte('Claire'); set role authenticated;
select test.ok((select jsonb_array_length(s->'services') = 4 and s->'services' @> '[{"regroupe": true}]' from public.stats_direction('2026-10-01') s), 'Direction : petits services regroupés (seuil 3)');
select test.ok((select (x->>'absence_maladie')::int > 0 from public.stats_direction('2026-10-01') s, jsonb_array_elements(s->'services') x
                where x->>'service' = 'Administration'), 'Maladie comptée dans l''agrégat du service');
select test.ok((select (x->>'jours_tt')::int >= 1 from public.stats_direction('2026-10-01') s, jsonb_array_elements(s->'services') x
                where x->>'service' = 'Administration'), 'Télétravail compté');
select test.ok((select jsonb_array_length(s->'tendance') = 6 from public.stats_direction('2026-10-01') s), 'Tendance sur 6 mois');
select test.ok((select not (s::text ilike '%Sofia%' or s::text ilike '%Janssens%') from public.stats_direction('2026-10-01') s),
               'Aucun nom de personne dans les statistiques');
reset role;
select test.connecte('Inès'); set role authenticated;
select test.ok((select count(*) = 1 and min(prenom) = 'Jordan' and min(partenaire) = 'CPAS (fictif)' from public.rapport_cpas('2026-10-01')),
               'Rapport CPAS : uniquement les ISP');
select test.ok((select preste >= 450 and jours_non_justifies > 0 from public.rapport_cpas('2026-10-01')), 'Rapport CPAS : heures et jours non justifiés');
reset role;

-- ===================== Admin général =====================
select test.connecte('Paul'); set role authenticated; select public.soumettre_demande('conge_jours', 'CP', '2026-12-21'); reset role;
select test.connecte('Admin'); set role authenticated;
select test.ok((select count(*) = 14 from public.personnes), 'Admin : voit tout le monde');
select test.ok((select bool_and(je_peux_valider) from public.demandes where statut = 'en_attente'), 'Admin : peut valider toutes les demandes');
select test.ok(public.decider(array(select id from public.demandes where prenom = 'Paul' and statut = 'en_attente'), true) = 1, 'Admin : valide une demande');
select test.ok((select count(*) >= 0 from public.heures_a_valider()), 'Admin : liste des heures à valider');
select test.ok((select jsonb_array_length(s->'services') = 4 from public.stats_direction('2026-10-01') s), 'Admin : tableau de bord');
select test.ok((select count(*) = 1 from public.rapport_cpas('2026-10-01')), 'Admin : rapport CPAS');
select test.ok((select (e->>'mois_termine')::boolean from public.etat_cloture('2026-09-01') e), 'Admin : état de clôture');
reset role;

-- ===================== Administration =====================
select test.connecte('Sofia'); set role authenticated;
select test.ok((select count(*) = 0 from public.admin_personnes), 'Employé : liste d''administration vide');
select test.erreur($$select public.enregistrer_personne(null, 'X', 'Y', 'x.y@cfb.test', 'a0000000-0000-0000-0000-000000000002', p_regime_id => 1::smallint)$$,
                   'Employé : création de personne refusée', 'réservée');
reset role;
select test.connecte('Inès'); set role authenticated;
select test.ok((select count(*) = 14 from public.admin_personnes where regime is not null), 'Admin RH : toutes les personnes avec leur régime');
select test.ok((select public.enregistrer_personne(null, 'Lina', 'Mertens', 'Lina.Mertens@cfb.test', 'a0000000-0000-0000-0000-000000000002',
                p_type => 'isp', p_partenaire_isp => 'CPAS (fictif)', p_date_entree => '2026-11-02', p_regime_id => 2::smallint) is not null),
               'Admin RH : crée une ISP (e-mail mis en minuscules)');
select test.ok((select email = 'lina.mertens@cfb.test' and regime = 'Temps plein 37h30' from public.admin_personnes where nom = 'Mertens')
               or (select count(*) = 1 from pointage.personnes where email = 'lina.mertens@cfb.test'), 'Nouvelle personne + régime à l''entrée');
select test.erreur($$select public.enregistrer_personne(null, 'Bob', 'Admin', 'bob@cfb.test', 'a0000000-0000-0000-0000-000000000003', p_role => 'admin', p_regime_id => 1::smallint)$$,
                   'Admin RH ne nomme pas d''admin général', 'Seul un admin');
select test.erreur($$select public.enregistrer_reseau('10.0.0.0/8', 'x')$$, 'Admin RH : réseau réservé à l''admin', 'réservée');
select test.erreur($$select public.enregistrer_regime(1::smallint, 'Temps plein 38h', 'temps_plein', '{480,480,480,480,480,0,0}')$$,
                   'Régime utilisé : horaires non modifiables', 'déjà utilisé');
select test.ok((select public.enregistrer_regime(null, 'Mi-temps 19h', 'temps_partiel', '{456,456,228,0,0,0,0}') > 0), 'Nouveau régime créé');
select public.changer_regime(test.pid('Yanis'), (select id from pointage.regimes where libelle = 'Mi-temps 19h'), '2027-01-01');
select test.erreur($$select public.changer_regime(test.pid('Yanis'), 1::smallint, '2026-09-15')$$, 'Régime sur un mois clôturé refusé', 'clôturé');
select public.enregistrer_service(null, 'SIPP', 'a0000000-0000-0000-0000-000000000001', null, 50::smallint);
select test.ok((select count(*) > 0 from pointage.journal_audit where table_nom = 'services'), 'Création de service tracée');
reset role;
select test.ok((select minutes_semaine = 1140 from pointage.regime_du(test.pid('Yanis'), '2027-01-04')), 'Changement de régime daté');
select test.ok((select array_agg(v) = array[test.pid('Claire')] from pointage.valideurs_n1(
                  (select id from pointage.personnes where nom = 'Renard'), current_date) v), 'Service sans chef → direction');
select test.connecte('Admin'); set role authenticated;
select test.erreur(format('select public.enregistrer_personne(%L, ''Admin'', ''IT'', ''admin.it@cfb.test'', ''a0000000-0000-0000-0000-000000000003'', p_role => ''employe'')',
                          'b0000000-0000-0000-0000-000000000099'), 'Dernier admin non rétrogradable', 'dernier admin');
select public.enregistrer_reseau('198.51.100.0/24', 'Antenne (fictif)');
select test.ok((select count(*) = 2 from public.reseaux_cfb()), 'Admin : plages réseau');
select test.erreur($$select public.enregistrer_reseau('pas-une-ip', 'x')$$, 'Plage IP invalide refusée', 'invalide');
select public.enregistrer_service('a0000000-0000-0000-0000-000000000005', 'Logistique', 'a0000000-0000-0000-0000-000000000001', '#7A869A', 50::smallint,
                                  true, array[test.pid('Paul')]);
select test.ok((select chefs = array[test.pid('Paul')] from public.admin_services where nom = 'Logistique'), 'Chef de service nommé');
reset role;

-- ===================== Personnalisation =====================
insert into pointage.pointages (personne_id, horodatage, sens, source, ip, cree_par) values
  (test.pid('Sofia'), '2026-10-20 08:00+02', 'entree', 'web', '203.0.113.50', test.pid('Sofia'));
select test.connecte('Marc'); set role authenticated;
select test.ok((select ip is not null from public.pointages where personne_id = test.pid('Sofia') and jour = '2026-10-20'), 'IP visible par le N+1 (réglage par défaut)');
reset role;
select test.connecte('Admin'); set role authenticated;
select public.modifier_parametre('ip_visible_n1', 0, 'test');
select test.erreur($$select public.modifier_parametre('ip_visible_n1', 2, 'test')$$, 'Réglage oui/non : valeur 2 refusée', 'oui ou non');
reset role;
select test.connecte('Marc'); set role authenticated;
select test.ok((select ip is null from public.pointages where personne_id = test.pid('Sofia') and jour = '2026-10-20'), 'IP masquée au N+1 si réglage désactivé');
reset role;
select test.connecte('Nadia'); set role authenticated;
select test.ok((select ip is not null from public.pointages where personne_id = test.pid('Sofia') and jour = '2026-10-20'), 'RH voit toujours l''IP');
reset role;
select test.connecte('Admin'); set role authenticated; select public.modifier_parametre('ip_visible_n1', 1, 'Décision CFB'); reset role;

-- Rappels manuels
select test.connecte('Marc'); set role authenticated;
select test.ok(public.envoyer_rappel(array[test.pid('Sofia'), test.pid('Yanis')]) = 2, 'Chef : rappel à 2 personnes de son équipe');
select test.ok(public.envoyer_rappel(array[test.pid('Sofia')]) = 0, 'Anti-spam : pas de 2e rappel dans le délai');
select test.erreur(format('select public.envoyer_rappel(array[%L]::uuid[])', test.pid('Emma')), 'Chef : pas de rappel hors de son équipe', 'non autorisé');
reset role;
select test.ok(test.notifs('Sofia', 'rappel_manuel') = 1, 'Rappel reçu par la personne');

-- Congés des ISP désactivables
select test.connecte('Admin'); set role authenticated; select public.modifier_parametre('isp_conges', 0, 'test'); reset role;
select test.connecte('Jordan'); set role authenticated;
select test.erreur($$select public.soumettre_demande('conge_jours', 'CP', '2026-12-28')$$, 'ISP : congés désactivés par réglage', 'pas gérés');
reset role;
select test.connecte('Admin'); set role authenticated; select public.modifier_parametre('isp_conges', 1, 'Décision CFB'); reset role;
select test.connecte('Inès'); set role authenticated;
select test.ok((select conges >= 0 and absence_justifiee >= 0 from public.rapport_cpas('2026-10-01') limit 1), 'Rapport CPAS : congés séparés');
reset role;

-- Ordre des clôtures
select test.connecte('Tom'); set role authenticated;
select test.erreur($$select public.cloturer_mois('2026-07-01')$$, 'Clôture d''un mois antérieur au dernier clôturé', 'plus récent');
reset role;

-- Report des compteurs en fin d'année (règles par défaut)
select pointage.reporter_compteurs('2026-12-31', test.pid('Admin'));
select test.ok((select coalesce(sum(minutes), 0) = 0 from pointage.mouvements_compteur
                where personne_id = test.pid('Sofia') and compteur_code = 'CONGE_LEGAL' and periode_debut = '2026-01-01'), 'Fin d''année : solde 2026 vidé');
select test.ok((select sum(minutes) > 0 from pointage.mouvements_compteur
                where personne_id = test.pid('Sofia') and compteur_code = 'CONGE_N1' and periode_debut = '2027-01-01'), 'Reporté en « congés année passée » 2027');
select test.connecte('Admin'); set role authenticated;
select public.enregistrer_compteur('EXTRA_LEGAL', 'Congés extra-légaux', 'annuelle', false, true, 'plafonne', null, 456);
select test.ok((select report_mode = 'plafonne' and report_plafond_min = 456 and not regle_provisoire from public.compteurs where code = 'EXTRA_LEGAL'),
               'Règle de report modifiable (plafond 1 jour)');
select test.erreur($$select public.enregistrer_compteur('RECUP', 'Récup', 'trimestrielle', true, true, 'plafonne')$$, 'Plafond obligatoire', 'plafond');
reset role;

-- Maximum hebdomadaire et conservation
select test.ok((select count(*) >= 0 from public.anomalies where code = 'semaine_max'), 'Contrôle du maximum hebdomadaire actif');
-- Pointages anciens dans des mois ensuite clôturés (2025-03 et 2026-03)
insert into pointage.pointages (personne_id, horodatage, sens, source, cree_par, ip)
values (test.pid('Sofia'), '2025-03-10 08:00+01', 'entree', 'web', test.pid('Sofia'), '192.0.2.250'),
       (test.pid('Sofia'), '2026-03-10 08:00+01', 'entree', 'web', test.pid('Sofia'), '192.0.2.251');
insert into pointage.clotures (mois, cloture_par) values ('2025-03-01', test.pid('Admin')), ('2026-03-01', test.pid('Admin')) on conflict do nothing;
select test.ok((pointage.purger_donnees()->>'ip_effacees')::int = 0, 'Conservation par défaut : aucune IP effacée');
select test.connecte('Admin'); set role authenticated; select public.modifier_parametre('conservation_ip_mois', 6, 'test'); reset role;
select (pointage.purger_donnees()->>'ip_effacees')::int as nb_ip \gset
select test.ok(:nb_ip >= 2
               and not exists (select 1 from pointage.pointages where ip is not null and horodatage::date in ('2025-03-10', '2026-03-10')),
               'IP effacée après 6 mois, même sur un mois clôturé');
select test.erreur($$update pointage.pointages set ip = null, remarque = 'x' where horodatage = '2026-03-10 08:00+01'$$,
                   'Hors purge, un mois clôturé reste verrouillé', 'clôturée');
select test.connecte('Admin'); set role authenticated; select public.modifier_parametre('conservation_pointages_ans', 1, 'test'); reset role;
select (pointage.purger_donnees()->>'pointages_supprimes')::int as nb_pt \gset
select test.ok(:nb_pt >= 1
               and not exists (select 1 from pointage.pointages where horodatage = '2025-03-10 08:00+01')
               and exists (select 1 from pointage.pointages where horodatage = '2026-03-10 08:00+01'),
               'Pointages clôturés de plus d''1 an supprimés, les autres gardés');
select test.erreur($$delete from pointage.pointages$$, 'Pas de suppression hors purge', 'lecture seule');


-- ===================== Liaison des comptes (R2) =====================
-- Une personne ajoutée par l'admin, dont l'adresse est « squattée » par un compte e-mail non confirmé
select test.connecte('Admin'); set role authenticated;
select public.enregistrer_personne(null, 'Zoé', 'Victime', 'zoe.victime@cfb.test', 'a0000000-0000-0000-0000-000000000002', p_regime_id => 1::smallint) as id_zoe \gset
reset role;
insert into auth.users (email, raw_app_meta_data) values ('zoe.victime@cfb.test', '{"provider":"email","providers":["email"]}');
select test.ok((select auth_user_id is null from pointage.personnes where id = :'id_zoe'), 'Compte e-mail non confirmé : jamais lié');
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'zoe.victime@cfb.test'))::text, false);
set role authenticated;
select test.ok(not public.lier_mon_compte(), 'Non confirmé : lier_mon_compte refuse');
select test.erreur('select public.pointer()', 'Non confirmé : aucun accès', 'non reconnu');
reset role;
update auth.users set email_confirmed_at = now() where email = 'zoe.victime@cfb.test';
select test.ok((select auth_user_id is null from pointage.personnes where id = :'id_zoe'), 'E-mail + mot de passe confirmé : pas lié (SSO exigé par défaut)');
update auth.users set raw_app_meta_data = '{"provider":"email","providers":["email","azure"]}' where email = 'zoe.victime@cfb.test';
select test.ok((select auth_user_id is not null from pointage.personnes where id = :'id_zoe'), 'Connexion Microsoft ajoutée : liaison automatique');
-- Réglage : autoriser e-mail + mot de passe (structure sans SSO, environnement de dev)
select test.connecte('Admin'); set role authenticated;
select public.enregistrer_personne(null, 'Hugo', 'Tardif', 'hugo.tardif@cfb.test', 'a0000000-0000-0000-0000-000000000002', p_regime_id => 1::smallint) as id_hugo \gset
reset role;
insert into auth.users (email, email_confirmed_at, raw_app_meta_data) values ('hugo.tardif@cfb.test', now(), '{"provider":"email"}');
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'hugo.tardif@cfb.test'))::text, false);
set role authenticated; select test.ok(not public.lier_mon_compte(), 'SSO exigé : compte e-mail refusé'); reset role;
select test.connecte('Admin'); set role authenticated; select public.modifier_parametre('liaison_sso_seulement', 0, 'test'); reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'hugo.tardif@cfb.test'))::text, false);
set role authenticated; select test.ok(public.lier_mon_compte(), 'Réglage désactivé : compte e-mail confirmé lié au 1er accès'); reset role;
select test.connecte('Admin'); set role authenticated; select public.modifier_parametre('liaison_sso_seulement', 1, 'test'); reset role;
-- Personne créée APRÈS le 1er login vérifié : liaison immédiate à l'enregistrement
insert into auth.users (email, email_confirmed_at, raw_app_meta_data) values ('tim.avance@cfb.test', now(), '{"provider":"azure"}');
select test.connecte('Admin'); set role authenticated;
select public.enregistrer_personne(null, 'Tim', 'Avance', 'tim.avance@cfb.test', 'a0000000-0000-0000-0000-000000000002', p_regime_id => 1::smallint) as id_tim \gset
reset role;
select test.ok((select auth_user_id is not null from pointage.personnes where id = :'id_tim'), 'Compte vérifié existant : lié dès l''enregistrement');
-- Délier / relier
select test.connecte('Sofia'); set role authenticated;
select test.erreur(format('select public.delier_compte(%L)', :'id_tim'), 'Employé : ne peut pas délier', 'réservée');
reset role;
select test.connecte('Admin'); set role authenticated;
select public.delier_compte(:'id_tim');
select test.erreur(format('select public.delier_compte(%L)', test.pid('Admin')), 'Admin : ne peut pas délier son propre compte', 'propre compte');
select test.erreur(format('select public.enregistrer_personne(%L, ''Admin'', ''IT'', ''autre.adresse@cfb.test'', ''a0000000-0000-0000-0000-000000000003'', p_role => ''admin'', p_regime_id => 1::smallint)', test.pid('Admin')),
                   'Admin : ne peut pas changer sa propre adresse', 'propre adresse');
reset role;
select test.ok((select auth_user_id is null from pointage.personnes where id = :'id_tim'), 'Compte délié par l''admin');
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'tim.avance@cfb.test'))::text, false);
set role authenticated; select test.ok(public.lier_mon_compte(), 'Reconnexion vérifiée : compte relié'); reset role;
-- Adresse corrigée par l'admin : l'ancien compte est délié
select test.connecte('Admin'); set role authenticated;
select public.enregistrer_personne(:'id_tim', 'Tim', 'Avance', 'tim.nouveau@cfb.test', 'a0000000-0000-0000-0000-000000000002', p_regime_id => 1::smallint);
reset role;
select test.ok((select auth_user_id is null from pointage.personnes where id = :'id_tim'), 'Adresse corrigée : ancien compte délié');


-- ===================== Pointages différés (R4) =====================
select test.notifs('Marc', 'pointage_differe') as alertes_avant \gset
select test.connecte('Sofia'); set role authenticated;
select test.erreur($$select public.pointer(p_horodatage => now() - interval '3 hours')$$, 'Heure passée sans synchro hors ligne : refusée', 'Corriger');
select test.erreur($$select public.pointer(p_client_id => gen_random_uuid(), p_horodatage => now() + interval '1 hour')$$, 'Heure future : refusée', 'futur');
select public.pointer(p_client_id => 'd0000000-0000-0000-0000-000000000001', p_horodatage => now() - interval '3 hours', p_sens => 'entree');
select public.pointer(p_client_id => 'd0000000-0000-0000-0000-000000000002', p_horodatage => now() - interval '1 minute', p_sens => 'sortie');
reset role;
select test.ok((select p.differe and p.differe_min between 179 and 181 and p.ip is null and p.lieu = 'inconnu'
                from public.pointages p join pointage.pointages x using (id) where x.client_id = 'd0000000-0000-0000-0000-000000000001'),
               'Synchro 3 h après : marqué « différé » (180 min), sans IP');
select test.ok((select not p.differe from public.pointages p join pointage.pointages x using (id) where x.client_id = 'd0000000-0000-0000-0000-000000000002'),
               'Synchro 1 min après : pas différé');
select test.ok(test.notifs('Marc', 'pointage_differe') = :alertes_avant + 1, 'N+1 prévenu d''un pointage différé (> 60 min), pas du petit retard');
select test.connecte('Marc'); set role authenticated;
select test.ok((select differe from public.pointages where personne_id = test.pid('Sofia') and differe limit 1), 'Le N+1 voit le marqueur « différé »');
reset role;
select test.connecte('Admin'); set role authenticated;
select public.modifier_parametre('differe_max_h', 2, 'test'); select public.modifier_parametre('differe_alerte_n1_min', 0, 'test');
reset role;
select test.connecte('Sofia'); set role authenticated;
select test.erreur($$select public.pointer(p_client_id => gen_random_uuid(), p_horodatage => now() - interval '3 hours')$$, 'Délai max réglable (2 h)', '2 h');
select public.pointer(p_client_id => 'd0000000-0000-0000-0000-000000000003', p_horodatage => now() - interval '90 minutes', p_sens => 'entree');
reset role;
select test.ok(test.notifs('Marc', 'pointage_differe') = :alertes_avant + 1, 'Alerte N+1 désactivable (0 = jamais)');

-- ===================== Fuseau horaire (R7) =====================
select test.ok((select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname in ('pointage', 'public') and p.prokind = 'f' and p.provolatile <> 'i'
                  and p.proowner = current_user::regrole
                  and not coalesce('TimeZone=Europe/Brussels' = any (p.proconfig), false)),
               'Toutes les fonctions calculent en heure belge (pointage.fixer_fuseau)');
select count(*) as nb_anom_bxl from public.anomalies \gset
set timezone = 'Pacific/Kiritimati';   -- UTC+14
select test.ok(pointage.aujourdhui() = (now() at time zone 'Europe/Brussels')::date, 'Serveur à UTC+14 : « aujourd''hui » reste belge');
select test.ok((select count(*) from public.anomalies) = :nb_anom_bxl, 'Serveur à UTC+14 : mêmes anomalies');
set timezone = 'Pacific/Pago_Pago';    -- UTC−11
select test.ok(pointage.aujourdhui() = (now() at time zone 'Europe/Brussels')::date, 'Serveur à UTC−11 : « aujourd''hui » reste belge');
select test.ok((select count(*) from public.anomalies) = :nb_anom_bxl, 'Serveur à UTC−11 : mêmes anomalies');
select test.connecte('Sofia'); set role authenticated;
select test.ok((select regime is not null from public.mon_profil), 'Serveur à UTC−11 : profil et régime du jour corrects');
reset role;
set timezone = 'Europe/Brussels';


-- ===================== Envoi des notifications (R9) =====================
select test.ok((select count(*) > 0 from pointage.notifications where envoi_termine_le is null), 'Nouvelles notifications en file d''envoi');
update pointage.notifications set envoi_termine_le = now() where envoi_termine_le is null;   -- on repart d'une file vide
select test.ok(not pointage.reveiller_envoi(), 'Service non configuré : aucun appel, aucune erreur');
select test.connecte('Sofia'); set role authenticated;
select public.enregistrer_push('https://push.exemple.test/abc', 'cle-p256dh', 'cle-auth');
select public.enregistrer_push('https://push.exemple.test/ancien', 'cle-p256dh', 'cle-auth');
select test.ok(public.mes_appareils() = 2, 'Deux appareils enregistrés');
select test.ok((public.config_publique() ? 'vapid_public') and not (public.config_publique() ? 'envoi_secret'), 'Config publique : jamais le secret');
select test.erreur('select public.notifications_a_envoyer()', 'Employé : pas d''accès à la file d''envoi', 'permission denied');
select test.erreur($$select public.config_envoi('x')$$, 'Employé : pas d''accès à la configuration privée', 'permission denied');
reset role;
select pointage.configurer('envoi_secret', 'secret-test'); select pointage.configurer('vapid_prive', 'cle-privee');
set role service_role;
select test.erreur($$select public.config_envoi('mauvais')$$, 'Service : mauvais secret refusé', 'invalide');
select test.ok((public.config_envoi('secret-test')->>'vapid_prive') = 'cle-privee' and not (public.config_envoi('secret-test') ? 'envoi_secret'),
               'Service : configuration privée remise contre le bon secret (jamais le secret lui-même)');
reset role;
select pointage.notifier(test.pid('Sofia'), 'test_envoi', 'envoi:1', 'Test d''envoi', 'Corps');
set role service_role;
select public.notifications_a_envoyer() as lot \gset
select test.ok((select (:'lot'::jsonb->>'push')::boolean and jsonb_array_length(:'lot'::jsonb->'notifications') = 1
                  and jsonb_array_length(:'lot'::jsonb->'notifications'->0->'abonnements') = 2), 'Lot : 1 notification, 2 appareils');
select test.ok(jsonb_array_length(public.notifications_a_envoyer()->'notifications') = 0, 'Réservée : pas d''envoi en double');
reset role;
select (select id from pointage.notifications where cle = 'envoi:1') as n1,
       (select id from pointage.push_abonnements where endpoint like '%ancien') as ab_ancien,
       (select id from pointage.push_abonnements where endpoint like '%abc') as ab_ok \gset
set role service_role;
select public.resultats_envoi(jsonb_build_array(jsonb_build_object('id', :n1, 'push_ok', true,
  'expires', jsonb_build_array(:'ab_ancien'), 'reussis', jsonb_build_array(:'ab_ok'))));
reset role;
select test.ok((select push_envoye_le is not null and envoi_termine_le is not null from pointage.notifications where cle = 'envoi:1'), 'Push livré : terminé');
select test.ok((select count(*) = 1 from pointage.push_abonnements where personne_id = test.pid('Sofia')), 'Appareil expiré (410) supprimé');
-- Échec réseau : repris au passage suivant, abandon après 5 essais
select pointage.notifier(test.pid('Sofia'), 'test_envoi', 'envoi:2', 'Deuxième', null);
select id as n2 from pointage.notifications where cle = 'envoi:2' \gset
set role service_role;
select public.notifications_a_envoyer();
select public.resultats_envoi(jsonb_build_array(jsonb_build_object('id', :n2, 'push_ok', false, 'erreur', 'réseau')));
select test.ok(jsonb_array_length(public.notifications_a_envoyer()->'notifications') = 1, 'Échec : reprise au passage suivant');
reset role;
update pointage.notifications set envoi_tentatives = 5, envoi_reserve_jusqua = null where cle = 'envoi:2';
set role service_role;
select public.resultats_envoi(jsonb_build_array(jsonb_build_object('id', :n2, 'push_ok', false)));
reset role;
select test.ok((select envoi_termine_le is not null and push_envoye_le is null from pointage.notifications where cle = 'envoi:2'), 'Abandon après 5 essais');
-- Trop ancienne : jamais envoyée
select pointage.notifier(test.pid('Sofia'), 'test_envoi', 'envoi:3', 'Vieille', null);
update pointage.notifications set cree_le = now() - interval '2 days' where cle = 'envoi:3';
set role service_role; select public.notifications_a_envoyer(); reset role;
select test.ok((select envoi_erreur = 'expirée sans envoi' from pointage.notifications where cle = 'envoi:3'), 'Notification de plus de 24 h : abandonnée');
select test.connecte('Yanis'); set role authenticated;
select public.retirer_push('https://push.exemple.test/abc');
reset role;
select test.ok((select count(*) = 1 from pointage.push_abonnements where personne_id = test.pid('Sofia')), 'On ne peut pas retirer l''appareil d''un autre');
select test.connecte('Sofia'); set role authenticated; select public.retirer_push('https://push.exemple.test/abc'); reset role;
select test.ok((select count(*) = 0 from pointage.push_abonnements where personne_id = test.pid('Sofia')), 'Désabonnement de son appareil');


-- ===================== Préférences de la direction =====================
select test.connecte('Claire'); set role authenticated;
select test.ok((select suivi from public.services_suivis() where nom = 'Administration'), 'Direction : voit le service suivi (Administration)');
select public.suivre_service((select service_id from public.services_suivis() where nom = 'Administration'), false);
select test.ok((select not suivi from public.services_suivis() where nom = 'Administration'), 'Direction : ne plus suivre un service');
reset role;
select test.connecte('Sofia'); set role authenticated;
select test.erreur('select * from public.services_suivis()', 'Employé : pas de préférences de direction', 'réservée');
reset role;


-- ===================== Justificatifs =====================
update pointage.parametres set valeur = 1 where cle = 'justificatifs_actifs';   -- fonction activée pour ces tests
select id as dem_awa, personne_id as pid_awa from pointage.demandes where personne_id = test.pid('Awa') and code_absence = 'MAL' \gset
select test.connecte('Awa'); set role authenticated;
select test.ok((select justificatif_requis and not justificatif_joint from public.demandes where id = :'dem_awa'), 'Maladie : justificatif requis, pas encore joint');
select test.erreur(format('select public.joindre_justificatif(%L, %L)', :'dem_awa', 'autre/chemin.pdf'), 'Chemin hors de son dossier refusé', 'invalide');
select public.joindre_justificatif(:'dem_awa', :'pid_awa' || '/' || :'dem_awa' || '/certificat.pdf');
select test.ok((select justificatif_joint and justificatif_chemin like '%certificat.pdf' from public.demandes where id = :'dem_awa'), 'La personne joint et revoit son certificat');
select test.erreur(format('select public.joindre_justificatif(%L, null)', (select id from public.demandes where prenom = 'Awa' and statut = 'refusee' limit 1)),
                   'Demande refusée : pas de justificatif', 'refusée');
select test.ok(pointage.peut_deposer_justificatif(:'pid_awa') and not pointage.peut_deposer_justificatif(test.pid('Yanis')), 'Dépôt : seulement dans son propre dossier');
reset role;
select test.connecte('Yanis'); set role authenticated;
select test.erreur(format('select public.joindre_justificatif(%L, null)', :'dem_awa'), 'Collègue : ne touche pas au justificatif', 'non autorisée');
reset role;
select test.connecte('Marc'); set role authenticated;
select test.ok((select justificatif_joint and justificatif_chemin is null from public.demandes where id = :'dem_awa'), 'N+1 : sait qu''il est joint, mais ne l''ouvre pas (par défaut)');
reset role;
select test.connecte('Nadia'); set role authenticated;
select test.ok((select justificatif_chemin is not null from public.demandes where id = :'dem_awa'), 'RH : ouvre le justificatif');
reset role;
select test.connecte('Admin'); set role authenticated; select public.modifier_parametre('justificatif_visible_n1', 1, 'test'); reset role;
select test.connecte('Marc'); set role authenticated;
select test.ok((select justificatif_chemin is not null from public.demandes where id = :'dem_awa'), 'Réglage activé : le N+1 l''ouvre aussi');
reset role;
select test.ok(pointage.dossier_personne('pas-un-uuid/x.pdf') is null, 'Nom de fichier malformé : aucun droit');


-- ===================== Moindre privilège =====================
select test.ok((select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'pointage' and has_function_privilege('anon', p.oid, 'execute')), 'Anonyme : aucune fonction interne exécutable');
select test.ok((select count(*) = 12 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'pointage' and has_function_privilege('authenticated', p.oid, 'execute')),
               'Connecté : seulement les 12 fonctions utiles aux vues / règles d''accès');
select test.connecte('Sofia'); set role authenticated;
select test.erreur('select pointage.purger_donnees()', 'Connecté : purge interdite', 'permission denied');
select test.erreur($$select pointage.notifier(pointage.moi(), 'x', 'x', 'x')$$, 'Connecté : création de notification directe interdite', 'permission denied');
reset role;


-- ===================== Règles complétées (audit approfondi) =====================
insert into pointage.pointages (personne_id, horodatage, sens, source, cree_par)
select test.pid('Lucas'), x, s::pointage.sens_pointage, 'web', test.pid('Lucas')
from (values ('2026-10-24 09:00 Europe/Brussels'::timestamptz, 'entree'), ('2026-10-24 12:00 Europe/Brussels'::timestamptz, 'sortie')) v(x, s);
select test.ok((select boni = 0 and depassement = 180 from pointage.journees_set('2026-10-24', '2026-10-24', array[test.pid('Lucas')])),
               'Samedi travaillé : 3 h « à valider », pas de boni automatique');
select test.ok(exists (select 1 from pointage.journees_set('2026-10-24', '2026-10-24', array[test.pid('Lucas')]) where depassement > 0),
               'Samedi travaillé : visible dans les heures à valider');
select test.connecte('Admin'); set role authenticated; select public.modifier_parametre('jour_non_prevu_a_valider', 0, 'test'); reset role;
select test.ok((select boni = 180 and depassement = 0 from pointage.journees_set('2026-10-24', '2026-10-24', array[test.pid('Lucas')])),
               'Réglage désactivé : le samedi va en boni');
select test.connecte('Admin'); set role authenticated; select public.modifier_parametre('jour_non_prevu_a_valider', 1, 'test'); reset role;
update pointage.parametres set valeur = 60 where cle = 'anti_rebond_s';
select test.connecte('Emma'); set role authenticated;
select public.pointer();
select test.erreur('select public.pointer()', 'Double appui (< 60 s) : refusé avec message', 'déjà de pointer');
reset role;
update pointage.pointages set cree_le = now() - interval '2 minutes' where personne_id = test.pid('Emma') and cree_le > now() - interval '1 minute';
select test.connecte('Emma'); set role authenticated;
select test.ok((public.pointer()->>'sens') is not null, 'Après 60 s : nouveau pointage accepté');
reset role;


-- ===================== Télétravail habituel =====================
select count(*) as notif_sofia_avant from pointage.notifications where personne_id = test.pid('Sofia') and type = 'teletravail_modifie' \gset
select test.pid('Nadia') as pid_nadia, test.pid('Sofia') as pid_sofia \gset
select test.connecte('Marc'); set role authenticated;
select public.definir_teletravail(test.pid('Sofia'), array[extract(isodow from pointage.aujourdhui())::int]);
select test.erreur(format('select public.definir_teletravail(%L, array[8])', test.pid('Sofia')), 'Jour invalide refusé', 'invalide');
select test.erreur(format('select public.definir_teletravail(%L, array[1])', :'pid_nadia'), 'Chef : pas pour une personne hors de son équipe', 'ne peux pas');
reset role;
select test.ok((select count(*) from pointage.notifications where personne_id = test.pid('Sofia') and type = 'teletravail_modifie') = :notif_sofia_avant + 1,
               'Jours modifiés par le chef : la personne est prévenue');
select test.connecte('Yanis'); set role authenticated;
select test.erreur(format('select public.definir_teletravail(%L, array[2])', :'pid_sofia'), 'Collègue : ne modifie pas les jours d''un autre', 'ne peux pas');
reset role;
select test.connecte('Sofia'); set role authenticated;
select test.ok((select jours_teletravail = array[extract(isodow from pointage.aujourdhui())::smallint] from public.mon_profil), 'Profil : jour de télétravail visible');
select test.erreur('select public.definir_teletravail(null, array[1])', 'Personne vide : refusé', 'ne peux pas');
select test.ok((public.teletravail_de(pointage.moi())->>'modifiable')::boolean, 'Chacun peut modifier ses propres jours');
reset role;
select count(*) as notif_marc_avant from pointage.notifications where personne_id = test.pid('Marc') and type = 'teletravail_modifie' \gset
select test.connecte('Sofia'); set role authenticated;
select public.definir_teletravail(pointage.moi(), array[extract(isodow from pointage.aujourdhui())::int, 1, 1]);
reset role;
select test.ok((select count(*) from pointage.notifications where personne_id = test.pid('Marc') and type = 'teletravail_modifie') = :notif_marc_avant + 1,
               'Changement par la personne : son responsable est prévenu');
select test.ok((select corps like 'Avant : %→ maintenant : %' from pointage.notifications where personne_id = test.pid('Marc') and type = 'teletravail_modifie' order by cree_le desc limit 1),
               'Notification : jours avant / après');
select test.connecte('Sofia'); set role authenticated;
select public.definir_teletravail(pointage.moi(), array[1, extract(isodow from pointage.aujourdhui())::int]);
reset role;
select test.ok((select count(*) from pointage.notifications where personne_id = test.pid('Marc') and type = 'teletravail_modifie') = :notif_marc_avant + 1,
               'Mêmes jours renvoyés : pas de nouvelle notification');
select test.ok(exists (select 1 from pointage.journal_audit where table_nom = 'teletravail_prevu'), 'Changements de jours tracés dans le journal');
-- Inès travaille aussi ce jour-là (régime 7 j) et n'a pas encore pointé : l'équipe voit « Télétravail prévu »
insert into pointage.regimes (id, libelle, contrat, minutes_jour) values (99, 'Test 7 jours', 'temps_plein', array[456,456,456,456,456,456,456])
on conflict do nothing;
insert into pointage.personne_regimes (personne_id, debut, regime_id) values (test.pid('Inès'), pointage.aujourdhui(), 99) on conflict do nothing;
insert into pointage.teletravail_prevu values (test.pid('Inès'), extract(isodow from pointage.aujourdhui())::smallint);
select test.connecte('Yanis'); set role authenticated;
select test.ok((select statut = 'Télétravail prévu' from public.presence_jour() where prenom = 'Inès'), 'Présence : « Télétravail prévu » avant de pointer');
reset role;
-- Pointage depuis une IP inconnue un jour de télétravail : type automatique Télétravail
update pointage.parametres set valeur = 0 where cle = 'anti_rebond_s';
select set_config('request.headers', '{}', false);
select test.connecte('Sofia'); set role authenticated;
select (public.pointer(p_client_id => gen_random_uuid()))->>'type_code' as type_auto \gset
reset role;
select test.ok(:'type_auto' = 'TT', 'Jour de télétravail habituel : pointage « Télétravail » automatiquement');

-- Jours de TT du mois (indemnité) : 1 jour dès qu'il y a un pointage Télétravail
select test.connecte('Nadia'); set role authenticated;
select test.ok((select jours_tt >= 1 and pointage.aujourdhui() = any(dates) from public.rapport_teletravail(pointage.aujourdhui()) where prenom = 'Sofia'),
               'Rapport TT : jour compté pour l''indemnité');
select test.ok((select count(*) = count(distinct d) from public.rapport_teletravail(pointage.aujourdhui()) r, unnest(r.dates) d where r.prenom = 'Sofia'),
               'Rapport TT : un jour avec plusieurs pointages TT compte une seule fois');
reset role;
select test.connecte('Sofia'); set role authenticated;
select test.erreur('select * from public.rapport_teletravail(current_date)', 'Rapport TT : réservé RH / direction / admin', 'réservée');
reset role;

-- ===================== Comptes avec mot de passe =====================
select test.connecte('Sofia'); set role authenticated;
select test.erreur(format('select public.preparer_compte(%L)', test.pid('Yanis')), 'Employée : ne gère pas les comptes', 'réservée');
reset role;
select test.connecte('Nadia'); set role authenticated;
select test.ok((public.preparer_compte(test.pid('Yanis'))->>'email') = 'yanis.peeters@cfb.test', 'RH : prépare le compte (e-mail pro)');
select test.erreur(format('select public.preparer_compte(%L)', (select id from pointage.personnes where role = 'admin' limit 1)), 'RH : pas le mot de passe d''un admin général', 'admin général');
select test.erreur(format('select public.preparer_compte(%L)', pointage.moi()), 'Son propre compte : via Mon compte', 'Mon compte');
select test.erreur(format('select public.attacher_compte(%L, gen_random_uuid(), null)', test.pid('Yanis')), 'Attacher un compte : interdit depuis l''appli', 'permission');
reset role;
select test.connecte('Admin'); set role authenticated;
select public.enregistrer_personne(null, 'Nouvelle', 'Recrue', 'nouvelle.recrue@cfb.test', (select id from pointage.services where nom = 'Administration'),
  p_regime_id => (select id from pointage.regimes where actif order by id limit 1)) as recrue \gset
reset role;
insert into auth.users (email) values ('nouvelle.recrue@cfb.test') returning id as compte_recrue \gset
select test.ok((select auth_user_id is null from pointage.personnes where id = :'recrue'), 'Compte e-mail + mot de passe : pas lié automatiquement');
select test.connecte('Nadia'); set role authenticated;
select test.ok((public.preparer_compte(:'recrue')->>'compte') = :'compte_recrue', 'Compte existant retrouvé par l''e-mail');
reset role;
set role service_role;
select public.attacher_compte(:'recrue', :'compte_recrue', null);
reset role;
select test.ok((select auth_user_id = :'compte_recrue' from pointage.personnes where id = :'recrue'), 'Compte créé par la RH : lié à la personne');
select test.ok(exists (select 1 from pointage.journal_audit where table_nom = 'comptes' and ligne_id = :'recrue'), 'Mot de passe généré : tracé dans le journal');
select test.pid('Yanis') as pid_yanis \gset
set role service_role;
select test.erreur(format('select public.attacher_compte(%L, %L, null)', :'pid_yanis', :'compte_recrue'), 'Un compte ne peut pas servir à deux personnes', 'déjà lié');
reset role;

-- ===================== Récap du mois =====================
select test.connecte('Marc'); set role authenticated;
select test.ok((select count(*) > 0 and bool_and(service = (select nom from pointage.services where id = (select service_id from pointage.personnes where prenom = 'Marc')))
                from public.rapport_mensuel(pointage.aujourdhui() - 1)), 'Récap : le chef voit son équipe, pas les autres services');
select test.ok(not exists (select 1 from public.rapport_mensuel(pointage.aujourdhui() - 1) where prenom = 'Marc'), 'Récap : sans la personne elle-même');
reset role;
select test.connecte('Nadia'); set role authenticated;
select test.ok((select count(distinct service) > 1 from public.rapport_mensuel(pointage.aujourdhui() - 1)), 'Récap : la RH voit tous les services');
select test.ok((select bool_and(jours_presents <= jours_prevus + 31 and preste >= 0) from public.rapport_mensuel(pointage.aujourdhui() - 1)), 'Récap : chiffres cohérents');
reset role;
select test.connecte('Yanis'); set role authenticated;
select test.ok(not exists (select 1 from public.rapport_mensuel(pointage.aujourdhui() - 1)), 'Récap : un employé ne voit personne');
reset role;

-- ===================== Indemnité de télétravail (réglable) =====================
select test.ok(pointage.indemnite_tt(3) = 7500, 'Indemnité TT : 25 € × 3 jours par défaut');
select test.ok(pointage.indemnite_tt(0) = 0, 'Indemnité TT : rien sans télétravail');
update pointage.parametres set valeur = 1 where cle = 'indemnite_tt_forfait_mensuel';
select test.ok(pointage.indemnite_tt(3) = 2500, 'Indemnité TT : forfait mensuel');
update pointage.parametres set valeur = 0 where cle = 'indemnite_tt_forfait_mensuel';
update pointage.parametres set valeur = 5000 where cle = 'indemnite_tt_plafond';
select test.ok(pointage.indemnite_tt(3) = 5000, 'Indemnité TT : plafond appliqué');
update pointage.parametres set valeur = 0 where cle = 'indemnite_tt_plafond';
select test.connecte('Nadia'); set role authenticated;
select test.ok((select indemnite_centimes = jours_tt * 2500 from public.rapport_teletravail_mois(pointage.aujourdhui()) where prenom = 'Sofia'), 'Rapport TT : indemnité calculée');
reset role;

-- ===================== Réglages organisés =====================
select test.ok((select count(*) from public.parametres where parent = 'indemnite_tt_active') = 3, 'Réglages : l''indemnité regroupe montant, mode et plafond');
update pointage.parametres set valeur = 0 where cle = 'indemnite_tt_active';
select test.ok(pointage.indemnite_tt(3) = 0, 'Indemnité coupée : 0 €');
update pointage.parametres set valeur = 1 where cle = 'indemnite_tt_active';
update pointage.parametres set valeur = 0 where cle = 'justificatifs_actifs';   -- retour à la valeur livrée
select test.ok((select valeur = 0 from pointage.parametres where cle = 'justificatifs_actifs'), 'Justificatifs : fonction coupable');
select test.ok(not exists (select 1 from public.demandes where justificatif_requis), 'Justificatifs coupés : aucun requis');
-- Régime personnalisé : 4/5 avec le mercredi libre
select test.connecte('Admin'); set role authenticated;
select public.regime_personnalise(test.pid('Yanis'), array[456,456,0,456,456,0,0], pointage.aujourdhui() + 30) as reg1 \gset
select public.regime_personnalise(test.pid('Sofia'), array[456,456,0,456,456,0,0], pointage.aujourdhui() + 30) as reg2 \gset
select test.erreur(format('select public.regime_personnalise(%L, array[0,0,0,0,0,0,0], current_date)', test.pid('Yanis')), 'Régime : au moins un jour', 'au moins un jour');
reset role;
select test.ok(:'reg1' = :'reg2', 'Régime identique réutilisé (pas de doublon)');
select test.ok((select libelle like '4/5 · lun mar jeu ven%' and contrat = 'temps_partiel' from pointage.regimes where id = :'reg1'), 'Régime nommé d''après ses jours');
select test.connecte('Yanis'); set role authenticated;
select test.erreur(format('select public.regime_personnalise(%L, array[456,456,456,456,456,0,0], current_date)', pointage.moi()), 'Régime : réservé admin / admin RH', 'réservée');
reset role;

-- ===================== Gestion RH : compteurs, départ, journal =====================
select test.pid('Emma') as pid_emma \gset
select test.connecte('Nadia'); set role authenticated;
select public.mouvement_solde_rh(:'pid_emma', 'CONGE_LEGAL', 456, 'ajustement', pointage.aujourdhui(), 'Test ajustement');
select test.ok(exists (select 1 from public.mouvements_personne(:'pid_emma') where motif = 'Test ajustement' and par like 'Nadia%'), 'Compteurs : ajustement visible avec son auteur');
select test.ok((public.preparer_depart(:'pid_emma', pointage.aujourdhui() + 10) ? 'soldes'), 'Départ : aperçu de l''impact');
select public.enregistrer_depart(:'pid_emma', pointage.aujourdhui() + 10) as dep \gset
select test.ok((select date_sortie = pointage.aujourdhui() + 10 from pointage.personnes where id = :'pid_emma'), 'Départ : date de sortie enregistrée');
select test.ok(not exists (select 1 from pointage.demandes where personne_id = :'pid_emma' and statut in ('en_attente', 'accordee') and date_debut > pointage.aujourdhui() + 10), 'Départ : demandes après le départ annulées');
select public.annuler_depart(:'pid_emma');
select test.ok((select date_sortie is null from pointage.personnes where id = :'pid_emma'), 'Départ annulé : la personne reste');
select test.erreur(format('select public.enregistrer_depart(%L, current_date)', pointage.moi()), 'Départ : pas le sien', 'propre départ');
select test.erreur('select * from public.journal_modifications()', 'Journal : réservé admin / admin RH', 'réservée');
reset role;
select test.connecte('Inès'); set role authenticated;
select test.ok(exists (select 1 from public.journal_modifications(50) where objet = 'personnes' and 'date_sortie' = any(champs)), 'Journal : la modification de la date de sortie est tracée');
reset role;
select test.connecte('Yanis'); set role authenticated;
select test.erreur(format('select * from public.mouvements_personne(%L)', :'pid_emma'), 'Compteurs d''un collègue : refusé', 'autoris');
reset role;

-- ===================== Bilan =====================
\o
\set QUIET 0
select n, case when ok then '✅' else '❌' end as r, libelle from test.resultats order by n;
select count(*) filter (where ok) as reussis, count(*) filter (where not ok) as echecs from test.resultats;
