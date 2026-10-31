// CFB Pointage — service d'envoi des notifications (Supabase Edge Function, Deno).
// Réveillé par la base (nouvelle notification, puis toutes les 5 min). Sans dépendance externe.
//
// Configuration : lue dans la base (pointage.configuration, via config_envoi) contre le secret reçu.
// Aucun secret dans le code ni dans le tableau de bord. Seules variables : SUPABASE_URL et
// SUPABASE_SERVICE_ROLE_KEY, fournies automatiquement par Supabase (ou par le serveur interne).
import { type Abonnement, envoyerPush } from './webpush.ts'

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Promise<Response>): void }
const env = (k: string) => Deno.env.get(k) ?? ''
let cfg: Record<string, string | null> = {}           // configuration de l'installation (lue à chaque réveil)
const c = (k: string) => cfg[k] ?? ''

interface Notif {
  id: number; titre: string; corps: string | null; type: string; tentative: number
  push_deja: boolean; mail_deja: boolean; email: string; prenom: string
  abonnements: (Abonnement & { id: string })[]
}
interface Resultat { id: number; push_ok: boolean; mail_ok: boolean; definitif: boolean; erreur: string | null; expires: string[]; reussis: string[] }

async function rpc<T>(nom: string, corps: unknown): Promise<T> {
  const rep = await fetch(`${env('SUPABASE_URL')}/rest/v1/rpc/${nom}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}` },
    body: JSON.stringify(corps),
  })
  if (!rep.ok) throw new Error(`${nom} : ${rep.status} ${await rep.text()}`)
  return rep.json() as Promise<T>
}

// ---------------------------------------------------------------------------- e-mail (Microsoft 365)
const MS_LOGIN = () => env('MS_LOGIN_URL') || 'https://login.microsoftonline.com'   // modifiables pour les tests
const MS_GRAPH = () => env('MS_GRAPH_URL') || 'https://graph.microsoft.com'
const emailConfigure = () => ['ms_tenant_id', 'ms_client_id', 'ms_client_secret', 'ms_expediteur'].every((k) => c(k))
let jetonGraph: { valeur: string; expire: number } | null = null

async function jetonMicrosoft(): Promise<string> {
  if (jetonGraph && jetonGraph.expire > Date.now() + 60_000) return jetonGraph.valeur
  const rep = await fetch(`${MS_LOGIN()}/${c('ms_tenant_id')}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({ client_id: c('ms_client_id'), client_secret: c('ms_client_secret'),
                                scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
  })
  if (!rep.ok) throw new Error(`Microsoft 365 : connexion refusée (${rep.status})`)
  const j = await rep.json() as { access_token: string; expires_in: number }
  jetonGraph = { valeur: j.access_token, expire: Date.now() + j.expires_in * 1000 }
  return j.access_token
}

const echapper = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

async function envoyerEmail(n: Notif, appli: string | null): Promise<void> {
  const lien = appli ? `<p><a href="${echapper(appli)}?onglet=alertes">Ouvrir CFB Pointage</a></p>` : ''
  const rep = await fetch(`${MS_GRAPH()}/v1.0/users/${encodeURIComponent(c('ms_expediteur'))}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await jetonMicrosoft()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      saveToSentItems: false,
      message: {
        subject: `CFB Pointage — ${n.titre}`,
        toRecipients: [{ emailAddress: { address: n.email } }],
        body: { contentType: 'HTML', content:
          `<p>Bonjour ${echapper(n.prenom)},</p><p><strong>${echapper(n.titre)}</strong></p>`
          + (n.corps ? `<p>${echapper(n.corps)}</p>` : '') + lien
          + '<p style="color:#5B6683;font-size:12px">Message automatique — active les notifications de l’appli pour les recevoir sur ton téléphone.</p>' },
      },
    }),
  })
  if (!rep.ok) throw new Error(`e-mail : ${rep.status}`)
}

// ---------------------------------------------------------------------------- traitement d'une notification
async function traiter(n: Notif, opt: { push: boolean; email: boolean; appli: string | null }): Promise<Resultat> {
  const r: Resultat = { id: n.id, push_ok: n.push_deja, mail_ok: n.mail_deja, definitif: false, erreur: null, expires: [], reussis: [] }
  const erreurs: string[] = []
  const vapid = { publique: c('vapid_public'), privee: c('vapid_prive'), contact: c('vapid_contact') || 'mailto:admin@localhost' }
  const pushPossible = opt.push && !!vapid.publique && !!vapid.privee

  if (pushPossible && !n.push_deja && n.abonnements.length) {
    const message = { titre: n.titre, corps: n.corps ?? '', lien: './?onglet=alertes', tag: `cfb-${n.type}` }
    const res = await Promise.allSettled(n.abonnements.map((a) => envoyerPush(a, message, vapid)))
    res.forEach((x, i) => {
      if (x.status === 'rejected') { erreurs.push(String(x.reason).slice(0, 120)); return }
      if (x.value.resultat === 'ok') r.reussis.push(n.abonnements[i].id)
      else if (x.value.resultat === 'expire') r.expires.push(n.abonnements[i].id)
      else erreurs.push(`push ${x.value.statut} ${x.value.detail ?? ''}`.trim())
    })
    r.push_ok = r.reussis.length > 0
  }

  // E-mail de secours : aucun appareil joignable, ou push en échec au 2e essai
  const appareilsRestants = n.abonnements.length - r.expires.length
  const secours = !r.push_ok && !n.mail_deja && opt.email && emailConfigure()
    && (!pushPossible || appareilsRestants === 0 || n.tentative >= 2)
  if (secours) {
    try { await envoyerEmail(n, opt.appli); r.mail_ok = true } catch (e) { erreurs.push(String(e).slice(0, 120)) }
  }

  // Rien ne pourra jamais partir : inutile de réessayer
  const pushJamais = !pushPossible || appareilsRestants === 0
  const mailJamais = !opt.email || !emailConfigure()
  r.definitif = !r.push_ok && !r.mail_ok && pushJamais && mailJamais
  r.erreur = erreurs.length ? erreurs.join(' | ').slice(0, 500) : (r.definitif ? 'aucun canal disponible (ni appareil ni e-mail)' : null)
  return r
}

// Envoi par paquets de 10 en parallèle
async function parPaquets<T, R>(liste: T[], f: (x: T) => Promise<R>, taille = 10): Promise<R[]> {
  const sortie: R[] = []
  for (let i = 0; i < liste.length; i += taille) sortie.push(...await Promise.all(liste.slice(i, i + taille).map(f)))
  return sortie
}

Deno.serve(async (req) => {
  const secret = req.headers.get('x-cfb-secret') ?? ''
  if (req.method !== 'POST' || !secret) return new Response('Non autorisé', { status: 401 })
  try {
    // La base vérifie le secret et remet la configuration ; sinon : refus
    try { cfg = await rpc<Record<string, string | null>>('config_envoi', { p_secret: secret }) } catch { return new Response('Non autorisé', { status: 401 }) }
    let traitees = 0, livrees = 0
    for (let tour = 0; tour < 5; tour++) {          // au plus 500 par réveil
      const lot = await rpc<{ push: boolean; email: boolean; notifications: Notif[] }>('notifications_a_envoyer', { p_limite: 100 })
      if (!lot.notifications.length) break
      const res = await parPaquets(lot.notifications, (n) => traiter(n, { push: lot.push, email: lot.email, appli: cfg.appli_url ?? null }))
      await rpc('resultats_envoi', { p_resultats: res })
      traitees += res.length
      livrees += res.filter((r) => r.push_ok || r.mail_ok).length
    }
    return Response.json({ traitees, livrees })
  } catch (e) {
    console.error(e)
    return Response.json({ erreur: String(e) }, { status: 500 })
  }
})
