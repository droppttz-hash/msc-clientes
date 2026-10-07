-- Tira o acesso anônimo às funções do sistema (rodar depois do 08 ou do 09)
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.prorettype = 'trigger'::regtype as gatilho
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosecdef and p.proname <> 'rls_auto_enable' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.gatilho then execute format('revoke execute on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
alter function public.fn_bloquear_alteracao() set search_path = public;
grant execute on function public.buscar_produto(text, int), public.busca_geral(text) to authenticated;
revoke execute on function public.buscar_produto(text, int), public.busca_geral(text) from public, anon;
