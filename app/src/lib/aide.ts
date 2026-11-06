import type { Profil } from './types'

/**
 * Contenu de l'aide : une seule source pour le bouton « ? » (aide de l'écran ouvert), la page Aide
 * (tout, avec recherche) et la carte de bienvenue. Chaque réponse tient en une ou deux phrases.
 * `pour` limite une entrée à certains publics (sinon : tout le monde).
 */
export type Public = 'tous' | 'responsable' | 'gestion' | 'reglages' | 'direction'
export type Question = { q: string; r: string; pour?: Public }
export type EcranAide = { id: string; titre: string; enBref: string; pour?: Public; questions: Question[] }

export const AIDE: EcranAide[] = [
  { id: 'pointer', titre: 'Pointer', enBref: 'Pointer ton arrivée et ton départ en un appui, voir ta journée et ce qui reste à faire.', questions: [
    { q: 'Comment pointer ?', r: 'Un appui sur le grand bouton : « Pointer mon entrée », puis le même bouton pour la sortie. La pause de midi est déduite toute seule, ne la pointe pas.' },
    { q: 'J’ai oublié de pointer.', r: 'Un encadré « à régulariser » apparaît sous le bouton : « Corriger », indique l’heure, c’est enregistré. Ton responsable en est informé.' },
    { q: 'Qui régularise un jour « À régulariser » ?', r: 'Toi d’abord : « À régulariser » › Corriger (validé tout de suite, ton responsable est informé). Si tu étais absent·e (maladie, congé…), c’est la RH qui l’encode. La RH peut aussi ajouter des heures pour toi (Gestion › Suivi RH).' },
    { q: 'Je suis en télétravail.', r: 'Un jour de télétravail habituel, le pointage passe en « Télétravail » tout seul. Un autre jour : « Type » sous le bouton, puis « Télétravail ».' },
    { q: 'Je n’ai pas de réseau.', r: 'Pointe quand même : c’est gardé sur l’appareil et envoyé dès le retour du réseau, avec l’heure réelle du pointage.' },
    { q: 'À quoi sert « À traiter » ?', r: 'Ce qui t’attend aujourd’hui : demandes à valider, personnes à rappeler, jours à régulariser. Un appui t’y emmène.', pour: 'responsable' },
  ] },
  { id: 'agenda', titre: 'Mon mois · Calendrier', enBref: 'Ton mois d’un coup d’œil : télétravail, congés (accordés ou en attente), jours fériés.', questions: [
    { q: 'Que veulent dire les couleurs ?', r: 'La légende sous le calendrier : télétravail prévu ou pointé, congé accordé, demande en attente, férié, jour non travaillé.' },
    { q: 'Voir mes congés dans Outlook', r: 'Mon compte › Agenda Outlook : copie ton lien personnel et ajoute-le comme calendrier dans Outlook (ou Google, Apple).' },
  ] },
  { id: 'heures', titre: 'Mon mois · Heures', enBref: 'Ta fiche de temps : heures prestées, boni, absences et le détail jour par jour.', questions: [
    { q: 'Qu’est-ce que le boni ?', r: 'La différence entre ce que tu as presté et ce que ton régime prévoit. Positif : tu as plus presté ; négatif : moins.' },
    { q: 'Un jour est « À régulariser ».', r: 'Il manque un pointage ce jour-là. Appuie sur « À régulariser » dans le tableau pour indiquer tes heures, ou demande à la RH s’il s’agit d’une absence.' },
    { q: 'Exporter ou imprimer', r: 'Boutons « Imprimer » et « Exporter » (Excel, CSV, XML) au-dessus du tableau jour par jour.' },
    { q: 'Voir la fiche d’une personne de mon équipe', r: 'Le menu « Moi » en haut de la fiche permet de choisir une personne de ton équipe.', pour: 'responsable' },
  ] },
  { id: 'conges', titre: 'Congés', enBref: 'Demander un congé, suivre tes demandes et tes soldes ; pour un responsable, valider celles de l’équipe.', questions: [
    { q: 'Demander un congé', r: 'Nouvelle demande : jour(s), demi-journée ou heures, le type, les dates. Le décompte et ton solde restant s’affichent avant d’envoyer.' },
    { q: 'Annuler une demande', r: 'Mes demandes › Annuler, tant que le congé n’a pas commencé.' },
    { q: 'Mes soldes', r: 'La carte « Mes soldes » : ce qu’il te reste par compteur, en jours, et le détail en heures.' },
    { q: 'Valider une demande', r: 'À valider › « Ouvrir » : la fiche montre le solde avant / après et qui d’autre est absent. Accepter ou Refuser (avec un motif). C’est définitif.', pour: 'responsable' },
    { q: 'Valider plusieurs demandes d’un coup', r: 'Coche-les dans « À valider », puis « Accepter les … ».', pour: 'responsable' },
    { q: 'Calendrier d’équipe', r: 'Qui est absent quand, sur quatre semaines, avec le nombre d’absents par jour.', pour: 'responsable' },
    { q: 'Recevoir les demandes d’autres services', r: 'Sous la liste « À valider » : « Je reçois… › Modifier », puis coche les services à suivre.', pour: 'direction' },
  ] },
  { id: 'equipe', titre: 'Équipe · Aujourd’hui', pour: 'responsable', enBref: 'Qui est présent, en télétravail, absent ou pas encore pointé, service par service.', questions: [
    { q: 'Rappeler quelqu’un qui n’a pas pointé', r: 'La cloche à côté de son nom, ou « Rappeler les non pointés » pour tout le service.' },
    { q: 'Voir sa fiche de temps', r: 'Un appui sur son nom ouvre sa fiche de temps.' },
  ] },
  { id: 'bilan', titre: 'Équipe · Ce mois', pour: 'responsable', enBref: 'Le récapitulatif du mois par personne : jours pointés, heures, absences, télétravail, jours à régulariser.', questions: [
    { q: 'Exporter le récap', r: 'Bouton « Exporter » : Excel, CSV ou XML.' },
  ] },
  { id: 'rh', titre: 'Gestion · Suivi RH', pour: 'gestion', enBref: 'Le quotidien RH : indicateurs du mois, pointages à régulariser, congés à constater, clôture.', questions: [
    { q: 'Régulariser un pointage', r: 'Sous « Pointages à régulariser » : « Ajouter la sortie », « Ajouter les heures » ou « Encoder une absence ». Aussi depuis la fiche de temps d’une personne (Mon mois › Heures) : appuie sur « À régulariser ». C’est tracé dans le journal.' },
    { q: 'Une personne signale une info fausse', r: 'Carte « Infos à corriger » (et une alerte) : ouvre sa fiche, corrige, puis « Corrigé » ; la personne est prévenue.' },
    { q: 'Encoder une maladie', r: 'Carte « Encoder une absence » › Nouvelle absence. L’absence est accordée directement.' },
    { q: 'Clôturer le mois', r: 'Carte « Clôture du mois » : les points à vérifier s’affichent avant. Après clôture, plus de correction possible sur ce mois.' },
    { q: 'Attribuer les congés de l’année', r: 'Carte « Congés annuels » › Voir la proposition (au prorata du régime) › Attribuer. Sans risque de doublon.' },
  ] },
  { id: 'personnes', titre: 'Gestion · Personnes', pour: 'gestion', enBref: 'Créer, modifier et suivre les fiches : identité, horaire, compte, soldes, départ.', questions: [
    { q: 'Une nouvelle personne arrive', r: '« Nouvelle personne » (ou « Importer » pour plusieurs). La fiche reste ouverte : suis les étapes « Arrivée » (compte, congés, télétravail).' },
    { q: 'Créer son compte / mot de passe oublié', r: 'Sa fiche › Compte : un mot de passe est généré ; remets-le en main propre. Il ne sera plus affiché.' },
    { q: 'Horaires habituels d’une personne', r: 'Sa fiche › Horaire › « Horaires habituels » : un horaire courant ou « Autre ». Sert aux rappels et aux propositions de correction, pas aux heures dues.' },
    { q: 'Passer en 4/5, 3/5…', r: 'Sa fiche › Horaire › « Jours au choix » : coche les jours, l’heure par jour et la date de début.' },
    { q: 'Corriger un solde', r: 'Sa fiche › Soldes › Ajuster un solde (motif obligatoire). L’historique montre qui, quand et pourquoi.' },
    { q: 'Une personne quitte le CFB', r: 'Sa fiche › Départ › Préparer le départ : la date, l’impact, puis Enregistrer. Rien n’est supprimé ; l’accès s’arrête après la date.' },
  ] },
  { id: 'rapports', titre: 'Gestion · Rapports', pour: 'gestion', enBref: 'Les indicateurs du mois, le télétravail (et son indemnité) et les heures des ISP pour le CPAS.', questions: [
    { q: 'Pourquoi certains services sont regroupés ?', r: 'Les petits services sont réunis pour qu’on ne puisse pas deviner qui est malade (confidentialité).' },
    { q: 'L’indemnité de télétravail', r: 'Onglet Télétravail : calculée selon le montant et le mode réglés dans Réglages › Télétravail.' },
  ] },
  { id: 'admin', titre: 'Gestion · Réglages', pour: 'reglages', enBref: 'Les règles de l’outil : services et chefs, régimes, accès, compteurs, paramètres, fériés, journal.', questions: [
    { q: 'Changer une règle', r: 'Paramètres : chaque fonction a son interrupteur ou sa valeur. « À confirmer » signale une valeur provisoire.' },
    { q: 'Désigner un chef de service', r: 'Services › le service › coche le ou les chefs.' },
    { q: 'Qui a modifié quoi ?', r: 'Journal : toutes les modifications, avec l’auteur et la date.' },
    { q: 'L’outil fonctionne-t-il bien ?', r: 'Journal › « État du système » : tâches automatiques, envois des notifications, erreurs. Vérifié toutes les heures ; en cas de problème, l’admin général reçoit une alerte (une fois par jour et par problème).' },
  ] },
  { id: 'alertes', titre: 'Alertes', enBref: 'Tes notifications : décisions sur tes demandes, rappels, oublis de pointage.', questions: [
    { q: 'Recevoir les rappels sur mon téléphone', r: 'Active les notifications sur cet appareil (bouton en haut des alertes). Sinon, un e-mail est envoyé en secours.' },
  ] },
  { id: 'compte', titre: 'Mon compte', enBref: 'Tes informations, tes jours de télétravail, ton mot de passe, ton agenda Outlook et tes notifications.', questions: [
    { q: 'Une info sur ma fiche est fausse', r: 'Mon compte › « Signaler à la RH » : choisis ce qui est faux (service, régime…). La RH reçoit une alerte, corrige ta fiche, et tu es prévenu·e.' },
    { q: 'Changer mon mot de passe', r: 'Carte « Mot de passe » : ton mot de passe actuel, puis le nouveau (8 caractères minimum).' },
    { q: 'Indiquer mes horaires habituels', r: 'Carte « Mes horaires habituels » : un appui sur 8h – 16h, 8h30 – 16h30… ou « Autre » pour saisir tes heures. « Automatique » : l’outil les apprend d’après tes pointages. Ils servent aux rappels, pas au calcul de tes heures.' },
    { q: 'Revoir le parcours d’accueil', r: 'Mon compte › « Refaire le parcours d’accueil » : horaires, télétravail, appli et rappels en une minute.' },
    { q: 'Changer mes jours de télétravail', r: 'Carte « Mes jours de télétravail » : coche tes jours. Ton responsable est prévenu.' },
    { q: 'Une information est fausse', r: 'Nom, service ou régime : signale-le à la RH, qui corrige ta fiche.' },
    { q: 'Installer l’appli sur mon téléphone', r: 'Mon compte › « Appli sur cet appareil » › Installer (Android, PC). Sur iPhone : Safari › Partager › « Sur l’écran d’accueil » (nécessaire pour les rappels).' },
    { q: '« Nouvelle version disponible »', r: 'Touche « Mettre à jour » quand tu veux : l’appli se recharge en une seconde. Tes pointages faits hors ligne sont gardés.' },
  ] },
]

/** Publics auxquels appartient la personne connectée. */
export function publicsDe(p: Profil): Set<Public> {
  const s = new Set<Public>(['tous'])
  if (p.est_chef_service || ['rh', 'admin_rh', 'admin', 'direction', 'responsable_isp'].includes(p.role)) s.add('responsable')
  if (['rh', 'admin_rh', 'admin', 'direction'].includes(p.role)) s.add('gestion')
  if (['admin_rh', 'admin', 'direction'].includes(p.role)) s.add('reglages')
  if (['direction', 'admin'].includes(p.role)) s.add('direction')
  return s
}

/** L'aide visible pour ce profil (écrans et questions filtrés). */
export function aidePour(p: Profil): EcranAide[] {
  const pub = publicsDe(p)
  return AIDE.filter((e) => pub.has(e.pour ?? 'tous'))
    .map((e) => ({ ...e, questions: e.questions.filter((q) => pub.has(q.pour ?? 'tous')) }))
}

/** Trois conseils pour bien démarrer, selon le rôle. */
export function bienvenue(p: Profil): string[] {
  const pub = publicsDe(p)
  if (pub.has('gestion')) return [
    'Gestion › Suivi RH : les indicateurs du mois et ce qui reste à régulariser.',
    'Gestion › Personnes : créer une fiche, son compte, ses soldes, son départ.',
    'Un nom cité quelque part est cliquable : il ouvre directement la bonne fiche.',
  ]
  if (pub.has('responsable')) return [
    'Pointer : « À traiter » rassemble ce qui t’attend (demandes, rappels).',
    'Congés › À valider › « Ouvrir » : solde et absences de l’équipe avant de décider.',
    'Équipe : qui est là aujourd’hui, et le récap du mois.',
  ]
  return [
    'Pointer : un appui à l’arrivée, un appui au départ. La pause de midi est déduite toute seule.',
    'Congés : demande un congé ; tu vois ton solde restant avant d’envoyer.',
    'Mon mois : ton calendrier et ta fiche de temps.',
  ]
}
