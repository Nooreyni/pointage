-- =====================================================================
--  CFB Pointage — index des clés étrangères (audit R15)
--  Négligeable à 70 personnes, mais évite tout parcours complet lors des jointures, des contrôles
--  d'intégrité et des purges (conservation) quand l'historique grossit.
-- =====================================================================
create index if not exists abonnements_service_service_idx on pointage.abonnements_service (service_id);
create index if not exists acces_services_accorde_par_idx on pointage.acces_services (accorde_par);
create index if not exists acces_services_service_idx on pointage.acces_services (service_id);
create index if not exists clotures_cloture_par_idx on pointage.clotures (cloture_par);
create index if not exists codes_absence_compteur_idx on pointage.codes_absence (compteur_code);
create index if not exists compteurs_report_vers_idx on pointage.compteurs (report_vers);
create index if not exists decisions_hs_decide_par_idx on pointage.decisions_hs (decide_par);
create index if not exists demandes_code_absence_idx on pointage.demandes (code_absence);
create index if not exists demandes_constate_par_idx on pointage.demandes (constate_par);
create index if not exists demandes_cree_par_idx on pointage.demandes (cree_par);
create index if not exists demandes_decide_par_idx on pointage.demandes (decide_par);
create index if not exists mouvements_compteur_compteur_idx on pointage.mouvements_compteur (compteur_code);
create index if not exists mouvements_compteur_cree_par_idx on pointage.mouvements_compteur (cree_par);
create index if not exists mouvements_compteur_demande_idx on pointage.mouvements_compteur (demande_id);
create index if not exists personne_regimes_regime_idx on pointage.personne_regimes (regime_id);
create index if not exists personnes_service_idx on pointage.personnes (service_id);
create index if not exists pointages_annule_par_idx on pointage.pointages (annule_par);
create index if not exists pointages_cree_par_idx on pointage.pointages (cree_par);
create index if not exists pointages_type_code_idx on pointage.pointages (type_code);
create index if not exists push_abonnements_personne_idx on pointage.push_abonnements (personne_id);
create index if not exists responsables_service_personne_idx on pointage.responsables_service (personne_id);
create index if not exists services_parent_idx on pointage.services (parent_id);
