create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text not null,
  role text not null default 'member' check (role in ('member', 'president')),
  member_status text not null default 'active' check (member_status in ('active', 'inactive')),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_state (
  id boolean primary key default true check (id),
  state jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

create table if not exists public.votes (
  office_id text not null,
  voter_id uuid not null references public.profiles (id) on delete cascade,
  ballot_payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (office_id, voter_id)
);

create or replace function public.current_user_is_president()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid() and role = 'president'
  );
$$;

create or replace function public.lock_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();

  if tg_op = 'INSERT' and auth.uid() = new.id then
    new.role := 'member';
  end if;

  if tg_op = 'UPDATE' and auth.uid() = new.id then
    new.role := old.role;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_role_lock on public.profiles;
create trigger profiles_role_lock
before insert or update on public.profiles
for each row
execute function public.lock_profile_role();

alter table public.profiles enable row level security;
alter table public.app_state enable row level security;
alter table public.votes enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "app_state_read_public" on public.app_state;
create policy "app_state_read_public"
on public.app_state
for select
using (true);

drop policy if exists "app_state_write_president" on public.app_state;
create policy "app_state_write_president"
on public.app_state
for all
using (public.current_user_is_president())
with check (public.current_user_is_president());

drop policy if exists "votes_select_own_or_president" on public.votes;
create policy "votes_select_own_or_president"
on public.votes
for select
using (auth.uid() = voter_id or public.current_user_is_president());

drop policy if exists "votes_insert_own" on public.votes;
create policy "votes_insert_own"
on public.votes
for insert
with check (auth.uid() = voter_id);

drop policy if exists "votes_update_own" on public.votes;
create policy "votes_update_own"
on public.votes
for update
using (auth.uid() = voter_id)
with check (auth.uid() = voter_id);

drop policy if exists "votes_delete_president" on public.votes;
create policy "votes_delete_president"
on public.votes
for delete
using (public.current_user_is_president());

insert into public.app_state (id, state)
values (
  true,
  jsonb_build_object(
    'version', 1,
    'chapter', jsonb_build_object(
      'name', 'Phi Sigma Rho',
      'subtitle', 'Engineering sorority election center',
      'motto', 'Together We Build the Future'
    ),
    'offices', jsonb_build_array(),
    'session', jsonb_build_object(
      'activeOfficeId', '',
      'activeCandidateId', '',
      'phase', 'idle',
      'phaseStartedAt', null,
      'phaseEndsAt', null,
      'announcement', 'President may cue the next position when ready.'
    ),
    'timestamps', jsonb_build_object(
      'createdAt', now(),
      'updatedAt', now()
    )
  )
)
on conflict (id) do nothing;
