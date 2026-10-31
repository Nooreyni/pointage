// Web Push sans dépendance : chiffrement RFC 8291 (aes128gcm, RFC 8188) + authentification VAPID (RFC 8292).
// Uniquement WebCrypto / fetch : fonctionne à l'identique dans Supabase Edge (Deno), Node ≥ 20,
// Cloudflare Workers ou un serveur interne.

const enc = new TextEncoder()

export function b64url(octets: Uint8Array): string {
  let s = ''
  for (const o of octets) s += String.fromCharCode(o)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function deB64url(texte: string): Uint8Array {
  const b = texte.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const r = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let i = 0
  for (const p of parts) { r.set(p, i); i += p.length }
  return r
}

// WebCrypto attend des ArrayBuffer « purs » (pas de vue partagée)
const buf = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer

async function hmac(cle: Uint8Array, donnees: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', buf(cle), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, buf(donnees)))
}

// Clé privée P-256 brute (32 octets) + clé publique non compressée (65 octets) → CryptoKey
async function clePrivee(d: Uint8Array, publique: Uint8Array, usage: 'ECDH' | 'ECDSA'): Promise<CryptoKey> {
  const jwk = { kty: 'EC', crv: 'P-256', d: b64url(d), x: b64url(publique.slice(1, 33)), y: b64url(publique.slice(33, 65)), ext: true }
  return crypto.subtle.importKey('jwk', jwk, usage === 'ECDH' ? { name: 'ECDH', namedCurve: 'P-256' } : { name: 'ECDSA', namedCurve: 'P-256' },
    false, usage === 'ECDH' ? ['deriveBits'] : ['sign'])
}

export interface Abonnement { endpoint: string; p256dh: string; auth: string }

/** Chiffre un message pour un abonnement (RFC 8291). `essai` permet d'imposer sel et clé éphémère (tests). */
export async function chiffrer(message: Uint8Array, p256dh: string, auth: string,
                               essai?: { sel: Uint8Array; privee: Uint8Array; publique: Uint8Array }): Promise<Uint8Array> {
  const uaPublique = deB64url(p256dh)
  const secretAuth = deB64url(auth)
  if (uaPublique.length !== 65 || secretAuth.length !== 16) throw new Error('Abonnement push invalide')

  let asPrivee: CryptoKey, asPublique: Uint8Array
  if (essai) {
    asPrivee = await clePrivee(essai.privee, essai.publique, 'ECDH'); asPublique = essai.publique
  } else {
    const paire = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
    asPrivee = paire.privateKey
    asPublique = new Uint8Array(await crypto.subtle.exportKey('raw', paire.publicKey))
  }
  const cleUa = await crypto.subtle.importKey('raw', buf(uaPublique), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const secretEcdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: cleUa }, asPrivee, 256))

  // IKM = HKDF(auth, ecdh, "WebPush: info\0" || ua_public || as_public, 32)
  const prkCle = await hmac(secretAuth, secretEcdh)
  const ikm = await hmac(prkCle, concat(enc.encode('WebPush: info\0'), uaPublique, asPublique, new Uint8Array([1])))
  const sel = essai?.sel ?? crypto.getRandomValues(new Uint8Array(16))
  const prk = await hmac(sel, ikm)
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16)
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12)

  const cleAes = await crypto.subtle.importKey('raw', buf(cek), 'AES-GCM', false, ['encrypt'])
  const chiffre = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(nonce) }, cleAes,
    buf(concat(message, new Uint8Array([2])))))     // 0x02 = dernier enregistrement, sans remplissage

  const rs = new Uint8Array([0, 0, 0x10, 0])          // taille d'enregistrement 4096
  return concat(sel, rs, new Uint8Array([asPublique.length]), asPublique, chiffre)
}

/** Jeton VAPID (JWT ES256) pour l'origine du service push. */
export async function jetonVapid(endpoint: string, publique: string, privee: string, contact: string, maintenant = Date.now()): Promise<string> {
  const entete = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const corps = b64url(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin, exp: Math.floor(maintenant / 1000) + 12 * 3600, sub: contact,
  })))
  const cle = await clePrivee(deB64url(privee), deB64url(publique), 'ECDSA')
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cle, buf(enc.encode(`${entete}.${corps}`))))
  return `${entete}.${corps}.${b64url(signature)}`
}

export type ResultatPush = 'ok' | 'expire' | 'erreur'

/** Envoie un message chiffré à un abonnement. 404/410 = abonnement expiré (à supprimer). */
export async function envoyerPush(ab: Abonnement, message: object, vapid: { publique: string; privee: string; contact: string },
                                  ttlSecondes = 24 * 3600): Promise<{ resultat: ResultatPush; statut: number; detail?: string }> {
  const corps = await chiffrer(enc.encode(JSON.stringify(message)), ab.p256dh, ab.auth)
  const jeton = await jetonVapid(ab.endpoint, vapid.publique, vapid.privee, vapid.contact)
  const rep = await fetch(ab.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm', TTL: String(ttlSecondes), Urgency: 'normal',
      Authorization: `vapid t=${jeton}, k=${vapid.publique}`,
    },
    body: buf(corps),
  })
  if (rep.status === 404 || rep.status === 410) return { resultat: 'expire', statut: rep.status }
  if (rep.ok) return { resultat: 'ok', statut: rep.status }
  return { resultat: 'erreur', statut: rep.status, detail: (await rep.text().catch(() => '')).slice(0, 200) }
}

/** Génère une paire de clés VAPID (à faire une fois par installation). */
export async function genererClesVapid(): Promise<{ publique: string; privee: string }> {
  const paire = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair
  const publique = new Uint8Array(await crypto.subtle.exportKey('raw', paire.publicKey))
  const jwk = await crypto.subtle.exportKey('jwk', paire.privateKey)
  return { publique: b64url(publique), privee: jwk.d! }
}
