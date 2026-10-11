-- All share mutations lock ticket first, then share, so claim/revoke/rotate cannot deadlock.

set lock_timeout = '4s';
set statement_timeout = '60s';

create or replace function public.claim_ticket_share(
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
     and revoked_at is null;

  if v_ticket_id is null then return null; end if;

  perform 1 from tickets where id = v_ticket_id for update;
  if not found then return null; end if;

  perform 1
    from ticket_shares
   where token_hash = p_token_hash
     and ticket_id = v_ticket_id
     and revoked_at is null
   for update;

  if not found then return null; end if;

  update tickets
     set guest_name = p_guest_name,
         claimed_at = coalesce(claimed_at, now())
   where id = v_ticket_id
     and status = 'valid'
  returning guest_name into v_name;

  return v_name;
end;
$$;

create function public.revoke_ticket_share(
  p_ticket_id uuid,
  p_clear_name boolean default true
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1 from tickets where id = p_ticket_id for update;
  if not found then return false; end if;

  update ticket_shares
     set revoked_at = now()
   where ticket_id = p_ticket_id
     and revoked_at is null;

  if p_clear_name then
    update tickets
       set guest_name = null, claimed_at = null
     where id = p_ticket_id and status = 'valid';
  end if;

  return true;
end;
$$;

revoke execute on function public.revoke_ticket_share(uuid, boolean) from public, anon, authenticated;
grant execute on function public.revoke_ticket_share(uuid, boolean) to service_role;
