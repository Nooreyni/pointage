// CFB Pointage — comptes avec mot de passe (Supabase Edge Function, Deno). Sans dépendance externe.
//
// La RH (rh, admin_rh) ou l'admin crée le compte d'une personne, ou lui génère un nouveau mot de passe
// (oubli). Le mot de passe est généré ici, aléatoirement, et renvoyé UNE fois à la RH, qui le remet
// à la personne. Il n'est stocké nulle part en clair (Supabase Auth n'en garde qu'une empreinte bcrypt).
//
// Sécurité : les droits sont vérifiés par la base (public.preparer_compte) avec le jeton de la RH.
// La clé service_role (fournie automatiquement par Supabase) ne sert qu'après ce contrôle.
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Promise<Response>): void }
const env = (k: string) => Deno.env.get(k) ?? ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// Lisible à l'oral et sans caractères ambigus (0/O, 1/l/I) : « k7mp-3xqa-9hfd » ≈ 59 bits d'entropie
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export function genererMotDePasse(): string {
  const car: string[] = []
  while (car.length < 12) {
    const octets = crypto.getRandomValues(new Uint8Array(24))
    for (const o of octets) {
      if (o < 248 && car.length < 12) car.push(ALPHABET[o % ALPHABET.length])   // 248 = 8 × 31 : pas de biais
    }
  }
  return `${car.slice(0, 4).join('')}-${car.slice(4, 8).join('')}-${car.slice(8).join('')}`
}

interface Prep { personne_id: string; email: string; nom: string; compte: string | null; acteur: string }

async function erreurDe(rep: Response): Promise<string> {
  const t = await rep.text()
  try { const j = JSON.parse(t); return j.message ?? j.msg ?? j.error_description ?? j.error ?? t } catch { return t }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ erreur: 'Méthode non autorisée' }, 405)
  const jeton = req.headers.get('Authorization') ?? ''
  if (!jeton.startsWith('Bearer ')) return json({ erreur: 'Non connecté' }, 401)

  let personne: string
  try { personne = (await req.json()).personne_id } catch { return json({ erreur: 'Requête invalide' }, 400) }
  if (!/^[0-9a-f-]{36}$/i.test(personne ?? '')) return json({ erreur: 'Personne invalide' }, 400)

  const url = env('SUPABASE_URL'), service = env('SUPABASE_SERVICE_ROLE_KEY')
  const publique = env('SUPABASE_ANON_KEY') || req.headers.get('apikey') || ''

  // 1. Contrôle des droits par la base, avec le jeton de la personne connectée
  const prep = await fetch(`${url}/rest/v1/rpc/preparer_compte`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: publique, Authorization: jeton },
    body: JSON.stringify({ p_personne: personne }),
  })
  if (!prep.ok) return json({ erreur: await erreurDe(prep) }, 403)
  const p = await prep.json() as Prep

  // 2. Création du compte, ou nouveau mot de passe s'il existe déjà
  const mdp = genererMotDePasse()
  const admin = { 'Content-Type': 'application/json', apikey: service, Authorization: `Bearer ${service}` }
  let compte = p.compte
  if (compte) {
    const rep = await fetch(`${url}/auth/v1/admin/users/${compte}`, { method: 'PUT', headers: admin, body: JSON.stringify({ password: mdp }) })
    if (!rep.ok) return json({ erreur: `Mot de passe non modifié : ${await erreurDe(rep)}` }, 500)
  } else {
    const rep = await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST', headers: admin, body: JSON.stringify({ email: p.email, password: mdp, email_confirm: true }),
    })
    if (!rep.ok) return json({ erreur: `Compte non créé : ${await erreurDe(rep)}` }, 500)
    compte = (await rep.json()).id as string
  }

  // 3. Liaison compte ↔ personne (+ trace dans le journal d'audit)
  const lien = await fetch(`${url}/rest/v1/rpc/attacher_compte`, {
    method: 'POST', headers: admin, body: JSON.stringify({ p_personne: p.personne_id, p_user: compte, p_acteur: p.acteur }),
  })
  if (!lien.ok) return json({ erreur: await erreurDe(lien) }, 500)

  return json({ email: p.email, nom: p.nom, mot_de_passe: mdp, cree: !p.compte })
})
