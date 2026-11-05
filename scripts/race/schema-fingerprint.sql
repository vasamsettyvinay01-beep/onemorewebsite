select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as fn, md5(replace(p.prosrc, E'\r', '')) as src
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
union all
select 'table:' || c.relname, md5(string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull::text, ',' order by a.attnum))
from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid
where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
group by c.relname
order by 1;
