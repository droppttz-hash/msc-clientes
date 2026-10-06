-- =====================================================================
-- MSC Clientes — v3: perfis de acesso (Gerente / Vendedor)
-- Rodar DEPOIS de schema.sql e 02-categorias-caixa.sql.
--
-- Como funciona:
--  * Todo usuário criado no Supabase (Authentication > Users) ganha um
--    perfil automaticamente como VENDEDOR (o acesso mais restrito).
--  * Para virar Gerente ou bloquear alguém: tela Configurações > Usuários
--    no sistema, ou Table Editor > perfis no Supabase.
--  * As regras valem no BANCO, não só na tela: mesmo usando a API direto,
--    vendedor não vê caixa, não apaga nada e só mexe nas vendas dele do dia.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) PERFIS
-- ---------------------------------------------------------------------
create table if not exists public.perfis (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  nome           text not null check (length(trim(nome)) >= 2),
  email          text,
  cargo          text not null default 'vendedor' check (cargo in ('gerente','vendedor')),
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
alter table public.perfis enable row level security;

-- Funções de apoio num schema que NÃO fica exposto na API
create schema if not exists privado;
revoke all on schema privado from public, anon;
grant usage on schema privado to authenticated;

-- Cargo de quem está logado (null = sem perfil ou bloqueado)
create or replace function privado.meu_cargo()
returns text language sql stable security definer set search_path = public as $$
  select cargo from public.perfis where user_id = auth.uid() and ativo
$$;
create or replace function privado.eh_gerente()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select cargo = 'gerente' from public.perfis where user_id = auth.uid() and ativo), false)
$$;
create or replace function privado.tem_acesso()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis where user_id = auth.uid() and ativo)
$$;
create or replace function privado.hoje_sp()
returns date language sql stable set search_path = public as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

-- Novo usuário no Supabase -> perfil de vendedor automático
create or replace function public.fn_novo_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfis (user_id, nome, email, cargo)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'nome'), ''), nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1), 'Usuário'),
    new.email,
    case when (new.raw_user_meta_data->>'cargo') = 'gerente' then 'gerente' else 'vendedor' end
  )
  on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists trg_auth_novo_usuario on auth.users;
create trigger trg_auth_novo_usuario after insert on auth.users
  for each row execute function public.fn_novo_usuario();

-- Usuários que já existem viram GERENTE (é o login de quem montou o sistema)
insert into public.perfis (user_id, nome, email, cargo)
select u.id, coalesce(nullif(split_part(u.email, '@', 1), ''), 'Usuário'), u.email, 'gerente'
from auth.users u
on conflict (user_id) do nothing;

-- Não deixar o sistema sem nenhum gerente ativo
create or replace function public.fn_proteger_perfis()
returns trigger language plpgsql set search_path = public as $$
begin
  if (old.cargo = 'gerente' and old.ativo) and (new.cargo <> 'gerente' or not new.ativo) then
    if not exists (select 1 from public.perfis where cargo = 'gerente' and ativo and user_id <> old.user_id) then
      raise exception 'É preciso ter pelo menos um gerente ativo.';
    end if;
  end if;
  new.atualizado_em := now();
  return new;
end $$;
drop trigger if exists trg_perfis_proteger on public.perfis;
create trigger trg_perfis_proteger before update on public.perfis
  for each row execute function public.fn_proteger_perfis();

drop trigger if exists trg_perfis_auditoria on public.perfis;
create or replace function public.fn_auditar_perfis()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.auditoria (tabela, registro_id, acao, antes, depois, usuario_id)
  values ('perfis', new.user_id, tg_op, case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new), auth.uid());
  return new;
end $$;
create trigger trg_perfis_auditoria after insert or update on public.perfis
  for each row execute function public.fn_auditar_perfis();

-- ---------------------------------------------------------------------
-- 2) QUEM LANÇOU (para saber quem cadastrou cada coisa)
-- ---------------------------------------------------------------------
alter table public.clientes    add column if not exists criado_por uuid default auth.uid() references public.perfis(user_id);
alter table public.compras     add column if not exists criado_por uuid default auth.uid() references public.perfis(user_id);
alter table public.lancamentos add column if not exists criado_por uuid default auth.uid() references public.perfis(user_id);
create index if not exists compras_criado_por_idx on public.compras (criado_por, criado_em desc);

-- Regras extras que a RLS sozinha não cobre
create or replace function public.fn_regras_vendedor_compras()
returns trigger language plpgsql set search_path = public as $$
begin
  -- auth.uid() nulo = alteração feita pelo painel do Supabase (dono do sistema)
  if auth.uid() is null or privado.eh_gerente() then return new; end if;
  if tg_op = 'INSERT' then
    new.criado_por := auth.uid();
    new.data := privado.hoje_sp();                  -- vendedor só lança venda de hoje
  else
    new.data := old.data;                          -- e não muda a data depois
    new.criado_por := old.criado_por;
  end if;
  return new;
end $$;
drop trigger if exists trg_compras_regras_vendedor on public.compras;
create trigger trg_compras_regras_vendedor before insert or update on public.compras
  for each row execute function public.fn_regras_vendedor_compras();

create or replace function public.fn_regras_vendedor_clientes()
returns trigger language plpgsql set search_path = public as $$
begin
  -- auth.uid() nulo = alteração feita pelo painel do Supabase (dono do sistema)
  if auth.uid() is null or privado.eh_gerente() then return new; end if;
  if tg_op = 'INSERT' then
    new.criado_por := auth.uid();
    new.ativo := true;
  elsif new.ativo is distinct from old.ativo then
    raise exception 'Só o gerente pode inativar ou reativar clientes.';
  end if;
  return new;
end $$;
drop trigger if exists trg_clientes_regras_vendedor on public.clientes;
create trigger trg_clientes_regras_vendedor before insert or update on public.clientes
  for each row execute function public.fn_regras_vendedor_clientes();

-- ---------------------------------------------------------------------
-- 3) REGRAS DE ACESSO (RLS) — trocando as antigas "qualquer logado"
-- ---------------------------------------------------------------------
-- PERFIS: cada um vê o seu; gerente vê e altera todos
drop policy if exists perfis_ler on public.perfis;
drop policy if exists perfis_editar on public.perfis;
create policy perfis_ler    on public.perfis for select to authenticated using (user_id = auth.uid() or privado.eh_gerente());
create policy perfis_editar on public.perfis for update to authenticated using (privado.eh_gerente()) with check (privado.eh_gerente());

-- CLIENTES: gerente e vendedor veem, criam e editam (inativar = só gerente, via gatilho)
drop policy if exists clientes_ler    on public.clientes;
drop policy if exists clientes_criar  on public.clientes;
drop policy if exists clientes_editar on public.clientes;
create policy clientes_ler    on public.clientes for select to authenticated using (privado.tem_acesso());
create policy clientes_criar  on public.clientes for insert to authenticated with check (privado.tem_acesso());
create policy clientes_editar on public.clientes for update to authenticated using (privado.tem_acesso()) with check (privado.tem_acesso());

-- COMPRAS (vendas)
--  gerente: tudo
--  vendedor: vê histórico dos clientes + as vendas balcão que ele lançou;
--            edita/cancela só as vendas DELE lançadas HOJE
drop policy if exists compras_ler    on public.compras;
drop policy if exists compras_criar  on public.compras;
drop policy if exists compras_editar on public.compras;
create policy compras_ler on public.compras for select to authenticated using (
  privado.eh_gerente()
  or (privado.tem_acesso() and (cliente_id is not null or criado_por = auth.uid()))
);
create policy compras_criar on public.compras for insert to authenticated with check (privado.tem_acesso());
create policy compras_editar on public.compras for update to authenticated
  using (
    privado.eh_gerente()
    or (privado.tem_acesso() and criado_por = auth.uid() and (criado_em at time zone 'America/Sao_Paulo')::date = privado.hoje_sp())
  )
  with check (
    privado.eh_gerente()
    or (privado.tem_acesso() and criado_por = auth.uid() and (criado_em at time zone 'America/Sao_Paulo')::date = privado.hoje_sp())
  );

-- CATEGORIAS: todos leem (precisa pra vender); só gerente cria/edita
drop policy if exists categorias_ler    on public.categorias;
drop policy if exists categorias_criar  on public.categorias;
drop policy if exists categorias_editar on public.categorias;
create policy categorias_ler    on public.categorias for select to authenticated using (privado.tem_acesso());
create policy categorias_criar  on public.categorias for insert to authenticated with check (privado.eh_gerente());
create policy categorias_editar on public.categorias for update to authenticated using (privado.eh_gerente()) with check (privado.eh_gerente());

-- CAIXA (lançamentos) e AUDITORIA: só gerente
drop policy if exists lancamentos_ler    on public.lancamentos;
drop policy if exists lancamentos_criar  on public.lancamentos;
drop policy if exists lancamentos_editar on public.lancamentos;
create policy lancamentos_ler    on public.lancamentos for select to authenticated using (privado.eh_gerente());
create policy lancamentos_criar  on public.lancamentos for insert to authenticated with check (privado.eh_gerente());
create policy lancamentos_editar on public.lancamentos for update to authenticated using (privado.eh_gerente()) with check (privado.eh_gerente());

drop policy if exists auditoria_ler on public.auditoria;
create policy auditoria_ler on public.auditoria for select to authenticated using (privado.eh_gerente());

-- ---------------------------------------------------------------------
-- 4) PERMISSÕES
-- ---------------------------------------------------------------------
revoke all on public.perfis from anon;
revoke insert, delete, truncate on public.perfis from authenticated;
grant select, update on public.perfis to authenticated;
revoke execute on function public.fn_novo_usuario(), public.fn_proteger_perfis(), public.fn_auditar_perfis(),
  public.fn_regras_vendedor_compras(), public.fn_regras_vendedor_clientes() from anon, authenticated, public;
revoke execute on all functions in schema privado from anon, public;
grant execute on function privado.meu_cargo(), privado.eh_gerente(), privado.tem_acesso(), privado.hoje_sp() to authenticated;
