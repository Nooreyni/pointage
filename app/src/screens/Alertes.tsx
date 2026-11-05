import { useEffect, useMemo, useState } from 'react'
import { IcCheck, IcConges, IcEquipe, IcHorloge } from '../components/Icones'
import type { Api, Notif } from '../lib/types'
import { dateCourte, decalerJour, heure, jourBxl } from '../lib/temps'
import NotifAppareil from '../components/NotifAppareil'

export type Destination = 'pointer' | 'conges' | 'conges-valider' | 'rh' | 'equipe' | 'compte' | `fiche:${string}`
type Famille = 'pointage' | 'conges' | 'equipe'

const FAMILLES: Record<Famille, string> = { pointage: 'Pointages', conges: 'Congés', equipe: 'Mon équipe' }

function familleDe(type: string): Famille {
  if (['demande_a_traiter', 'demande_decidee', 'demande_annulee', 'relance_demande'].includes(type)) return 'conges'
  if (['fin_mois_equipe', 'correction_pointage', 'pointage_differe', 'info_fausse'].includes(type)) return 'equipe'
  return 'pointage'
}

function action(n: Notif): [string, Destination] | null {
  switch (n.type) {
    case 'oubli_entree': case 'oubli_sortie': return ['Pointer', 'pointer']
    case 'fin_mois': case 'rappel_manuel': case 'pointage_annule': return ['Voir mes pointages', 'pointer']
    case 'demande_a_traiter': case 'relance_demande': return ['Valider', 'conges-valider']
    case 'demande_decidee': case 'demande_annulee': return ['Mes congés', 'conges']
    case 'fin_mois_equipe': case 'correction_pointage': case 'pointage_differe': return ['Voir l’équipe', 'equipe']
    case 'info_fausse': return n.lien ? ['Ouvrir sa fiche', `fiche:${n.lien}`] : null
    case 'info_corrigee': return ['Mon compte', 'compte']
    default: return null
  }
}

function groupeDe(iso: string): string {
  const j = jourBxl(new Date(iso)), auj = jourBxl()
  if (j === auj) return 'Aujourd’hui'
  if (j === decalerJour(auj, -1)) return 'Hier'
  if (j > decalerJour(auj, -7)) return 'Cette semaine'
  return 'Plus ancien'
}

export default function Alertes({ api, notifs, onVu, onAller, aFaire }: {
  api: Api; notifs: Notif[]; onVu: () => void; onAller: (d: Destination) => void
  aFaire: { anomalies: number; aValider: number }
}) {
  const [famille, setFamille] = useState<Famille | null>(null)
  const [max, setMax] = useState(30)   // les 30 plus récentes, puis « Voir les plus anciennes »
  const nonLues = notifs.filter((n) => !n.lu_le).length

  useEffect(() => {
    if (nonLues > 0) { const t = setTimeout(onVu, 2500); return () => clearTimeout(t) }
  }, [nonLues, onVu])

  const filtrees = useMemo(() => notifs.filter((x) => !famille || familleDe(x.type) === famille), [notifs, famille])
  const groupes = useMemo(() => {
    const m = new Map<string, Notif[]>()
    for (const n of filtrees.slice(0, max)) {
      const g = groupeDe(n.cree_le); m.set(g, [...(m.get(g) ?? []), n])
    }
    return [...m]
  }, [filtrees, max])
  const parFamille = (f: Famille) => notifs.filter((n) => familleDe(n.type) === f).length

  return (
    <main className="contenu">
      <div className="col-principale pile">
        <section className="carte">
          <div className="ligne entre barre-outils">
            <h2>Alertes {nonLues > 0 && <span className="pilule attente">{nonLues} nouvelle(s)</span>}</h2>
          </div>
          <div className="filtres" role="group" aria-label="Filtrer les alertes">
            <button className="puce" aria-pressed={famille === null} onClick={() => setFamille(null)}>Toutes <b>{notifs.length}</b></button>
            {(Object.keys(FAMILLES) as Famille[]).filter((f) => parFamille(f) > 0).map((f) => (
              <button key={f} className="puce" aria-pressed={famille === f} onClick={() => setFamille(famille === f ? null : f)}>
                {FAMILLES[f]} <b>{parFamille(f)}</b></button>
            ))}
          </div>
        </section>

        {groupes.length === 0 && (
          <section className="carte vide-grand">
            <div className="pictogramme"><IcCheck size={26} /></div>
            <h3>Rien à signaler</h3>
            <p className="doux">Les rappels de pointage, les décisions sur tes congés et les demandes à traiter apparaîtront ici.</p>
          </section>
        )}

        {groupes.map(([titre, liste]) => (
          <section key={titre} className="carte">
            <div className="groupe-titre" style={{ marginTop: 0 }}>{titre}</div>
            <ul className="liste-alertes">
              {liste.map((n) => {
                const a = action(n), f = familleDe(n.type)
                return (
                  <li key={n.id} className={n.lu_le ? '' : 'non-lue'}>
                    <span className={`icone-alerte ${f}`}>{f === 'conges' ? <IcConges /> : f === 'equipe' ? <IcEquipe size={20} /> : <IcHorloge size={20} />}</span>
                    <span className="corps-alerte">
                      <strong>{n.titre}</strong>
                      {n.corps && <span className="doux petit">{n.corps}</span>}
                      <span className="doux petit">{titre === 'Aujourd’hui' || titre === 'Hier' ? heure(n.cree_le) : `${dateCourte(jourBxl(new Date(n.cree_le)))} · ${heure(n.cree_le)}`}</span>
                    </span>
                    {a && <button className="bouton secondaire petit" onClick={() => onAller(a[1])}>{a[0]}</button>}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
        {filtrees.length > max && <button className="bouton secondaire" onClick={() => setMax((m) => m + 30)}>Voir les plus anciennes ({filtrees.length - max})</button>}
      </div>

      <div className="col-laterale pile">
        <section className="carte">
          <h2>À faire</h2>
          <ul className="a-faire">
            <li className={aFaire.anomalies ? 'actif' : ''}>
              <strong>{aFaire.anomalies}</strong><span>jour(s) de pointage à régulariser</span>
              {aFaire.anomalies > 0 && <button className="lien petit" onClick={() => onAller('pointer')}>Corriger</button>}
            </li>
            {aFaire.aValider > 0 && (
              <li className="actif"><strong>{aFaire.aValider}</strong><span>demande(s) de congé à valider</span>
                <button className="lien petit" onClick={() => onAller('conges-valider')}>Valider</button></li>
            )}
          </ul>
          {aFaire.anomalies === 0 && aFaire.aValider === 0 && <p className="doux petit" style={{ margin: 0 }}>Tout est à jour.</p>}
        </section>
        <NotifAppareil api={api} />
        <section className="carte">
          <h2>Comment ça marche</h2>
          <p className="doux petit" style={{ margin: 0 }}>
            L’appli te prévient si tu oublies de pointer (d’après tes heures habituelles), quelques jours avant la fin du mois s’il reste
            des jours à régulariser, et dès qu’une demande de congé change de statut.
          </p>
        </section>
      </div>
    </main>
  )
}
