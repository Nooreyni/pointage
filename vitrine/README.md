# Vitrine : démo animée de CFB Pointage

Illustration produit (pas l'appli) : Sofia pointe sur son téléphone, la vue « Mon équipe aujourd'hui » de son chef
se met à jour. Faite avec le kit **Stageshow** (MIT, `src/kit/LICENSE`) pour une page de présentation (direction, intranet).

```bash
cd vitrine && npm ci && npm run dev      # aperçu
npm run build                            # page statique dans vitrine/dist (hébergeable n'importe où, chemins relatifs)
```

Indépendante de l'appli : rien dans `app/` n'en dépend ; supprimer le dossier `vitrine/` suffit à la retirer.
La scène : `src/demo/` (composition, temps, styles) ; détails de la répétition dans `src/demo/REHEARSAL.md`.
