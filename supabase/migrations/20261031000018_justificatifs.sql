-- =====================================================================
--  CFB Pointage — justificatifs (certificat médical, accident de travail, petit chômage…)
--  Fichier privé (Supabase Storage, dossier = personne) joint à une demande / absence.
--  Lecture : la personne, la RH, l'admin RH, l'admin ; le N+1 seulement si le réglage
--  « justificatif_visible_n1 » est activé (données de santé : décision RGPD à prendre par le CFB,
--  désactivé par défaut).
-- =====================================================================

insert into pointage.parametres (cle, valeur, unite, libelle, categorie, provisoire, source) values
  ('justificatif_visible_n1', 0, 'booleen', 'Le N+1 peut ouvrir les justificatifs (certificats) de son équipe', 'Confidentialité', true,
   'À décider (données de santé) — par défaut : RH uniquement')
on conflict (cle) do nothing;

-- Droits sur le dossier d'une personne (le nom du dossier = identifiant de la personne)
create or replace function pointage.dossier_personne(p_nom text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return split_part(p_nom, '/', 1)::uuid;
exception when others then
  return null;
end $$;

create or replace function pointage.peut_lire_justificatif(p_personne uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_personne is not null and pointage.moi() is not null and (
    p_personne = pointage.moi()
    or pointage.mon_role() in ('rh', 'admin_rh', 'admin')
    or (coalesce(pointage.param('justificatif_visible_n1'), 0) = 1 and pointage.est_valideur_de(p_personne)))
$$;

create or replace function pointage.peut_deposer_justificatif(p_personne uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_personne is not null and pointage.moi() is not null
     and (p_personne = pointage.moi() or pointage.mon_role() in ('rh', 'admin_rh', 'admin'))
$$;

-- Une demande déjà accordée sur un mois clôturé peut encore recevoir son justificatif (rien d'autre)
create or replace function pointage.bloquer_demande_cloture() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'justificatif_url' - 'maj_le') = (to_jsonb(old) - 'justificatif_url' - 'maj_le') then
    return new;
  end if;
  -- Une demande en attente sur un mois clôturé peut encore être refusée/annulée,
  -- mais pas créée, accordée, ni annulée si elle était accordée.
  if (tg_op = 'INSERT' or new.statut = 'accordee' or old.statut = 'accordee')
     and pointage.mois_cloture(new.date_debut) then
    raise exception 'Période % clôturée : demande impossible', to_char(new.date_debut, 'MM/YYYY');
  end if;
  return new;
end $$;

-- Rattache (ou retire, p_chemin = null) le fichier déposé à la demande
create or replace function public.joindre_justificatif(p_demande uuid, p_chemin text) returns void
language plpgsql security definer set search_path = '' as $$
declare d pointage.demandes;
begin
  perform pointage.exiger_personne();
  select * into d from pointage.demandes where id = p_demande;
  if not found or not pointage.peut_deposer_justificatif(d.personne_id) then
    raise exception 'Demande introuvable ou non autorisée' using errcode = '42501';
  end if;
  if d.statut in ('refusee', 'annulee') then
    raise exception 'Demande refusée ou annulée : pas de justificatif';
  end if;
  if p_chemin is not null and p_chemin not like d.personne_id::text || '/' || d.id::text || '/%' then
    raise exception 'Emplacement du fichier invalide';
  end if;
  update pointage.demandes set justificatif_url = p_chemin where id = p_demande;
end $$;

-- Vue des demandes : + justificatif (chemin seulement pour qui peut l'ouvrir)
create or replace view public.demandes with (security_invoker = true) as
select d.id, d.numero, d.personne_id, pe.prenom, pe.nom, d.type, d.code_absence, ca.libelle as libelle_absence,
       ca.code_court, d.date_debut, d.date_fin, d.demi, d.minutes_decomptees, d.commentaire, d.statut,
       d.decide_par, d.decide_le, d.commentaire_decision, d.constate_le, d.encode_par_rh, d.cree_le,
       d.statut = 'en_attente' and pointage.est_valideur_de(d.personne_id) as je_peux_valider,
       ca.justificatif_requis,
       d.justificatif_url is not null as justificatif_joint,
       case when pointage.peut_lire_justificatif(d.personne_id) then d.justificatif_url end as justificatif_chemin
from pointage.demandes d
join pointage.personnes pe on pe.id = d.personne_id
join pointage.codes_absence ca on ca.code = d.code_absence;

-- Stockage (Supabase Storage) : dossier privé, 10 Mo, PDF ou photo
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('justificatifs', 'justificatifs', false, 10485760,
            array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

    drop policy if exists justificatifs_lecture on storage.objects;
    drop policy if exists justificatifs_depot on storage.objects;
    drop policy if exists justificatifs_suppression on storage.objects;
    create policy justificatifs_lecture on storage.objects for select to authenticated
      using (bucket_id = 'justificatifs' and pointage.peut_lire_justificatif(pointage.dossier_personne(name)));
    create policy justificatifs_depot on storage.objects for insert to authenticated
      with check (bucket_id = 'justificatifs' and pointage.peut_deposer_justificatif(pointage.dossier_personne(name)));
    create policy justificatifs_suppression on storage.objects for delete to authenticated
      using (bucket_id = 'justificatifs' and pointage.peut_deposer_justificatif(pointage.dossier_personne(name)));
  end if;
end $$;

revoke all on function pointage.peut_lire_justificatif(uuid), pointage.peut_deposer_justificatif(uuid), pointage.dossier_personne(text) from public, anon;
grant execute on function pointage.peut_lire_justificatif(uuid), pointage.peut_deposer_justificatif(uuid), pointage.dossier_personne(text) to authenticated;
revoke all on function public.joindre_justificatif(uuid, text) from public, anon;
grant execute on function public.joindre_justificatif(uuid, text) to authenticated;
grant select on public.demandes to authenticated;

select pointage.fixer_fuseau();
