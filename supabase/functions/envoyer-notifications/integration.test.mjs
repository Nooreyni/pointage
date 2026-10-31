// Usage : node supabase/functions/envoyer-notifications/integration.test.mjs supabase/functions/envoyer-notifications/index.ts [email]
// Prérequis : Node ≥ 20 et Deno 2 dans le PATH.
// Test d'intégration du service d'envoi : fausse API Supabase + faux service push qui DÉCHIFFRE le message.
import http from 'node:http'
import { spawn } from 'node:child_process'
const { subtle } = globalThis.crypto
const b64u = (u) => Buffer.from(u).toString('base64url')
const deb = (s) => new Uint8Array(Buffer.from(s, 'base64url'))
const hmac = async (k, d) => new Uint8Array(await subtle.sign('HMAC', await subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), d))
const cat = (...p) => { const r = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { r.set(x, i); i += x.length } return r }
const te = new TextEncoder()

// Appareil fictif : paire ECDH + secret d'auth
const ua = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
const uaPub = new Uint8Array(await subtle.exportKey('raw', ua.publicKey))
const auth = crypto.getRandomValues(new Uint8Array(16))
// Clés VAPID
const v = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const vPub = b64u(new Uint8Array(await subtle.exportKey('raw', v.publicKey))), vPriv = (await subtle.exportKey('jwk', v.privateKey)).d

async function dechiffrer(corps) {
  const sel = corps.slice(0, 16), idlen = corps[20], asPub = corps.slice(21, 21 + idlen), ct = corps.slice(21 + idlen)
  const asKey = await subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdh = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256))
  const ikm = await hmac(await hmac(auth, ecdh), cat(te.encode('WebPush: info\0'), uaPub, asPub, new Uint8Array([1])))
  const prk = await hmac(sel, ikm)
  const cek = (await hmac(prk, cat(te.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16)
  const nonce = (await hmac(prk, cat(te.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12)
  const clair = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), ct))
  return JSON.parse(new TextDecoder().decode(clair.slice(0, clair.lastIndexOf(2))))
}

const journal = { recus: [], resultats: null, appelsLot: 0, erreurs: [] }
const abOk = { id: '11111111-1111-1111-1111-111111111111', endpoint: 'http://127.0.0.1:54399/push/ok', p256dh: b64u(uaPub), auth: b64u(auth) }
const abGone = { ...abOk, id: '22222222-2222-2222-2222-222222222222', endpoint: 'http://127.0.0.1:54399/push/gone' }
const lot = { push: true, email: true, notifications: [
  { id: 1, titre: 'Tu as oublié de pointer ta sortie ?', corps: 'D’habitude tu pars vers 16h50.', type: 'oubli_sortie', tentative: 1,
    push_deja: false, mail_deja: false, email: 'a@cfb.test', prenom: 'Sofia', abonnements: [abOk, abGone] },
  { id: 2, titre: 'Sans appareil', corps: null, type: 'fin_mois', tentative: 1, push_deja: false, mail_deja: false,
    email: 'b@cfb.test', prenom: 'Marc', abonnements: [] },
] }

const serveur = http.createServer(async (req, res) => {
  const morceaux = []; for await (const m of req) morceaux.push(m)
  const corps = new Uint8Array(Buffer.concat(morceaux))
  try {
    if (req.url.startsWith('/rest/v1/rpc/')) {
      if (req.headers.authorization !== 'Bearer cle-service') journal.erreurs.push('clé service absente')
      const nom = req.url.split('/').pop()
      if (nom === 'config_envoi') {
        if (JSON.parse(new TextDecoder().decode(corps)).p_secret !== 'secret-de-test') { res.statusCode = 400; return res.end('{"message":"Secret d\'envoi invalide"}') }
        return res.end(JSON.stringify({ appli_url: 'https://pointage.exemple.be', vapid_public: vPub, vapid_prive: vPriv, vapid_contact: 'mailto:it@exemple.be',
          ...(process.argv[3] === 'email' ? { ms_tenant_id: 'tenant-test', ms_client_id: 'c', ms_client_secret: 's', ms_expediteur: 'pointage@exemple.be' } : {}) }))
      }
      if (nom === 'notifications_a_envoyer') return res.end(JSON.stringify(journal.appelsLot++ === 0 ? lot : { ...lot, notifications: [] }))
      if (nom === 'resultats_envoi') { journal.resultats = JSON.parse(new TextDecoder().decode(corps)).p_resultats; return res.end('2') }
    }
    if (req.url === '/push/ok') {
      if (req.headers['content-encoding'] !== 'aes128gcm') journal.erreurs.push('content-encoding')
      const m = /^vapid t=([^,]+), k=(.+)$/.exec(req.headers.authorization || '')
      if (!m || m[2] !== vPub) journal.erreurs.push('vapid')
      const [h, c, s] = m[1].split('.')
      const okSig = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, v.publicKey, deb(s), te.encode(`${h}.${c}`))
      if (!okSig) journal.erreurs.push('signature VAPID')
      if (JSON.parse(Buffer.from(c, 'base64url')).aud !== 'http://127.0.0.1:54399') journal.erreurs.push('aud')
      journal.recus.push(await dechiffrer(corps))
      res.statusCode = 201; return res.end()
    }
    if (req.url === '/push/gone') { res.statusCode = 410; return res.end() }
    if (req.url === '/ms/tenant-test/oauth2/v2.0/token') return res.end(JSON.stringify({ access_token: 'jeton-graph', expires_in: 3600 }))
    if (req.url.startsWith('/graph/v1.0/users/')) {
      if (req.headers.authorization !== 'Bearer jeton-graph') journal.erreurs.push('jeton graph')
      journal.mails = [...(journal.mails ?? []), JSON.parse(new TextDecoder().decode(corps)).message]
      res.statusCode = 202; return res.end()
    }
    res.statusCode = 404; res.end()
  } catch (e) { journal.erreurs.push(String(e)); res.statusCode = 500; res.end() }
})
await new Promise((r) => serveur.listen(54399, '127.0.0.1', r))

const fn = process.argv[2]
const deno = spawn('deno', ['run', '--allow-net', '--allow-env', fn], { env: { ...process.env,
  SUPABASE_URL: 'http://127.0.0.1:54399', SUPABASE_SERVICE_ROLE_KEY: 'cle-service', DENO_NO_UPDATE_CHECK: '1',
  MS_LOGIN_URL: 'http://127.0.0.1:54399/ms', MS_GRAPH_URL: 'http://127.0.0.1:54399/graph' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
let sortie = ''; deno.stdout.on('data', (d) => { sortie += d }); deno.stderr.on('data', (d) => { sortie += d })
await new Promise((r) => { const t = setInterval(() => { if (/Listening/.test(sortie)) { clearInterval(t); r() } }, 100) })
const port = /:(\d+)\//.exec(sortie)?.[1] ?? '8000'

const refus = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST', headers: { 'x-cfb-secret': 'mauvais' } })
const rep = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST', headers: { 'x-cfb-secret': 'secret-de-test' } })
const bilan = await rep.json()
try { process.kill(-deno.pid, 'SIGKILL') } catch {}; serveur.close()

const r1 = journal.resultats?.find((x) => x.id === 1), r2 = journal.resultats?.find((x) => x.id === 2)
const verifs = [
  ['Mauvais secret refusé (401)', refus.status === 401],
  ['Réponse du service', rep.status === 200 && bilan.traitees === 2 && bilan.livrees === (process.argv[3] === 'email' ? 2 : 1)],
  ['Message déchiffré par l’appareil', journal.recus.length === 1 && journal.recus[0].titre === 'Tu as oublié de pointer ta sortie ?' && journal.recus[0].lien === './?onglet=alertes'],
  ['Push livré + appareil expiré signalé', r1?.push_ok === true && r1.expires[0] === abGone.id && r1.reussis[0] === abOk.id],
  ...(process.argv[3] === 'email'
    ? [['E-mail de secours envoyé (sans appareil)', r2?.mail_ok === true && journal.mails?.length === 1 && journal.mails[0].toRecipients[0].emailAddress.address === 'b@cfb.test'
         && journal.mails[0].body.content.includes('https://pointage.exemple.be?onglet=alertes')],
       ['Pas d’e-mail quand le push est livré', !journal.mails?.some((m) => m.toRecipients[0].emailAddress.address === 'a@cfb.test')]]
    : [['Sans appareil ni e-mail configuré : définitif', r2?.push_ok === false && r2.mail_ok === false && r2.definitif === true]]),
  ['Aucune anomalie côté services', journal.erreurs.length === 0],
]
for (const [l, ok] of verifs) console.log(ok ? '✅' : '❌', l)
if (journal.erreurs.length) console.log(journal.erreurs)
process.exit(verifs.every(([, ok]) => ok) ? 0 : 1)
