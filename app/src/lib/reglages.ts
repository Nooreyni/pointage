import { createContext, useContext } from 'react'

/** Réglages de l'installation (Admin › Réglages), lus une fois à l'ouverture de l'espace. */
export const ReglagesContext = createContext<Record<string, number>>({})
export const useReglage = (cle: string, defaut = 0): number => useContext(ReglagesContext)[cle] ?? defaut
