import { useEffect, useRef } from 'react'

let ouvertes = 0
const FOCUSABLES = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Fenêtre modale accessible : focus sur le premier champ, Échap ferme, Tab reste dans la fenêtre, focus rendu à la fermeture. */
export function useDialogue<T extends HTMLElement>(onFermer: () => void) {
  const ref = useRef<T>(null)
  const fermer = useRef(onFermer)
  fermer.current = onFermer
  useEffect(() => {
    const avant = document.activeElement as HTMLElement | null
    const el = ref.current
    const premiers = el?.querySelectorAll<HTMLElement>(FOCUSABLES)
    const champ = el?.querySelector<HTMLElement>('input:not([type=checkbox]):not([disabled]), select, textarea')
    ;(champ ?? premiers?.[0])?.focus()
    const clavier = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); fermer.current(); return }
      if (e.key !== 'Tab' || !el) return
      const liste = [...el.querySelectorAll<HTMLElement>(FOCUSABLES)].filter((x) => x.offsetParent !== null)
      if (!liste.length) return
      const [premier, dernier] = [liste[0], liste[liste.length - 1]]
      if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus() }
      else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus() }
    }
    document.addEventListener('keydown', clavier)
    // Page derrière bloquée (compteur : deux fenêtres l'une sur l'autre)
    ouvertes++; document.body.classList.add('fenetre-ouverte')
    return () => {
      document.removeEventListener('keydown', clavier); avant?.focus?.()
      if (--ouvertes === 0) document.body.classList.remove('fenetre-ouverte')
    }
  }, [])
  return ref
}
