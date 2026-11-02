import { useEffect, useState } from 'react'
import type { Api, Presence, Profil } from '../lib/types'
import { jourBxl } from '../lib/temps'
import { IcOk } from './Icones'
import { etatDe } from '../screens/Equipe'
import { useReglage } from '../lib/reglages'

export type CibleAction = 'conges-valider' | 'equipe' | 'rh'
type Action = { cle: string; nombre: number; texte: string; bouton: string; faire: () => void }

const MOIS = new Intl.DateTimeFormat('fr-BE', { month: 'long', timeZone: 'UTC' })
const moisPrecedent = () => { const d = new Date(`${jourBxl().slice(0, 8)}01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10) }

/**
 * Accueil des responsables : ce qui attend une action aujourd'hui, en une carte, chaque ligne avec son bouton.
 * Chef : demandes à valider, équipe pas encore pointée. RH : jours à régulariser, justificatifs, clôture.
 * Direction / RH : l'état de présence du CFB en une ligne.
 */
export default function ActionsDuJour({ api, profil, aValider, onAller }: {
  api: Api; profil: Profil; aValider: number; onAller: (c: CibleAction) => void
}) {
  const rh = ['rh', 'admin_rh', 'admin'].includes(profil.role)
  const vueCfb = rh || profil.role === 'direction'
  const justifsActifs = useReglage('justificatifs_actifs') === 1
  const [presence, setPresence] = useState<Presence[]>([])
  const [anomalies, setAnomalies] = useState(0)
  const [justifs, setJustifs] = useState(0)
  const [cloture, setCloture] = useState<string | null>(null)
  const [rappel, setRappel] = useState<string | null>(null)

  useEffect(() => {
    api.presence().then(setPresence).catch(() => {})
    if (!rh) return
    api.anomaliesTous().then((a) => setAnomalies(new Set(a.filter((x) => x.code !== 'semaine_max').map((x) => x.personne_id)).size)).catch(() => {})
    if (justifsActifs) api.justificatifsManquants().then((j) => setJustifs(j.length)).catch(() => {})
    const m = moisPrecedent()
    api.etatCloture(m).then((e) => setCloture(e.mois_termine && !e.deja_cloture ? MOIS.format(new Date(`${m}T12:00:00Z`)) : null)).catch(() => {})
  }, [api, rh, justifsActifs])

  const nonPointesEquipe = presence.filter((p) => p.mon_service && p.statut === 'Pas encore pointé' && p.personne_id !== profil.id)
  const compte = (f: (p: Presence) => boolean) => presence.filter(f).length
  const actions: Action[] = [
    ...(aValider ? [{ cle: 'valider', nombre: aValider, texte: aValider > 1 ? 'demandes de congé à valider' : 'demande de congé à valider', bouton: 'Valider', faire: () => onAller('conges-valider') }] : []),
    ...(profil.est_chef_service && nonPointesEquipe.length ? [{ cle: 'np', nombre: nonPointesEquipe.length, texte: 'de ton équipe pas encore pointé(s)', bouton: rappel ? 'Rappelé' : 'Rappeler',
      faire: async () => { const n = await api.envoyerRappel(nonPointesEquipe.map((p) => p.personne_id)).catch(() => 0); setRappel(n ? `Rappel envoyé à ${n} personne(s)` : 'Déjà rappelé récemment') } }] : []),
    ...(rh && anomalies ? [{ cle: 'ano', nombre: anomalies, texte: 'personne(s) avec des jours à régulariser', bouton: 'Voir', faire: () => onAller('rh') }] : []),
    ...(rh && justifs ? [{ cle: 'jus', nombre: justifs, texte: 'justificatif(s) manquant(s)', bouton: 'Voir', faire: () => onAller('rh') }] : []),
    ...(rh && cloture ? [{ cle: 'clo', nombre: 1, texte: `clôture de ${cloture} à faire`, bouton: 'Clôturer', faire: () => onAller('rh') }] : []),
  ]

  return (
    <section className="carte actions-jour" aria-label="À traiter aujourd’hui">
      <h2>À traiter</h2>
      {vueCfb && presence.length > 0 && (
        <button className="etat-cfb" onClick={() => onAller('equipe')}>
          <span className="doux">Au CFB aujourd’hui</span>
          <span className="etat-cfb__chiffres">
            <span><span className="point present" />{compte((p) => etatDe(p.statut) === 'present')} présents</span>
            <span><span className="point tt" />{compte((p) => etatDe(p.statut) === 'tt')} TT</span>
            <span><span className="point absent" />{compte((p) => etatDe(p.statut) === 'absent')} absents</span>
            <span><span className="point" />{compte((p) => etatDe(p.statut) === 'non_pointe')} pas pointé</span>
          </span>
        </button>
      )}
      {actions.length === 0
        ? <p className="rien-a-faire"><IcOk /> Rien à traiter pour l’instant.</p>
        : <ul className="liste-actions">{actions.map((a) => (
            <li key={a.cle}>
              <strong className="nombre-action">{a.nombre}</strong>
              <span className="texte-ligne">{a.texte}</span>
              <button className="bouton secondaire petit" disabled={a.cle === 'np' && !!rappel} onClick={a.faire}>{a.bouton}</button>
            </li>
          ))}</ul>}
      {rappel && <p className="doux petit" role="status" style={{ margin: '6px 0 0' }}>{rappel}</p>}
    </section>
  )
}
