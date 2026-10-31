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
grant usage on schema test to authenticated, anon;
grant all on all tables in schema test to authenticated, anon;
grant all on all sequences in schema test to authenticated, anon;
grant execute on all functions in schema test to authenticated, anon;

insert into auth.users (email) select email from pointage.personnes;
insert into auth.users (email) values ('inconnu@exterieur.test');
select test.ok((select count(*) = 13 from pointage.personnes where auth_user_id is not null), 'SSO : 13 comptes liés par e-mail');

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
select test.erreur($$select public.pointer(p_horodatage => now() - interval '4 days')$$, 'Pointage > 72 h refusé', '72 h');
select test.erreur($$select public.pointer(p_source => 'rh')$$, 'Source RH refusée', 'réservée');
reset role;

-- ===================== Visibilité =====================
select test.connecte('Sofia');  set role authenticated;
select test.ok((select count(*) = 1 from public.personnes), 'Employé : ne voit que lui');
select test.ok((select count(*) = 13 from public.presence_jour()), 'Présence du jour : tout le monde');
select test.ok((select bool_and(mon_service) = false from (select mon_service from public.presence_jour() limit 1 offset 6) x), 'Présence : son service en premier');
reset role;
select test.connecte('Marc');   set role authenticated;
select test.ok((select count(*) = 5 from public.personnes), 'Chef Administration : son service (5, ISP compris)');
reset role;
select test.connecte('Lucas');  set role authenticated;
select test.ok((select count(*) = 2 from public.personnes), 'Chef IT : son service (2)');
reset role;
select test.connecte('Paul');   set role authenticated;
select test.ok((select count(*) = 1 from public.personnes), 'Logistique (sans équipe) : comme un employé');
reset role;
select test.connecte('Claire'); set role authenticated;
select test.ok((select count(*) = 13 from public.personnes), 'Direction : tout le monde');
reset role;
select test.connecte('Nadia');  set role authenticated;
select test.ok((select count(*) = 13 from public.personnes), 'RH : tout le monde (constat)');
reset role;

-- ===================== Accès inter-services =====================
select test.connecte('Marc'); set role authenticated;
select test.erreur($$select public.donner_acces_service(test.pid('Lucas'), 'a0000000-0000-0000-0000-000000000002')$$, 'Chef ne donne pas d''accès', 'réservée');
reset role;
select test.connecte('Claire'); set role authenticated;
select public.donner_acces_service(test.pid('Lucas'), 'a0000000-0000-0000-0000-000000000002', false);
reset role;
select test.connecte('Lucas'); set role authenticated;
select test.ok((select count(*) = 7 from public.personnes), 'Accès lecture à Administration : 2 + 5');
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
select test.ok(public.attribuer_conges(2027) = 13, 'Attribution en 1 clic (13)');
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
select test.ok((select jsonb_array_length(s->'services') = 5 from public.stats_direction('2026-10-01') s), 'Direction : 5 services agrégés');
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

-- ===================== Bilan =====================
\o
\set QUIET 0
select n, case when ok then '✅' else '❌' end as r, libelle from test.resultats order by n;
select count(*) filter (where ok) as reussis, count(*) filter (where not ok) as echecs from test.resultats;
