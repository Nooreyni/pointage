-- =====================================================================
--  CFB Pointage — « Une info est fausse ? » (05/11/2026)
--  Depuis Mon compte, chacun signale une erreur sur sa fiche (nom, e-mail, service, rôle, régime…).
--  La RH et l'admin RH reçoivent une alerte qui ouvre la fiche ; le signalement reste listé dans Suivi RH
--  jusqu'à « Corrigé », et la personne est prévenue. Limite : 5 signalements par personne et par jour.
-- =====================================================================
create table if not exists pointage.signalements (
  id          bigint generated always as identity primary key,
  personne_id uuid not null references pointage.personnes(id),
  champ       text not null check (champ in ('nom', 'email', 'service', 'role', 'regime', 'horaire', 'autre')),
  message     text check (char_length(message) <= 500),
  cree_le     timestamptz not null default now(),
  traite_le   timestamptz,
  traite_par  uuid references pointage.personnes(id)
);
create index if not exists signalements_ouverts_idx on pointage.signalements (cree_le desc) where traite_le is null;
create index if not exists signalements_personne_idx on pointage.signalements (personne_id, cree_le desc);
alter table pointage.signalements enable row level security;   -- aucun accès direct : tout passe par les fonctions ci-dessous

create or replace function pointage.libelle_champ(c text) returns text language sql immutable as $$
  select case c when 'nom' then 'Nom ou prénom' when 'email' then 'E-mail' when 'service' then 'Service' when 'role' then 'Rôle'
                when 'regime' then 'Régime de travail' when 'horaire' then 'Horaires' else 'Autre' end
$$;

create or replace function public.signaler_info(p_champ text, p_message text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_moi uuid := pointage.exiger_personne();
  v_id  bigint;
  v_n   int := 0;
  v_dest uuid;
begin
  if p_champ is null or p_champ not in ('nom', 'email', 'service', 'role', 'regime', 'horaire', 'autre') then raise exception 'Choisis ce qui est faux'; end if;
  if p_champ = 'autre' and nullif(trim(p_message), '') is null then raise exception 'Précise ce qui est faux'; end if;
  if (select count(*) from pointage.signalements where personne_id = v_moi and cree_le > now() - interval '1 day') >= 5 then
    raise exception 'Tu as déjà fait 5 signalements aujourd''hui : la RH les a reçus';
  end if;
  insert into pointage.signalements (personne_id, champ, message) values (v_moi, p_champ, nullif(left(trim(p_message), 500), ''))
  returning id into v_id;
  -- Destinataires : RH et admin RH en poste ; à défaut, l'admin général
  for v_dest in
    select id from pointage.personnes
    where role in ('rh', 'admin_rh') and id <> v_moi and (date_sortie is null or date_sortie >= pointage.aujourdhui())
    union
    select id from pointage.personnes
    where role = 'admin' and (date_sortie is null or date_sortie >= pointage.aujourdhui())
      and not exists (select 1 from pointage.personnes where role in ('rh', 'admin_rh') and id <> v_moi
                        and (date_sortie is null or date_sortie >= pointage.aujourdhui()))
  loop
    perform pointage.notifier(v_dest, 'info_fausse', 'info:' || v_id,
      'Info à corriger : ' || pointage.nom_complet(v_moi),
      pointage.libelle_champ(p_champ) || coalesce(' — « ' || nullif(left(trim(p_message), 200), '') || ' »', ''),
      v_moi::text);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Mes derniers signalements (pour afficher « envoyé / corrigé » dans Mon compte)
create or replace function public.mes_signalements() returns table (id bigint, champ text, message text, cree_le timestamptz, traite_le timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.id, s.champ, s.message, s.cree_le, s.traite_le from pointage.signalements s
  where s.personne_id = pointage.moi() order by s.cree_le desc limit 5
$$;

-- Signalements à traiter (Suivi RH)
create or replace function public.signalements_ouverts()
returns table (id bigint, personne_id uuid, prenom text, nom text, service text, champ text, message text, cree_le timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform pointage.exiger_role('rh', 'admin_rh', 'admin');
  return query
  select s.id, p.id, p.prenom, p.nom, sv.nom, s.champ, s.message, s.cree_le
  from pointage.signalements s join pointage.personnes p on p.id = s.personne_id join pointage.services sv on sv.id = p.service_id
  where s.traite_le is null order by s.cree_le;
end $$;

create or replace function public.traiter_signalement(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare v_moi uuid := pointage.exiger_role('rh', 'admin_rh', 'admin'); v pointage.signalements;
begin
  update pointage.signalements set traite_le = now(), traite_par = v_moi where id = p_id and traite_le is null returning * into v;
  if v.id is null then raise exception 'Signalement introuvable ou déjà traité'; end if;
  perform pointage.notifier(v.personne_id, 'info_corrigee', 'info-ok:' || v.id, 'Ta fiche a été vérifiée',
    'La RH a traité ton signalement (' || lower(pointage.libelle_champ(v.champ)) || ').', null);
end $$;

revoke all on function public.signaler_info(text, text), public.mes_signalements(), public.signalements_ouverts(), public.traiter_signalement(bigint) from public, anon;
grant execute on function public.signaler_info(text, text), public.mes_signalements(), public.signalements_ouverts(), public.traiter_signalement(bigint) to authenticated;
revoke all on function pointage.libelle_champ(text) from public, anon, authenticated;

select pointage.fixer_fuseau();
