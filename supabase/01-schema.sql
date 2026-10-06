-- =====================================================================
-- MSC Assistência Técnica — Cadastro de Clientes e Compras
-- Banco: Supabase (PostgreSQL 15+)
-- Como usar: Supabase > SQL Editor > New query > cole tudo > Run
-- Pode rodar mais de uma vez sem quebrar (idempotente).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) CLIENTES
-- ---------------------------------------------------------------------
create table if not exists public.clientes (
  id               uuid primary key default gen_random_uuid(),
  nome             text not null check (length(trim(nome)) >= 2),
  telefone         text check (telefone ~ '^[0-9]{10,11}$'),        -- só dígitos: DDD + número
  email            text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  cep              text check (cep is null or cep ~ '^[0-9]{8}$'),  -- só dígitos
  logradouro       text,
  numero           text,
  complemento      text,
  bairro           text,
  cidade           text,
  uf               text check (uf is null or uf ~ '^[A-Z]{2}$'),
  data_nascimento  date check (data_nascimento is null or data_nascimento between date '1900-01-01' and current_date),
  observacoes      text,
  ativo            boolean not null default true,                    -- "excluir" = inativar (histórico fica)
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);

create index if not exists clientes_nome_idx     on public.clientes (lower(nome));
create index if not exists clientes_telefone_idx on public.clientes (telefone);
create index if not exists clientes_email_idx    on public.clientes (lower(email));

-- ---------------------------------------------------------------------
-- 2) COMPRAS
--    Valor guardado em CENTAVOS (inteiro) para nunca dar erro de arredondamento.
--    Compra não é apagada: é CANCELADA (fica no histórico).
-- ---------------------------------------------------------------------
create table if not exists public.compras (
  id                   uuid primary key default gen_random_uuid(),
  numero               bigint generated always as identity unique,   -- nº sequencial da compra
  cliente_id           uuid not null references public.clientes(id) on delete restrict,
  data                 date not null default (now() at time zone 'America/Sao_Paulo')::date,
  descricao            text not null check (length(trim(descricao)) >= 2),
  valor_centavos       bigint not null check (valor_centavos > 0),
  forma_pagamento      text not null check (forma_pagamento in ('pix','dinheiro','debito','credito','boleto','outro')),
  parcelas             smallint not null default 1 check (parcelas between 1 and 24),
  observacao           text,
  status               text not null default 'ativa' check (status in ('ativa','cancelada')),
  motivo_cancelamento  text,
  cancelada_em         timestamptz,
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now(),
  constraint parcelas_so_no_credito check (forma_pagamento = 'credito' or parcelas = 1),
  constraint cancelamento_consistente check (
    (status = 'ativa' and cancelada_em is null) or
    (status = 'cancelada' and cancelada_em is not null and coalesce(length(trim(motivo_cancelamento)),0) > 0)
  )
);

create index if not exists compras_cliente_idx on public.compras (cliente_id, data desc);
create index if not exists compras_data_idx    on public.compras (data desc);

-- ---------------------------------------------------------------------
-- 3) AUDITORIA — registra toda criação/alteração (antes e depois)
-- ---------------------------------------------------------------------
create table if not exists public.auditoria (
  id           bigint generated always as identity primary key,
  tabela       text not null,
  registro_id  uuid not null,
  acao         text not null,          -- INSERT | UPDATE
  antes        jsonb,
  depois       jsonb,
  usuario_id   uuid,
  quando       timestamptz not null default now()
);
create index if not exists auditoria_registro_idx on public.auditoria (tabela, registro_id, quando desc);

create or replace function public.fn_auditar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.auditoria (tabela, registro_id, acao, antes, depois, usuario_id)
  values (tg_table_name, new.id, tg_op,
          case when tg_op = 'UPDATE' then to_jsonb(old) end,
          to_jsonb(new),
          auth.uid());
  return new;
end $$;

create or replace function public.fn_atualizado_em()
returns trigger language plpgsql set search_path = public as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

-- Compra cancelada não volta a ficar ativa, e valor/cliente não mudam depois de cancelada.
create or replace function public.fn_proteger_compra()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status = 'cancelada' then
    raise exception 'Compra nº % já está cancelada e não pode ser alterada.', old.numero;
  end if;
  if new.cliente_id <> old.cliente_id then
    raise exception 'Não é permitido mudar o cliente de uma compra. Cancele e lance de novo.';
  end if;
  return new;
end $$;

drop trigger if exists trg_clientes_atualizado on public.clientes;
create trigger trg_clientes_atualizado before update on public.clientes
  for each row execute function public.fn_atualizado_em();

drop trigger if exists trg_compras_atualizado on public.compras;
create trigger trg_compras_atualizado before update on public.compras
  for each row execute function public.fn_atualizado_em();

drop trigger if exists trg_compras_proteger on public.compras;
create trigger trg_compras_proteger before update on public.compras
  for each row execute function public.fn_proteger_compra();

drop trigger if exists trg_clientes_auditoria on public.clientes;
create trigger trg_clientes_auditoria after insert or update on public.clientes
  for each row execute function public.fn_auditar();

drop trigger if exists trg_compras_auditoria on public.compras;
create trigger trg_compras_auditoria after insert or update on public.compras
  for each row execute function public.fn_auditar();

-- ---------------------------------------------------------------------
-- 4) RESUMO POR CLIENTE (total gasto, nº de compras, última compra)
-- ---------------------------------------------------------------------
create or replace view public.clientes_resumo
with (security_invoker = true) as
select c.*,
       coalesce(sum(p.valor_centavos) filter (where p.status = 'ativa'), 0)::bigint as total_centavos,
       count(p.id) filter (where p.status = 'ativa')                               as qtd_compras,
       max(p.data) filter (where p.status = 'ativa')                               as ultima_compra,
       extract(month from c.data_nascimento)::int                                   as mes_aniversario
from public.clientes c
left join public.compras p on p.cliente_id = c.id
group by c.id;

-- ---------------------------------------------------------------------
-- 5) SEGURANÇA (RLS): só quem fez login acessa. Ninguém apaga nada.
-- ---------------------------------------------------------------------
alter table public.clientes  enable row level security;
alter table public.compras   enable row level security;
alter table public.auditoria enable row level security;

drop policy if exists clientes_ler    on public.clientes;
drop policy if exists clientes_criar  on public.clientes;
drop policy if exists clientes_editar on public.clientes;
create policy clientes_ler    on public.clientes for select to authenticated using (true);
create policy clientes_criar  on public.clientes for insert to authenticated with check (true);
create policy clientes_editar on public.clientes for update to authenticated using (true) with check (true);

drop policy if exists compras_ler    on public.compras;
drop policy if exists compras_criar  on public.compras;
drop policy if exists compras_editar on public.compras;
create policy compras_ler    on public.compras for select to authenticated using (true);
create policy compras_criar  on public.compras for insert to authenticated with check (true);
create policy compras_editar on public.compras for update to authenticated using (true) with check (true);

drop policy if exists auditoria_ler on public.auditoria;
create policy auditoria_ler on public.auditoria for select to authenticated using (true);

-- Sem policy de DELETE = ninguém consegue apagar pelo site.
revoke delete on public.clientes, public.compras, public.auditoria from anon, authenticated;
revoke all    on public.clientes, public.compras, public.auditoria, public.clientes_resumo from anon;
grant select, insert, update on public.clientes, public.compras to authenticated;
grant select on public.clientes_resumo, public.auditoria to authenticated;
