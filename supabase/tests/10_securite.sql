-- Tests de sécurité et workflow — à lancer avec run.sh (base locale jetable)
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
create schema test;
create table test.resultats (n serial, ok boolean, libelle text);
create function test.ok(cond boolean, libelle text) returns void language sql as $$
  insert into test.resultats (ok, libelle) values (coalesce(cond, false), libelle) $$;
-- Vérifie qu'une instruction échoue (exécutée avec les droits de l'appelant)
create function test.erreur(sql text, libelle text, motif text default null) returns void language plpgsql as $$
declare m text;
begin
  begin execute sql; exception when others then m := sqlerrm; end;
  insert into test.resultats (ok, libelle)
  values (m is not null and (motif is null or m ilike '%' || motif || '%'),
          libelle || coalesce(' → ' || m, ' → AUCUNE ERREUR'));
end $$;
create function test.connecte(email text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users u where u.email = $1))::text, false) $$;
grant usage on schema test to authenticated, anon;
grant all on all tables in schema test to authenticated, anon;
grant all on all sequences in schema test to authenticated, anon;
grant execute on all functions in schema test to authenticated, anon;

-- Comptes SSO fictifs (le trigger lie chaque compte à sa personne par e-mail)
insert into auth.users (email) select email from pointage.personnes;
insert into auth.users (email) values ('inconnu@exterieur.test');
select test.ok((select count(*) = 11 from pointage.personnes where auth_user_id is not null), 'Liaison SSO par e-mail : 11 comptes liés');

-- ===== Accès anonyme =====
set role anon;
select test.erreur('select * from public.pointages', 'anon ne lit rien', 'permission denied');
select test.erreur('select public.pointer()', 'anon ne pointe pas', 'permission denied');
reset role;

-- ===== Compte Entra inconnu =====
select test.connecte('inconnu@exterieur.test');
set role authenticated;
select test.erreur('select public.pointer()', 'Compte inconnu ne pointe pas', 'non reconnu');
select test.ok((select count(*) = 0 from public.personnes), 'Compte inconnu ne voit personne');
reset role;

-- ===== Travailleur : Sofia (Administration) =====
select test.connecte('sofia.janssens@cfb.test');
set role authenticated;
select test.erreur($$insert into pointage.demandes (personne_id,type,code_absence,date_debut,date_fin,statut) values (pointage.moi(),'conge_jours','CP','2026-12-01','2026-12-01','accordee')$$,
                   'T1 insertion directe d''une demande accordée', 'permission denied');
select test.erreur($$update pointage.demandes set statut='a_traiter_rh'$$, 'T2 update direct des demandes', 'permission denied');
select test.erreur($$insert into pointage.pointages (personne_id,horodatage,sens,source,cree_par) values (pointage.moi(),now(),'entree','web','b0000000-0000-0000-0000-000000000003')$$,
                   'T4 insertion directe de pointage', 'permission denied');

-- Pointage 1 tap depuis le réseau CFB
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.10, 10.0.0.1"}', false);
select test.ok((select (public.pointer()->>'sens') = 'entree'), 'Pointage 1 tap → entrée');
select test.ok((select lieu = 'reseau_cfb' and type_code = 'BUREAU' from public.pointages order by horodatage desc limit 1), 'Réseau CFB détecté → BUREAU');
select test.ok((select (public.pointer()->>'sens') = 'sortie'), '2e tap → sortie');
select test.ok((select count(*) = 0 from pointage.pointages where remarque ~ '203\.0\.113'), 'Aucune IP stockée');
-- Hors réseau → télétravail
select set_config('request.headers', '{"x-forwarded-for":"198.51.100.7"}', false);
select test.ok((select (public.pointer()->>'type_code') = 'TT'), 'Hors réseau → TT');
-- Idempotence hors ligne
select test.ok((select (public.pointer(p_client_id => 'c0000000-0000-0000-0000-000000000001', p_horodatage => now() - interval '1 hour')->>'id')
                     = (public.pointer(p_client_id => 'c0000000-0000-0000-0000-000000000001', p_horodatage => now() - interval '1 hour')->>'id')),
               'Synchro hors ligne rejouée → pas de doublon');
select test.ok((select pp.lieu = 'inconnu' from pointage.pointages pp where pp.client_id = 'c0000000-0000-0000-0000-000000000001'),
               'Pointage différé → lieu inconnu');
select test.erreur($$select public.pointer(p_horodatage => now() - interval '4 days')$$, 'Pointage > 72 h refusé', '72 h');
select test.erreur($$select public.pointer(p_source => 'correction_rh')$$, 'Source système refusée', 'réservée');
select test.erreur($$select public.annuler_pointage((select id from public.pointages where personne_id <> pointage.moi() limit 1))$$, 'Annuler le pointage d''autrui', 'introuvable');

-- Visibilité
select test.ok((select count(*) = 1 from public.personnes), 'Travailleur ne voit que lui-même');
select test.ok((select count(*) >= 9 from public.presence_jour()), 'Vue équipe du jour : tous les internes');
select test.ok((select bool_and(personne_id = pointage.moi()) from public.soldes), 'Soldes : uniquement les siens');

-- Simulation + demande
select test.ok((select (s->>'minutes')::int = 5 * 456 and (s->>'solde_apres')::int = 15 * 456
                from public.simuler_demande('conge_jours', 'CP', '2026-11-16', '2026-11-20') s),
               'Simulation : 5 j décomptés, reste 15 j');
select test.ok((select (s->>'minutes')::int = 2 * 456 from public.simuler_demande('conge_jours', 'CP', '2026-11-10', '2026-11-12') s),
               'Simulation : 11/11 férié non décompté');
select test.ok((select (public.soumettre_demande('conge_jours', 'CP', '2026-11-16', '2026-11-20')->>'statut') = 'a_valider_n1'),
               'Demande soumise → à valider N+1');
select test.erreur($$select public.soumettre_demande('conge_jours', 'CP', '2026-11-18', '2026-11-18')$$, 'Chevauchement avec sa propre demande', 'déjà une demande');
select test.erreur($$select public.soumettre_demande('conge_jours', 'CP', '2026-12-01', '2026-12-31')$$, 'Solde insuffisant (attente déduite)', 'insuffisant');
select test.erreur($$select public.soumettre_demande('conge_jours', 'MAL', '2026-12-01', '2026-12-01')$$, 'Maladie non demandable', 'non demandable');
select test.erreur($$select public.decider_n1(array(select id from public.demandes where personne_id = pointage.moi()), true)$$,
                   'T2 Auto-validation N+1', 'pas valideur');
select test.erreur($$select public.traiter_rh((select id from public.demandes limit 1), true)$$, 'Travailleur → traitement RH', 'réservée');
select test.ok((select count(*) = 0 from public.anomalies where personne_id <> pointage.moi()), 'T3 Anomalies : uniquement les siennes');
reset role;

-- Données d'un autre service : pointage d'Emma il y a 2 jours (anomalie)
insert into pointage.pointages (personne_id, horodatage, sens, source, cree_par, cree_le)
values ('b0000000-0000-0000-0000-000000000007', now() - interval '2 days', 'entree', 'web', 'b0000000-0000-0000-0000-000000000007', now() - interval '2 days');

select test.connecte('sofia.janssens@cfb.test'); set role authenticated;
select test.ok((select count(*) = 0 from public.anomalies), 'T3 Anomalie d''un autre service invisible');
reset role;

-- ===== Responsable Marc (Administration) =====
select test.connecte('marc.dupont@cfb.test'); set role authenticated;
select test.ok((select count(*) = 5 from public.personnes), 'N+1 voit son équipe (lui + 3 + ISP)');
select test.ok((select count(*) = 0 from public.personnes where service = 'Comptabilité'), 'N+1 ne voit pas les autres services');
select test.ok((select bool_and(je_peux_valider) from public.demandes where personne_id <> pointage.moi()), 'Flag je_peux_valider');
select test.ok((select (public.soumettre_demande('conge_jours', 'CP', '2026-11-23', '2026-11-23')->>'statut') = 'a_valider_n1'), 'Responsable soumet sa demande');
select test.erreur($$select public.decider_n1(array(select id from public.demandes where personne_id = pointage.moi()), true)$$,
                   'T6 Responsable valide sa propre demande', 'pas valideur');
select test.erreur($$select public.decider_n1(array(select id from public.demandes where personne_id <> pointage.moi()), false)$$,
                   'Refus sans motif', 'motivé');
select test.ok((select public.decider_n1(array(select id from public.demandes where personne_id <> pointage.moi()), true) = 1), 'N+1 valide la demande de Sofia');
select test.erreur($$select public.decider_n1(array(select id from public.demandes where prenom = 'Sofia'), true)$$, 'Double validation', 'déjà traitée');
reset role;

-- ===== Direction (N+1 des responsables via service parent) =====
select test.connecte('claire.lambert@cfb.test'); set role authenticated;
select test.ok((select public.decider_n1(array(select id from public.demandes where prenom = 'Marc'), true) = 1), 'Direction valide la demande du responsable');
reset role;

-- ===== RH =====
select test.connecte('nadia.benali@cfb.test'); set role authenticated;
select test.ok((select count(*) >= 11 from public.personnes), 'RH voit tout le monde');
select public.traiter_rh((select id from public.demandes where prenom = 'Sofia'), true);
select test.ok((select reste_min = 15 * 456 from public.soldes where personne_id = 'b0000000-0000-0000-0000-000000000003' and compteur_code = 'CONGE_LEGAL'),
               'Accord RH → solde Sofia 15 j');
select test.erreur($$select public.traiter_rh((select id from public.demandes where prenom = 'Sofia'), true)$$, 'Double traitement RH', 'pas à traiter');
select test.erreur($$select public.mouvement_solde_rh('b0000000-0000-0000-0000-000000000003', 'CONGE_LEGAL', 456, 'prise')$$, 'RH ne crée pas de "prise" à la main', 'réservé');
select test.erreur($$select public.mouvement_solde_rh('b0000000-0000-0000-0000-000000000003', 'CONGE_LEGAL', 456)$$, 'Ajustement sans motif', 'motivé');
select test.erreur($$update pointage.mouvements_compteur set minutes = 0$$, 'Grand livre non modifiable', 'permission denied');
select test.ok((select count(*) > 0 from pointage.journal_audit), 'RH lit le journal d''audit');
reset role;

-- Nadia soumet une demande → traitée par l'autre RH uniquement
select test.connecte('nadia.benali@cfb.test'); set role authenticated;
-- Nadia est responsable RH : sa demande remonte à la direction
select public.soumettre_demande('conge_jours', 'CP', '2026-12-07', '2026-12-07');
reset role;
select test.connecte('claire.lambert@cfb.test'); set role authenticated;
select public.decider_n1(array(select id from public.demandes where prenom = 'Nadia'), true);
reset role;
select test.connecte('nadia.benali@cfb.test'); set role authenticated;
select test.erreur($$select public.traiter_rh((select id from public.demandes where prenom = 'Nadia'), true)$$, 'RH traite sa propre demande', 'propre demande');
reset role;
select test.connecte('tom.wouters@cfb.test'); set role authenticated;
select public.traiter_rh((select id from public.demandes where prenom = 'Nadia'), true);
select test.ok((select statut = 'accordee' from public.demandes where prenom = 'Nadia'), 'Autre RH traite la demande');
reset role;

-- Annulation d'un congé accordé futur par le demandeur → solde restauré
select test.connecte('sofia.janssens@cfb.test'); set role authenticated;
select public.annuler_demande((select id from public.demandes where statut = 'accordee'));
select test.ok((select reste_min = 20 * 456 and pris_min = 0 from public.soldes where compteur_code = 'CONGE_LEGAL'), 'Annulation → solde restauré à 20 j');
reset role;

-- ===== Délégation =====
select test.connecte('sofia.janssens@cfb.test'); set role authenticated;
select public.soumettre_demande('conge_demi_jour', 'CP', '2026-12-02', p_demi => 'matin');
reset role;
select id as demi_sofia from pointage.demandes where personne_id = 'b0000000-0000-0000-0000-000000000003' and statut = 'a_valider_n1' \gset
select test.connecte('yanis.peeters@cfb.test'); set role authenticated;
select test.erreur(format('select public.decider_n1(array[%L]::uuid[], true)', :'demi_sofia'), 'Collègue sans délégation', 'pas valideur');
reset role;
select test.connecte('marc.dupont@cfb.test'); set role authenticated;
select public.deleguer('b0000000-0000-0000-0000-000000000004', current_date, current_date + 7);
reset role;
select test.connecte('yanis.peeters@cfb.test'); set role authenticated;
select test.ok((select public.decider_n1(array(select id from public.demandes where prenom = 'Sofia' and statut = 'a_valider_n1'), true) = 1), 'Délégué valide pendant la délégation');
reset role;

-- ===== Motif confidentiel =====
insert into pointage.demandes (personne_id, type, code_absence, date_debut, date_fin, statut, minutes_decomptees)
values ('b0000000-0000-0000-0000-000000000005', 'conge_jours', 'MAL', current_date, current_date, 'a_traiter_rh', 0);
update pointage.demandes set statut = 'accordee' where code_absence = 'MAL';
select test.connecte('emma.claes@cfb.test'); set role authenticated;
select test.ok((select statut = 'Absent' from public.presence_jour() where prenom = 'Awa'), 'Collègue voit « Absent » (maladie masquée)');
reset role;
select test.connecte('marc.dupont@cfb.test'); set role authenticated;
select test.ok((select statut = 'Maladie' from public.presence_jour() where prenom = 'Awa'), 'N+1 voit le motif');
reset role;

-- ===== Référent ISP =====
select test.connecte('ines.leroy@cfb.test'); set role authenticated;
select test.ok((select count(*) = 2 and bool_or(type = 'isp') from public.personnes), 'Référent ISP : lui + ISP uniquement');
reset role;

-- ===== Clôture =====
-- Pointage de Sofia du 30/09 encodé le 02/10, puis clôture de septembre
insert into pointage.pointages (id, personne_id, horodatage, sens, source, cree_par, cree_le)
values ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003', '2026-09-30 09:00+02', 'entree', 'web',
        'b0000000-0000-0000-0000-000000000003', '2026-10-02 09:00+02');
select test.connecte('sofia.janssens@cfb.test'); set role authenticated;
select test.erreur($$select public.cloturer_mois('2026-09-01')$$, 'Travailleur ne clôture pas', 'réservée');
reset role;
select test.connecte('tom.wouters@cfb.test'); set role authenticated;
select test.erreur($$select public.cloturer_mois('2026-10-01')$$, 'Clôture d''un mois en cours', 'terminé');
select public.cloturer_mois('2026-09-01');
select test.erreur($$select public.corriger_pointage_rh('b0000000-0000-0000-0000-000000000003', '2026-09-15 17:00+02', 'sortie')$$, 'Pointage dans un mois clôturé', 'clôturée');
select test.erreur($$select public.annuler_pointage('d0000000-0000-0000-0000-000000000001')$$, 'Annuler un pointage clôturé', 'clôturée');
select test.erreur($$select public.mouvement_solde_rh('b0000000-0000-0000-0000-000000000003', 'CONGE_LEGAL', 456, 'ajustement', '2026-09-10', 'test')$$, 'Mouvement dans un mois clôturé', 'clôturée');
reset role;
select test.erreur($$update pointage.pointages set horodatage = '2026-10-01 09:00+02' where id = 'd0000000-0000-0000-0000-000000000001'$$,
                   'T7b Sortir un pointage du mois clôturé (même en admin)', 'clôturée');
select test.erreur($$delete from pointage.journal_audit$$, 'Journal d''audit immuable (même en admin)', 'lecture seule');
select test.erreur($$delete from pointage.pointages$$, 'Pas de DELETE de pointage (même en admin)', 'lecture seule');

-- ===== Correction de pointage (workflow complet) =====
select test.connecte('emma.claes@cfb.test'); set role authenticated;
select public.soumettre_demande('correction_pointage',
  p_pointage_propose => json_build_object('horodatage', (now() - interval '2 days')::date + time '17:00', 'sens', 'sortie')::jsonb,
  p_commentaire => 'Oubli de sortie');
reset role;
select test.connecte('lucas.martin@cfb.test'); set role authenticated;
select public.decider_n1(array(select id from public.demandes where prenom = 'Emma'), true);
reset role;
select test.connecte('tom.wouters@cfb.test'); set role authenticated;
select public.traiter_rh((select id from public.demandes where prenom = 'Emma'), true);
select test.ok((select count(*) = 0 from public.anomalies where personne_id = 'b0000000-0000-0000-0000-000000000007'), 'Correction accordée → anomalie résolue');
reset role;

-- ===== Bilan =====
\set QUIET 0
\o
select n, case when ok then '✅' else '❌' end as r, libelle from test.resultats order by n;
select count(*) filter (where ok) as reussis, count(*) filter (where not ok) as echecs from test.resultats;
