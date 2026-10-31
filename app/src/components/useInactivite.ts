import { useEffect, useRef, useState } from 'react'

const EVENEMENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

/** Secondes restantes avant déconnexion (≤ 0 : à déconnecter). */
export const secondesRestantes = (derniereActivite: number, minutes: number, maintenant: number) =>
  Math.round((derniereActivite + minutes * 60_000 - maintenant) / 1000)

/**
 * Déconnexion après `minutes` sans activité (0 = jamais). Renvoie le nombre de secondes restantes
 * pendant la dernière minute (pour l'avertissement), sinon null, et une fonction pour relancer le délai.
 * Le délai tient compte du temps passé appli en arrière-plan (horloge réelle, pas un minuteur suspendu).
 */
export function useInactivite(minutes: number, onExpire: () => void): [number | null, () => void] {
  const derniere = useRef(Date.now())
  const expire = useRef(onExpire)
  expire.current = onExpire
  const [restant, setRestant] = useState<number | null>(null)

  useEffect(() => {
    if (!minutes) { setRestant(null); return }
    const activite = () => { derniere.current = Date.now() }
    EVENEMENTS.forEach((e) => addEventListener(e, activite, { passive: true }))
    const t = setInterval(() => {
      const reste = secondesRestantes(derniere.current, minutes, Date.now())
      if (reste <= 0) { clearInterval(t); expire.current() } else setRestant(reste <= 60 ? reste : null)
    }, 1000)
    return () => { clearInterval(t); EVENEMENTS.forEach((e) => removeEventListener(e, activite)) }
  }, [minutes])

  return [restant, () => { derniere.current = Date.now(); setRestant(null) }]
}
