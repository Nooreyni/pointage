import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Anomalie, Api, Journee, Pointage, Profil, Sens, TypePointage } from '../lib/types'
import { messageErreur } from '../lib/supabase'
import { enAttente, estErreurReseau, mettreEnAttente, synchroniser, versPointage } from '../lib/file'
import { dateCourte, dateLongue, decalerJour, duree, heure, heureHabituelle, hhmm, isoBxl, jourBxl, minutesDepuisMinuit } from '../lib/temps'
import { IcEntree, IcSortie } from '../components/Icones'
import Equipe from './Equipe'
import NotifAppareil from '../components/NotifAppareil'
import { useDialogue } from '../components/useDialogue'

// Valeurs de secours tant que les paramètres serveur ne sont pas chargés
const DEFAUTS = { pause_midi_min: 30, pause_seuil_min: 360, heure_entree_defaut: 510, heure_sortie_defaut: 1020 }

interface Message { texte: string; erreur?: boolean }

export default function Pointer({ api, profil, enLigne, onVoirEquipe, onVoirMois }: {
  api: Api; profil: Profil; enLigne: boolean; onVoirEquipe?: () => void; onVoirMois?: () => void
}) {
  const [regles, setRegles] = useState(DEFAUTS)
  const PAUSE = regles.pause_midi_min, SEUIL_PAUSE = regles.pause_seuil_min
  const [maintenant, setMaintenant] = useState(new Date())
  const [jour, setJour] = useState(jourBxl())
  const [pointages, setPointages] = useState<Pointage[]>([])
  const [historique, setHistorique] = useState<Pointage[]>([])
  const [journee, setJournee] = useState<Journee | null>(null)
  const [boni, setBoni] = useState<number | null>(null)
  const [anomalies, setAnomalies] = useState<Anomalie[]>([])
  const [types, setTypes] = useState<TypePointage[]>([])
  const [type, setType] = useState<string | null>(null)       // null = automatique (réseau CFB / extérieur)
  const [remarque, setRemarque] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)
  const [message, setMessage] = useState<Message | null>(null)
  const [aCorriger, setACorriger] = useState<Anomalie | null>(null)
  const [versionFile, setVersionFile] = useState(0)          // file hors ligne modifiée

  // Horloge (et changement de jour à minuit)
  useEffect(() => {
    const t = setInterval(() => { const n = new Date(); setMaintenant(n); setJour(jourBxl(n)) }, 15_000)
    return () => clearInterval(t)
  }, [])

  const charger = useCallback(async () => {
    try {
      const [pts, hist, j, b, a] = await Promise.all([
        api.pointages(jour, jour), api.pointages(decalerJour(jour, -40), decalerJour(jour, -1)),
        api.journee(jour), api.soldeBoni(), api.anomalies(),
      ])
      setPointages(pts); setHistorique(hist); setJournee(j); setBoni(b); setAnomalies(a)
    } catch (e) {
      if (!estErreurReseau(e)) setMessage({ texte: messageErreur(e), erreur: true })
    }
  }, [api, jour])

  useEffect(() => { charger(); api.typesPointage().then(setTypes).catch(() => {}) }, [charger, api])
  useEffect(() => {
    api.parametres().then((ps) => setRegles((r) => {
      const n = { ...r }
      for (const k of Object.keys(DEFAUTS) as (keyof typeof DEFAUTS)[]) { const v = ps.find((x) => x.cle === k); if (v) n[k] = v.valeur }
      return n
    })).catch(() => {})
  }, [api])

  // Retour du réseau → envoi des pointages gardés sur l'appareil
  useEffect(() => {
    if (!enLigne || enAttente().length === 0) return
    synchroniser(api).then((n) => {
      setVersionFile((v) => v + 1)
      if (n) { setMessage({ texte: `${n} pointage(s) envoyé(s) ✅` }); charger() }
    })
  }, [enLigne, api, charger])

  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(null), message.erreur ? 6000 : 3500)
    return () => clearTimeout(t)
  }, [message])

  // Pointages du jour + ceux en attente d'envoi
  const duJour = useMemo(() => {
    const attente: Pointage[] = []
    let sens: Sens = (pointages.filter((p) => !p.annule).at(-1)?.sens ?? 'sortie')
    for (const d of enAttente().filter((x) => x.horodatage && jourBxl(new Date(x.horodatage)) === jour)) {
      sens = sens === 'entree' ? 'sortie' : 'entree'
      attente.push(versPointage(d, sens))
    }
    return [...pointages, ...attente].sort((a, b) => a.horodatage.localeCompare(b.horodatage))
  }, [pointages, jour, versionFile])

  const actifs = duJour.filter((p) => !p.annule)
  const dernier = actifs.at(-1)
  const present = dernier?.sens === 'entree'
  const libelleType = (code: string) => types.find((t) => t.code === code)?.libelle ?? code

  // Temps presté en direct (la journée en cours compte jusqu'à maintenant)
  const direct = useMemo(() => {
    let brut = 0, pausePointee = 0
    actifs.forEach((p, i) => {
      const suiv = actifs[i + 1]
      if (p.sens === 'sortie') { if (suiv?.sens === 'entree') pausePointee += (Date.parse(suiv.horodatage) - Date.parse(p.horodatage)) / 60000; return }
      const fin = suiv?.sens === 'sortie' ? Date.parse(suiv.horodatage) : (i === actifs.length - 1 ? maintenant.getTime() : null)
      if (fin) brut += (fin - Date.parse(p.horodatage)) / 60000
    })
    // Même règle que le serveur : pause déduite au-delà du seuil, moins la pause déjà pointée
    const pause = brut > SEUIL_PAUSE ? Math.max(0, PAUSE - pausePointee) : 0
    return { preste: Math.max(0, Math.round(brut - pause)) }
  }, [actifs, maintenant, PAUSE, SEUIL_PAUSE])

  const aPrester = journee?.a_prester ?? 0
  const premiereEntree = actifs.find((p) => p.sens === 'entree')
  const finEstimee = premiereEntree && aPrester > 0
    ? minutesDepuisMinuit(premiereEntree.horodatage) + aPrester + (aPrester > SEUIL_PAUSE ? PAUSE : 0) : null

  async function pointer() {
    const d = { client_id: crypto.randomUUID(), type_code: present ? null : type, remarque: remarque?.trim() || null }
    const horodatage = new Date().toISOString()
    setEnCours(true)
    try {
      if (!navigator.onLine) throw new Error('Failed to fetch')
      const p = await api.pointer(d)
      setMessage({ texte: `${p.sens === 'entree' ? 'Entrée' : 'Sortie'} pointée à ${heure(p.horodatage)} ✅` })
      setRemarque(null); setType(null)
      await charger()
    } catch (e) {
      if (estErreurReseau(e)) {
        mettreEnAttente({ ...d, horodatage })
        setVersionFile((v) => v + 1)
        setMessage({ texte: `Pointage gardé sur l’appareil (${heure(horodatage)}) — envoyé dès le retour du réseau` })
      } else setMessage({ texte: messageErreur(e), erreur: true })
    } finally {
      setEnCours(false)
    }
  }

  async function annuler(p: Pointage) {
    try { await api.annulerPointage(p.id); setMessage({ texte: 'Pointage annulé' }); await charger() }
    catch (e) { setMessage({ texte: messageErreur(e), erreur: true }) }
  }

  const statut = !dernier ? { texte: aPrester > 0 ? 'Pas encore pointé' : 'Pas de prestation prévue aujourd’hui', classe: '' }
    : present ? { texte: `${dernier.type_code === 'TT' ? 'En télétravail' : libelleType(dernier.type_code) === 'Bureau' ? 'Présent' : libelleType(dernier.type_code)} depuis ${heure(dernier.horodatage)}`,
                  classe: dernier.type_code === 'TT' ? 'tt' : 'present' }
    : { texte: `Parti à ${heure(dernier.horodatage)}`, classe: 'parti' }

  const ratio = aPrester > 0 ? Math.min(100, (direct.preste / aPrester) * 100) : 0
  const boniJour = actifs.length && aPrester > 0 ? direct.preste - aPrester : null
  const aRegler = anomalies.filter((a) => a.code !== 'semaine_max')
  const semaines = anomalies.filter((a) => a.code === 'semaine_max')
  const hEntree = heureHabituelle(historique, 'entree', regles.heure_entree_defaut)
  const hSortie = heureHabituelle(historique, 'sortie', regles.heure_sortie_defaut)

  return (
    <main className="contenu">
      <div className="col-principale pile">
        <NotifAppareil api={api} compact />
        <section className="carte pointeuse" aria-live="polite">
          <div className="date">Bonjour {profil.prenom} · {dateLongue(jour)}</div>
          <div className="horloge">{heure(maintenant)}</div>
          <div className="statut"><span className={`point ${statut.classe}`} />{statut.texte}</div>

          <div>
            <button className={`bouton-pointer ${present ? 'sortie' : ''}`} onClick={pointer} disabled={enCours}>
              {present ? <IcSortie /> : <IcEntree />}
              {enCours ? 'Envoi…' : present ? 'Pointer ma sortie' : 'Pointer mon entrée'}
            </button>
          </div>

          {!present && (
            <div className="puces" role="group" aria-label="Type de prestation">
              <button className="puce" aria-pressed={type === null} onClick={() => setType(null)} title="Bureau sur le réseau CFB, télétravail sinon">Auto</button>
              {types.filter((t) => t.code !== 'BUREAU').map((t) => (
                <button key={t.code} className="puce" aria-pressed={type === t.code} onClick={() => setType(t.code)}>{t.libelle}</button>
              ))}
            </div>
          )}
          {remarque === null
            ? <button className="lien petit" style={{ marginTop: 10 }} onClick={() => setRemarque('')}>Ajouter une remarque</button>
            : <textarea className="remarque" rows={2} maxLength={500} placeholder="Remarque (facultatif)" value={remarque}
                        onChange={(e) => setRemarque(e.target.value)} autoFocus />}

          {aPrester > 0 && (
            <div className="progression">
              <div className="ligne entre petit"><span>Journée : <strong>{duree(direct.preste)}</strong> / {duree(aPrester)}</span>
                {finEstimee !== null && present && <span className="doux">Fin estimée {hhmm(finEstimee % 1440)}</span>}</div>
              <div className="barre"><span style={{ width: `${ratio}%` }} /></div>
            </div>
          )}
          <div className="chiffres">
            <div className="chiffre"><strong>{duree(direct.preste)}</strong><span>Prestées</span></div>
            <div className="chiffre"><strong className={boniJour !== null && boniJour < 0 ? 'negatif' : 'positif'}>
              {boniJour === null ? '—' : duree(boniJour, true)}</strong><span>Boni du jour</span></div>
            <div className="chiffre"><strong className={boni !== null && boni < 0 ? 'negatif' : ''}>{boni === null ? '—' : duree(boni, true)}</strong>
              <span>Boni trimestre</span></div>
          </div>
          <div className="ligne entre" style={{ marginTop: 10 }}>
            <p className="doux petit" style={{ margin: 0 }}>Pause de midi : {PAUSE} min retirées automatiquement</p>
            {onVoirMois && <button className="lien petit" onClick={onVoirMois}>Voir mon mois →</button>}
          </div>
        </section>

        {aRegler.slice(0, 3).map((a) => (
          <section key={a.jour} className="carte anomalie">
            <div className="ligne entre">
              <div>
                <strong>{dateCourte(a.jour)} : {a.code === 'absent' ? 'aucun pointage' : 'sortie manquante'}</strong>
                <div className="doux petit">{a.code === 'absent' ? 'Tu étais présent ? Ajoute tes heures.' : `Tu pars d’habitude vers ${hhmm(hSortie)}.`}</div>
              </div>
              <button className="bouton" onClick={() => setACorriger(a)}>Corriger</button>
            </div>
          </section>
        ))}
        {semaines.map((a) => (
          <section key={`s-${a.jour}`} className="carte anomalie info">
            <strong>Semaine du {dateCourte(a.jour)} : maximum hebdomadaire dépassé</strong>
            <div className="doux petit">Signalé à ton responsable et à la RH. Rien à corriger de ton côté.</div>
          </section>
        ))}
        {aRegler.length > 3 && <p className="doux petit">+ {aRegler.length - 3} autre(s) jour(s) à régulariser</p>}

        <section className="carte">
          <h2>Mes pointages du jour</h2>
          {duJour.length === 0 && <p className="vide">Aucun pointage pour l’instant.</p>}
          <ul className="liste">
            {duJour.map((p) => (
              <li key={p.id} className={p.annule ? 'annule' : ''}>
                <span className="h">{heure(p.horodatage)}</span>
                <span className="quoi" style={{ flex: 1 }}>{p.sens === 'entree' ? 'Entrée' : 'Sortie'} · {libelleType(p.type_code)}
                  {p.remarque && <div className="doux petit">{p.remarque}</div>}
                  {p.annule && p.annule_motif && <div className="negatif petit">Annulé : {p.annule_motif}</div>}</span>
                {p.enAttente ? <span className="badge attente">En attente</span>
                  : p.differe ? <span className="badge attente" title={`Envoyé ${p.differe_min} min après l’heure déclarée (hors ligne)`}>Différé</span>
                  : p.source === 'correction' ? <span className="badge correction">Corrigé</span>
                  : p.lieu === 'reseau_cfb' ? <span className="badge">Réseau CFB</span>
                  : p.lieu === 'externe' ? <span className="badge externe">Extérieur</span> : null}
                {!p.annule && !p.enAttente && Date.now() - Date.parse(p.cree_le) < 15 * 60_000 && (
                  <button className="lien petit" onClick={() => annuler(p)}>Annuler</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="col-laterale pile"><Equipe api={api} profil={profil} compact onVoirTout={onVoirEquipe} /></div>

      {aCorriger && (
        <Correction anomalie={aCorriger} hEntree={hEntree} hSortie={hSortie}
                    onFermer={() => setACorriger(null)}
                    onValider={async (corrections, motif) => {
                      try {
                        for (const [sens, min] of corrections) await api.corriger(isoBxl(aCorriger.jour, min), sens, motif || undefined)
                        setACorriger(null); setMessage({ texte: 'Correction enregistrée ✅ (ton responsable est informé)' }); await charger()
                      } catch (e) { setMessage({ texte: messageErreur(e), erreur: true }) }
                    }} />
      )}
      {message && <div className={`toast ${message.erreur ? 'erreur' : ''}`} role="status">{message.texte}</div>}
    </main>
  )
}

function Correction({ anomalie, hEntree, hSortie, onFermer, onValider }: {
  anomalie: Anomalie; hEntree: number; hSortie: number
  onFermer: () => void; onValider: (c: [Sens, number][], motif: string) => Promise<void>
}) {
  const absent = anomalie.code === 'absent'
  const [entree, setEntree] = useState(hhmm(hEntree))
  const [sortie, setSortie] = useState(hhmm(hSortie))
  const [motif, setMotif] = useState('')
  const [enCours, setEnCours] = useState(false)
  const min = (v: string) => { const [h, m] = v.split(':').map(Number); return h * 60 + m }
  const dialogue = useDialogue<HTMLFormElement>(onFermer)

  return (
    <div className="voile" role="dialog" aria-modal="true" aria-labelledby="titre-correction" onClick={onFermer}>
      <form className="fenetre" ref={dialogue} onClick={(e) => e.stopPropagation()} onSubmit={async (e) => {
        e.preventDefault(); setEnCours(true)
        await onValider(absent ? [['entree', min(entree)], ['sortie', min(sortie)]] : [['sortie', min(sortie)]], motif)
        setEnCours(false)
      }}>
        <h2 id="titre-correction">Corriger le {dateCourte(anomalie.jour)}</h2>
        <p className="doux petit">Heure proposée d’après tes habitudes. La correction est validée tout de suite ; ton responsable est informé.</p>
        {absent && <label className="champ">Heure d’entrée<input type="time" value={entree} onChange={(e) => setEntree(e.target.value)} required /></label>}
        <label className="champ">Heure de sortie<input type="time" value={sortie} onChange={(e) => setSortie(e.target.value)} required /></label>
        <label className="champ">Motif (facultatif)<input value={motif} maxLength={500} placeholder="Ex. oubli en partant" onChange={(e) => setMotif(e.target.value)} /></label>
        <div className="actions">
          <button type="button" className="bouton secondaire" onClick={onFermer}>Annuler</button>
          <button className="bouton" disabled={enCours || (absent && min(sortie) <= min(entree))}>{enCours ? 'Envoi…' : 'Enregistrer'}</button>
        </div>
      </form>
    </div>
  )
}
