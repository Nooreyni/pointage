import type { Profil } from '../lib/types'

type Q = [string, string]
const TOUS: [string, Q[]][] = [
  ['Pointer', [
    ['Comment pointer mon arrivée et mon départ ?', 'Onglet Pointer : un appui sur le grand bouton. Le même bouton sert pour la sortie.'],
    ['J’ai oublié de pointer.', 'Un encadré « à régulariser » apparaît sous le bouton : « Corriger », indique l’heure, c’est enregistré. Ton responsable est informé.'],
    ['Je suis en télétravail, que faire ?', 'Rien de spécial : hors du réseau du CFB, ou un jour de télétravail habituel, le pointage passe en « Télétravail ». Pour un autre type : « Type » sous le bouton.'],
    ['Pas de réseau ?', 'Pointe quand même : c’est gardé sur le téléphone et envoyé dès le retour du réseau, avec l’heure réelle.'],
  ]],
  ['Congés', [
    ['Demander un congé', 'Onglet Congés › Nouvelle demande : type, dates, envoyer. Ton responsable reçoit la demande ; tu es prévenu de sa réponse.'],
    ['Voir mes soldes', 'Onglet Congés : « Mes soldes ». Le calendrier de Mon mois montre tes congés accordés et en attente.'],
    ['Annuler une demande', 'Congés › Mes demandes › Annuler (tant que le congé n’a pas commencé).'],
  ]],
  ['Mon compte', [
    ['Changer mon mot de passe', 'Avatar en haut à droite › Mon compte › Mot de passe.'],
    ['Mes jours de télétravail', 'Mon compte › Mes jours de télétravail. Ton responsable est prévenu à chaque changement.'],
    ['Installer l’appli sur mon téléphone', 'Ouvre le site dans le navigateur › menu › « Ajouter à l’écran d’accueil ». Sur iPhone : bouton Partager › « Sur l’écran d’accueil ».'],
    ['Recevoir les rappels', 'Onglet Alertes (la cloche) › Activer les notifications sur cet appareil.'],
  ]],
]
const CHEF: [string, Q[]] = ['Responsable', [
  ['Valider une demande', 'Accueil › « À traiter » › Valider, ou Congés › À valider. Accepter ou refuser est définitif.'],
  ['Qui est là aujourd’hui ?', 'Équipe › Aujourd’hui. La cloche à côté d’un nom envoie un rappel de pointage.'],
  ['Le bilan du mois de mon équipe', 'Équipe › Ce mois : jours pointés, absences, télétravail, jours à régulariser. Exportable.'],
]]
const RH: [string, Q[]] = ['RH et administration', [
  ['Clôturer le mois', 'Gestion › Suivi RH › Clôture du mois. Les anomalies restantes sont listées avant.'],
  ['Une nouvelle personne arrive', 'Gestion › Personnes › Nouvelle personne (ou Importer pour plusieurs). La fiche reste ouverte : suis les étapes « Arrivée » (compte, congés, télétravail).'],
  ['Une personne quitte le CFB', 'Sa fiche › Départ › Préparer le départ : la date, l’impact (soldes, demandes), puis Enregistrer. Rien n’est supprimé.'],
  ['Corriger un solde', 'Sa fiche › Soldes et compteurs › Ajuster un solde (motif obligatoire, tracé).'],
  ['Changer une règle (pause, indemnité…)', 'Gestion › Réglages › Paramètres. Chaque fonction a son interrupteur ; tout est tracé dans le Journal.'],
]]

/** Aide : les questions courantes, en une phrase chacune. */
export default function Aide({ profil }: { profil: Profil }) {
  const groupes: [string, Q[]][] = [...TOUS,
    ...(profil.est_chef_service || ['direction', 'rh', 'admin_rh', 'admin', 'responsable_isp'].includes(profil.role) ? [CHEF] : []),
    ...(['rh', 'admin_rh', 'admin'].includes(profil.role) ? [RH] : [])]
  return (
    <main className="contenu">
      <div className="col-pleine pile">
        <section className="carte">
          <h2>Aide</h2>
          <p className="doux petit" style={{ marginBottom: 0 }}>Une question qui n’est pas ici ? Demande à la RH. Astuce : la loupe en haut (ou Ctrl + K) retrouve un écran, une personne ou un réglage.</p>
        </section>
        <div className="grille-cartes">
          {groupes.map(([titre, qs]) => (
            <section key={titre} className="carte">
              <h2>{titre}</h2>
              {qs.map(([q, r]) => (
                <details key={q} className="faq"><summary>{q}</summary><p>{r}</p></details>
              ))}
            </section>
          ))}
        </div>
      </div>
    </main>
  )
}
