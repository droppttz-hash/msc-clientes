-- =====================================================================
-- MSC — Onda 1 / parte 2: FINANÇAS
-- Contas (caixa, banco, maquininha), formas de pagamento com taxa e prazo,
-- títulos a pagar/receber, baixas, extrato (ledger), transferências,
-- sangria/suprimento, abertura/fechamento de caixa, despesas fixas.
-- Regras:
--  * dinheiro em centavos (bigint)
--  * saldo de conta = saldo inicial + soma do extrato (movimentos imutáveis)
--  * nada é apagado: título é cancelado, baixa é estornada (movimento inverso)
--  * escrita SÓ por funções (RPC) que conferem permissão
-- =====================================================================

-- Categorias de sistema (não somem se o gerente renomear)
alter table public.categorias add column if not exists sistema text unique;
insert into public.categorias (tipo, nome, ordem, sistema) values
  ('receita', 'Vendas', 0, 'vendas'),
  ('receita', 'Serviços (OS)', 0, 'servicos'),
  ('despesa', 'Devolução a cliente', 50, 'devolucao'),
  ('despesa', 'Quebra de caixa', 51, 'quebra_caixa')
on conflict do nothing;
update public.categorias set sistema = 'taxa_cartao'      where tipo = 'despesa' and nome = 'Taxa de maquininha' and sistema is null;
update public.categorias set sistema = 'compra_mercadoria' where tipo = 'despesa' and nome = 'Compra de mercadoria / fornecedor' and sistema is null;
insert into public.categorias (tipo, nome, ordem, sistema) values
  ('despesa', 'Taxa de maquininha', 7, 'taxa_cartao'),
  ('despesa', 'Compra de mercadoria / fornecedor', 1, 'compra_mercadoria')
on conflict do nothing;
update public.categorias set sistema = 'taxa_cartao'
  where id = (select id from public.categorias where tipo='despesa' and lower(nome) = lower('Taxa de maquininha') limit 1) and sistema is null;
update public.categorias set sistema = 'compra_mercadoria'
  where id = (select id from public.categorias where tipo='despesa' and lower(nome) = lower('Compra de mercadoria / fornecedor') limit 1) and sistema is null;

create or replace function privado.cat(p_sistema text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.categorias where sistema = p_sistema
$$;

-- ---------------------------------------------------------------------
-- CONTAS FINANCEIRAS
-- ---------------------------------------------------------------------
create table if not exists public.contas_financeiras (
  id                      uuid primary key default gen_random_uuid(),
  nome                    text not null check (length(trim(nome)) >= 2),
  tipo                    text not null check (tipo in ('caixa','banco','maquininha','carteira','outro')),
  saldo_inicial_centavos  bigint not null default 0,
  saldo_inicial_data      date not null default (now() at time zone 'America/Sao_Paulo')::date,
  ativo                   boolean not null default true,
  ordem                   int not null default 100,
  sistema                 text unique,
  criado_em               timestamptz not null default now(),
  atualizado_em           timestamptz not null default now()
);
create unique index if not exists contas_nome_uk on public.contas_financeiras (lower(nome));
insert into public.contas_financeiras (nome, tipo, ordem, sistema) values
  ('Caixa da loja (gaveta)', 'caixa', 1, 'caixa'),
  ('Banco / PIX', 'banco', 2, 'banco'),
  ('Maquininha de cartão', 'maquininha', 3, 'maquininha')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- FORMAS DE PAGAMENTO (taxa e prazo de repasse por forma)
-- ---------------------------------------------------------------------
create table if not exists public.formas_pagamento (
  forma             text primary key check (forma in ('dinheiro','pix','debito','credito','boleto','crediario','outro')),
  nome              text not null,
  ativo             boolean not null default true,
  conta_id          uuid references public.contas_financeiras(id),
  taxa_pct          numeric(6,3) not null default 0 check (taxa_pct between 0 and 100),
  dias_repasse      int not null default 0 check (dias_repasse between 0 and 365),
  baixa_automatica  boolean not null default true,     -- dá baixa sozinho na data prevista
  antecipar         boolean not null default false,    -- crédito: recebe tudo de uma vez (antecipação)
  ordem             int not null default 100
);
insert into public.formas_pagamento (forma, nome, conta_id, dias_repasse, baixa_automatica, ordem)
select f.forma, f.nome, (select id from public.contas_financeiras where sistema = f.conta), f.dias, f.auto, f.ordem
from (values
  ('dinheiro', 'Dinheiro',          'caixa',      0,  true,  1),
  ('pix',      'PIX',               'banco',      0,  true,  2),
  ('debito',   'Cartão de débito',  'maquininha', 1,  true,  3),
  ('credito',  'Cartão de crédito', 'maquininha', 30, true,  4),
  ('boleto',   'Boleto',            'banco',      0,  false, 5),
  ('crediario','Crediário / fiado', null,         30, false, 6),
  ('outro',    'Outro',             'caixa',      0,  true,  7)
) f(forma, nome, conta, dias, auto, ordem)
on conflict (forma) do nothing;

-- Taxa do crédito por número de parcelas (se não tiver a linha, usa a taxa da forma)
create table if not exists public.credito_taxas (
  parcelas  smallint primary key check (parcelas between 1 and 24),
  taxa_pct  numeric(6,3) not null default 0 check (taxa_pct between 0 and 100)
);
insert into public.credito_taxas (parcelas, taxa_pct)
select g, 0 from generate_series(1, 12) g on conflict do nothing;

create or replace function privado.taxa_forma(p_forma text, p_parcelas int)
returns numeric language sql stable security definer set search_path = public as $$
  select case when p_forma = 'credito'
              then coalesce((select taxa_pct from public.credito_taxas where parcelas = greatest(p_parcelas,1)),
                            (select taxa_pct from public.formas_pagamento where forma = 'credito'), 0)
              else coalesce((select taxa_pct from public.formas_pagamento where forma = p_forma), 0) end
$$;

-- ---------------------------------------------------------------------
-- TÍTULOS (contas a pagar e a receber)
-- ---------------------------------------------------------------------
create table if not exists public.titulos (
  id                      uuid primary key default gen_random_uuid(),
  numero                  bigint generated always as identity unique,
  tipo                    text not null check (tipo in ('receber','pagar')),
  descricao               text not null check (length(trim(descricao)) >= 2),
  categoria_id            uuid references public.categorias(id),
  cliente_id              uuid references public.clientes(id),
  fornecedor_id           uuid references public.fornecedores(id),
  venda_id                uuid,
  entrada_id              uuid,
  os_id                   uuid,
  recorrencia_id          uuid,
  devolucao_id            uuid,
  forma_pagamento         text references public.formas_pagamento(forma),
  conta_prevista_id       uuid references public.contas_financeiras(id),
  competencia             date not null,
  vencimento              date not null,
  parcela                 smallint not null default 1 check (parcela >= 1),
  parcelas                smallint not null default 1 check (parcelas >= 1),
  valor_centavos          bigint not null check (valor_centavos > 0),
  taxa_prevista_centavos  bigint not null default 0 check (taxa_prevista_centavos >= 0),
  pago_centavos           bigint not null default 0 check (pago_centavos >= 0),
  status                  text not null default 'aberto' check (status in ('aberto','parcial','pago','cancelado')),
  baixa_automatica        boolean not null default false,
  observacao              text,
  motivo_cancelamento     text,
  cancelado_em            timestamptz,
  criado_por              uuid default auth.uid() references public.perfis(user_id),
  criado_em               timestamptz not null default now(),
  atualizado_em           timestamptz not null default now(),
  constraint titulo_parcela_ok check (parcela <= parcelas),
  constraint titulo_cancelamento_ok check (status <> 'cancelado' or (cancelado_em is not null and coalesce(length(trim(motivo_cancelamento)),0) > 0))
);
create index if not exists titulos_aberto_idx on public.titulos (tipo, status, vencimento);
create index if not exists titulos_venda_idx on public.titulos (venda_id);
create index if not exists titulos_entrada_idx on public.titulos (entrada_id);
create index if not exists titulos_competencia_idx on public.titulos (competencia);
create unique index if not exists titulos_recorrencia_uk on public.titulos (recorrencia_id, competencia) where recorrencia_id is not null;

-- ---------------------------------------------------------------------
-- EXTRATO (ledger imutável) + BAIXAS + TRANSFERÊNCIAS + CAIXA
-- ---------------------------------------------------------------------
create table if not exists public.baixas (
  id                uuid primary key default gen_random_uuid(),
  titulo_id         uuid not null references public.titulos(id),
  data              date not null,
  conta_id          uuid not null references public.contas_financeiras(id),
  valor_centavos    bigint not null check (valor_centavos >= 0),   -- principal abatido
  juros_centavos    bigint not null default 0 check (juros_centavos >= 0),
  multa_centavos    bigint not null default 0 check (multa_centavos >= 0),
  desconto_centavos bigint not null default 0 check (desconto_centavos >= 0),
  taxa_centavos     bigint not null default 0 check (taxa_centavos >= 0),
  automatica        boolean not null default false,
  estornada         boolean not null default false,
  estornada_em      timestamptz,
  motivo_estorno    text,
  criado_por        uuid default auth.uid() references public.perfis(user_id),
  criado_em         timestamptz not null default now(),
  constraint baixa_valor_ok check (valor_centavos + desconto_centavos > 0)
);
create index if not exists baixas_titulo_idx on public.baixas (titulo_id);

create table if not exists public.transferencias (
  id                uuid primary key default gen_random_uuid(),
  tipo              text not null default 'transferencia' check (tipo in ('transferencia','sangria','suprimento')),
  data              date not null,
  conta_origem_id   uuid not null references public.contas_financeiras(id),
  conta_destino_id  uuid not null references public.contas_financeiras(id),
  valor_centavos    bigint not null check (valor_centavos > 0),
  descricao         text,
  criado_por        uuid default auth.uid() references public.perfis(user_id),
  criado_em         timestamptz not null default now(),
  check (conta_origem_id <> conta_destino_id)
);

create table if not exists public.sessoes_caixa (
  id                         uuid primary key default gen_random_uuid(),
  conta_id                   uuid not null references public.contas_financeiras(id),
  aberta_em                  timestamptz not null default now(),
  aberta_por                 uuid default auth.uid() references public.perfis(user_id),
  valor_abertura_centavos    bigint not null check (valor_abertura_centavos >= 0),
  saldo_sistema_abertura     bigint not null,
  fechada_em                 timestamptz,
  fechada_por                uuid references public.perfis(user_id),
  valor_contado_centavos     bigint check (valor_contado_centavos >= 0),
  saldo_sistema_fechamento   bigint,
  diferenca_centavos         bigint,
  observacao                 text
);
create unique index if not exists sessoes_caixa_aberta_uk on public.sessoes_caixa (conta_id) where fechada_em is null;

create table if not exists public.movimentos_financeiros (
  id                bigint generated always as identity primary key,
  conta_id          uuid not null references public.contas_financeiras(id),
  data              date not null,
  tipo              text not null check (tipo in ('entrada','saida')),
  valor_centavos    bigint not null check (valor_centavos > 0),
  descricao         text not null,
  categoria_id      uuid references public.categorias(id),
  origem            text not null check (origem in ('baixa','taxa','estorno_baixa','estorno_taxa','transferencia','ajuste','quebra_caixa')),
  baixa_id          uuid references public.baixas(id),
  transferencia_id  uuid references public.transferencias(id),
  sessao_caixa_id   uuid references public.sessoes_caixa(id),
  criado_por        uuid default auth.uid() references public.perfis(user_id),
  criado_em         timestamptz not null default now()
);
create index if not exists movfin_conta_data_idx on public.movimentos_financeiros (conta_id, data);
create index if not exists movfin_data_idx on public.movimentos_financeiros (data);

create table if not exists public.recorrencias (
  id               uuid primary key default gen_random_uuid(),
  tipo             text not null default 'pagar' check (tipo in ('pagar','receber')),
  descricao        text not null check (length(trim(descricao)) >= 2),
  categoria_id     uuid not null references public.categorias(id),
  fornecedor_id    uuid references public.fornecedores(id),
  valor_centavos   bigint not null check (valor_centavos > 0),
  frequencia       text not null default 'mensal' check (frequencia in ('semanal','mensal','anual')),
  dia_vencimento   smallint not null default 10 check (dia_vencimento between 1 and 31),
  inicio           date not null,
  fim              date,
  forma_pagamento  text references public.formas_pagamento(forma),
  ativo            boolean not null default true,
  criado_por       uuid default auth.uid() references public.perfis(user_id),
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
alter table public.titulos drop constraint if exists titulos_recorrencia_fk;
alter table public.titulos add constraint titulos_recorrencia_fk foreign key (recorrencia_id) references public.recorrencias(id);

alter table public.contas_financeiras    enable row level security;
alter table public.formas_pagamento      enable row level security;
alter table public.credito_taxas         enable row level security;
alter table public.titulos               enable row level security;
alter table public.baixas                enable row level security;
alter table public.transferencias        enable row level security;
alter table public.sessoes_caixa         enable row level security;
alter table public.movimentos_financeiros enable row level security;
alter table public.recorrencias          enable row level security;

-- ---------------------------------------------------------------------
-- Funções de saldo
-- ---------------------------------------------------------------------
create or replace function privado.saldo_conta(p_conta uuid, p_ate date default null)
returns bigint language sql stable security definer set search_path = public as $$
  select c.saldo_inicial_centavos + coalesce((
    select sum(case when m.tipo = 'entrada' then m.valor_centavos else -m.valor_centavos end)
    from public.movimentos_financeiros m
    where m.conta_id = c.id and (p_ate is null or m.data <= p_ate)), 0)
  from public.contas_financeiras c where c.id = p_conta
$$;

create or replace view public.saldos_contas with (security_invoker = true) as
select c.id, c.nome, c.tipo, c.ativo, c.ordem, c.saldo_inicial_centavos, c.saldo_inicial_data,
       c.saldo_inicial_centavos + coalesce(sum(case when m.tipo = 'entrada' then m.valor_centavos else -m.valor_centavos end), 0)::bigint as saldo_centavos,
       (select s.id from public.sessoes_caixa s where s.conta_id = c.id and s.fechada_em is null) as sessao_aberta_id
from public.contas_financeiras c
left join public.movimentos_financeiros m on m.conta_id = c.id
group by c.id;

-- ---------------------------------------------------------------------
-- Gatilhos: baixa gera extrato e atualiza o título
-- ---------------------------------------------------------------------
create or replace function privado.recalcular_titulo(p_titulo uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_pago bigint; v_valor bigint; v_status text;
begin
  select valor_centavos, status into v_valor, v_status from public.titulos where id = p_titulo for update;
  select coalesce(sum(valor_centavos + desconto_centavos), 0) into v_pago
    from public.baixas where titulo_id = p_titulo and not estornada;
  update public.titulos set
    pago_centavos = v_pago,
    status = case when v_status = 'cancelado' then 'cancelado'
                  when v_pago >= v_valor then 'pago'
                  when v_pago > 0 then 'parcial'
                  else 'aberto' end
  where id = p_titulo;
end $$;

create or replace function public.fn_baixa_movimentos()
returns trigger language plpgsql security definer set search_path = public as $$
declare t record; v_bruto bigint; v_desc text;
begin
  select * into t from public.titulos where id = new.titulo_id;
  v_desc := case when t.tipo = 'receber' then 'Recebimento: ' else 'Pagamento: ' end || t.descricao
            || case when t.parcelas > 1 then ' (' || t.parcela || '/' || t.parcelas || ')' else '' end;
  v_bruto := new.valor_centavos + new.juros_centavos + new.multa_centavos;

  if tg_op = 'INSERT' then
    if v_bruto > 0 then
      insert into public.movimentos_financeiros (conta_id, data, tipo, valor_centavos, descricao, categoria_id, origem, baixa_id, criado_por)
      values (new.conta_id, new.data, case when t.tipo = 'receber' then 'entrada' else 'saida' end, v_bruto, v_desc,
              coalesce(t.categoria_id, case when t.venda_id is not null then privado.cat('vendas') end), 'baixa', new.id, new.criado_por);
    end if;
    if new.taxa_centavos > 0 then
      insert into public.movimentos_financeiros (conta_id, data, tipo, valor_centavos, descricao, categoria_id, origem, baixa_id, criado_por)
      values (new.conta_id, new.data, 'saida', new.taxa_centavos, 'Taxa: ' || t.descricao, privado.cat('taxa_cartao'), 'taxa', new.id, new.criado_por);
    end if;
  elsif tg_op = 'UPDATE' then
    if old.estornada or not new.estornada then
      raise exception 'Baixa não pode ser alterada. Use o estorno.';
    end if;
    if v_bruto > 0 then
      insert into public.movimentos_financeiros (conta_id, data, tipo, valor_centavos, descricao, categoria_id, origem, baixa_id, criado_por)
      values (new.conta_id, (now() at time zone 'America/Sao_Paulo')::date, case when t.tipo = 'receber' then 'saida' else 'entrada' end, v_bruto,
              'Estorno: ' || v_desc, coalesce(t.categoria_id, case when t.venda_id is not null then privado.cat('vendas') end), 'estorno_baixa', new.id, auth.uid());
    end if;
    if new.taxa_centavos > 0 then
      insert into public.movimentos_financeiros (conta_id, data, tipo, valor_centavos, descricao, categoria_id, origem, baixa_id, criado_por)
      values (new.conta_id, (now() at time zone 'America/Sao_Paulo')::date, 'entrada', new.taxa_centavos, 'Estorno taxa: ' || t.descricao,
              privado.cat('taxa_cartao'), 'estorno_taxa', new.id, auth.uid());
    end if;
  end if;
  perform privado.recalcular_titulo(new.titulo_id);
  return new;
end $$;
drop trigger if exists trg_baixas_movimentos on public.baixas;
create trigger trg_baixas_movimentos after insert or update on public.baixas
  for each row execute function public.fn_baixa_movimentos();

create or replace function public.fn_transferencia_movimentos()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_txt text;
begin
  v_txt := case new.tipo when 'sangria' then 'Sangria' when 'suprimento' then 'Suprimento' else 'Transferência' end
           || coalesce(': ' || nullif(trim(new.descricao), ''), '');
  insert into public.movimentos_financeiros (conta_id, data, tipo, valor_centavos, descricao, origem, transferencia_id, criado_por)
  values (new.conta_origem_id, new.data, 'saida', new.valor_centavos, v_txt, 'transferencia', new.id, new.criado_por),
         (new.conta_destino_id, new.data, 'entrada', new.valor_centavos, v_txt, 'transferencia', new.id, new.criado_por);
  return new;
end $$;
drop trigger if exists trg_transferencias_movimentos on public.transferencias;
create trigger trg_transferencias_movimentos after insert on public.transferencias
  for each row execute function public.fn_transferencia_movimentos();

-- Movimentos, baixas e transferências não se apagam
create or replace function public.fn_bloquear_alteracao()
returns trigger language plpgsql as $$
begin
  raise exception 'Registros de % não podem ser alterados ou apagados.', tg_table_name;
end $$;
drop trigger if exists trg_movfin_imutavel on public.movimentos_financeiros;
create trigger trg_movfin_imutavel before update or delete on public.movimentos_financeiros
  for each row execute function public.fn_bloquear_alteracao();
drop trigger if exists trg_transf_imutavel on public.transferencias;
create trigger trg_transf_imutavel before update or delete on public.transferencias
  for each row execute function public.fn_bloquear_alteracao();
drop trigger if exists trg_baixas_sem_delete on public.baixas;
create trigger trg_baixas_sem_delete before delete on public.baixas
  for each row execute function public.fn_bloquear_alteracao();

drop trigger if exists trg_titulos_atualizado on public.titulos;
create trigger trg_titulos_atualizado before update on public.titulos
  for each row execute function public.fn_atualizado_em();
drop trigger if exists trg_titulos_auditoria on public.titulos;
create trigger trg_titulos_auditoria after insert or update on public.titulos
  for each row execute function public.fn_auditar();
drop trigger if exists trg_baixas_auditoria on public.baixas;
create trigger trg_baixas_auditoria after insert or update on public.baixas
  for each row execute function public.fn_auditar();
drop trigger if exists trg_contas_auditoria on public.contas_financeiras;
create trigger trg_contas_auditoria after insert or update on public.contas_financeiras
  for each row execute function public.fn_auditar();
drop trigger if exists trg_contas_atualizado on public.contas_financeiras;
create trigger trg_contas_atualizado before update on public.contas_financeiras
  for each row execute function public.fn_atualizado_em();
drop trigger if exists trg_formas_auditoria on public.formas_pagamento;
create trigger trg_formas_auditoria after update on public.formas_pagamento
  for each row execute function public.fn_auditar_generico();
drop trigger if exists trg_recorrencias_atualizado on public.recorrencias;
create trigger trg_recorrencias_atualizado before update on public.recorrencias
  for each row execute function public.fn_atualizado_em();
drop trigger if exists trg_recorrencias_auditoria on public.recorrencias;
create trigger trg_recorrencias_auditoria after insert or update on public.recorrencias
  for each row execute function public.fn_auditar();

-- ---------------------------------------------------------------------
-- Funções internas reutilizadas por vendas/entradas
-- ---------------------------------------------------------------------
-- Baixa interna (sem checar permissão — quem chama já conferiu)
create or replace function privado.baixar(p_titulo uuid, p_data date, p_conta uuid, p_valor bigint,
                                          p_juros bigint default 0, p_multa bigint default 0,
                                          p_desconto bigint default 0, p_taxa bigint default 0,
                                          p_automatica boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare t record; v_id uuid;
begin
  select * into t from public.titulos where id = p_titulo for update;
  if not found then raise exception 'Conta não encontrada.'; end if;
  if t.status in ('cancelado','pago') then raise exception 'Esta conta já está %.', case when t.status = 'pago' then 'paga' else 'cancelada' end; end if;
  if p_conta is null then raise exception 'Escolha a conta (caixa, banco…) da baixa.'; end if;
  if coalesce(p_valor,0) < 0 or coalesce(p_juros,0) < 0 or coalesce(p_multa,0) < 0 or coalesce(p_desconto,0) < 0 or coalesce(p_taxa,0) < 0 then
    raise exception 'Valores não podem ser negativos.';
  end if;
  if coalesce(p_valor,0) + coalesce(p_desconto,0) <= 0 then raise exception 'Informe o valor da baixa.'; end if;
  if coalesce(p_valor,0) + coalesce(p_desconto,0) > t.valor_centavos - t.pago_centavos then
    raise exception 'O valor é maior do que o que falta (R$ %).', to_char((t.valor_centavos - t.pago_centavos) / 100.0, 'FM999G999G990D00');
  end if;
  insert into public.baixas (titulo_id, data, conta_id, valor_centavos, juros_centavos, multa_centavos, desconto_centavos, taxa_centavos, automatica)
  values (p_titulo, p_data, p_conta, coalesce(p_valor,0), coalesce(p_juros,0), coalesce(p_multa,0), coalesce(p_desconto,0), coalesce(p_taxa,0), p_automatica)
  returning id into v_id;
  return v_id;
end $$;

create or replace function privado.estornar_baixa(p_baixa uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.baixas set estornada = true, estornada_em = now(), motivo_estorno = p_motivo
  where id = p_baixa and not estornada;
end $$;

-- Cancela título (estornando as baixas se houver)
create or replace function privado.cancelar_titulo(p_titulo uuid, p_motivo text, p_estornar boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare b record;
begin
  if p_estornar then
    for b in select id from public.baixas where titulo_id = p_titulo and not estornada loop
      perform privado.estornar_baixa(b.id, p_motivo);
    end loop;
  elsif exists (select 1 from public.baixas where titulo_id = p_titulo and not estornada) then
    raise exception 'Esta conta já tem pagamento registrado. Estorne o pagamento antes de cancelar.';
  end if;
  update public.titulos set status = 'cancelado', cancelado_em = now(), motivo_cancelamento = p_motivo
  where id = p_titulo and status <> 'cancelado';
end $$;

-- ---------------------------------------------------------------------
-- RPCs do módulo financeiro (o site chama estas funções)
-- ---------------------------------------------------------------------
-- Criar conta a pagar/receber (com parcelamento opcional)
-- p: {tipo, descricao, categoria_id, cliente_id, fornecedor_id, forma_pagamento, conta_prevista_id,
--     competencia, observacao, parcelas:[{vencimento, valor_centavos}], pago:{conta_id, data} (opcional: já pago)}
create or replace function public.salvar_titulo(p jsonb)
returns setof uuid language plpgsql security definer set search_path = public as $$
declare v_parc jsonb; v_n int; v_i int := 0; v_id uuid; v_tipo text := p->>'tipo'; v_cat uuid := nullif(p->>'categoria_id','')::uuid; v_ct text;
begin
  if not privado.pode('financeiro.lancar') then raise exception 'Sem permissão para lançar contas.'; end if;
  if v_tipo not in ('pagar','receber') then raise exception 'Tipo inválido.'; end if;
  if v_cat is null then raise exception 'Escolha a categoria.'; end if;
  select tipo into v_ct from public.categorias where id = v_cat;
  if (v_tipo = 'pagar' and v_ct <> 'despesa') or (v_tipo = 'receber' and v_ct <> 'receita') then
    raise exception 'A categoria não combina com o tipo da conta.';
  end if;
  v_n := jsonb_array_length(coalesce(p->'parcelas', '[]'::jsonb));
  if v_n < 1 then raise exception 'Informe ao menos um vencimento.'; end if;
  for v_parc in select * from jsonb_array_elements(p->'parcelas') loop
    v_i := v_i + 1;
    insert into public.titulos (tipo, descricao, categoria_id, cliente_id, fornecedor_id, forma_pagamento, conta_prevista_id,
                                competencia, vencimento, parcela, parcelas, valor_centavos, observacao)
    values (v_tipo, trim(p->>'descricao'), v_cat, nullif(p->>'cliente_id','')::uuid, nullif(p->>'fornecedor_id','')::uuid,
            nullif(p->>'forma_pagamento',''), nullif(p->>'conta_prevista_id','')::uuid,
            coalesce(nullif(p->>'competencia','')::date, (v_parc->>'vencimento')::date),
            (v_parc->>'vencimento')::date, v_i, v_n, (v_parc->>'valor_centavos')::bigint, nullif(trim(p->>'observacao'),''))
    returning id into v_id;
    if p ? 'pago' and p->'pago' is not null and jsonb_typeof(p->'pago') = 'object' then
      if not privado.pode('financeiro.baixar') then raise exception 'Sem permissão para dar baixa.'; end if;
      perform privado.baixar(v_id, coalesce(nullif(p->'pago'->>'data','')::date, (v_parc->>'vencimento')::date),
                             (p->'pago'->>'conta_id')::uuid, (v_parc->>'valor_centavos')::bigint);
    end if;
    return next v_id;
  end loop;
end $$;

-- Editar título em aberto (sem pagamento)
create or replace function public.editar_titulo(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare t record;
begin
  if not privado.pode('financeiro.lancar') then raise exception 'Sem permissão.'; end if;
  select * into t from public.titulos where id = p_id for update;
  if t.status <> 'aberto' or t.pago_centavos > 0 then raise exception 'Só dá para editar contas em aberto, sem pagamento.'; end if;
  if t.venda_id is not null or t.entrada_id is not null or t.os_id is not null then
    raise exception 'Esta conta foi gerada por uma venda/entrada/OS. Altere pelo documento de origem.';
  end if;
  update public.titulos set
    descricao = coalesce(nullif(trim(p->>'descricao'),''), descricao),
    categoria_id = coalesce(nullif(p->>'categoria_id','')::uuid, categoria_id),
    vencimento = coalesce(nullif(p->>'vencimento','')::date, vencimento),
    competencia = coalesce(nullif(p->>'competencia','')::date, competencia),
    valor_centavos = coalesce(nullif(p->>'valor_centavos','')::bigint, valor_centavos),
    forma_pagamento = coalesce(nullif(p->>'forma_pagamento',''), forma_pagamento),
    fornecedor_id = case when p ? 'fornecedor_id' then nullif(p->>'fornecedor_id','')::uuid else fornecedor_id end,
    cliente_id = case when p ? 'cliente_id' then nullif(p->>'cliente_id','')::uuid else cliente_id end,
    observacao = case when p ? 'observacao' then nullif(trim(p->>'observacao'),'') else observacao end
  where id = p_id;
end $$;

create or replace function public.baixar_titulo(p_titulo uuid, p_data date, p_conta uuid, p_valor bigint,
                                                p_juros bigint default 0, p_multa bigint default 0,
                                                p_desconto bigint default 0, p_taxa bigint default 0)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not privado.pode('financeiro.baixar') then raise exception 'Sem permissão para dar baixa.'; end if;
  if p_data > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'A data do pagamento não pode ser no futuro.'; end if;
  return privado.baixar(p_titulo, p_data, p_conta, p_valor, p_juros, p_multa, p_desconto, p_taxa);
end $$;

create or replace function public.estornar_baixa(p_baixa uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare t record;
begin
  if not privado.pode('financeiro.baixar') then raise exception 'Sem permissão para estornar.'; end if;
  if coalesce(length(trim(p_motivo)),0) < 3 then raise exception 'Informe o motivo do estorno.'; end if;
  select ti.* into t from public.titulos ti join public.baixas b on b.titulo_id = ti.id where b.id = p_baixa;
  if t.status = 'cancelado' then raise exception 'Conta cancelada.'; end if;
  perform privado.estornar_baixa(p_baixa, trim(p_motivo));
end $$;

create or replace function public.cancelar_titulo(p_titulo uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare t record;
begin
  if not privado.pode('financeiro.lancar') then raise exception 'Sem permissão.'; end if;
  if coalesce(length(trim(p_motivo)),0) < 3 then raise exception 'Informe o motivo do cancelamento.'; end if;
  select * into t from public.titulos where id = p_titulo;
  if t.venda_id is not null or t.entrada_id is not null or t.os_id is not null then
    raise exception 'Esta conta foi gerada por uma venda/entrada/OS. Cancele o documento de origem.';
  end if;
  perform privado.cancelar_titulo(p_titulo, trim(p_motivo), false);
end $$;

create or replace function public.transferir(p_tipo text, p_data date, p_origem uuid, p_destino uuid, p_valor bigint, p_descricao text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_tipo in ('sangria','suprimento') then
    if not privado.pode('financeiro.caixa') then raise exception 'Sem permissão para sangria/suprimento.'; end if;
  elsif not privado.pode('financeiro.baixar') then raise exception 'Sem permissão para transferir.'; end if;
  if p_data > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'Data no futuro.'; end if;
  insert into public.transferencias (tipo, data, conta_origem_id, conta_destino_id, valor_centavos, descricao)
  values (p_tipo, p_data, p_origem, p_destino, p_valor, nullif(trim(p_descricao),'')) returning id into v_id;
  return v_id;
end $$;

-- Abrir caixa: confere o dinheiro da gaveta; diferença vira ajuste
create or replace function public.abrir_caixa(p_conta uuid, p_valor bigint, p_obs text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_saldo bigint; v_id uuid; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not privado.pode('financeiro.caixa') then raise exception 'Sem permissão para abrir o caixa.'; end if;
  if (select tipo from public.contas_financeiras where id = p_conta) <> 'caixa' then raise exception 'Escolha uma conta do tipo caixa.'; end if;
  if exists (select 1 from public.sessoes_caixa where conta_id = p_conta and fechada_em is null) then raise exception 'O caixa já está aberto.'; end if;
  v_saldo := privado.saldo_conta(p_conta);
  insert into public.sessoes_caixa (conta_id, valor_abertura_centavos, saldo_sistema_abertura, observacao)
  values (p_conta, p_valor, v_saldo, nullif(trim(p_obs),'')) returning id into v_id;
  if p_valor <> v_saldo then
    insert into public.movimentos_financeiros (conta_id, data, tipo, valor_centavos, descricao, categoria_id, origem, sessao_caixa_id)
    values (p_conta, v_hoje, case when p_valor > v_saldo then 'entrada' else 'saida' end, abs(p_valor - v_saldo),
            'Diferença na abertura do caixa', privado.cat('quebra_caixa'), 'quebra_caixa', v_id);
  end if;
  return v_id;
end $$;

create or replace function public.fechar_caixa(p_conta uuid, p_contado bigint, p_obs text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record; v_saldo bigint; v_dif bigint; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not privado.pode('financeiro.caixa') then raise exception 'Sem permissão para fechar o caixa.'; end if;
  select * into s from public.sessoes_caixa where conta_id = p_conta and fechada_em is null for update;
  if not found then raise exception 'O caixa não está aberto.'; end if;
  if p_contado is null or p_contado < 0 then raise exception 'Informe o valor contado na gaveta.'; end if;
  v_saldo := privado.saldo_conta(p_conta);
  v_dif := p_contado - v_saldo;
  if v_dif <> 0 then
    insert into public.movimentos_financeiros (conta_id, data, tipo, valor_centavos, descricao, categoria_id, origem, sessao_caixa_id)
    values (p_conta, v_hoje, case when v_dif > 0 then 'entrada' else 'saida' end, abs(v_dif),
            case when v_dif > 0 then 'Sobra de caixa' else 'Quebra de caixa' end, privado.cat('quebra_caixa'), 'quebra_caixa', s.id);
  end if;
  update public.sessoes_caixa set fechada_em = now(), fechada_por = auth.uid(), valor_contado_centavos = p_contado,
         saldo_sistema_fechamento = v_saldo, diferenca_centavos = v_dif,
         observacao = concat_ws(' | ', observacao, nullif(trim(p_obs),''))
  where id = s.id;
  return jsonb_build_object('esperado', v_saldo, 'contado', p_contado, 'diferenca', v_dif);
end $$;

-- Despesas fixas: gera as contas até 60 dias à frente (pode chamar várias vezes)
create or replace function public.gerar_recorrencias()
returns int language plpgsql security definer set search_path = public as $$
declare r record; v_data date; v_lim date := (now() at time zone 'America/Sao_Paulo')::date + 60; v_n int := 0; v_venc date; v_ins int;
begin
  if not privado.tem_acesso() then return 0; end if;
  for r in select * from public.recorrencias where ativo loop
    v_data := r.inicio;
    while v_data <= v_lim and (r.fim is null or v_data <= r.fim) loop
      v_venc := case when r.frequencia = 'semanal' then v_data
                     else make_date(extract(year from v_data)::int, extract(month from v_data)::int,
                                    least(r.dia_vencimento, extract(day from (date_trunc('month', v_data) + interval '1 month - 1 day'))::int)) end;
      if v_venc >= r.inicio then
        insert into public.titulos (tipo, descricao, categoria_id, fornecedor_id, forma_pagamento, competencia, vencimento, valor_centavos, recorrencia_id, criado_por)
        values (r.tipo, r.descricao, r.categoria_id, r.fornecedor_id, r.forma_pagamento,
                case when r.frequencia = 'semanal' then v_data else date_trunc('month', v_data)::date end,
                v_venc, r.valor_centavos, r.id, r.criado_por)
        on conflict (recorrencia_id, competencia) where recorrencia_id is not null do nothing;
        get diagnostics v_ins = row_count; v_n := v_n + v_ins;
      end if;
      v_data := case r.frequencia when 'semanal' then v_data + 7
                                  when 'anual' then (v_data + interval '1 year')::date
                                  else (date_trunc('month', v_data) + interval '1 month')::date end;
    end loop;
  end loop;
  return v_n;
end $$;

create or replace function public.salvar_recorrencia(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id','')::uuid;
begin
  if not privado.pode('financeiro.lancar') then raise exception 'Sem permissão.'; end if;
  if v_id is null then
    insert into public.recorrencias (tipo, descricao, categoria_id, fornecedor_id, valor_centavos, frequencia, dia_vencimento, inicio, fim, forma_pagamento)
    values (coalesce(p->>'tipo','pagar'), trim(p->>'descricao'), (p->>'categoria_id')::uuid, nullif(p->>'fornecedor_id','')::uuid,
            (p->>'valor_centavos')::bigint, coalesce(p->>'frequencia','mensal'), coalesce((p->>'dia_vencimento')::int, 10),
            (p->>'inicio')::date, nullif(p->>'fim','')::date, nullif(p->>'forma_pagamento',''))
    returning id into v_id;
  else
    update public.recorrencias set descricao = trim(p->>'descricao'), categoria_id = (p->>'categoria_id')::uuid,
      fornecedor_id = nullif(p->>'fornecedor_id','')::uuid, valor_centavos = (p->>'valor_centavos')::bigint,
      frequencia = coalesce(p->>'frequencia','mensal'), dia_vencimento = coalesce((p->>'dia_vencimento')::int, 10),
      fim = nullif(p->>'fim','')::date, forma_pagamento = nullif(p->>'forma_pagamento',''),
      ativo = coalesce((p->>'ativo')::boolean, true)
    where id = v_id;
    -- contas futuras em aberto acompanham o novo valor
    update public.titulos set valor_centavos = (p->>'valor_centavos')::bigint, descricao = trim(p->>'descricao'), categoria_id = (p->>'categoria_id')::uuid
    where recorrencia_id = v_id and status = 'aberto' and pago_centavos = 0
      and vencimento >= (now() at time zone 'America/Sao_Paulo')::date;
    if not coalesce((p->>'ativo')::boolean, true) or nullif(p->>'fim','') is not null then
      update public.titulos set status = 'cancelado', cancelado_em = now(), motivo_cancelamento = 'Despesa fixa encerrada'
      where recorrencia_id = v_id and status = 'aberto' and pago_centavos = 0
        and (not coalesce((p->>'ativo')::boolean, true) or vencimento > (p->>'fim')::date)
        and vencimento >= (now() at time zone 'America/Sao_Paulo')::date;
    end if;
  end if;
  perform public.gerar_recorrencias();
  return v_id;
end $$;

-- Recebíveis de cartão (e outros com baixa automática) que já venceram
create or replace function public.processar_recebiveis()
returns int language plpgsql security definer set search_path = public as $$
declare t record; v_n int := 0; v_rest bigint; v_taxa bigint;
begin
  if not privado.tem_acesso() then return 0; end if;
  for t in select * from public.titulos
           where baixa_automatica and status in ('aberto','parcial')
             and vencimento <= (now() at time zone 'America/Sao_Paulo')::date and conta_prevista_id is not null
           order by vencimento for update skip locked loop
    v_rest := t.valor_centavos - t.pago_centavos;
    v_taxa := case when t.pago_centavos = 0 then t.taxa_prevista_centavos
                   else round(t.taxa_prevista_centavos::numeric * v_rest / t.valor_centavos)::bigint end;
    perform privado.baixar(t.id, t.vencimento, t.conta_prevista_id, v_rest, 0, 0, 0, v_taxa, true);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Fluxo de caixa: saldo de hoje + o que está previsto para entrar e sair
create or replace function public.fluxo_caixa(p_dias int default 30)
returns table (dia date, entradas bigint, saidas bigint, saldo bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_saldo bigint;
begin
  if not privado.pode('financeiro.relatorios') then raise exception 'Sem permissão.'; end if;
  select coalesce(sum(privado.saldo_conta(id)), 0) into v_saldo from public.contas_financeiras where ativo;
  return query
  with prev as (
    select greatest(t.vencimento, v_hoje) as d,
           sum(case when t.tipo = 'receber' then t.valor_centavos - t.pago_centavos - (case when t.pago_centavos = 0 then t.taxa_prevista_centavos else 0 end) else 0 end) as ent,
           sum(case when t.tipo = 'pagar' then t.valor_centavos - t.pago_centavos else 0 end) as sai
    from public.titulos t
    where t.status in ('aberto','parcial') and t.vencimento <= v_hoje + p_dias
    group by 1
  ), dias as (
    select g::date as d from generate_series(v_hoje, v_hoje + p_dias, interval '1 day') g
  )
  select dias.d, coalesce(prev.ent,0)::bigint, coalesce(prev.sai,0)::bigint,
         (v_saldo + sum(coalesce(prev.ent,0) - coalesce(prev.sai,0)) over (order by dias.d))::bigint
  from dias left join prev on prev.d = dias.d
  order by dias.d;
end $$;
