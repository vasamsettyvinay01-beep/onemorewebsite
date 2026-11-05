select p.proname, pg_get_functiondef(p.oid) as def
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('tier_sold', 'event_sales', 'admit_vip_guests', 'guard_vip_invitation', 'issue_complimentary_tickets',
                    'issue_vip_invitation', 'reject_vip_admission_change', 'rls_auto_enable')
order by 1;
