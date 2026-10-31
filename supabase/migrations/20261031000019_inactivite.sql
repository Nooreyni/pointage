-- =====================================================================
--  CFB Pointage — déconnexion automatique après inactivité (PC partagés : accueil, bureau RH…)
--  0 = jamais (défaut). Appliqué par l'appli ; un avertissement laisse 1 min pour rester connecté.
-- =====================================================================
insert into pointage.parametres (cle, valeur, unite, libelle, categorie, provisoire, source) values
  ('session_inactivite_min', 0, 'min', 'Déconnecter automatiquement après une inactivité de (0 = jamais)', 'Sécurité', true,
   'Proposition : 0 sur les téléphones ; ex. 30 min si des PC sont partagés')
on conflict (cle) do nothing;
