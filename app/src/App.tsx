import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { apiSupabase, supabase } from './lib/supabase'
import { apiDemo } from './lib/demo'
import type { Api } from './lib/types'
import Connexion from './screens/Connexion'
import Espace from './screens/Espace'

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(supabase ? undefined : null)
  const [demo, setDemo] = useState(() => new URLSearchParams(location.search).has('demo') && import.meta.env.VITE_MODE_DEMO === '1')

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (demo) return <Espace api={apiDemo()} onQuitter={() => setDemo(false)} />
  if (session === undefined) return <div className="squelette">Chargement…</div>
  if (!session) return <Connexion onDemo={() => setDemo(true)} />
  return <Espace key={session.user.id} api={apiSupabase() as Api} onQuitter={() => supabase?.auth.signOut()} />
}
