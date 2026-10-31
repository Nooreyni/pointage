// Génère la configuration d'envoi des notifications pour UNE installation (à lancer une seule fois).
// Usage : node scripts/generer-config-envoi.mjs https://<projet>.supabase.co https://pointage.exemple.be mailto:it@exemple.be
// Affiche le SQL à exécuter dans l'éditeur SQL de Supabase (ne pas le committer : il contient la clé privée).
const [base, appli = '', contact = ''] = process.argv.slice(2)
if (!base) { console.error('Usage : node scripts/generer-config-envoi.mjs <URL Supabase> [URL appli] [contact]'); process.exit(1) }
const { subtle } = globalThis.crypto
const paire = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const publique = Buffer.from(await subtle.exportKey('raw', paire.publicKey)).toString('base64url')
const privee = (await subtle.exportKey('jwk', paire.privateKey)).d
const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
const q = (v) => `'${String(v).replace(/'/g, "''")}'`
console.log(`select pointage.configurer('vapid_public', ${q(publique)}),
       pointage.configurer('vapid_prive', ${q(privee)}),
       pointage.configurer('vapid_contact', ${q(contact || base)}),
       pointage.configurer('envoi_secret', ${q(secret)}),
       pointage.configurer('envoi_url', ${q(base.replace(/\/$/, '') + '/functions/v1/envoyer-notifications')}),
       pointage.configurer('appli_url', ${q(appli)});`)
