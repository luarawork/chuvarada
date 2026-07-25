-- A página interna /sugestoes (app/sugestoes, app/api/suggestions/all,
-- app/api/suggestions/[id]) usa os status 'open' / 'in_review' / 'resolved'
-- -- diferente do conjunto original de user_suggestions ('open' / 'reviewing'
-- / 'closed', ver scripts/sql/027_user_suggestions.sql). Migra as linhas
-- existentes antes de trocar a constraint, senão qualquer linha com o status
-- antigo passaria a violar o check.
update user_suggestions set status = 'in_review' where status = 'reviewing';
update user_suggestions set status = 'resolved' where status = 'closed';

alter table user_suggestions drop constraint if exists user_suggestions_status_check;
alter table user_suggestions add constraint user_suggestions_status_check
  check (status in ('open', 'in_review', 'resolved'));
