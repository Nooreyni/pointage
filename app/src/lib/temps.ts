// Petites fonctions de date/heure, toutes en heure de Bruxelles
const TZ = 'Europe/Brussels'

export function jourBxl(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

export function heure(iso: string | Date): string {
  return new Intl.DateTimeFormat('fr-BE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

export function minutesDepuisMinuit(iso: string | Date): number {
  const [h, m] = heure(iso).split(':').map(Number)
  return h * 60 + m
}

export function duree(min: number, signe = false): string {
  const s = min < 0 ? '−' : signe && min > 0 ? '+' : ''
  const a = Math.abs(Math.round(min))
  return `${s}${Math.floor(a / 60)}h${String(a % 60).padStart(2, '0')}`
}

export function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

export function dateLongue(jour: string): string {
  return new Intl.DateTimeFormat('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(`${jour}T12:00:00Z`))
}

export function dateCourte(jour: string): string {
  return new Intl.DateTimeFormat('fr-BE', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' })
    .format(new Date(`${jour}T12:00:00Z`))
}

export function decalerJour(jour: string, n: number): string {
  const d = new Date(`${jour}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// Horodatage ISO pour « tel jour à HH:MM, heure de Bruxelles »
export function isoBxl(jour: string, minutes: number): string {
  const approx = new Date(`${jour}T${hhmm(minutes)}:00Z`)
  let ecart = (((minutesDepuisMinuit(approx) - minutes) % 1440) + 1440) % 1440 // décalage Bruxelles/UTC
  if (ecart > 720) ecart -= 1440
  return new Date(approx.getTime() - ecart * 60_000).toISOString()
}

// Heure habituelle = médiane des 20 derniers jours (même règle que le serveur)
export function heureHabituelle(pointages: { horodatage: string; jour: string; sens: string; annule: boolean }[],
                                sens: 'entree' | 'sortie', defaut: number): number {
  const parJour = new Map<string, number>()
  for (const p of pointages) {
    if (p.annule || p.sens !== sens) continue
    const m = minutesDepuisMinuit(p.horodatage)
    const actuel = parJour.get(p.jour)
    if (actuel === undefined || (sens === 'entree' ? m < actuel : m > actuel)) parJour.set(p.jour, m)
  }
  const valeurs = [...parJour.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 20).map(([, m]) => m).sort((a, b) => a - b)
  if (valeurs.length < 5) return defaut
  const mi = Math.floor(valeurs.length / 2)
  return valeurs.length % 2 ? valeurs[mi] : Math.round((valeurs[mi - 1] + valeurs[mi]) / 2)
}
