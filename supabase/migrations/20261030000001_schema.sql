-- =====================================================================
--  CFB Pointage — schéma de données (v0.2)
--
--  Principes
--   • Identité : Microsoft Entra ID via Supabase Auth, pas de mot de passe local
--   • Données dans le schéma privé « pointage » (non exposé par l'API REST)
--   • Aucune écriture directe : tout passe par les fonctions de 20261030000003_api.sql
--   • Soldes = grand livre de mouvements (jamais de valeur écrasée)
--   • Journal d'audit append-only sur toutes les tables métier
--   • Minimisation RGPD : pas d'IP stockée, pas de GPS, motif d'absence masqué
--   • Durées en minutes (entiers) pour éviter les erreurs d'arrondi
--
--  v0.2 (30/10/2026) : corrige les failles v0.1 (auto-validation, insertion
--  d'une demande déjà accordée, contournement de clôture, vues hors RLS)
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;

create schema if not exists pointage;

-- ---------------------------------------------------------------------
-- 1. Types énumérés
-- ---------------------------------------------------------------------
create type pointage.type_personne   as enum ('interne', 'isp');
create type pointage.role_app        as enum ('travailleur', 'responsable', 'rh', 'direction', 'referent_isp', 'admin');
create type pointage.sens_pointage   as enum ('entree', 'sortie');
create type pointage.source_pointage as enum ('mobile', 'web', 'teams', 'correction_rh', 'demande');
create type pointage.lieu_pointage   as enum ('reseau_cfb', 'externe', 'inconnu');
create type pointage.periodicite     as enum ('annuelle', 'trimestrielle', 'aucune');
create type pointage.type_demande    as enum ('conge_jours', 'conge_demi_jour', 'conge_heures', 'correction_pointage');
create type pointage.demi_journee    as enum ('matin', 'apres_midi');
create type pointage.statut_demande  as enum ('brouillon', 'a_valider_n1', 'a_traiter_rh', 'accordee', 'refusee', 'annulee');
create type pointage.type_mouvement  as enum ('ouverture', 'attribution', 'prise', 'ajustement', 'report', 'expiration', 'annulation');

-- ---------------------------------------------------------------------
-- 2. Organisation
-- ---------------------------------------------------------------------
create table pointage.regimes (
  id                 smallserial primary key,
  libelle            text not null unique,                 -- ex. 'Temps plein 38h'
  minutes_par_jour   int  not null check (minutes_par_jour between 1 and 720),  -- 7h36 = 456
  jours_par_semaine  smallint not null default 5 check (jours_par_semaine between 1 and 7),
  actif              boolean not null default true
);

create table pointage.services (
  id                uuid primary key default gen_random_uuid(),
  nom               text not null unique,
  parent_id         uuid references pointage.services(id), -- escalade N+1 quand le responsable demande pour lui-même
  couleur           text check (couleur ~ '^#[0-9a-fA-F]{6}$'),
  seuil_absence_pct smallint not null default 50 check (seuil_absence_pct between 0 and 100), -- alerte chevauchement
  actif             boolean not null default true
);

create table pointage.personnes (
  id              uuid primary key default gen_random_uuid(),
  auth_user_id    uuid unique,                              -- auth.users.id (lié au 1er login SSO)
  entra_oid       uuid unique,                              -- objectId Entra ID
  matricule       text unique,                              -- n° Partena (internes)
  nom             text not null,
  prenom          text not null,
  email           text not null unique check (email = lower(email)),
  type            pointage.type_personne not null default 'interne',
  role            pointage.role_app not null default 'travailleur',
  service_id      uuid not null references pointage.services(id),
  regime_id       smallint not null references pointage.regimes(id),
  partenaire_isp  text,                                     -- ex. 'CPAS de …' (ISP uniquement)
  date_entree     date not null,
  date_sortie     date,
  cree_le         timestamptz not null default now(),
  constraint isp_a_partenaire check (type <> 'isp' or partenaire_isp is not null),
  constraint dates_coherentes check (date_sortie is null or date_sortie >= date_entree)
);

-- Responsables de service (plusieurs possibles)
create table pointage.responsables_service (
  service_id   uuid not null references pointage.services(id) on delete cascade,
  personne_id  uuid not null references pointage.personnes(id),
  principal    boolean not null default true,
  primary key (service_id, personne_id)
);

-- Délégation temporaire de validation (remplaçant pendant une absence)
create table pointage.delegations (
  id            uuid primary key default gen_random_uuid(),
  delegant_id   uuid not null references pointage.personnes(id),
  delegue_id    uuid not null references pointage.personnes(id),
  periode       daterange not null,
  cree_le       timestamptz not null default now(),
  check (delegant_id <> delegue_id),
  exclude using gist (delegant_id with =, periode with &&)
);

create table pointage.jours_feries (
  jour        date primary key,
  libelle     text not null,
  recuperable boolean generated always as (extract(isodow from jour) >= 6) stored  -- tombe un WE
);

-- Plages réseau du CFB : servent à classer un pointage « réseau CFB / externe ».
-- L'IP de la requête est comparée puis oubliée, jamais stockée.
create table pointage.reseaux_cfb (
  plage    cidr primary key,
  libelle  text not null
);

-- ---------------------------------------------------------------------
-- 3. Catalogue (paramétrable par la RH)
-- ---------------------------------------------------------------------
create table pointage.compteurs (
  code                text primary key,
  libelle             text not null,
  periodicite         pointage.periodicite not null default 'annuelle',
  visible_travailleur boolean not null default true,
  autorise_negatif    boolean not null default false,
  ordre               smallint not null default 100,
  actif               boolean not null default true
);

create table pointage.codes_absence (
  code                text primary key,
  libelle             text not null,
  compteur_code       text references pointage.compteurs(code),  -- null = n'impacte aucun solde
  demandable          boolean not null default true,             -- false = encodé uniquement par la RH
  validation_n1       boolean not null default true,
  justificatif_requis boolean not null default false,
  motif_confidentiel  boolean not null default false,            -- collègues voient seulement « Absent »
  couleur             text,
  actif               boolean not null default true
);

create table pointage.types_pointage (
  code                 text primary key,
  libelle              text not null,
  compte_comme_travail boolean not null default true,
  icone                text,
  ordre                smallint not null default 100,
  actif                boolean not null default true
);

-- ---------------------------------------------------------------------
-- 4. Pointages
-- ---------------------------------------------------------------------
create table pointage.pointages (
  id            uuid primary key default gen_random_uuid(),
  personne_id   uuid not null references pointage.personnes(id),
  horodatage    timestamptz not null,
  sens          pointage.sens_pointage not null,
  type_code     text not null default 'BUREAU' references pointage.types_pointage(code),
  source        pointage.source_pointage not null,
  lieu          pointage.lieu_pointage not null default 'inconnu',
  remarque      text check (char_length(remarque) <= 500),
  client_id     uuid,                                       -- id généré par l'appareil (idempotence hors ligne)
  demande_id    uuid,
  annule        boolean not null default false,             -- jamais de DELETE : on annule
  annule_par    uuid references pointage.personnes(id),
  annule_le     timestamptz,
  cree_par      uuid not null references pointage.personnes(id),
  cree_le       timestamptz not null default now(),
  constraint pas_dans_le_futur check (horodatage <= cree_le + interval '5 minutes'),
  constraint annulation_complete check (annule = (annule_par is not null and annule_le is not null)),
  unique (personne_id, client_id)
);
create index on pointage.pointages (personne_id, horodatage desc) where not annule;

-- ---------------------------------------------------------------------
-- 5. Demandes et workflow
-- ---------------------------------------------------------------------
create table pointage.demandes (
  id                uuid primary key default gen_random_uuid(),
  numero            bigint generated always as identity unique,
  personne_id       uuid not null references pointage.personnes(id),
  type              pointage.type_demande not null,
  code_absence      text references pointage.codes_absence(code),
  date_debut        date not null,
  date_fin          date not null,
  demi              pointage.demi_journee,
  minutes           int check (minutes > 0),                 -- congé en heures (saisi)
  minutes_decomptees int not null default 0 check (minutes_decomptees >= 0), -- calculé à la soumission
  pointage_propose  jsonb,                                   -- correction : {horodatage, sens, type_code}
  commentaire       text check (char_length(commentaire) <= 1000),
  justificatif_url  text,
  statut            pointage.statut_demande not null default 'a_valider_n1',
  valideur_n1_id    uuid references pointage.personnes(id),
  decision_n1_le    timestamptz,
  commentaire_n1    text check (char_length(commentaire_n1) <= 1000),
  traite_rh_par     uuid references pointage.personnes(id),
  traite_rh_le      timestamptz,
  commentaire_rh    text check (char_length(commentaire_rh) <= 1000),
  cree_le           timestamptz not null default now(),
  maj_le            timestamptz not null default now(),
  check (date_fin >= date_debut),
  check (type <> 'conge_demi_jour' or (demi is not null and date_debut = date_fin)),
  check (type <> 'conge_heures' or (minutes is not null and date_debut = date_fin)),
  check (type <> 'correction_pointage' or pointage_propose is not null),
  check (type = 'correction_pointage' or code_absence is not null)
);
create index on pointage.demandes (personne_id, date_debut desc);
create index on pointage.demandes (statut) where statut in ('a_valider_n1', 'a_traiter_rh');

alter table pointage.pointages
  add constraint pointages_demande_fk foreign key (demande_id) references pointage.demandes(id);

create table pointage.transitions_demande (
  de    pointage.statut_demande not null,
  vers  pointage.statut_demande not null,
  primary key (de, vers)
);

-- ---------------------------------------------------------------------
-- 6. Soldes = grand livre
-- ---------------------------------------------------------------------
create table pointage.mouvements_compteur (
  id             bigint generated always as identity primary key,
  personne_id    uuid not null references pointage.personnes(id),
  compteur_code  text not null references pointage.compteurs(code),
  periode_debut  date not null,                             -- 01/01 (annuel), 1er jour du trimestre, 2000-01-01 (sans période)
  date_effet     date not null default current_date,        -- date métier (clôture)
  type           pointage.type_mouvement not null,
  minutes        int  not null,                             -- + crédit / - débit
  demande_id     uuid references pointage.demandes(id),
  motif          text,
  cree_par       uuid not null references pointage.personnes(id),
  cree_le        timestamptz not null default now()
);
create index on pointage.mouvements_compteur (personne_id, compteur_code, periode_debut);

-- ---------------------------------------------------------------------
-- 7. Clôture mensuelle RH
-- ---------------------------------------------------------------------
create table pointage.clotures (
  mois          date primary key check (extract(day from mois) = 1),
  cloture_par   uuid not null references pointage.personnes(id),
  cloture_le    timestamptz not null default now(),
  export_hash   text
);

-- ---------------------------------------------------------------------
-- 8. Journal d'audit (append-only)
-- ---------------------------------------------------------------------
create table pointage.journal_audit (
  id         bigint generated always as identity primary key,
  table_nom  text not null,
  ligne_id   text not null,
  action     text not null check (action in ('INSERT','UPDATE','DELETE')),
  avant      jsonb,
  apres      jsonb,
  acteur_id  uuid,
  quand      timestamptz not null default now()
);
