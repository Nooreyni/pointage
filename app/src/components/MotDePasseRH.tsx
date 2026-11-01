import { useState } from 'react'
import { IcCheck } from './Icones'
import type { Api, MotDePasseGenere } from '../lib/types'
import { messageErreur } from '../lib/supabase'

/**
 * RH / admin : crée le compte d'une personne avec un mot de passe généré, ou lui en génère un nouveau (oubli).
 * Le mot de passe n'est affiché qu'une fois : la RH le remet à la personne, qui peut le garder ou le changer.
 */
export default function MotDePasseRH({ api, personneId, compteLie, onFait }: {
  api: Api; personneId: string; compteLie?: boolean; onFait?: () => void   // compteLie inconnu : bouton unique
}) {
  const [resultat, setResultat] = useState<MotDePasseGenere | null>(null)
  const [confirmer, setConfirmer] = useState(false)
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [copie, setCopie] = useState(false)

  async function generer() {
    setEnCours(true); setErreur(null); setConfirmer(false)
    try { setResultat(await api.genererMotDePasse(personneId)); onFait?.() }
    catch (e) { setErreur(messageErreur(e)) } finally { setEnCours(false) }
  }

  if (resultat) {
    return (
      <div className="mdp-genere" role="status">
        <p className="petit" style={{ marginTop: 0 }}>{resultat.cree ? 'Compte créé.' : 'Nouveau mot de passe enregistré.'} À remettre à <strong>{resultat.nom}</strong> :</p>
        <div className="ligne">
          <code className="mdp">{resultat.mot_de_passe}</code>
          <button className="bouton secondaire petit" onClick={async () => {
            try { await navigator.clipboard.writeText(resultat.mot_de_passe); setCopie(true) } catch { setCopie(false) }
          }}>{copie ? <><IcCheck size={14} />Copié</> : 'Copier'}</button>
        </div>
        <p className="doux petit">Identifiant : <strong>{resultat.email}</strong>. Ce mot de passe <strong>ne sera plus affiché</strong> : remets-le en main propre
          ou par un canal sûr (pas sur un post-it). La personne peut le garder ou le changer dans « Mon compte ».</p>
        <button className="lien petit" onClick={() => { setResultat(null); setCopie(false) }}>Terminé</button>
      </div>
    )
  }

  return (
    <div>
      {compteLie === undefined && (confirmer
        ? <div>
            <p className="petit attention" style={{ marginTop: 0 }}>Si la personne a déjà un mot de passe, l’ancien ne fonctionnera plus. Continuer ?</p>
            <div className="actions" style={{ justifyContent: 'flex-start' }}>
              <button className="bouton" disabled={enCours} onClick={generer}>{enCours ? 'Génération…' : 'Oui, générer'}</button>
              <button className="bouton secondaire" onClick={() => setConfirmer(false)}>Annuler</button>
            </div>
          </div>
        : <button className="bouton secondaire" onClick={() => setConfirmer(true)}>Générer un mot de passe</button>)}
      {compteLie === false && <>
        <p className="petit" style={{ marginTop: 0 }}>Pas encore de compte. Crée-le avec un mot de passe généré automatiquement
          (la personne pourra aussi se connecter avec Microsoft si elle a un compte Office 365 du CFB).</p>
        <button className="bouton secondaire" disabled={enCours} onClick={generer}>{enCours ? 'Création…' : 'Créer le compte et générer un mot de passe'}</button>
      </>}
      {compteLie === true && (confirmer
        ? <div>
            <p className="petit attention" style={{ marginTop: 0 }}>L’ancien mot de passe de la personne ne fonctionnera plus. Continuer ?</p>
            <div className="actions" style={{ justifyContent: 'flex-start' }}>
              <button className="bouton" disabled={enCours} onClick={generer}>{enCours ? 'Génération…' : 'Oui, générer'}</button>
              <button className="bouton secondaire" onClick={() => setConfirmer(false)}>Annuler</button>
            </div>
          </div>
        : <button className="bouton secondaire" onClick={() => setConfirmer(true)}>Mot de passe oublié : en générer un nouveau</button>)}
      {erreur && <p className="negatif petit" role="alert">{erreur}</p>}
    </div>
  )
}
