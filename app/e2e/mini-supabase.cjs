// Mini serveur compatible Supabase, POUR LES TESTS UNIQUEMENT : permet de lancer l'application réelle
// (lib/supabase.ts, pas la démo) sur la base locale (e2e/base-locale.sh), là où Supabase n'est pas joignable (CI, poste isolé).
// Couvre ce que l'appli utilise : connexion par mot de passe (/auth/v1), lectures de vues et appels de fonctions (/rest/v1).
// Chaque requête s'exécute comme dans Supabase : rôle « authenticated » + jeton (request.jwt.claims) → RLS et contrôles réels.
// Mot de passe de tous les comptes fictifs : MDP_TEST (défaut « Test-CFB-2026 »). Jamais sur une vraie base.
const http = require('http')
const crypto = require('crypto')
const { Pool } = require('pg')

const PORT = Number(process.env.PORT_API || 54321)
const SECRET = 'secret-de-test-local-uniquement'
const MDP = process.env.MDP_TEST || 'Test-CFB-2026'
const pool = new Pool({ connectionString: process.env.BASE_LOCALE || 'postgresql://postgres@localhost:5499/postgres', max: 8 })

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')
const signer = (claims) => { const t = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}`; return `${t}.${crypto.createHmac('sha256', SECRET).update(t).digest('base64url')}` }
function lireJeton(h) {
  const t = (h || '').replace(/^Bearer /i, ''); const [a, b, s] = t.split('.')
  if (!s || crypto.createHmac('sha256', SECRET).update(`${a}.${b}`).digest('base64url') !== s) return null
  const c = JSON.parse(Buffer.from(b, 'base64url').toString()); return c.exp > Date.now() / 1000 ? c : null
}
const utilisateur = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: u.email_confirmed_at,
  app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [{ provider: 'email', id: u.id, user_id: u.id }], factors: [],
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' })
const session = (u) => {
  const exp = Math.floor(Date.now() / 1000) + 3600
  return { access_token: signer({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', aal: 'aal1', exp }),
           token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: `r.${u.id}`, user: utilisateur(u) }
}

// Types des paramètres de chaque fonction publique (pour typer les arguments nommés)
let signatures = null
async function chargerSignatures() {
  const r = await pool.query(`select p.proname, p.proargnames, p.proretset, t.typname as ret,
      (select array_agg(format_type(x, null) order by o) from unnest(p.proargtypes) with ordinality u(x, o)) as types
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype where n.nspname = 'public'`)
  signatures = new Map(); for (const f of r.rows) (signatures.get(f.proname) ?? signatures.set(f.proname, []).get(f.proname)).push(f)
}
const ident = (s) => { if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw Object.assign(new Error(`Nom refusé : ${s}`), { http: 400 }); return `"${s}"` }

async function executer(claims, sql, params) {
  const c = await pool.connect()
  try {
    await c.query('begin')
    await c.query(`set local role ${claims ? 'authenticated' : 'anon'}`)
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims ?? { role: 'anon' })])
    const r = await c.query(sql, params); await c.query('commit'); return r
  } catch (e) { await c.query('rollback').catch(() => {}); throw e } finally { c.release() }
}

async function rpc(claims, nom, args) {
  if (!signatures) await chargerSignatures()
  const cles = Object.keys(args)
  const f = (signatures.get(nom) ?? []).find((s) => cles.every((k) => (s.proargnames ?? []).includes(k)))
  if (!f) throw Object.assign(new Error(`Fonction public.${nom} introuvable`), { http: 404, code: 'PGRST202' })
  const vals = cles.map((k) => { const v = args[k]; const t = f.types[f.proargnames.indexOf(k)]; return t === 'jsonb' || t === 'json' ? JSON.stringify(v) : v })
  const liste = cles.map((k, i) => `${ident(k)} => $${i + 1}::${f.types[f.proargnames.indexOf(k)]}`).join(', ')
  const scalaire = !f.proretset && f.ret !== 'record'
  // JSON produit par PostgreSQL (to_json), comme PostgREST : dates « 2026-11-03 », horodatages ISO avec fuseau
  const r = await executer(claims, scalaire ? `select to_json(public.${ident(nom)}(${liste})) as v`
    : `select coalesce(json_agg(t), '[]'::json) as v from public.${ident(nom)}(${liste}) t`, vals)
  return r.rows[0]?.v ?? null
}

const OPS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }
async function lire(claims, table, q) {
  const cols = (q.get('select') || '*').split(',').map((c) => c.trim()).map((c) => (c === '*' ? '*' : ident(c))).join(', ')
  const where = [], params = []
  for (const [k, v] of q) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue
    const m = /^(eq|neq|gt|gte|lt|lte|in|is)\.(.*)$/s.exec(v); if (!m) continue
    if (m[1] === 'is') where.push(`${ident(k)} is ${m[2] === 'null' ? 'null' : m[2] === 'true' ? 'true' : 'false'}`)
    else if (m[1] === 'in') { params.push(m[2].replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, ''))); where.push(`${ident(k)} = any($${params.length})`) }
    else { params.push(m[2]); where.push(`${ident(k)} ${OPS[m[1]]} $${params.length}`) }
  }
  const ordre = (q.get('order') || '').split(',').filter(Boolean).map((o) => { const [c, sens] = o.split('.'); return `${ident(c)} ${sens === 'desc' ? 'desc' : 'asc'}` })
  const sql = `select ${cols} from public.${ident(table)}${where.length ? ` where ${where.join(' and ')}` : ''}${ordre.length ? ` order by ${ordre.join(', ')}` : ''}`
    + (q.get('limit') ? ` limit ${Number(q.get('limit'))}` : '')
  return (await executer(claims, `select coalesce(json_agg(t), '[]'::json) as v from (${sql}) t`, params)).rows[0].v
}

function corps(req) { return new Promise((ok) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => ok(d ? JSON.parse(d) : {})) }) }
function repondre(res, statut, donnees) {
  res.writeHead(statut, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
                          'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'Access-Control-Expose-Headers': '*' })
  res.end(donnees === undefined ? '' : JSON.stringify(donnees))
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://local')
  if (req.method === 'OPTIONS') return repondre(res, 204)
  try {
    const claims = lireJeton(req.headers.authorization)
    // --- Authentification (sous-ensemble GoTrue)
    if (u.pathname === '/auth/v1/token') {
      const b = await corps(req)
      const email = u.searchParams.get('grant_type') === 'refresh_token' ? null : String(b.email || '').toLowerCase()
      const r = email !== null
        ? await pool.query('select id, email, email_confirmed_at from auth.users where email = $1', [email])
        : await pool.query('select id, email, email_confirmed_at from auth.users where id = $1', [String(b.refresh_token || '').slice(2)])
      if (!r.rows[0] || (email !== null && b.password !== MDP)) return repondre(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' })
      return repondre(res, 200, session(r.rows[0]))
    }
    if (u.pathname === '/auth/v1/user') {
      if (!claims) return repondre(res, 401, { msg: 'Session expirée' })
      const r = await pool.query('select id, email, email_confirmed_at from auth.users where id = $1', [claims.sub])
      return repondre(res, 200, utilisateur(r.rows[0]))
    }
    if (u.pathname === '/auth/v1/logout') return repondre(res, 204)
    if (u.pathname.startsWith('/auth/v1/factors')) return repondre(res, 501, { msg: 'Double authentification non simulée en test local' })
    // --- Fonctions serveur et fichiers : non simulés
    if (u.pathname.startsWith('/functions/v1/') || u.pathname.startsWith('/storage/v1/')) return repondre(res, 501, { erreur: 'Non disponible en test local' })
    // --- API de données (sous-ensemble PostgREST)
    const m = /^\/rest\/v1\/(rpc\/)?([a-z_][a-z0-9_]*)$/i.exec(u.pathname)
    if (!m) return repondre(res, 404, { message: 'Inconnu' })
    if (m[1]) return repondre(res, 200, await rpc(claims, m[2], req.method === 'GET' ? Object.fromEntries(u.searchParams) : await corps(req)))
    if (req.method !== 'GET') return repondre(res, 405, { message: 'Écriture directe non prévue (l’appli passe par des fonctions)' })
    return repondre(res, 200, await lire(claims, m[2], u.searchParams))
  } catch (e) {
    repondre(res, e.http ?? (e.code === '42501' ? 403 : 400), { code: e.code ?? 'ERREUR', message: e.message, details: e.detail ?? null, hint: e.hint ?? null })
  }
}).listen(PORT, () => console.log(`Mini Supabase de test sur http://localhost:${PORT}`))
