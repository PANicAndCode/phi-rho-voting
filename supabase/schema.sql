-- Run this on a new Supabase project, or after removing any earlier
-- email-auth version of this election schema.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

drop table if exists public.votes cascade;
drop table if exists public.candidate_notes cascade;
drop table if exists public.member_sessions cascade;
drop table if exists public.members cascade;
drop table if exists public.app_state cascade;
drop table if exists public.profiles cascade;

create table public.members (
  id uuid primary key default extensions.gen_random_uuid(),
  login_name text not null,
  login_name_normalized text not null unique,
  display_name text not null,
  password_hash text not null,
  role text not null default 'member' check (role in ('member', 'president')),
  member_status text not null default 'active' check (member_status in ('active', 'inactive')),
  contact_email text unique,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.member_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text
);

create table public.app_state (
  id boolean primary key default true check (id),
  state jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.members (id)
);

create table public.votes (
  office_id text not null,
  voter_id uuid not null references public.members (id) on delete cascade,
  ballot_payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (office_id, voter_id)
);

create table public.candidate_notes (
  office_id text not null,
  candidate_id text not null,
  member_id uuid not null references public.members (id) on delete cascade,
  note_text text not null,
  updated_at timestamptz not null default now(),
  primary key (office_id, candidate_id, member_id)
);

create or replace function public.normalize_member_name(p_name text)
returns text
language sql
immutable
as $$
  select regexp_replace(lower(trim(coalesce(p_name, ''))), '\s+', ' ', 'g');
$$;

create or replace function public.president_login_email()
returns text
language sql
immutable
as $$
  select 'president.psr.rho@gmail.com'::text;
$$;

create or replace function public.require_member_session(p_session_token text)
returns table (
  session_id uuid,
  member_id uuid,
  display_name text,
  login_name text,
  role text,
  member_status text,
  contact_email text
)
language sql
security definer
set search_path = public
as $$
  select
    s.id,
    m.id,
    m.display_name,
    m.login_name,
    m.role,
    m.member_status,
    m.contact_email
  from public.member_sessions s
  join public.members m on m.id = s.member_id
  where s.token_hash = encode(extensions.digest(trim(coalesce(p_session_token, '')), 'sha256'::text), 'hex')
    and s.revoked_at is null
    and m.removed_at is null
  limit 1;
$$;

create or replace function public.assert_president(p_session_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
begin
  select * into v_session
  from public.require_member_session(p_session_token);

  if not found or v_session.role <> 'president' then
    raise exception 'Only the president can use that control.';
  end if;

  return v_session.member_id;
end;
$$;

create or replace function public.issue_member_session(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.members%rowtype;
  v_token text;
  v_token_hash text;
begin
  select * into v_member
  from public.members
  where id = p_member_id
    and removed_at is null;

  if not found then
    raise exception 'Member account not found.';
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  v_token_hash := encode(extensions.digest(v_token, 'sha256'::text), 'hex');

  insert into public.member_sessions (
    member_id,
    token_hash,
    created_at,
    last_seen_at
  )
  values (
    v_member.id,
    v_token_hash,
    now(),
    now()
  );

  return jsonb_build_object(
    'session_token', v_token,
    'member', jsonb_build_object(
      'id', v_member.id,
      'login_name', v_member.login_name,
      'display_name', v_member.display_name,
      'role', v_member.role,
      'member_status', v_member.member_status,
      'contact_email', v_member.contact_email
    )
  );
end;
$$;

create or replace function public.register_member(
  p_name text,
  p_password text,
  p_member_status text default 'active'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_normalized text := public.normalize_member_name(p_name);
  v_member_id uuid;
begin
  if v_name = '' then
    raise exception 'Enter your name.';
  end if;

  if char_length(trim(coalesce(p_password, ''))) < 6 then
    raise exception 'Use a password with at least 6 characters.';
  end if;

  if exists (
    select 1
    from public.members
    where login_name_normalized = v_normalized
      and removed_at is null
  ) then
    raise exception 'That name is already in use. Try a slightly different version.';
  end if;

  insert into public.members (
    login_name,
    login_name_normalized,
    display_name,
    password_hash,
    role,
    member_status,
    contact_email,
    created_at,
    updated_at
  )
  values (
    v_name,
    v_normalized,
    v_name,
    extensions.crypt(trim(p_password), extensions.gen_salt('bf')),
    'member',
    coalesce(nullif(trim(coalesce(p_member_status, '')), ''), 'active'),
    null,
    now(),
    now()
  )
  returning id into v_member_id;

  return public.issue_member_session(v_member_id);
end;
$$;

create or replace function public.sign_in_member(
  p_name text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.members%rowtype;
begin
  select * into v_member
  from public.members
  where login_name_normalized = public.normalize_member_name(p_name)
    and removed_at is null
  limit 1;

  if not found or extensions.crypt(trim(coalesce(p_password, '')), v_member.password_hash) <> v_member.password_hash then
    raise exception 'That name and password did not match.';
  end if;

  return public.issue_member_session(v_member.id);
end;
$$;

create or replace function public.sign_in_president(
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.members%rowtype;
begin
  select * into v_member
  from public.members
  where contact_email = public.president_login_email()
    and role = 'president'
    and removed_at is null
  limit 1;

  if not found then
    raise exception 'Create the president account in SQL first, then use the president sign-in button.';
  end if;

  if extensions.crypt(trim(coalesce(p_password, '')), v_member.password_hash) <> v_member.password_hash then
    raise exception 'The president password is incorrect.';
  end if;

  return public.issue_member_session(v_member.id);
end;
$$;

create or replace function public.touch_session(
  p_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
begin
  select * into v_session
  from public.require_member_session(p_session_token);

  if not found then
    return null;
  end if;

  update public.member_sessions
  set last_seen_at = now()
  where id = v_session.session_id;

  return jsonb_build_object(
    'session_token', trim(p_session_token),
    'member', jsonb_build_object(
      'id', v_session.member_id,
      'login_name', v_session.login_name,
      'display_name', v_session.display_name,
      'role', v_session.role,
      'member_status', v_session.member_status,
      'contact_email', v_session.contact_email
    )
  );
end;
$$;

create or replace function public.sign_out_member(
  p_session_token text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.member_sessions
  set revoked_at = now(),
      revoked_reason = 'signed out'
  where token_hash = encode(extensions.digest(trim(coalesce(p_session_token, '')), 'sha256'::text), 'hex')
    and revoked_at is null;
end;
$$;

create or replace function public.update_member_profile(
  p_session_token text,
  p_display_name text,
  p_member_status text,
  p_new_password text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_display_name text := trim(coalesce(p_display_name, ''));
  v_normalized text := public.normalize_member_name(p_display_name);
  v_member public.members%rowtype;
begin
  select * into v_session
  from public.require_member_session(p_session_token);

  if not found then
    raise exception 'Sign in before saving your profile.';
  end if;

  if v_display_name = '' then
    raise exception 'Enter your name before saving.';
  end if;

  if exists (
    select 1
    from public.members
    where id <> v_session.member_id
      and login_name_normalized = v_normalized
      and removed_at is null
  ) then
    raise exception 'That name is already taken by another member.';
  end if;

  if coalesce(trim(coalesce(p_new_password, '')), '') <> '' and char_length(trim(p_new_password)) < 6 then
    raise exception 'Use a password with at least 6 characters.';
  end if;

  update public.members
  set login_name = v_display_name,
      login_name_normalized = v_normalized,
      display_name = v_display_name,
      member_status = coalesce(nullif(trim(coalesce(p_member_status, '')), ''), member_status),
      password_hash = case
        when coalesce(trim(coalesce(p_new_password, '')), '') = '' then password_hash
        else extensions.crypt(trim(p_new_password), extensions.gen_salt('bf'))
      end,
      updated_at = now()
  where id = v_session.member_id
  returning * into v_member;

  return jsonb_build_object(
    'id', v_member.id,
    'login_name', v_member.login_name,
    'display_name', v_member.display_name,
    'role', v_member.role,
    'member_status', v_member.member_status,
    'contact_email', v_member.contact_email
  );
end;
$$;

create or replace function public.get_public_state()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select state
  from public.app_state
  where id = true;
$$;

create or replace function public.save_app_state(
  p_session_token text,
  p_state jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_president_id uuid;
  v_state jsonb := coalesce(p_state, '{}'::jsonb);
begin
  v_president_id := public.assert_president(p_session_token);

  insert into public.app_state (
    id,
    state,
    updated_at,
    updated_by
  )
  values (
    true,
    v_state,
    now(),
    v_president_id
  )
  on conflict (id) do update
  set state = excluded.state,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by;

  return v_state;
end;
$$;

create or replace function public.get_member_vote(
  p_session_token text,
  p_office_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_vote public.votes%rowtype;
begin
  select * into v_session
  from public.require_member_session(p_session_token);

  if not found then
    return null;
  end if;

  select * into v_vote
  from public.votes
  where office_id = p_office_id
    and voter_id = v_session.member_id;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'office_id', v_vote.office_id,
    'voter_id', v_vote.voter_id,
    'updated_at', v_vote.updated_at,
    'ballot_payload', v_vote.ballot_payload
  );
end;
$$;

create or replace function public.submit_vote(
  p_session_token text,
  p_office_id text,
  p_ballot_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_vote public.votes%rowtype;
begin
  select * into v_session
  from public.require_member_session(p_session_token);

  if not found then
    raise exception 'Sign in before voting.';
  end if;

  insert into public.votes (
    office_id,
    voter_id,
    ballot_payload,
    updated_at
  )
  values (
    p_office_id,
    v_session.member_id,
    coalesce(p_ballot_payload, '{}'::jsonb),
    now()
  )
  on conflict (office_id, voter_id) do update
  set ballot_payload = excluded.ballot_payload,
      updated_at = excluded.updated_at
  returning * into v_vote;

  return jsonb_build_object(
    'office_id', v_vote.office_id,
    'voter_id', v_vote.voter_id,
    'updated_at', v_vote.updated_at,
    'ballot_payload', v_vote.ballot_payload
  );
end;
$$;

create or replace function public.get_office_votes(
  p_session_token text,
  p_office_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_president(p_session_token);

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'office_id', v.office_id,
          'voter_id', v.voter_id,
          'updated_at', v.updated_at,
          'ballot_payload', v.ballot_payload
        )
        order by v.updated_at desc
      )
      from public.votes v
      where v.office_id = p_office_id
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.get_candidate_notes(
  p_session_token text,
  p_office_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
begin
  select * into v_session
  from public.require_member_session(p_session_token);

  if not found then
    return '[]'::jsonb;
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'office_id', n.office_id,
          'candidate_id', n.candidate_id,
          'member_id', n.member_id,
          'note_text', n.note_text,
          'updated_at', n.updated_at
        )
        order by n.updated_at desc, n.candidate_id asc
      )
      from public.candidate_notes n
      where n.member_id = v_session.member_id
        and n.office_id = p_office_id
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.save_candidate_note(
  p_session_token text,
  p_office_id text,
  p_candidate_id text,
  p_note_text text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_note public.candidate_notes%rowtype;
  v_note_text text := coalesce(p_note_text, '');
begin
  select * into v_session
  from public.require_member_session(p_session_token);

  if not found then
    raise exception 'Sign in before saving private candidate notes.';
  end if;

  if trim(coalesce(p_candidate_id, '')) = '' then
    raise exception 'Choose a candidate before saving notes.';
  end if;

  if trim(v_note_text) = '' then
    delete from public.candidate_notes
    where office_id = p_office_id
      and candidate_id = p_candidate_id
      and member_id = v_session.member_id;

    return null;
  end if;

  insert into public.candidate_notes (
    office_id,
    candidate_id,
    member_id,
    note_text,
    updated_at
  )
  values (
    p_office_id,
    p_candidate_id,
    v_session.member_id,
    v_note_text,
    now()
  )
  on conflict (office_id, candidate_id, member_id) do update
  set note_text = excluded.note_text,
      updated_at = excluded.updated_at
  returning * into v_note;

  return jsonb_build_object(
    'office_id', v_note.office_id,
    'candidate_id', v_note.candidate_id,
    'member_id', v_note.member_id,
    'note_text', v_note.note_text,
    'updated_at', v_note.updated_at
  );
end;
$$;

create or replace function public.list_members(
  p_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_president(p_session_token);

  return coalesce(
    (
      select jsonb_agg(member_row order by is_online desc, role_sort asc, display_sort asc)
      from (
        select
          jsonb_build_object(
            'id', m.id,
            'login_name', m.login_name,
            'display_name', m.display_name,
            'role', m.role,
            'member_status', m.member_status,
            'contact_email', m.contact_email,
            'is_online',
              exists (
                select 1
                from public.member_sessions s
                where s.member_id = m.id
                  and s.revoked_at is null
                  and s.last_seen_at >= now() - interval '2 minutes'
              )
          ) as member_row,
          exists (
            select 1
            from public.member_sessions s
            where s.member_id = m.id
              and s.revoked_at is null
              and s.last_seen_at >= now() - interval '2 minutes'
          ) as is_online,
          case when m.role = 'president' then 0 else 1 end as role_sort,
          m.display_name as display_sort
        from public.members m
        where m.removed_at is null
      ) ranked
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.set_member_role(
  p_session_token text,
  p_member_id uuid,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.members%rowtype;
begin
  perform public.assert_president(p_session_token);

  if p_role not in ('member', 'president') then
    raise exception 'Invalid role.';
  end if;

  select * into v_member
  from public.members
  where id = p_member_id
    and removed_at is null;

  if not found then
    raise exception 'Member not found.';
  end if;

  if v_member.contact_email = public.president_login_email() and p_role <> 'president' then
    raise exception 'The main president account cannot lose president access.';
  end if;

  update public.members
  set role = p_role,
      updated_at = now()
  where id = p_member_id
  returning * into v_member;

  return jsonb_build_object(
    'id', v_member.id,
    'login_name', v_member.login_name,
    'display_name', v_member.display_name,
    'role', v_member.role,
    'member_status', v_member.member_status,
    'contact_email', v_member.contact_email
  );
end;
$$;

create or replace function public.kick_member(
  p_session_token text,
  p_member_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_president_id uuid;
  v_member public.members%rowtype;
begin
  v_president_id := public.assert_president(p_session_token);

  if v_president_id = p_member_id then
    raise exception 'Use sign out instead of kicking your own session.';
  end if;

  select * into v_member
  from public.members
  where id = p_member_id
    and removed_at is null;

  if not found then
    raise exception 'Member not found.';
  end if;

  if v_member.contact_email = public.president_login_email() then
    raise exception 'The main president account cannot be removed.';
  end if;

  delete from public.members
  where id = p_member_id;
end;
$$;

alter table public.members enable row level security;
alter table public.member_sessions enable row level security;
alter table public.app_state enable row level security;
alter table public.votes enable row level security;
alter table public.candidate_notes enable row level security;

revoke all on public.members from anon, authenticated;
revoke all on public.member_sessions from anon, authenticated;
revoke all on public.app_state from anon, authenticated;
revoke all on public.votes from anon, authenticated;
revoke all on public.candidate_notes from anon, authenticated;

insert into public.app_state (
  id,
  state,
  updated_at,
  updated_by
)
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
  ),
  now(),
  null
)
on conflict (id) do nothing;

insert into public.members (
  login_name,
  login_name_normalized,
  display_name,
  password_hash,
  role,
  member_status,
  contact_email
)
values (
  'President',
  public.normalize_member_name('President'),
  'President',
  extensions.crypt('P3ngu!n84', extensions.gen_salt('bf')),
  'president',
  'active',
  public.president_login_email()
)
on conflict (contact_email) do update
set password_hash = excluded.password_hash,
    role = 'president',
    member_status = 'active',
    removed_at = null,
    updated_at = now();
