-- =====================================================================
--  CFB Pointage — espace RH
--   • codes d'absence : tous les codes actifs (la RH encode maladie, AT…) ;
--     l'écran employé ne garde que les « demandable »
--   • état de clôture d'un mois (ce qui reste à régulariser)
-- =====================================================================

drop view if exists public.codes_absence;
create view public.codes_absence with (security_invoker = true) as
select code, libelle, code_court, compteur_code, demandable, justificatif_requis, couleur, ordre
from pointage.codes_absence where actif;

revoke all on public.codes_absence from public, anon;
grant select on public.codes_absence to authenticated;

-- Ce qui empêche (ou non) de clôturer un mois
create or replace function public.etat_cloture(p_mois date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_debut date := date_trunc('month', p_mois)::date;
  v_fin   date := (date_trunc('month', p_mois) + interval '1 month - 1 day')::date;
  v_anom  jsonb;
begin
  perform pointage.exiger_role('rh', 'admin_rh', 'admin');

  select coalesce(jsonb_agg(jsonb_build_object('personne_id', x.id, 'prenom', x.prenom, 'nom', x.nom, 'jours', x.nb)
                            order by x.nom), '[]'::jsonb)
    into v_anom
  from (
    select pe.id, pe.prenom, pe.nom, count(*) as nb
    from pointage.personnes pe
    cross join lateral generate_series(v_debut, least(v_fin, current_date - 1), interval '1 day') g(d)
    cross join lateral pointage.journee(pe.id, g.d::date) j
    where (j.nb_pointages = 0 and j.a_prester > 0) or (j.nb_pointages > 0 and not j.complete)
    group by pe.id, pe.prenom, pe.nom
  ) x;

  return jsonb_build_object(
    'mois', v_debut,
    'deja_cloture', exists (select 1 from pointage.clotures where mois = v_debut),
    'derniere_cloture', (select max(mois) from pointage.clotures),
    'mois_termine', v_debut < date_trunc('month', current_date)::date,
    'anomalies', v_anom,
    'demandes_en_attente', (select count(*) from pointage.demandes d
                            where d.statut = 'en_attente' and date_trunc('month', d.date_debut)::date <= v_debut),
    'conges_a_constater', (select count(*) from pointage.demandes d
                           where d.statut = 'accordee' and d.constate_le is null and d.date_debut <= v_fin)
  );
end $$;

revoke all on function public.etat_cloture(date) from public, anon;
grant execute on function public.etat_cloture(date) to authenticated;
