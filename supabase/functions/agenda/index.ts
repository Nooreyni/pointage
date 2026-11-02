// CFB Pointage — agenda iCalendar (abonnement Outlook, Google, Apple) : congés accordés + jours fériés.
// GET /functions/v1/agenda?jeton=<lien secret de la personne>. Vérification du jeton par la base
// (public.agenda_evenements, réservée à service_role). Aucune donnée sans jeton valide.
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Promise<Response>): void }
const env = (k: string) => Deno.env.get(k) ?? ''

type Evt = { uid: string; debut: string; fin: string; titre: string; maj: string }

const jourIcs = (d: string) => d.replaceAll('-', '')
const lendemain = (d: string) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10) }
const horodatage = (t: string) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const echapper = (t: string) => t.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
// Lignes de 75 octets maximum (RFC 5545), repliées par « CRLF + espace »
function plier(ligne: string): string {
  const enc = new TextEncoder(); const morceaux: string[] = []; let cour = ''
  for (const c of ligne) { if (enc.encode(cour + c).length > (morceaux.length ? 74 : 75)) { morceaux.push(cour); cour = c } else cour += c }
  morceaux.push(cour); return morceaux.join('\r\n ')
}

export function versIcs(evts: Evt[]): string {
  const l = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CFB//CFB Pointage//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:CFB · mes congés', 'X-WR-TIMEZONE:Europe/Brussels', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H']
  for (const e of evts) {
    l.push('BEGIN:VEVENT', `UID:${e.uid}@cfb-pointage`, `DTSTAMP:${horodatage(e.maj)}`, `DTSTART;VALUE=DATE:${jourIcs(e.debut)}`,
      `DTEND;VALUE=DATE:${jourIcs(lendemain(e.fin))}`, `SUMMARY:${echapper(e.titre)}`, 'TRANSP:OPAQUE', 'X-MICROSOFT-CDO-BUSYSTATUS:OOF', 'END:VEVENT')
  }
  l.push('END:VCALENDAR')
  return l.map(plier).join('\r\n') + '\r\n'
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Méthode non autorisée', { status: 405 })
  const jeton = new URL(req.url).searchParams.get('jeton') ?? ''
  if (!/^[0-9a-f]{64}$/.test(jeton)) return new Response('Lien invalide', { status: 404 })
  const rep = await fetch(`${env('SUPABASE_URL')}/rest/v1/rpc/agenda_evenements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}` },
    body: JSON.stringify({ p_jeton: jeton }),
  })
  if (!rep.ok) return new Response('Agenda indisponible', { status: 503 })
  const evts = await rep.json() as Evt[]
  if (!evts.length) return new Response('Lien invalide ou expiré', { status: 404 })
  return new Response(req.method === 'HEAD' ? null : versIcs(evts), {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="cfb-conges.ics"', 'Cache-Control': 'private, max-age=900' },
  })
})
