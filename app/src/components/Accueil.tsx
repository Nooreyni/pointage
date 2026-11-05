import { useState } from 'react'
import type { Api, Profil } from '../lib/types'
import { useDialogue } from './useDialogue'
import { IcCheck, IcFermer } from './Icones'
import HoraireHabituel from './HoraireHabituel'
import TeletravailHabituel from './TeletravailHabituel'
import NotifAppareil from './NotifAppareil'
import { InstallerAppli } from './Pwa'
import { bienvenue } from '../lib/aide'
import SignalerInfo from './SignalerInfo'

const ROLES: Record<Profil['role'], string> = {
  employe: 'Employé·e', rh: 'RH', admin_rh: 'Admin RH', responsable_isp: 'Responsable ISP', direction: 'Direction', admin: 'Admin général',
}

type Etape = { id: string; titre: string; intro: string }
const ETAPES: Etape[] = [
  { id: 'infos', titre: 'Tes informations', intro: 'Vérifie que tout est juste. Une erreur ? « Signaler à la RH » : elle corrige ta fiche.' },
  { id: 'horaires', titre: 'Tes horaires habituels', intro: 'À quelle heure arrives-tu et pars-tu d’habitude ? Ça sert à te rappeler de pointer au bon moment. Pas sûr·e ? « Automatique » : l’outil apprendra tout seul.' },
  { id: 'teletravail', titre: 'Tes jours de télétravail', intro: 'Coche tes jours habituels (aucun si tu n’en fais pas). Ces jours-là, ton pointage passe en « Télétravail » tout seul.' },
  { id: 'appli', titre: 'L’appli sur ton téléphone', intro: 'Une icône sur l’écran d’accueil pour pointer en un appui. Sur iPhone, c’est nécessaire pour recevoir les rappels.' },
  { id: 'notifs', titre: 'Les rappels', intro: 'Active les notifications sur cet appareil : un oubli de pointage ou une réponse à ta demande de congé, et tu es prévenu·e.' },
  { id: 'fin', titre: 'C’est prêt !', intro: 'Tu pourras tout changer plus tard dans Mon compte.' },
]

/**
 * Parcours d'accueil d'un nouvel utilisateur : 6 courtes étapes, chacune passable. « Passer le parcours » ou « Terminer »
 * le marque comme fait côté serveur (tous les appareils) ; ✕ = plus tard (reproposé à la prochaine ouverture).
 */
export default function Accueil({ api, profil, onFini, onPlusTard }: { api: Api; profil: Profil; onFini: () => void; onPlusTard: () => void }) {
  const [i, setI] = useState(0)
  const [faites, setFaites] = useState<Set<string>>(new Set())
  const ref = useDialogue<HTMLDivElement>(onPlusTard)
  const e = ETAPES[i]
  const derniere = i === ETAPES.length - 1
  const terminer = async () => { try { await api.terminerAccueil() } catch { /* reproposé plus tard, sans bloquer */ } onFini() }
  const suivant = () => (derniere ? terminer() : setI(i + 1))
  const role = profil.est_chef_service && profil.role === 'employe' ? 'Chef de service' : ROLES[profil.role]

  return (
    <div className="voile" role="dialog" aria-modal="true" aria-labelledby="titre-accueil">
      <div className="fenetre parcours" ref={ref}>
        <div className="entete-fenetre">
          <div className="texte-ligne">
            <span className="doux petit">{derniere ? 'Bienvenue sur CFB Pointage' : `Étape ${i + 1} sur ${ETAPES.length - 1} · 1 minute en tout`}</span>
            <h2 id="titre-accueil">{i === 0 ? `Bonjour ${profil.prenom} !` : e.titre}</h2>
          </div>
          <button type="button" className="fermer-fenetre" aria-label="Plus tard" title="Plus tard (reproposé à la prochaine ouverture)" onClick={onPlusTard}><IcFermer /></button>
        </div>
        <ol className="progression-parcours" aria-hidden="true">
          {ETAPES.slice(0, -1).map((x, k) => <li key={x.id} className={k < i ? 'fait' : k === i ? 'actif' : ''} />)}
        </ol>

        <p className="intro-parcours">{i === 0 ? 'Quelques réglages rapides pour bien démarrer. Chaque étape peut être passée si tu ne sais pas.' : e.intro}</p>

        <div className="corps-parcours">
          {e.id === 'infos' && <>
            <dl className="infos-compte">
              <div><dt>Nom</dt><dd>{profil.prenom} {profil.nom}</dd></div>
              <div><dt>Service</dt><dd>{profil.service}</dd></div>
              <div><dt>Rôle</dt><dd>{role}</dd></div>
              <div><dt>Régime</dt><dd>{profil.regime ?? '—'}</dd></div>
            </dl>
            <SignalerInfo api={api} />
          </>}
          {e.id === 'horaires' && <HoraireHabituel api={api} moi minutesJour={profil.minutes_jour}
                                                   onEnregistre={() => setFaites((f) => new Set(f).add('horaires'))} />}
          {e.id === 'teletravail' && <TeletravailHabituel api={api} personneId={profil.id} moi sansEtiquette />}
          {e.id === 'appli' && <InstallerAppli />}
          {e.id === 'notifs' && <NotifAppareil api={api} />}
          {e.id === 'fin' && <>
            <ul className="controle">{bienvenue(profil).map((t) => <li key={t}><span className="pastille-ok"><IcCheck size={14} /></span><span>{t}</span></li>)}</ul>
            <p className="doux petit" style={{ margin: 0 }}>Le bouton <strong>?</strong> en haut explique chaque écran.</p>
          </>}
        </div>

        <div className="actions actions-parcours">
          {i > 0 && !derniere && <button type="button" className="lien" onClick={() => setI(i - 1)}>Retour</button>}
          {i === 0 && <button type="button" className="lien" onClick={terminer}>Passer le parcours</button>}
          <span className="espace" />
          {!derniere && i > 0 && !faites.has(e.id) && <button type="button" className="bouton secondaire" onClick={suivant}>Passer</button>}
          <button type="button" className="bouton" onClick={suivant}>{derniere ? 'Commencer' : i === 0 ? 'C’est parti' : 'Suivant'}</button>
        </div>
      </div>
    </div>
  )
}
