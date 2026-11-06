import { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import qrcode from 'qrcode-generator'
import type { MotDePasseGenere } from '../lib/types'

export type FicheConnexion = MotDePasseGenere & { service?: string }

/** QR code dessiné en SVG (un seul chemin), sans image externe : nets à l'impression. */
export function QrCode({ texte, taille = 132 }: { texte: string; taille?: number }) {
  const { d, n } = useMemo(() => {
    const q = qrcode(0, 'M'); q.addData(texte); q.make()
    const n = q.getModuleCount(); let d = ''
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) d += `M${x + 4} ${y + 4}h1v1h-1z`
    return { d, n: n + 8 }
  }, [texte])
  return (
    <svg className="qr" width={taille} height={taille} viewBox={`0 0 ${n} ${n}`} role="img" aria-label={`QR code : ${texte}`} shapeRendering="crispEdges">
      <rect width={n} height={n} fill="#fff" /><path d={d} fill="#000" />
    </svg>
  )
}

/**
 * Fiches de connexion à imprimer (4 par page A4) : lien + QR, identifiant, mot de passe provisoire, 3 gestes.
 * Affichées par-dessus l'appli ; à l'impression, seules les fiches sortent. Les mots de passe ne sont gardés nulle part :
 * une fois la fenêtre fermée, il faut en générer de nouveaux.
 */
export default function FichesConnexion({ fiches, microsoft, onFermer }: { fiches: FicheConnexion[]; microsoft: boolean; onFermer: () => void }) {
  const url = location.origin
  useEffect(() => {
    document.body.classList.add('impression-fiches')
    const echap = (e: KeyboardEvent) => { if (e.key === 'Escape') onFermer() }
    window.addEventListener('keydown', echap)
    return () => { document.body.classList.remove('impression-fiches'); window.removeEventListener('keydown', echap) }
  }, [onFermer])

  return createPortal(
    <div className="fiches-connexion" role="dialog" aria-modal="true" aria-label="Fiches de connexion">
      <div className="barre-fiches">
        <div className="texte-ligne">
          <strong>{fiches.length} fiche{fiches.length > 1 ? 's' : ''} de connexion</strong>
          <span className="doux petit">Mots de passe affichés une seule fois : imprime ou note-les avant de fermer.</span>
        </div>
        <span className="espace" />
        <button type="button" className="bouton secondaire" onClick={onFermer}>Fermer</button>
        <button type="button" className="bouton" onClick={() => window.print()}>Imprimer</button>
      </div>
      <div className="pages-fiches">
        {fiches.map((f) => (
          <article className="fiche-connexion" key={f.email}>
            <header>
              <span className="marque-fiche">CFB Pointage</span>
              <h2>{f.nom}</h2>
              {f.service && <span className="doux">{f.service}</span>}
            </header>
            <div className="corps-fiche">
              <ol>
                <li>Ouvre <strong>{url.replace(/^https?:\/\//, '')}</strong><br /><span className="doux">ou scanne le QR code avec ton téléphone</span></li>
                <li>Connecte-toi :
                  <dl>
                    <div><dt>Identifiant</dt><dd>{f.email}</dd></div>
                    <div><dt>Mot de passe</dt><dd className="mdp">{f.mot_de_passe}</dd></div>
                  </dl>
                  {microsoft && <span className="doux">ou « Se connecter avec Microsoft » avec ton compte du CFB</span>}
                </li>
                <li>Suis la visite guidée (1 minute), puis change ton mot de passe dans <strong>Mon compte</strong>.</li>
              </ol>
              <QrCode texte={url} />
            </div>
            <footer>Sur téléphone : après connexion, « Ajouter à l’écran d’accueil » pour pointer en un appui. · Fiche personnelle, à ne pas laisser traîner.</footer>
          </article>
        ))}
      </div>
    </div>,
    document.body,
  )
}
