-- =====================================================================
--  CFB Pointage — schéma de données (v0.3)
--
--  Principes
--   • Identité : Microsoft Entra ID via Supabase Auth, pas de mot de passe local
--   • Données dans le schéma privé « pointage » (non exposé par l'API REST)
--   • Aucune écriture directe : tout passe par les fonctions de l'API
--   • Rôles génériques (direction, chef de service, RH…), jamais de noms
--   • Durées en minutes (entiers)
--   • Règles chiffrées dans « parametres » (provisoire = à confirmer par le règlement de travail)
--
--  v0.3 (31/10/2026) : régimes hebdomadaires, validation décentralisée (N+1 définitif),
--  IP stockée, pause auto, boni / heures à valider, rappels, accès inter-services.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

create schema if not exists pointage;

-- ---------------------------------------------------------------------
-- 1. Types
-- ---------------------------------------------------------------------
create type pointage.role_app        as enum ('employe', 'rh', 'admin_rh', 'responsable_isp', 'direction', 'admin');
create type pointage.type_personne   as enum ('interne', 'isp');
create type pointage.contrat         as enum ('temps_plein', 'temps_partiel', 'isp');
create type pointage.sens_pointage   as enum ('entree', 'sortie');
create type pointage.source_pointage as enum ('mobile', 'web', 'correction', 'rh');
create type pointage.lieu_pointage   as enum ('reseau_cfb', 'externe', 'inconnu');
create type pointage.periodicite     as enum ('annuelle', 'trimestrielle', 'aucune');
create type pointage.type_demande    as enum ('conge_jours', 'conge_demi_jour', 'conge_heures');
create type pointage.demi_journee    as enum ('matin', 'apres_midi');
create type pointage.statut_demande  as enum ('en_attente', 'accordee', 'refusee', 'annulee');
create type pointage.type_mouvement  as enum ('ouverture', 'attribution', 'prise', 'ajustement', 'report',
                                              'expiration', 'annulation', 'hs_validees');

-- ---------------------------------------------------------------------
-- 2. Paramètres (une ligne = une règle chiffrée)
-- ---------------------------------------------------------------------
create table pointage.parametres (
  cle        text primary key,
  valeur     int  not null,
  unite      text not null,                -- 'min', 'jours', 'mois', 'semaines', 'min_depuis_minuit'
  libelle    text not null,
  provisoire boolean not null default true, -- true = valeur par défaut, à confirmer (règlement de travail)
  source     text
);

-- ---------------------------------------------------------------------
-- 3. Organisation
-- ---------------------------------------------------------------------
-- Régime hebdomadaire : minutes prévues par jour, lundi → dimanche
create table pointage.regimes (
  id              smallserial primary key,
  libelle         text not null unique,
  contrat         pointage.contrat not null default 'temps_plein',
  minutes_jour    int[] not null check (cardinality(minutes_jour) = 7
                                        and 0 <= all (minutes_jour) and 720 >= all (minutes_jour)),
  minutes_semaine int generated always as (minutes_jour[1] + minutes_jour[2] + minutes_jour[3] + minutes_jour[4]
                                           + minutes_jour[5] + minutes_jour[6] + minutes_jour[7]) stored,
  actif           boolean not null default true
);

create table pointage.services (
  id                uuid primary key default gen_random_uuid(),
  nom               text not null unique,
  parent_id         uuid references pointage.services(id),  -- service supérieur (direction)
  couleur           text check (couleur ~ '^#[0-9a-fA-F]{6}$'),
  seuil_absence_pct smallint not null default 50 check (seuil_absence_pct between 0 and 100),
  actif             boolean not null default true
);

create table pointage.personnes (
  id              uuid primary key default gen_random_uuid(),
  auth_user_id    uuid unique,                               -- lié au 1er login SSO
  matricule       text unique,                               -- n° Partena
  nom             text not null,
  prenom          text not null,
  email           text not null unique check (email = lower(email)),
  type            pointage.type_personne not null default 'interne',
  role            pointage.role_app not null default 'employe',
  service_id      uuid not null references pointage.services(id),
  partenaire_isp  text,                                      -- ex. 'CPAS de …'
  date_entree     date not null,
  date_sortie     date,
  cree_le         timestamptz not null default now(),
  constraint isp_a_partenaire check (type <> 'isp' or partenaire_isp is not null),
  constraint dates_coherentes check (date_sortie is null or date_sortie >= date_entree)
);

-- Historique des régimes (un temps partiel peut changer en cours d'année)
create table pointage.personne_regimes (
  personne_id  uuid not null references pointage.personnes(id),
  debut        date not null,
  regime_id    smallint not null references pointage.regimes(id),
  primary key (personne_id, debut)
);

-- Chefs de service (N+1). Un service sans chef remonte à son service parent.
create table pointage.responsables_service (
  service_id   uuid not null references pointage.services(id) on delete cascade,
  personne_id  uuid not null references pointage.personnes(id),
  primary key (service_id, personne_id)
);

-- Accès d'un responsable à un autre service (lecture, et validation si peut_valider)
create table pointage.acces_services (
  personne_id  uuid not null references pointage.personnes(id),
  service_id   uuid not null references pointage.services(id) on delete cascade,
  peut_valider boolean not null default false,
  accorde_par  uuid not null references pointage.personnes(id),
  accorde_le   timestamptz not null default now(),
  primary key (personne_id, service_id)
);

-- Services dont la direction veut recevoir les demandes (en plus de ses N-1)
create table pointage.abonnements_service (
  personne_id  uuid not null references pointage.personnes(id),
  service_id   uuid not null references pointage.services(id) on delete cascade,
  primary key (personne_id, service_id)
);

create table pointage.jours_feries (
  jour        date primary key,
  libelle     text not null,
  recuperable boolean generated always as (extract(isodow from jour) >= 6) stored
);

-- Plages réseau du CFB (classement réseau CFB / externe)
create table pointage.reseaux_cfb (
  plage    cidr primary key,
  libelle  text not null
);

-- ---------------------------------------------------------------------
-- 4. Catalogue
-- ---------------------------------------------------------------------
create table pointage.compteurs (
  code                text primary key,
  libelle             text not null,
  periodicite         pointage.periodicite not null default 'annuelle',
  visible_employe     boolean not null default true,
  autorise_negatif    boolean not null default true,         -- comme Dinclock ; alerte si négatif
  ordre               smallint not null default 100,
  actif               boolean not null default true
);

create table pointage.codes_absence (
  code                text primary key,
  libelle             text not null,
  code_court          text,                                   -- affiché dans l'agenda (VA, Mal…)
  compteur_code       text references pointage.compteurs(code),
  demandable          boolean not null default true,          -- false = encodé par la RH
  justificatif_requis boolean not null default false,
  couleur             text,
  ordre               smallint not null default 100,
  actif               boolean not null default true
);

create table pointage.types_pointage (
  code                 text primary key,
  libelle              text not null,
  libelle_presence     text not null,                         -- statut affiché aux collègues
  compte_comme_travail boolean not null default true,
  ordre                smallint not null default 100,
  actif                boolean not null default true
);

-- ---------------------------------------------------------------------
-- 5. Pointages
-- ---------------------------------------------------------------------
create table pointage.pointages (
  id            uuid primary key default gen_random_uuid(),
  personne_id   uuid not null references pointage.personnes(id),
  horodatage    timestamptz not null,
  sens          pointage.sens_pointage not null,
  type_code     text not null default 'BUREAU' references pointage.types_pointage(code),
  source        pointage.source_pointage not null,
  lieu          pointage.lieu_pointage not null default 'inconnu',
  ip            inet,                                         -- conservée (décision CFB), pas d'info appareil
  remarque      text check (char_length(remarque) <= 500),
  client_id     uuid,                                         -- idempotence hors ligne
  annule        boolean not null default false,
  annule_par    uuid references pointage.personnes(id),
  annule_le     timestamptz,
  annule_motif  text check (char_length(annule_motif) <= 500),
  cree_par      uuid not null references pointage.personnes(id),
  cree_le       timestamptz not null default now(),
  constraint pas_dans_le_futur check (horodatage <= cree_le + interval '5 minutes'),
  constraint annulation_complete check (annule = (annule_par is not null and annule_le is not null)),
  unique (personne_id, client_id)
);
create index on pointage.pointages (personne_id, horodatage desc) where not annule;

-- ---------------------------------------------------------------------
-- 6. Demandes de congé (validation décentralisée : décision du N+1 définitive)
-- ---------------------------------------------------------------------
create table pointage.demandes (
  id                   uuid primary key default gen_random_uuid(),
  numero               bigint generated always as identity unique,
  personne_id          uuid not null references pointage.personnes(id),
  type                 pointage.type_demande not null,
  code_absence         text not null references pointage.codes_absence(code),
  date_debut           date not null,
  date_fin             date not null,
  demi                 pointage.demi_journee,
  minutes              int check (minutes > 0),                -- congé en heures (saisi)
  minutes_decomptees   int not null default 0 check (minutes_decomptees >= 0),
  commentaire          text check (char_length(commentaire) <= 1000),
  justificatif_url     text,
  statut               pointage.statut_demande not null default 'en_attente',
  decide_par           uuid references pointage.personnes(id),
  decide_le            timestamptz,
  commentaire_decision text check (char_length(commentaire_decision) <= 1000),
  constate_par         uuid references pointage.personnes(id), -- la RH « constate »
  constate_le          timestamptz,
  encode_par_rh        boolean not null default false,          -- maladie, AT… encodés par la RH
  cree_par             uuid not null references pointage.personnes(id),
  cree_le              timestamptz not null default now(),
  maj_le               timestamptz not null default now(),
  check (date_fin >= date_debut),
  check (type <> 'conge_demi_jour' or (demi is not null and date_debut = date_fin)),
  check (type <> 'conge_heures' or (minutes is not null and date_debut = date_fin))
);
create index on pointage.demandes (personne_id, date_debut desc);
create index on pointage.demandes (statut) where statut = 'en_attente';

-- Décisions sur les heures au-delà du maximum journalier (politique : pas d'heures sup)
create table pointage.decisions_hs (
  personne_id  uuid not null references pointage.personnes(id),
  jour         date not null,
  minutes      int  not null check (minutes > 0),
  accordee     boolean not null,
  commentaire  text,
  decide_par   uuid not null references pointage.personnes(id),
  decide_le    timestamptz not null default now(),
  primary key (personne_id, jour)
);

-- ---------------------------------------------------------------------
-- 7. Soldes = grand livre
-- ---------------------------------------------------------------------
create table pointage.mouvements_compteur (
  id             bigint generated always as identity primary key,
  personne_id    uuid not null references pointage.personnes(id),
  compteur_code  text not null references pointage.compteurs(code),
  periode_debut  date not null,
  date_effet     date not null default current_date,
  type           pointage.type_mouvement not null,
  minutes        int  not null,
  demande_id     uuid references pointage.demandes(id),
  motif          text,
  cree_par       uuid references pointage.personnes(id),    -- null = calcul automatique (clôture)
  cree_le        timestamptz not null default now()
);
create index on pointage.mouvements_compteur (personne_id, compteur_code, periode_debut);

-- ---------------------------------------------------------------------
-- 8. Clôture mensuelle
-- ---------------------------------------------------------------------
create table pointage.clotures (
  mois          date primary key check (extract(day from mois) = 1),
  cloture_par   uuid not null references pointage.personnes(id),
  cloture_le    timestamptz not null default now(),
  export_hash   text
);

-- ---------------------------------------------------------------------
-- 9. Notifications (rappels) et abonnements push
-- ---------------------------------------------------------------------
create table pointage.notifications (
  id              bigint generated always as identity primary key,
  personne_id     uuid not null references pointage.personnes(id),
  type            text not null,                 -- oubli_entree, oubli_sortie, demande_a_traiter, …
  cle             text not null,                 -- anti-doublon
  titre           text not null,
  corps           text,
  lien            text,
  cree_le         timestamptz not null default now(),
  lu_le           timestamptz,
  push_envoye_le  timestamptz,
  mail_envoye_le  timestamptz,
  unique (personne_id, cle)
);
create index on pointage.notifications (personne_id, cree_le desc);
create index on pointage.notifications (cree_le) where push_envoye_le is null;

create table pointage.push_abonnements (
  id           uuid primary key default gen_random_uuid(),
  personne_id  uuid not null references pointage.personnes(id),
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  cree_le      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 10. Journal d'audit (append-only)
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
