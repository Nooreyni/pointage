// Vérifie le chiffrement Web Push du service d'envoi contre le vecteur officiel de la RFC 8291 (annexe A),
// et la signature VAPID avec la clé publique.
import { describe, expect, it } from 'vitest'
import { b64url, chiffrer, deB64url, genererClesVapid, jetonVapid } from '../../../supabase/functions/envoyer-notifications/webpush'

describe('Web Push (RFC 8291 / RFC 8292)', () => {
  it('reproduit exactement l’exemple de la RFC 8291', async () => {
    const corps = await chiffrer(new TextEncoder().encode('When I grow up, I want to be a watermelon'),
      'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
      'BTBZMqHH6r4Tts7J_aSIgg',
      {
        sel: deB64url('DGv6ra1nlYgDCS1FRnbzlw'),
        privee: deB64url('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'),
        publique: deB64url('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8'),
      })
    expect(b64url(corps)).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_'
      + 'yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN')
  })

  it('jeton VAPID : signature ES256 valide, audience = origine du service push', async () => {
    const cles = await genererClesVapid()
    const jeton = await jetonVapid('https://fcm.googleapis.com/fcm/send/abc', cles.publique, cles.privee, 'mailto:it@exemple.be', 1_800_000_000_000)
    const [h, c, s] = jeton.split('.')
    const charge = JSON.parse(new TextDecoder().decode(deB64url(c)))
    expect(charge).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1_800_000_000 + 43_200, sub: 'mailto:it@exemple.be' })
    const pub = await crypto.subtle.importKey('raw', new Uint8Array(deB64url(cles.publique)), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, new Uint8Array(deB64url(s)), new TextEncoder().encode(`${h}.${c}`))
    expect(ok).toBe(true)
  })

  it('refuse un abonnement mal formé', async () => {
    await expect(chiffrer(new Uint8Array([1]), 'abc', 'def')).rejects.toThrow('invalide')
  })
})
