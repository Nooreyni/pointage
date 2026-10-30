import { useEffect, useState } from 'react'
import type { Api, Presence } from '../lib/types'
import { heure } from '../lib/temps'

export function classeStatut(statut: string): string {
  if (statut === 'Télétravail') return 'tt'
  if (statut === 'Parti') return 'parti'
  if (['Pas encore pointé', 'Pas prévu aujourd’hui', "Pas prévu aujourd'hui"].includes(statut)) return ''
  if (statut === 'Présent' || statut.startsWith('En ') || statut === 'Mandat' || statut === 'Permanence VAD') return 'present'
  return 'absent' // « Absent » ou motif visible par le N+1
}

export default function Equipe({ api, compact = false }: { api: Api; compact?: boolean }) {
  const [liste, setListe] = useState<Presence[] | null>(null)
  useEffect(() => {
    const charger = () => api.presence().then(setListe).catch(() => setListe([]))
    charger()
    const t = setInterval(charger, 120_000)
    return () => clearInterval(t)
  }, [api])

  if (!liste) return <section className="carte"><h2>Mon équipe aujourd’hui</h2><p className="vide">Chargement…</p></section>

  const equipe = liste.filter((p) => p.mon_service)
  const autres = liste.filter((p) => !p.mon_service)
  const services = [...new Set(autres.map((p) => p.service))]
  const presents = equipe.filter((p) => classeStatut(p.statut) === 'present' || classeStatut(p.statut) === 'tt').length

  return (
    <section className="carte">
      <div className="ligne entre"><h2>Mon équipe aujourd’hui</h2><span className="doux petit">{presents}/{equipe.length} présents</span></div>
      {equipe.map((p) => <Ligne key={p.personne_id} p={p} />)}
      {!compact && services.map((s) => (
        <div key={s}>
          <div className="groupe-titre">{s}</div>
          {autres.filter((p) => p.service === s).map((p) => <Ligne key={p.personne_id} p={p} />)}
        </div>
      ))}
    </section>
  )
}

function Ligne({ p }: { p: Presence }) {
  return (
    <div className="personne">
      <span className="initiales">{(p.prenom[0] + p.nom[0]).toUpperCase()}</span>
      <span className="nom">{p.prenom} {p.nom}</span>
      <span className="etat ligne"><span className={`point ${classeStatut(p.statut)}`} />
        {p.statut}{p.depuis && p.statut !== 'Parti' ? ` · ${heure(p.depuis)}` : ''}</span>
    </div>
  )
}
