import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './kit/stageshow.css'
import Demo from './demo'
import './page.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main className="page">
      <p className="sur-titre">CFB Pointage</p>
      <h1>Un pointage, et le responsable le voit</h1>
      <p className="intro">Sofia pointe son entrée sur son téléphone ; sur le PC de son chef de service, sa tuile passe au vert et les compteurs de l’équipe se mettent à jour.</p>
      <Demo />
    </main>
  </StrictMode>,
)
