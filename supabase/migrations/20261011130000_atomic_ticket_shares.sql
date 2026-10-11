-- Keep an existing invitation and claimed name intact until its replacement is ready.
-- These functions serialize activation, claim, and revoke operations on the share row.

set lock_timeout = '4s';
set statement_timeout = '60s';

create function public.activate_ticket_share(
  p_ticket_id uuid,
  p_token_hash text,
  p_clear_name boolean default true
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1 from tickets where id = p_ticket_id for update;
  if not found then return false; end if;

  if not exists (
    select 1 from ticket_shares
    where ticket_id = p_ticket_id and token_hash = p_token_hash
  ) then
    return false;
  end if;

  update ticket_shares
     set revoked_at = now()
   where ticket_id = p_ticket_id
     and revoked_at is null;

  update ticket_shares
     set revoked_at = null
   where ticket_id = p_ticket_id
     and token_hash = p_token_hash;

  if p_clear_name then
    update tickets
       set guest_name = null, claimed_at = null
     where id = p_ticket_id and status = 'valid';
  end if;

  return true;
end;
$$;

create function public.claim_ticket_share(
  p_token_hash text,
  p_guest_name text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket_id uuid;
  v_name text;
begin
  select ticket_id
    into v_ticket_id
    from ticket_shares
   where token_hash = p_token_hash
     and revoked_at is null
   for update;

  if v_ticket_id is null then return null; end if;

  update tickets
     set guest_name = p_guest_name,
         claimed_at = coalesce(claimed_at, now())
   where id = v_ticket_id
     and status = 'valid'
  returning guest_name into v_name;

  return v_name;
end;
$$;

revoke execute on function public.activate_ticket_share(uuid, text, boolean) from public, anon, authenticated;
revoke execute on function public.claim_ticket_share(text, text) from public, anon, authenticated;
grant execute on function public.activate_ticket_share(uuid, text, boolean) to service_role;
grant execute on function public.claim_ticket_share(text, text) to service_role;
