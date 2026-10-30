-- =====================================================================
--  CFB Pointage — données de référence
--  Paramètres : valeurs légales « normales » PROVISOIRES, à remplacer par le
--  règlement de travail du CFB (public.modifier_parametre).
-- =====================================================================

insert into pointage.parametres (cle, valeur, unite, libelle, source) values
  ('pause_midi_min',            30,   'min',   'Pause de midi déduite automatiquement',            'Dinclock CFB (≈ 30 min)'),
  ('pause_seuil_min',           360,  'min',   'Pause déduite si la journée pointée dépasse',      'Valeur légale courante (pause après 6 h)'),
  ('max_jour_min',              540,  'min',   'Maximum journalier en horaire flottant',           'Loi 05/03/2017 — 9 h/jour (Securex)'),
  ('max_semaine_min',           2700, 'min',   'Maximum hebdomadaire en horaire flottant',         'Loi 05/03/2017 — 45 h/semaine (Securex)'),
  ('boni_periode_mois',         3,    'mois',  'Période de référence du boni',                     'Loi 05/03/2017 — 3 mois en principe'),
  ('boni_report_max_min',       720,  'min',   'Boni reportable max (crédit)',                     'Loi 05/03/2017 — 12 h sauf CCT'),
  ('boni_report_min_min',       -720, 'min',   'Boni reportable min (débit)',                      'Symétrique du crédit — à confirmer'),
  ('conges_semaines',           4,    'semaines', 'Congés annuels (semaines du régime)',           '20 jours en régime 5 j = 4 semaines'),
  ('heure_entree_defaut',       510,  'min_depuis_minuit', 'Heure d''entrée par défaut (rappels)',  'Avant apprentissage des habitudes'),
  ('heure_sortie_defaut',       1020, 'min_depuis_minuit', 'Heure de sortie par défaut (rappels)',  'Avant apprentissage des habitudes'),
  ('rappel_entree_delai_min',   30,   'min',   'Rappel d''entrée après l''heure habituelle',        'Proposition'),
  ('rappel_sortie_delai_min',   60,   'min',   'Rappel de sortie après l''heure habituelle',        'Proposition'),
  ('rappel_fin_mois_employe_j', 5,    'jours', 'Rappel anomalies aux employés (jours avant fin de mois)', 'Proposition'),
  ('rappel_fin_mois_n1_j',      2,    'jours', 'Rappel anomalies aux N+1 (jours avant fin de mois)',      'Proposition'),
  ('relance_demande_jours',     3,    'jours', 'Relance d''une demande en attente après',           'Proposition');

-- Régimes observés dans Dinclock (lundi → dimanche, minutes)
insert into pointage.regimes (libelle, contrat, minutes_jour) values
  ('Temps plein 38h',                     'temps_plein',   '{456,456,456,456,456,0,0}'),
  ('Temps plein 37h30',                   'temps_plein',   '{450,450,450,450,450,0,0}'),
  ('Temps partiel 36h (8h × 4 + 4h mer.)', 'temps_partiel', '{480,480,240,480,480,0,0}'),
  ('Temps partiel 35h (8/5h30/8/8/5h30)', 'temps_partiel', '{480,330,480,480,330,0,0}');

insert into pointage.types_pointage (code, libelle, libelle_presence, ordre) values
  ('BUREAU',         'Bureau',          'Présent',             10),
  ('TT',             'Télétravail',     'Télétravail',         20),
  ('VISITE',         'Visite',          'En visite',           30),
  ('MISSION',        'Mission',         'En mission',          40),
  ('FORMATION',      'Formation',       'En formation',        50),
  ('MANDAT',         'Mandat',          'Mandat',              60),
  ('PERMANENCE_VAD', 'VAD Permanence',  'Permanence VAD',      70);

insert into pointage.compteurs (code, libelle, periodicite, ordre) values
  ('CONGE_LEGAL',     'Congés annuels',              'annuelle',      10),
  ('CONGE_N1',        'Congés année passée',         'annuelle',      11),
  ('CONGE_N2',        'Congés année −2',             'annuelle',      12),
  ('EXTRA_LEGAL',     'Congés extra-légaux',         'annuelle',      20),
  ('ANCIENNETE',      'Congés ancienneté',           'annuelle',      30),
  ('VACANCES_JEUNES', 'Congés vacances jeunes',      'annuelle',      35),
  ('RECUP',           'Récup HS',                    'trimestrielle', 40),
  ('REPOS_COMP',      'Repos compensatoire',         'trimestrielle', 50),
  ('BONI',            'Boni (horaire flottant)',     'aucune',        60);

insert into pointage.codes_absence (code, libelle, code_court, compteur_code, demandable, justificatif_requis, ordre) values
  ('CP',            'Congés payés',                       'VA',   'CONGE_LEGAL',     true,  false, 10),
  ('CP_N1',         'Congé année −1',                     'V-1',  'CONGE_N1',        true,  false, 11),
  ('CP_N2',         'Congé année −2',                     'V-2',  'CONGE_N2',        true,  false, 12),
  ('CEL',           'Jour de congé extra-légal',          'EL',   'EXTRA_LEGAL',     true,  false, 20),
  ('ANC',           'Congé ancienneté',                   'ANC',  'ANCIENNETE',      true,  false, 30),
  ('VJ',            'Congé vacances jeunes',              'VJ',   'VACANCES_JEUNES', true,  false, 35),
  ('RECUP',         'Récup',                              'RECUP','RECUP',           true,  false, 40),
  ('REPOS_COMP',    'Repos compensatoire',                'RC',   'REPOS_COMP',      true,  false, 50),
  ('RECUP_JC',      'Récupération jour communautaire',    'JC',   null,              true,  false, 55),
  ('MAL',           'Maladie',                            'Mal',  null,              false, true,  100),
  ('MAL_3J',        'Maladie 3 j sans certificat',        'Mal3', null,              false, false, 101),
  ('AT',            'Accident de travail',                'AT',   null,              false, true,  102),
  ('PETIT_CHOMAGE', 'Petit chômage',                      'PC',   null,              false, true,  110),
  ('RAISONS_IMP',   'Congé familial raisons impérieuses', 'FAM',  null,              false, false, 111),
  ('PARENTAL',      'Congé parental',                     'CPAR', null,              false, false, 112),
  ('EDUCATION',     'Congé éducation',                    'EDU',  null,              false, false, 113),
  ('MATERNITE',     'Congé de maternité',                 'MAT',  null,              false, true,  114),
  ('NAISSANCE',     'Congé de naissance',                 'NAI',  null,              false, true,  115),
  ('SANS_SOLDE',    'Congé sans solde',                   'SS',   null,              false, false, 116),
  ('GREVE',         'Grève',                              'GR',   null,              false, false, 117),
  ('ABS_JUSTIFIEE', 'Absence justifiée',                  'AJ',   null,              false, false, 118),
  ('ABS_INJUSTIFIEE','Absence injustifiée',               'AI',   null,              false, false, 119);

-- Jours fériés légaux belges 2026-2027 (Pâques 2026 : 05/04 ; 2027 : 28/03)
insert into pointage.jours_feries (jour, libelle) values
  ('2026-01-01', 'Nouvel An'),          ('2026-04-06', 'Lundi de Pâques'),
  ('2026-05-01', 'Fête du Travail'),    ('2026-05-14', 'Ascension'),
  ('2026-05-25', 'Lundi de Pentecôte'), ('2026-07-21', 'Fête nationale'),
  ('2026-08-15', 'Assomption'),         ('2026-11-01', 'Toussaint'),
  ('2026-11-11', 'Armistice'),          ('2026-12-25', 'Noël'),
  ('2027-01-01', 'Nouvel An'),          ('2027-03-29', 'Lundi de Pâques'),
  ('2027-05-01', 'Fête du Travail'),    ('2027-05-06', 'Ascension'),
  ('2027-05-17', 'Lundi de Pentecôte'), ('2027-07-21', 'Fête nationale'),
  ('2027-08-15', 'Assomption'),         ('2027-11-01', 'Toussaint'),
  ('2027-11-11', 'Armistice'),          ('2027-12-25', 'Noël');
