# Répétition : démo « Un pointage, et le responsable le voit »

Gold : `device-pair` du skill Stageshow (gardé : la paire PC + téléphone, le téléphone qui chevauche le bord droit
de la fenêtre au-dessus du remplissage, la fenêtre épinglée en haut à gauche qui sort par le bas ; changé : l'écran
de bureau devient « Mon équipe aujourd'hui » de CFB Pointage, le téléphone montre l'appli (pas l'écran verrouillé),
fenêtre PWA à la couleur de l'appli, charte CFB, et une version étroite repensée : téléphone en héros + carte équipe).

Temps : 1. Sofia n'a pas pointé (téléphone et tuile) … 2. le doigt appuie sur « Pointer mon entrée » (1,3 s) …
3. bouton « Pointer ma sortie » + « Présente depuis 8:42 » … 4. 1,1 s plus tard, chez le chef : tuile verte,
16 présents, 3 pas pointé (le résultat tient). Joué une fois à l'arrivée à l'écran, bouton « Rejouer » dans la page.

Filmé : largeurs 1280 et 390, image de référence (mouvement réduit), appui au ralenti (70 ms), page construite.
Contrôle `film.mjs --gate` : réussi aux deux largeurs sur l'aperçu du kit.
Page construite : 6 alertes « kit override », fausses alertes (le build fusionne la CSS du kit dans un seul fichier,
l'outil ne la reconnaît plus au chemin `/kit/`) ; aucune en dev.
Corrigé en route : marges inégales des cartes, chiffre collé à son mot, icône sur un demi-pixel, texte du bouton
qui sautait à l'appui, fenêtre écrasée en étroit (remplacée par une carte), barre grise à côté de « Bonjour Sofia »,
compteur « télétravail » en barre entre deux vrais compteurs, scène de la même couleur que la page.

Relecture : faite par le même auteur (pas de relecteur indépendant).
Hypothèses : noms et heures fictifs (Sofia Janssens, 8:42) ; chiffres d'équipe d'exemple.
Pas vérifié : thème sombre (non demandé), autres navigateurs que Chromium.
