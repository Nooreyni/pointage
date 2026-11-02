-- =====================================================================
--  CFB Pointage — réglages organisés et activables
--  • Chaque réglage peut dépendre d'une fonction (parent) : quand la fonction est coupée,
--    ses réglages sont masqués et sans effet.
--  • Un réglage oui/non peut porter deux libellés (« Par jour » / « Forfait par mois »).
--  • Justificatifs : fonction optionnelle, COUPÉE par défaut (le CFB ne les demande pas pour l'instant).
--  • Indemnité de télétravail : activable.
--  • Régime personnalisé : jours travaillés choisis par personne (4/5, 3/5… le jour libre varie).
-- =====================================================================
alter table pointage.parametres
  add column if not exists parent  text references pointage.parametres(cle),
  add column if not exists options text[],
  add column if not exists ordre   smallint not null default 100,
  add column if not exists aide    text;

insert into pointage.parametres (cle, valeur, unite, libelle, categorie, provisoire, source, ordre, aide) values
  ('justificatifs_actifs', 0, 'booleen', 'Demander des justificatifs (certificats…)', 'Congés et absences', true,
   'Le CFB ne les demande pas pour l''instant', 10, 'Coupé : aucun justificatif n''est demandé ni signalé comme manquant.'),
  ('indemnite_tt_active', 1, 'booleen', 'Indemnité de télétravail', 'Télétravail', true, 'Proposition', 10,
   'Calculée dans Rapports › Télétravail, à partir des jours pointés en télétravail.')
on conflict (cle) do nothing;

update pointage.parametres set categorie = 'Congés et absences' where categorie = 'Congés';
update pointage.parametres set parent = 'justificatifs_actifs', categorie = 'Congés et absences', ordre = 11 where cle = 'justificatif_visible_n1';
update pointage.parametres set parent = 'indemnite_tt_active', ordre = 11 where cle = 'indemnite_tt_montant';
update pointage.parametres set parent = 'indemnite_tt_active', ordre = 12, options = array['Par jour de télétravail', 'Forfait par mois'],
  libelle = 'Mode de calcul' where cle = 'indemnite_tt_forfait_mensuel';
update pointage.parametres set parent = 'indemnite_tt_active', ordre = 13 where cle = 'indemnite_tt_plafond';

create or replace view public.parametres with (security_invoker = true) as
select cle, valeur, unite, libelle, provisoire, source, categorie, parent, options, ordre, aide from pointage.parametres;

-- Indemnité : 0 si la fonction est coupée
create or replace function pointage.indemnite_tt(p_jours int) returns int
language sql stable security definer set search_path = '' as $$
  with p as (select coalesce(pointage.param('indemnite_tt_montant'), 0) as montant,
                    coalesce(pointage.param('indemnite_tt_forfait_mensuel'), 0) as forfait,
                    coalesce(pointage.param('indemnite_tt_plafond'), 0) as plafond,
                    coalesce(pointage.param('indemnite_tt_active'), 0) as active)
  select case when p_jours <= 0 or (select active from p) = 0 then 0
              else (select case when plafond > 0 then least(brut, plafond) else brut end
                    from (select case when forfait = 1 then montant else montant * p_jours end as brut, plafond from p) x)
         end
$$;

-- Justificatifs : « requis » seulement si la fonction est activée
create or replace view public.demandes with (security_invoker = true) as
select d.id, d.numero, d.personne_id, pe.prenom, pe.nom, d.type, d.code_absence, ca.libelle as libelle_absence,
       ca.code_court, d.date_debut, d.date_fin, d.demi, d.minutes_decomptees, d.commentaire, d.statut,
       d.decide_par, d.decide_le, d.commentaire_decision, d.constate_le, d.encode_par_rh, d.cree_le,
       d.statut = 'en_attente' and pointage.est_valideur_de(d.personne_id) as je_peux_valider,
       ca.justificatif_requis and coalesce(pointage.param('justificatifs_actifs'), 0) = 1 as justificatif_requis,
       d.justificatif_url is not null as justificatif_joint,
       case when pointage.peut_lire_justificatif(d.personne_id) then d.justificatif_url end as justificatif_chemin
from pointage.demandes d
join pointage.personnes pe on pe.id = d.personne_id
join pointage.codes_absence ca on ca.code = d.code_absence;

-- Régime personnalisé : les heures de chaque jour (lun → dim). Réutilise un régime identique s'il existe,
-- sinon en crée un, nommé d'après ses jours (« 4/5 · lun mar jeu ven »).
create or replace function public.regime_personnalise(p_personne_id uuid, p_minutes_jour int[], p_debut date) returns smallint
language plpgsql security definer set search_path = '' as $$
declare
  v_id      smallint;
  v_jours   int;
  v_semaine int;
  v_plein   int;
  v_lib     text;
  v_noms    text[] := array['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
begin
  perform pointage.exiger_role('admin', 'admin_rh');
  if cardinality(p_minutes_jour) <> 7 or exists (select 1 from unnest(p_minutes_jour) m where m < 0 or m > 720) then
    raise exception 'Indique les heures des 7 jours (entre 0 et 12 h)';
  end if;
  select count(*) filter (where m > 0), sum(m) into v_jours, v_semaine from unnest(p_minutes_jour) m;
  if v_jours = 0 then raise exception 'Choisis au moins un jour travaillé'; end if;

  select id into v_id from pointage.regimes where actif and minutes_jour = p_minutes_jour order by id limit 1;
  if v_id is null then
    select max(minutes_semaine) into v_plein from pointage.regimes where actif and contrat = 'temps_plein';
    v_lib := (case when v_semaine >= coalesce(v_plein, v_semaine) then 'Temps plein' else v_jours || '/5' end)
             || ' · ' || (select string_agg(v_noms[i], ' ' order by i) from generate_series(1, 7) i where p_minutes_jour[i] > 0)
             || ' (' || to_char(make_interval(mins => v_semaine), 'FMHH24"h"MI') || '/sem.)';
    while exists (select 1 from pointage.regimes where libelle = v_lib) loop v_lib := v_lib || '′'; end loop;
    insert into pointage.regimes (libelle, contrat, minutes_jour)
    values (v_lib, case when v_semaine >= coalesce(v_plein, v_semaine) then 'temps_plein' else 'temps_partiel' end::pointage.contrat, p_minutes_jour)
    returning id into v_id;
  end if;
  perform public.changer_regime(p_personne_id, v_id, p_debut);
  return v_id;
end $$;

revoke all on function public.regime_personnalise(uuid, int[], date) from public, anon;
grant execute on function public.regime_personnalise(uuid, int[], date) to authenticated;
grant select on public.parametres, public.demandes to authenticated;
select pointage.fixer_fuseau();
