create table if not exists public.candidate_notes (
  office_id text not null,
  candidate_id text not null,
  member_id uuid not null references public.members (id) on delete cascade,
  note_text text not null,
  updated_at timestamptz not null default now(),
  primary key (office_id, candidate_id, member_id)
);

alter table public.candidate_notes enable row level security;
revoke all on public.candidate_notes from anon, authenticated;

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
