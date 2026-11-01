import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { apiSupabase, supabase } from './lib/supabase'
import type { Persona } from './lib/demo'
import type { Api } from './lib/types'
import Connexion from './screens/Connexion'
import Espace from './screens/Espace'

type ModuleDemo = typeof import('./lib/demo')

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(supabase ? undefined : null)
  const [demo, setDemo] = useState(() => import.meta.env.VITE_DEMO_SEUL === '1'
    || (new URLSearchParams(location.search).has('demo') && import.meta.env.VITE_MODE_DEMO === '1'))
  // ?vue=chef|rh|direction|admin ouvre la démo directement dans ce rôle (lien à partager)
  const [persona, setPersona] = useState<Persona>(() => {
    const v = new URLSearchParams(location.search).get('vue')
    return (['employe', 'chef', 'rh', 'direction', 'admin'] as string[]).includes(v ?? '') ? v as Persona : 'employe'
  })
  const [moduleDemo, setModuleDemo] = useState<ModuleDemo | null>(null)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  // La démo (données fictives) n'est chargée que si on l'ouvre : rien dans le code des utilisateurs réels
  useEffect(() => { if (demo && !moduleDemo) import('./lib/demo').then(setModuleDemo) }, [demo, moduleDemo])

  // Une seule instance d'API par personne connectée (sinon chaque renouvellement de jeton rechargerait tout)
  const idUtilisateur = session?.user.id ?? null
  const api = useMemo(() => (idUtilisateur ? apiSupabase() as Api : null), [idUtilisateur])
  const apiFictive = useMemo(() => (moduleDemo ? moduleDemo.apiDemo(persona) : null), [moduleDemo, persona])

  if (demo) {
    if (!apiFictive) return <div className="squelette">Chargement…</div>
    return <Espace key={persona} api={apiFictive} onQuitter={() => setDemo(false)} vueDemo={{ persona, choisir: setPersona }} />
  }
  if (session === undefined) return <div className="squelette">Chargement…</div>
  if (!session || !api) return <Connexion onDemo={() => setDemo(true)} />
  return <Espace key={session.user.id} api={api} onQuitter={() => supabase?.auth.signOut()} />
}
