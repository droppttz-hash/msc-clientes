-- =====================================================================
-- MSC Clientes — v2: categorias de produto + caixa (entradas e saídas)
-- Rodar DEPOIS do schema.sql. Compatível com a versão anterior do site.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) CATEGORIAS (uma tabela só, separada por tipo)
--    venda   = o que a loja vende (Celulares, Capas…)
--    despesa = saídas do caixa (Aluguel, Fornecedor…)
--    receita = outras entradas que não são venda
-- ---------------------------------------------------------------------
create table if not exists public.categorias (
  id             uuid primary key default gen_random_uuid(),
  tipo           text not null check (tipo in ('venda','despesa','receita')),
  nome           text not null check (length(trim(nome)) >= 2),
  ordem          int  not null default 100,
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create unique index if not exists categorias_tipo_nome_uk on public.categorias (tipo, lower(nome));

insert into public.categorias (tipo, nome, ordem) values
  ('venda','Celulares',1), ('venda','Acessórios',2), ('venda','Notebooks',3), ('venda','Capas',4), ('venda','Películas',5),
  ('despesa','Compra de mercadoria / fornecedor',1), ('despesa','Aluguel',2), ('despesa','Funcionários',3),
  ('despesa','Energia / água',4), ('despesa','Internet / telefone',5), ('despesa','Impostos e taxas',6),
  ('despesa','Taxa de maquininha',7), ('despesa','Marketing',8), ('despesa','Manutenção da loja',9),
  ('despesa','Retirada do dono',10), ('despesa','Outras despesas',99),
  ('receita','Aporte / dinheiro colocado',1), ('receita','Outras entradas',99)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 2) COMPRAS: categoria + venda sem cliente cadastrado (venda balcão)
-- ---------------------------------------------------------------------
alter table public.compras add column if not exists categoria_id uuid references public.categorias(id) on delete restrict;
alter table public.compras alter column cliente_id drop not null;
create index if not exists compras_categoria_idx on public.compras (categoria_id);

-- Cliente pode ser preenchido depois numa venda balcão, mas não trocado.
create or replace function public.fn_proteger_compra()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status = 'cancelada' then
    raise exception 'Compra nº % já está cancelada e não pode ser alterada.', old.numero;
  end if;
  if old.cliente_id is not null and new.cliente_id is distinct from old.cliente_id then
    raise exception 'Não é permitido mudar o cliente de uma compra. Cancele e lance de novo.';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 3) LANÇAMENTOS DE CAIXA (tudo que entra/sai e NÃO é venda)
-- ---------------------------------------------------------------------
create table if not exists public.lancamentos (
  id                   uuid primary key default gen_random_uuid(),
  numero               bigint generated always as identity unique,
  tipo                 text not null check (tipo in ('entrada','saida')),
  categoria_id         uuid not null references public.categorias(id) on delete restrict,
  data                 date not null default (now() at time zone 'America/Sao_Paulo')::date,
  descricao            text not null check (length(trim(descricao)) >= 2),
  valor_centavos       bigint not null check (valor_centavos > 0),
  forma_pagamento      text not null check (forma_pagamento in ('pix','dinheiro','debito','credito','boleto','outro')),
  observacao           text,
  status               text not null default 'ativo' check (status in ('ativo','cancelado')),
  motivo_cancelamento  text,
  cancelado_em         timestamptz,
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now(),
  constraint lanc_cancelamento_consistente check (
    (status = 'ativo' and cancelado_em is null) or
    (status = 'cancelado' and cancelado_em is not null and coalesce(length(trim(motivo_cancelamento)),0) > 0)
  )
);
create index if not exists lancamentos_data_idx on public.lancamentos (data desc);

-- Categoria tem que combinar com o tipo (saída → despesa, entrada → receita)
create or replace function public.fn_validar_lancamento()
returns trigger language plpgsql set search_path = public as $$
declare v_tipo text;
begin
  if tg_op = 'UPDATE' and old.status = 'cancelado' then
    raise exception 'Lançamento nº % já está cancelado e não pode ser alterado.', old.numero;
  end if;
  select tipo into v_tipo from public.categorias where id = new.categoria_id;
  if (new.tipo = 'saida' and v_tipo <> 'despesa') or (new.tipo = 'entrada' and v_tipo <> 'receita') then
    raise exception 'Categoria não combina com o tipo do lançamento.';
  end if;
  return new;
end $$;

drop trigger if exists trg_lancamentos_validar on public.lancamentos;
create trigger trg_lancamentos_validar before insert or update on public.lancamentos
  for each row execute function public.fn_validar_lancamento();
drop trigger if exists trg_lancamentos_atualizado on public.lancamentos;
create trigger trg_lancamentos_atualizado before update on public.lancamentos
  for each row execute function public.fn_atualizado_em();
drop trigger if exists trg_lancamentos_auditoria on public.lancamentos;
create trigger trg_lancamentos_auditoria after insert or update on public.lancamentos
  for each row execute function public.fn_auditar();
drop trigger if exists trg_categorias_atualizado on public.categorias;
create trigger trg_categorias_atualizado before update on public.categorias
  for each row execute function public.fn_atualizado_em();
drop trigger if exists trg_categorias_auditoria on public.categorias;
create trigger trg_categorias_auditoria after insert or update on public.categorias
  for each row execute function public.fn_auditar();

-- ---------------------------------------------------------------------
-- 4) CAIXA = vendas + lançamentos, numa visão só
-- ---------------------------------------------------------------------
create or replace view public.caixa_movimentos
with (security_invoker = true) as
select 'venda'::text            as origem,
       c.id, c.numero, c.data,
       'entrada'::text          as tipo,
       c.categoria_id,
       cat.nome                 as categoria,
       c.descricao, c.valor_centavos, c.forma_pagamento, c.parcelas,
       c.cliente_id, cl.nome    as cliente_nome,
       (c.status = 'ativa')     as ativo,
       c.motivo_cancelamento,
       c.criado_em
from public.compras c
left join public.categorias cat on cat.id = c.categoria_id
left join public.clientes  cl  on cl.id  = c.cliente_id
union all
select 'lancamento'::text, l.id, l.numero, l.data, l.tipo, l.categoria_id, cat.nome,
       l.descricao, l.valor_centavos, l.forma_pagamento, 1::smallint,
       null::uuid, null::text, (l.status = 'ativo'), l.motivo_cancelamento, l.criado_em
from public.lancamentos l
join public.categorias cat on cat.id = l.categoria_id;

-- ---------------------------------------------------------------------
-- 5) SEGURANÇA
-- ---------------------------------------------------------------------
alter table public.categorias  enable row level security;
alter table public.lancamentos enable row level security;

drop policy if exists categorias_ler    on public.categorias;
drop policy if exists categorias_criar  on public.categorias;
drop policy if exists categorias_editar on public.categorias;
create policy categorias_ler    on public.categorias for select to authenticated using (true);
create policy categorias_criar  on public.categorias for insert to authenticated with check (true);
create policy categorias_editar on public.categorias for update to authenticated using (true) with check (true);

drop policy if exists lancamentos_ler    on public.lancamentos;
drop policy if exists lancamentos_criar  on public.lancamentos;
drop policy if exists lancamentos_editar on public.lancamentos;
create policy lancamentos_ler    on public.lancamentos for select to authenticated using (true);
create policy lancamentos_criar  on public.lancamentos for insert to authenticated with check (true);
create policy lancamentos_editar on public.lancamentos for update to authenticated using (true) with check (true);

revoke all on public.categorias, public.lancamentos, public.caixa_movimentos from anon;
revoke delete, truncate on public.categorias, public.lancamentos from authenticated;
grant select, insert, update on public.categorias, public.lancamentos to authenticated;
grant select on public.caixa_movimentos to authenticated;
revoke execute on function public.fn_validar_lancamento() from anon, authenticated, public;
