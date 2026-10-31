-- =====================================================================
--  CFB Pointage — moindre privilège sur le schéma interne « pointage » (audit approfondi)
--  Par défaut PostgreSQL donne EXECUTE à tous sur chaque fonction. Le schéma n'est pas exposé par
--  l'API, mais si on activait un jour GraphQL ou l'exposition de ce schéma, des fonctions internes
--  (purge, envoi, reports…) deviendraient appelables. On ne laisse aux utilisateurs connectés que
--  les fonctions dont les vues et règles d'accès ont besoin ; toute nouvelle fonction est fermée.
-- =====================================================================
revoke execute on all functions in schema pointage from public, anon, authenticated;

grant execute on function
  pointage.moi(), pointage.mon_role(), pointage.peut_voir(uuid), pointage.est_valideur_de(uuid),
  pointage.jour_bxl(timestamptz), pointage.param(text), pointage.aujourdhui(),
  pointage.journees_set(date, date, uuid[]),
  pointage.peut_lire_justificatif(uuid), pointage.peut_deposer_justificatif(uuid), pointage.dossier_personne(text)
to authenticated;

-- Fonctions créées plus tard dans ce schéma : fermées par défaut
alter default privileges in schema pointage revoke execute on functions from public;
