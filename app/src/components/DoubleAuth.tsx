import { useCallback, useEffect, useState } from 'react'
import type { Api } from '../lib/types'
import { messageErreur } from '../lib/supabase'
import { IcCheck } from './Icones'

/**
 * Double authentification (code à 6 chiffres d'une application : Microsoft Authenticator, Google Authenticator…).
 * mode « gestion » : dans Mon compte. mode « exiger » : écran bloquant quand l'option est cochée (Réglages › Sécurité).
 */
export default function DoubleAuth({ api, mode = 'gestion', onOk }: { api: Api; mode?: 'gestion' | 'exiger'; onOk?: () => void }) {
  const [etat, setEtat] = useState<Awaited<ReturnType<Api['mfaEtat']>> | null>(null)
  const [inscription, setInscription] = useState<{ id: string; qr: string; secret: string } | null>(null)
  const [code, setCode] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)
  const charger = useCallback(() => { api.mfaEtat().then(setEtat).catch((e) => setErreur(messageErreur(e))) }, [api])
  useEffect(() => { charger() }, [charger])

  const verifier = async (facteurId: string) => {
    setEnCours(true); setErreur(null)
    try { await api.mfaVerifier(facteurId, code); setCode(''); setInscription(null); charger(); onOk?.() }
    catch (e) { setErreur(messageErreur(e)) } finally { setEnCours(false) }
  }
  if (api.mode === 'demo') return <p className="doux petit" style={{ margin: 0 }}>Non disponible en démo.</p>
  if (!etat) return <p className="vide">Chargement…</p>
  const facteur = etat.facteurs[0]

  const champCode = (facteurId: string, libelle: string) => (
    <form className="ligne code-mfa" onSubmit={(e) => { e.preventDefault(); verifier(facteurId) }}>
      <input id="code-mfa" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123 456" aria-label="Code à 6 chiffres"
             value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
      <button className="bouton" disabled={enCours || code.replace(/\s/g, '').length < 6}>{enCours ? 'Vérification…' : libelle}</button>
    </form>
  )

  return (
    <div className="double-auth">
      {facteur && etat.niveau === 'aal2' && mode === 'gestion' && <>
        <p className="positif petit statut-inline" style={{ marginTop: 0 }}><IcCheck size={14} />Activée ({facteur.nom})</p>
        <button className="lien petit" onClick={async () => { try { await api.mfaRetirer(facteur.id); charger() } catch (e) { setErreur(messageErreur(e)) } }}>Désactiver</button>
      </>}
      {facteur && etat.niveau === 'aal1' && <>
        <p className="petit" style={{ marginTop: 0 }}>Entre le code affiché dans ton application d’authentification.</p>
        {champCode(facteur.id, 'Confirmer')}
      </>}
      {!facteur && !inscription && <>
        <p className="petit" style={{ marginTop: 0 }}>{mode === 'exiger' ? 'Ton rôle exige une double authentification. ' : ''}Installe une application d’authentification
          (Microsoft Authenticator, Google Authenticator…), puis active-la ici.</p>
        <button className="bouton" onClick={async () => { try { setInscription(await api.mfaInscrire()) } catch (e) { setErreur(messageErreur(e)) } }}>Activer la double authentification</button>
      </>}
      {inscription && <>
        <p className="petit" style={{ marginTop: 0 }}>1. Scanne ce code avec l’application. 2. Entre le code à 6 chiffres qu’elle affiche.</p>
        <img className="qr-mfa" src={inscription.qr} alt="Code QR à scanner avec l’application d’authentification" width={180} height={180} />
        <p className="doux petit">Sans appareil photo : saisis la clé <code>{inscription.secret}</code></p>
        {champCode(inscription.id, 'Activer')}
      </>}
      {erreur && <p className="negatif petit" role="alert">{erreur}</p>}
    </div>
  )
}
