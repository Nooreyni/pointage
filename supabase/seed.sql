-- Données FICTIVES de développement (aucune personne réelle)
insert into pointage.services (id, nom, parent_id, couleur, seuil_absence_pct) values
  ('a0000000-0000-0000-0000-000000000001', 'Direction',       null,                                   '#223A87', 50),
  ('a0000000-0000-0000-0000-000000000002', 'Administration',  'a0000000-0000-0000-0000-000000000001', '#2479BE', 40),
  ('a0000000-0000-0000-0000-000000000003', 'Comptabilité',    'a0000000-0000-0000-0000-000000000001', '#A3C854', 50),
  ('a0000000-0000-0000-0000-000000000004', 'Ressources humaines', 'a0000000-0000-0000-0000-000000000001', '#F7BC39', 50);

insert into pointage.personnes (id, nom, prenom, email, role, type, service_id, regime_id, partenaire_isp, matricule, date_entree) values
  ('b0000000-0000-0000-0000-000000000001', 'Lambert',  'Claire',  'claire.lambert@cfb.test',  'direction',   'interne', 'a0000000-0000-0000-0000-000000000001', 1, null, 'P0001', '2015-01-05'),
  ('b0000000-0000-0000-0000-000000000002', 'Dupont',   'Marc',    'marc.dupont@cfb.test',     'responsable', 'interne', 'a0000000-0000-0000-0000-000000000002', 1, null, 'P0002', '2018-03-01'),
  ('b0000000-0000-0000-0000-000000000003', 'Janssens', 'Sofia',   'sofia.janssens@cfb.test',  'travailleur', 'interne', 'a0000000-0000-0000-0000-000000000002', 1, null, 'P0003', '2020-09-01'),
  ('b0000000-0000-0000-0000-000000000004', 'Peeters',  'Yanis',   'yanis.peeters@cfb.test',   'travailleur', 'interne', 'a0000000-0000-0000-0000-000000000002', 1, null, 'P0004', '2022-02-14'),
  ('b0000000-0000-0000-0000-000000000005', 'Diallo',   'Awa',     'awa.diallo@cfb.test',      'travailleur', 'interne', 'a0000000-0000-0000-0000-000000000002', 1, null, 'P0005', '2023-06-01'),
  ('b0000000-0000-0000-0000-000000000006', 'Martin',   'Lucas',   'lucas.martin@cfb.test',    'responsable', 'interne', 'a0000000-0000-0000-0000-000000000003', 1, null, 'P0006', '2016-10-01'),
  ('b0000000-0000-0000-0000-000000000007', 'Claes',    'Emma',    'emma.claes@cfb.test',      'travailleur', 'interne', 'a0000000-0000-0000-0000-000000000003', 1, null, 'P0007', '2021-01-04'),
  ('b0000000-0000-0000-0000-000000000008', 'Benali',   'Nadia',   'nadia.benali@cfb.test',    'rh',          'interne', 'a0000000-0000-0000-0000-000000000004', 1, null, 'P0008', '2017-05-02'),
  ('b0000000-0000-0000-0000-000000000009', 'Wouters',  'Tom',     'tom.wouters@cfb.test',     'rh',          'interne', 'a0000000-0000-0000-0000-000000000004', 1, null, 'P0009', '2019-11-04'),
  ('b0000000-0000-0000-0000-000000000010', 'Kabongo',  'Jordan',  'jordan.kabongo@cfb.test',  'travailleur', 'isp',     'a0000000-0000-0000-0000-000000000002', 1, 'CPAS (fictif)', null, '2026-09-01'),
  ('b0000000-0000-0000-0000-000000000011', 'Leroy',    'Inès',    'ines.leroy@cfb.test',      'referent_isp','interne', 'a0000000-0000-0000-0000-000000000004', 1, null, 'P0011', '2020-01-06');

insert into pointage.responsables_service (service_id, personne_id) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000006'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000008');

-- Soldes d'ouverture 2026 : 20 j congés légaux + 2 j extra-légaux (7h36 = 456 min/j)
insert into pointage.mouvements_compteur (personne_id, compteur_code, periode_debut, date_effet, type, minutes, motif, cree_par)
select p.id, c.code, '2026-01-01', '2026-01-01', 'ouverture', c.minutes, 'Reprise Dinclock (fictif)', 'b0000000-0000-0000-0000-000000000008'
from pointage.personnes p
cross join (values ('CONGE_LEGAL', 20 * 456), ('EXTRA_LEGAL', 2 * 456)) c(code, minutes)
where p.type = 'interne';

-- Réseau CFB fictif (plage de documentation RFC 5737)
insert into pointage.reseaux_cfb (plage, libelle) values ('203.0.113.0/24', 'Siège (fictif)');
