-- Première installation : crée le service de l'IT et l'admin général (personne ne peut encore le faire depuis l'appli).
-- psql "$DB_URL" -v prenom='…' -v nom='…' -v email='it@<domaine>' -v service='IT' -f scripts/premier-admin.sql
-- Connexion ensuite : « Se connecter avec Microsoft » (compte Office 365), ou créer d'abord l'utilisateur dans
-- Supabase › Authentication › Add user (même e-mail, « Auto confirm ») puis relancer ce script pour relier le compte.
\set ON_ERROR_STOP 1
begin;
insert into pointage.services (nom) select :'service' where not exists (select 1 from pointage.services where nom = :'service');
insert into pointage.personnes (prenom, nom, email, role, type, service_id, date_entree)
select :'prenom', :'nom', lower(:'email'), 'admin', 'interne', (select id from pointage.services where nom = :'service'), current_date
where not exists (select 1 from pointage.personnes where email = lower(:'email'));
insert into pointage.personne_regimes (personne_id, debut, regime_id)
select p.id, p.date_entree, (select id from pointage.regimes where actif order by id limit 1)
from pointage.personnes p where p.email = lower(:'email') and not exists (select 1 from pointage.personne_regimes r where r.personne_id = p.id);
-- Compte de connexion déjà créé dans Supabase › Authentication : on le relie
update pointage.personnes p set auth_user_id = u.id from auth.users u
 where p.email = lower(:'email') and lower(u.email) = p.email and p.auth_user_id is null;
commit;
select prenom, nom, email, role, auth_user_id is not null as compte_relie from pointage.personnes where email = lower(:'email');
