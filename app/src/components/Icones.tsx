// Icônes de l'appli : un seul jeu (Lucide, licence ISC), un seul trait (2 px), tailles fixes.
// Les noms Ic… restent ceux utilisés dans les écrans.
import {
  Bell, BellRing, BriefcaseBusiness, Calendar, CalendarDays, ChartColumn, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, CircleHelp,
  Clock, FileClock, Hourglass, LogIn, LogOut, Paperclip, Pencil, Search, Settings, TreePalm, TriangleAlert, Users, X, type LucideIcon,
} from 'lucide-react'

const ic = (I: LucideIcon, taille = 24) => (props: { size?: number; className?: string } = {}) =>
  <I size={props.size ?? taille} strokeWidth={2} absoluteStrokeWidth aria-hidden="true" focusable="false" className={props.className} />

export const IcHorloge = ic(Clock)
export const IcFermer = ic(X, 20)
export const IcAide = ic(CircleHelp)
export const IcEquipe = ic(Users)
export const IcCalendrier = ic(TreePalm)          // Congés
export const IcAgenda = ic(Calendar)
export const IcCloche = ic(Bell)
export const IcEntree = ic(LogIn)
export const IcSortie = ic(LogOut)
export const IcRh = ic(BriefcaseBusiness)
export const IcStats = ic(ChartColumn)
export const IcAdmin = ic(Settings)
export const IcHeures = ic(FileClock)
export const IcLoupe = ic(Search)
export const IcChevron = ic(ChevronRight, 18)
export const IcPrecedent = ic(ChevronLeft, 18)
export const IcSuivant = ic(ChevronRight, 18)
export const IcCheck = ic(Check, 16)
export const IcOk = ic(CircleCheck, 18)
export const IcErreur = ic(CircleAlert, 18)
export const IcAttention = ic(TriangleAlert, 18)
export const IcRappel = ic(BellRing, 18)
export const IcTrombone = ic(Paperclip, 14)
export const IcCorrection = ic(Pencil, 12)
export const IcDiffere = ic(Hourglass, 12)
export const IcConges = ic(CalendarDays, 20)

// Logo Microsoft (marque officielle : quatre carrés), pour « Se connecter avec Microsoft »
export const IcMicrosoft = () => (
  <svg width="20" height="20" viewBox="0 0 21 21" aria-hidden="true">
    <rect x="1" y="1" width="9" height="9" fill="#F25022" /><rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
    <rect x="1" y="11" width="9" height="9" fill="#00A4EF" /><rect x="11" y="11" width="9" height="9" fill="#FFB900" />
  </svg>
)
export const IcChevronBas = ic(ChevronDown, 16)
