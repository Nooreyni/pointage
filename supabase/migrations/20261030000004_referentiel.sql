-- =====================================================================
--  CFB Pointage — données de référence (à valider avec la RH)
-- =====================================================================

insert into pointage.regimes (libelle, minutes_par_jour) values ('Temps plein 38h', 456);

insert into pointage.types_pointage (code, libelle, ordre) values
  ('BUREAU',         'Bureau',          10),
  ('TT',             'Télétravail',     20),
  ('VISITE',         'Visite',          30),
  ('MISSION',        'Mission',         40),
  ('FORMATION',      'Formation',       50),
  ('MANDAT',         'Mandat',          60),
  ('PERMANENCE_VAD', 'Permanence VAD',  70);

insert into pointage.compteurs (code, libelle, periodicite, ordre, autorise_negatif) values
  ('CONGE_LEGAL',   'Congés annuels',            'annuelle',      10, false),
  ('EXTRA_LEGAL',   'Congés extra-légaux',       'annuelle',      20, false),
  ('ANCIENNETE',    'Congés ancienneté',         'annuelle',      30, false),
  ('RECUP',         'Récup heures sup',          'trimestrielle', 40, false),
  ('REPOS_COMP',    'Repos compensatoire',       'trimestrielle', 50, false),
  ('BONI',          'Boni (heures flexibles)',   'aucune',        60, true);

insert into pointage.codes_absence (code, libelle, compteur_code, demandable, validation_n1, justificatif_requis, motif_confidentiel) values
  ('CP',            'Congé annuel',              'CONGE_LEGAL', true,  true,  false, false),
  ('CEL',           'Congé extra-légal',         'EXTRA_LEGAL', true,  true,  false, false),
  ('ANC',           'Congé ancienneté',          'ANCIENNETE',  true,  true,  false, false),
  ('RECUP',         'Récup',                     'RECUP',       true,  true,  false, false),
  ('REPOS_COMP',    'Repos compensatoire',       'REPOS_COMP',  true,  true,  false, false),
  ('MAL',           'Maladie',                   null,          false, false, true,  true),
  ('AT',            'Accident de travail',       null,          false, false, true,  true),
  ('PETIT_CHOMAGE', 'Petit chômage',             null,          true,  true,  true,  true),
  ('RAISONS_IMP',   'Congé raisons impérieuses', null,          true,  true,  false, true),
  ('FORMATION',     'Formation',                 null,          true,  true,  false, false),
  ('SANS_SOLDE',    'Congé sans solde',          null,          true,  true,  false, false);

-- Jours fériés légaux belges 2026-2027 (Pâques 2026 : 05/04 ; 2027 : 28/03)
insert into pointage.jours_feries (jour, libelle) values
  ('2026-01-01', 'Nouvel An'),        ('2026-04-06', 'Lundi de Pâques'),
  ('2026-05-01', 'Fête du Travail'),  ('2026-05-14', 'Ascension'),
  ('2026-05-25', 'Lundi de Pentecôte'), ('2026-07-21', 'Fête nationale'),
  ('2026-08-15', 'Assomption'),       ('2026-11-01', 'Toussaint'),
  ('2026-11-11', 'Armistice'),        ('2026-12-25', 'Noël'),
  ('2027-01-01', 'Nouvel An'),        ('2027-03-29', 'Lundi de Pâques'),
  ('2027-05-01', 'Fête du Travail'),  ('2027-05-06', 'Ascension'),
  ('2027-05-17', 'Lundi de Pentecôte'), ('2027-07-21', 'Fête nationale'),
  ('2027-08-15', 'Assomption'),       ('2027-11-01', 'Toussaint'),
  ('2027-11-11', 'Armistice'),        ('2027-12-25', 'Noël');
