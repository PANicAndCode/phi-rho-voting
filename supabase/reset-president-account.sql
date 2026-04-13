create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

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
