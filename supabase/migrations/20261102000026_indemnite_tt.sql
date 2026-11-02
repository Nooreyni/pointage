-- =====================================================================
--  CFB Pointage — indemnité de télétravail, réglable (Admin → Paramètres → Télétravail)
--  Montant en centimes (€ HT), par jour de télétravail ou en forfait mensuel, plafond optionnel.
--  Valeur par défaut 25 € HT par jour : PROVISOIRE, à confirmer par la direction / la RH.
-- =====================================================================
insert into pointage.parametres (cle, valeur, unite, libelle, categorie, provisoire, source) values
  ('indemnite_tt_montant', 2500, 'centimes', 'Indemnité de télétravail (montant € HT)', 'Télétravail', true, 'Proposition : 25 € HT, à confirmer'),
  ('indemnite_tt_forfait_mensuel', 0, 'booleen', 'Indemnité en forfait par mois (sinon : par jour de télétravail)', 'Télétravail', true, 'Proposition : par jour'),
  ('indemnite_tt_plafond', 0, 'centimes', 'Plafond mensuel de l''indemnité (0 = sans plafond)', 'Télétravail', true, 'Proposition : sans plafond')
on conflict (cle) do nothing;

-- L'indemnité d'un mois pour un nombre de jours de télétravail
create or replace function pointage.indemnite_tt(p_jours int) returns int
language sql stable security definer set search_path = '' as $$
  with p as (select coalesce(pointage.param('indemnite_tt_montant'), 0) as montant,
                    coalesce(pointage.param('indemnite_tt_forfait_mensuel'), 0) as forfait,
                    coalesce(pointage.param('indemnite_tt_plafond'), 0) as plafond)
  select case when p_jours <= 0 then 0
              else (select case when plafond > 0 then least(brut, plafond) else brut end
                    from (select case when forfait = 1 then montant else montant * p_jours end as brut, plafond from p) x)
         end
$$;

-- Nouvelle fonction (pas de suppression de l'ancienne rapport_teletravail : aucune confirmation destructive)
create or replace function public.rapport_teletravail_mois(p_mois date)
returns table (personne_id uuid, prenom text, nom text, service text, jours_tt int, dates date[], jours_habituels smallint[], indemnite_centimes int)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_debut date := date_trunc('month', p_mois)::date;
  v_fin   date := least((date_trunc('month', p_mois) + interval '1 month - 1 day')::date, current_date);
begin
  perform pointage.exiger_role('rh', 'admin_rh', 'direction', 'admin');
  return query
  with tt as (
    select distinct pt.personne_id, pointage.jour_bxl(pt.horodatage) as jour
    from pointage.pointages pt
    where not pt.annule and pt.type_code = 'TT'
      and pt.horodatage >= (v_debut::timestamp at time zone 'Europe/Brussels')
      and pt.horodatage <  ((v_fin + 1)::timestamp at time zone 'Europe/Brussels')
  ), n as (select t.personne_id, count(*)::int as jours, array_agg(t.jour order by t.jour) as dates from tt t group by t.personne_id)
  select pe.id, pe.prenom, pe.nom, s.nom, coalesce(n.jours, 0), coalesce(n.dates, '{}'), pointage.jours_teletravail(pe.id),
         pointage.indemnite_tt(coalesce(n.jours, 0))
  from pointage.personnes pe
  join pointage.services s on s.id = pe.service_id
  left join n on n.personne_id = pe.id
  where pe.date_entree <= v_fin and (pe.date_sortie is null or pe.date_sortie >= v_debut)
    and (n.personne_id is not null or exists (select 1 from pointage.teletravail_prevu t where t.personne_id = pe.id))
  order by s.nom, pe.nom, pe.prenom;
end $$;

revoke all on function pointage.indemnite_tt(int) from public, anon, authenticated;
revoke all on function public.rapport_teletravail_mois(date) from public, anon;
grant execute on function public.rapport_teletravail_mois(date) to authenticated;
select pointage.fixer_fuseau();
