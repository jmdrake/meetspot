-- MeetSpot milestone 1: accounts, invites, activities, participation, mail, chat.
-- Plain Postgres 15+; runs unchanged on Supabase.

create extension if not exists pgcrypto;

create table users (
  id               uuid primary key default gen_random_uuid(),
  email            text not null unique,          -- normalized (lowercase, Gmail dots/+tags removed)
  email_display    text not null,                 -- as typed
  supabase_id      uuid unique,
  role             text not null default 'member' check (role in ('member','admin')),
  first_name       text,
  birth_date       date,
  gender           text check (gender in ('F','M','X')),
  intents          text[] not null default '{}',  -- romance, friends, networking, community
  bio              text,
  interests        text[] not null default '{}',
  photo_path       text,
  home_city        text not null default 'Nashville',
  invite_code      text not null unique,          -- this member's personal invite / referral code
  invited_by       uuid references users(id),     -- referral record: written once, never changed
  invited_at       timestamptz,
  no_show_count    int not null default 0,
  late_cancel_count int not null default 0,
  created_at       timestamptz not null default now()
);

-- Referral attribution is permanent.
create or replace function users_lock_referral() returns trigger language plpgsql as $$
begin
  if old.invited_by is not null and new.invited_by is distinct from old.invited_by then
    raise exception 'invited_by is write-once';
  end if;
  if old.invited_at is not null and new.invited_at is distinct from old.invited_at then
    raise exception 'invited_at is write-once';
  end if;
  return new;
end $$;
create trigger users_referral_lock before update on users
  for each row execute function users_lock_referral();

create table login_codes (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  code_hash   text not null,
  invite_code text,
  attempts    int not null default 0,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index on login_codes (email, created_at desc);

create table sessions (
  token_hash  text primary key,
  user_id     uuid not null references users(id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create table activities (
  id               uuid primary key default gen_random_uuid(),
  host_id          uuid not null references users(id),
  title            text not null,
  description      text,
  place_name       text not null,
  address          text,
  neighborhood     text,
  is_private_home  boolean not null default false,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  spots            int not null check (spots between 1 and 100),
  cost_type        text not null default 'free'
                   check (cost_type in ('free','pay_own','dutch','host_covers','ticket')),
  price_cents      int,                             -- stored now, charged later
  audience_intents text[] not null default '{}',   -- empty = any
  audience_genders text[] not null default '{}',   -- empty = any
  age_min          int not null default 18,
  age_max          int not null default 99,
  invite_style     text not null default 'review' check (invite_style in ('review','first_come')),
  auto_fill        boolean not null default true,
  show_to_friends  boolean not null default true,
  canceled_at      timestamptz,
  cancel_reason    text check (cancel_reason in ('event_canceled','cant_make_it','safety')),
  cancel_note      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index on activities (starts_at);

-- One row per member per activity.
-- requested → invited → confirmed → attended | no_show
-- requested/waitlisted → offered (waitlist spot) → confirmed
-- side exits: declined, dropped, expired, filled (accepted after the last spot went)
create table participations (
  id                uuid primary key default gen_random_uuid(),
  activity_id       uuid not null references activities(id) on delete cascade,
  user_id           uuid not null references users(id),
  status            text not null check (status in
                    ('requested','invited','confirmed','waitlisted','offered',
                     'declined','dropped','expired','filled','attended','no_show','canceled')),
  invite_expires_at timestamptz,
  offer_expires_at  timestamptz,
  needs_reconfirm   boolean not null default false,
  checkin_code      text,
  checked_in_at     timestamptz,
  requested_at      timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (activity_id, user_id)
);
create index on participations (user_id);

create table notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  kind         text not null,
  activity_id  uuid references activities(id) on delete set null,
  title        text not null,
  body         text,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index on notifications (user_id, created_at desc);

create table messages (
  id           uuid primary key default gen_random_uuid(),
  activity_id  uuid not null references activities(id) on delete cascade,
  sender_id    uuid not null references users(id),
  body         text not null check (length(body) between 1 and 2000),
  created_at   timestamptz not null default now()
);
create index on messages (activity_id, created_at);
