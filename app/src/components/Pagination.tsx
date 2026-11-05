import { useEffect, useState } from 'react'

/**
 * Pagination des longues listes (pensée pour une centaine de personnes et plus) : on affiche `taille` éléments
 * à la fois au lieu de faire défiler sans fin. La page revient à la première quand le filtre (`cle`) change.
 */
export function usePagination<T>(liste: T[], taille = 25, cle?: unknown) {
  const [page, setPage] = useState(0)
  useEffect(() => { setPage(0) }, [cle])
  const nb = Math.max(1, Math.ceil(liste.length / taille))
  const p = Math.min(page, nb - 1)
  return { items: liste.slice(p * taille, (p + 1) * taille), page: p, nb, setPage, total: liste.length, taille }
}

export type Pager = ReturnType<typeof usePagination>

export function Pagination({ pager, quoi = 'éléments' }: { pager: Pager; quoi?: string }) {
  const { page, nb, setPage, total, taille } = pager
  if (nb <= 1) return null
  const de = page * taille + 1, a = Math.min(total, (page + 1) * taille)
  return (
    <nav className="pagination" aria-label={`Pages (${quoi})`}>
      <span className="doux petit">{de}–{a} sur {total} {quoi}</span>
      <span className="ligne">
        <button className="bouton secondaire petit" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Page précédente">‹ Précédent</button>
        <span className="petit" aria-current="page">{page + 1} / {nb}</span>
        <button className="bouton secondaire petit" disabled={page >= nb - 1} onClick={() => setPage(page + 1)} aria-label="Page suivante">Suivant ›</button>
      </span>
    </nav>
  )
}
