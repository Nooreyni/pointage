import '@fontsource-variable/fraunces'
import '@fontsource/source-sans-3/latin-400.css'
import '@fontsource/source-sans-3/latin-600.css'
import '@fontsource/source-sans-3/latin-700.css'
import { useState } from 'react'
// Seules les pièces utilisées (le point d'entrée du kit embarquerait tous ses logos de marques)
import { Stage } from '../kit/stage'
import { Bar, Window } from '../kit/window'
import { Phone } from '../kit/phone'
import { Count } from '../kit/motion/Count'
import { States } from '../kit/motion/States'
import type { Act } from '../kit/act'
import logo from './icon.svg'
import './cfb.css'

// CFB Pointage, « un pointage, et le chef le voit » : un couple d'appareils.
// L'appli installée sur le PC du chef de service (fenêtre PWA, barre à la
// couleur de l'appli) montre « Mon équipe aujourd'hui » ; le téléphone de
// Sofia la chevauche à droite, sur la colonne de tuiles de remplissage.
// Trois temps : le téléphone attend (Pas encore pointé), le doigt appuie sur
// « Pointer mon entrée », le bouton devient « Pointer ma sortie » et le statut
// « Présente depuis 8:42 » ; un temps plus tard, sur le PC, la tuile de Sofia
// passe au vert et les compteurs roulent (15 → 16 présents, 4 → 3 pas pointé).
// Joué une fois à l'arrivée à l'écran, puis « Rejouer » dans la page.
//
// Mots réels : CFB Pointage, Mon équipe aujourd'hui, les deux compteurs,
// Sofia Janssens et son statut ; sur le téléphone : Bonjour Sofia, l'heure,
// le statut, le bouton. Le reste est remplissage.

type S = { pointe: boolean; equipe: boolean }
const START: S = { pointe: false, equipe: false }

const AUTRES = [
  { ini: 'MD', nom: 74, etat: 58, point: 'present' },
  { ini: 'AD', nom: 62, etat: 70, point: 'tt' },
  { ini: 'YP', nom: 80, etat: 52, point: 'present' },
  { ini: 'LM', nom: 58, etat: 64, point: '' },
]
const DROITE = [
  { ini: 'EC', nom: 70, etat: 54, point: 'present' },
  { ini: 'JK', nom: 56, etat: 66, point: 'present' },
  { ini: 'PR', nom: 76, etat: 48, point: 'tt' },
  { ini: 'TW', nom: 64, etat: 60, point: 'present' },
  { ini: 'IL', nom: 52, etat: 56, point: '' },
]

const script = async (a: Act<S>) => {
  await a.wait(1300)
  a.mark('tap')
  await a.click('pointer')
  a.put({ pointe: true })
  // L'info arrive chez le chef un temps après : la cause d'abord, l'effet ensuite
  await a.wait(1100)
  a.mark('equipe')
  a.put({ equipe: true })
  await a.wait(2600)
}

function Tuile({ ini, nom, etat, point }: { ini: string; nom: number; etat: number; point: string }) {
  return (
    <div className="cfb-tuile">
      <span className="cfb-ini">{ini}</span>
      <span className="cfb-tuile__texte">
        <Bar w={nom} h={7} tone={3} />
        <span className="cfb-etat"><span className={`cfb-point ${point}`} /><Bar w={etat} h={6} tone={2} /></span>
      </span>
    </div>
  )
}


function Equipe({ s, large = false }: { s: S; large?: boolean }) {
  return (
    <div className="cfb-equipe">
      <div className="cfb-titre">Mon équipe aujourd’hui</div>
      <div className="cfb-compteurs">
        <span><span className="cfb-point present" /><span className="cfb-n"><Count value={s.equipe ? 16 : 15} /><span>présents</span></span></span>
        <span className="cfb-attente"><span className="cfb-point" /><span className="cfb-n"><Count value={s.equipe ? 3 : 4} /><span>pas pointé</span></span></span>
      </div>
      <div className="cfb-grille">
        <div className="cfb-col">
          <div className="cfb-tuile cfb-sofia" data-present={s.equipe || undefined}>
            <span className="cfb-ini">SJ</span>
            <span className="cfb-tuile__texte">
              <span className="cfb-nom">Sofia Janssens</span>
              <States
                align="start"
                value={s.equipe ? 'oui' : 'non'}
                className="cfb-etat-states"
                states={{
                  non: <span className="cfb-etat cfb-etat--attente"><span className="cfb-point" />Pas encore pointé</span>,
                  oui: <span className="cfb-etat"><span className="cfb-point present" />Présente · 8:42</span>,
                }}
              />
            </span>
          </div>
          {large && AUTRES.map((t) => <Tuile key={t.ini} {...t} />)}
        </div>
        {large && <div className="cfb-col">{DROITE.map((t) => <Tuile key={t.ini} {...t} />)}</div>}
      </div>
    </div>
  )
}

function Scene() {
  return (
    <Stage<S>
      width={720}
      height={440}
      compact={{ below: 640, width: 358, height: 479 }}
      initial={START}
      poster={{ pointe: true, equipe: true }}
      script={script}
      play="once"
      cursor={{ at: { wide: { x: 640, y: 420 }, compact: { x: 320, y: 300 } }, style: 'touch', ripple: true }}
      className="cfb-demo"
    >
      {(s, _rect, layout) => (
        <>
          {layout === 'wide' ? <Window title="CFB Pointage" lights="white" className="cfb-fenetre">
            <Equipe s={s} large />
          </Window> : null}

          <Phone width={layout === 'compact' ? 300 : 320} time="8:42" dark wallpaper="#F5F7FB" className="cfb-phone">
            <div className="cfb-app">
              <header className="cfb-entete">
                <img src={logo} alt="" width={28} height={28} />
                <span>CFB Pointage</span>
              </header>
              <section className="cfb-pointeuse">
                <div className="cfb-date">Bonjour Sofia</div>
                <div className="cfb-horloge">8:42</div>
                <States
                  value={s.pointe ? 'oui' : 'non'}
                  className="cfb-statut"
                  states={{
                    non: <span className="cfb-statut__ligne"><span className="cfb-point" />Pas encore pointé</span>,
                    oui: <span className="cfb-statut__ligne"><span className="cfb-point present" />Présente depuis 8:42</span>,
                  }}
                />
                <button className="cfb-bouton" data-target="pointer" data-cursor="pointer" data-sortie={s.pointe || undefined} tabIndex={-1}>
                  <States
                    value={s.pointe ? 'sortie' : 'entree'}
                    states={{
                      entree: <span className="cfb-bouton__lib"><span className="cfb-ico"><Entree /></span>Pointer mon entrée</span>,
                      sortie: <span className="cfb-bouton__lib"><span className="cfb-ico"><Sortie /></span>Pointer ma sortie</span>,
                    }}
                  />
                </button>
                <div className="cfb-puces">
                  <span className="cfb-puce" data-on><Bar w={34} h={6} tone={3} /></span>
                  <span className="cfb-puce"><Bar w={52} h={6} tone={2} /></span>
                  <span className="cfb-puce"><Bar w={42} h={6} tone={2} /></span>
                </div>
              </section>
            </div>
          </Phone>
          {layout === 'compact' && <div className="cfb-carte"><Equipe s={s} /></div>}
        </>
      )}
    </Stage>
  )
}

// Les icônes de l'appli elle-même (Icones.tsx de CFB Pointage), trait 2 px
const trait = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
const Entree = () => <svg {...trait}><path d="M10 17l5-5-5-5M15 12H3" /><path d="M14 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5" /></svg>
const Sortie = () => <svg {...trait}><path d="M15 17l5-5-5-5M20 12H8" /><path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5" /></svg>

export default function CfbPointage() {
  const [tour, setTour] = useState(0)
  return (
    <div className="cfb-hote">
      <Scene key={tour} />
      <button className="cfb-rejouer" onClick={() => setTour((n) => n + 1)}>Rejouer</button>
    </div>
  )
}
