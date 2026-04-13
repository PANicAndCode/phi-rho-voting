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
