-- One row per card a member initialed. Rows are never updated or deleted: they are the
-- record of what each member agreed to, which version, and when.
create table agreement_acceptances (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  agreement     text not null,           -- member | host
  card_id       text not null,
  card_version  int not null,
  initials      text not null,
  check_passed  boolean,                 -- null when the card has no check question
  ip            text,
  user_agent    text,
  accepted_at   timestamptz not null default now(),
  unique (user_id, agreement, card_id, card_version)
);
create index on agreement_acceptances (user_id);

create or replace function agreement_acceptances_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'agreement records cannot be changed';
end $$;
create trigger agreement_acceptances_no_update before update on agreement_acceptances
  for each row execute function agreement_acceptances_immutable();
