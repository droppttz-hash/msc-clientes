-- =====================================================================
-- MSC — Onda 1 / parte 3: ESTOQUE
-- Produtos (com IMEI/nº de série opcional), movimentos imutáveis (kardex),
-- custo médio ponderado, entradas de mercadoria, ajustes, inventário e
-- importação de planilha.
--
-- As tabelas com CUSTO ficam no schema "nucleo" (não exposto na API).
-- O site lê pelas views do schema public, que escondem o custo de quem
-- não tem a permissão "estoque.ver_custo".
-- =====================================================================
create schema if not exists nucleo;
revoke all on schema nucleo from public, anon;
grant usage on schema nucleo to authenticated;

create sequence if not exists nucleo.produtos_sku_seq start 1001;

create table if not exists nucleo.produtos (
  id                    uuid primary key default gen_random_uuid(),
  sku                   text not null unique default ('P' || nextval('nucleo.produtos_sku_seq')),
  codigo_barras         text unique check (codigo_barras is null or codigo_barras ~ '^[0-9A-Za-z.-]{4,40}$'),
  nome                  text not null check (length(trim(nome)) >= 2),
  categoria_id          uuid references public.categorias(id),
  marca                 text,
  modelo                text,
  condicao              text not null default 'novo' check (condicao in ('novo','seminovo','usado','recondicionado')),
  tipo                  text not null default 'produto' check (tipo in ('produto','servico')),
  controla_estoque      boolean not null default true,
  controla_serie        boolean not null default false,       -- IMEI / nº de série
  unidade               text not null default 'un',
  preco_venda_centavos  bigint not null default 0 check (preco_venda_centavos >= 0),
  custo_medio_centavos  bigint not null default 0 check (custo_medio_centavos >= 0),
  estoque_atual         numeric(15,3) not null default 0,       -- só os gatilhos mexem
  estoque_minimo        numeric(15,3) not null default 0 check (estoque_minimo >= 0),
  garantia_dias         int check (garantia_dias is null or garantia_dias between 0 and 3650),
  ncm                   text check (ncm is null or ncm ~ '^[0-9]{8}$'),
  cest                  text,
  origem_fiscal         smallint check (origem_fiscal is null or origem_fiscal between 0 and 8),
  observacoes           text,
  ativo                 boolean not null default true,
  criado_por            uuid default auth.uid() references public.perfis(user_id),
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now(),
  check (not (controla_serie and not controla_estoque)),
  check (tipo = 'produto' or not controla_estoque)
);
create index if not exists produtos_nome_idx on nucleo.produtos (lower(nome));
create index if not exists produtos_categoria_idx on nucleo.produtos (categoria_id);

create table if not exists nucleo.produto_series (
  id              uuid primary key default gen_random_uuid(),
  produto_id      uuid not null references nucleo.produtos(id),
  serie           text not null check (length(trim(serie)) >= 3),
  status          text not null default 'disponivel'
                  check (status in ('disponivel','reservado','vendido','em_os','devolvido_fornecedor','defeito','baixado')),
  custo_centavos  bigint not null default 0 check (custo_centavos >= 0),
  entrada_id      uuid,
  venda_item_id   uuid,
  observacao      text,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
create unique index if not exists series_serie_uk on nucleo.produto_series (upper(serie));
create index if not exists series_produto_idx on nucleo.produto_series (produto_id, status);

create table if not exists nucleo.estoque_movimentos (
  id                       bigint generated always as identity primary key,
  produto_id               uuid not null references nucleo.produtos(id),
  tipo                     text not null check (tipo in ('saldo_inicial','entrada_compra','venda','cancelamento_venda',
                                                         'devolucao_cliente','devolucao_fornecedor','ajuste','inventario',
                                                         'perda','uso_os','estorno_os')),
  quantidade               numeric(15,3) not null check (quantidade <> 0),   -- + entra / − sai
  custo_unitario_centavos  bigint not null default 0 check (custo_unitario_centavos >= 0),
  saldo_apos               numeric(15,3),
  custo_medio_apos         bigint,
  serie_id                 uuid references nucleo.produto_series(id),
  venda_id                 uuid,
  venda_item_id            uuid,
  entrada_id               uuid,
  os_id                    uuid,
  devolucao_id             uuid,
  motivo                   text,
  criado_por               uuid default auth.uid() references public.perfis(user_id),
  criado_em                timestamptz not null default now()
);
create index if not exists estmov_produto_idx on nucleo.estoque_movimentos (produto_id, id);
create index if not exists estmov_venda_idx on nucleo.estoque_movimentos (venda_id);

alter table nucleo.produtos           enable row level security;
alter table nucleo.produto_series     enable row level security;
alter table nucleo.estoque_movimentos enable row level security;

-- ---------------------------------------------------------------------
-- Gatilho do kardex: trava o produto, confere saldo, recalcula custo médio
-- ---------------------------------------------------------------------
create or replace function nucleo.fn_movimento_estoque()
returns trigger language plpgsql security definer set search_path = nucleo, public as $$
declare p record; v_novo numeric; v_neg boolean;
begin
  select * into p from nucleo.produtos where id = new.produto_id for update;
  if not found then raise exception 'Produto não encontrado.'; end if;
  if not p.controla_estoque then raise exception 'O produto "%" não controla estoque.', p.nome; end if;
  if p.controla_serie and new.serie_id is null then
    raise exception 'O produto "%" exige IMEI / nº de série.', p.nome;
  end if;
  v_novo := p.estoque_atual + new.quantidade;
  select permitir_estoque_negativo into v_neg from public.empresa where id = 1;
  if new.quantidade < 0 and v_novo < 0 and (p.controla_serie or not coalesce(v_neg, false)) then
    raise exception 'Estoque insuficiente de "%": tem %, precisa de %.', p.nome, trim(to_char(p.estoque_atual, 'FM999G999G990D###')), trim(to_char(-new.quantidade, 'FM999G999G990D###'));
  end if;

  if new.quantidade > 0 and new.tipo in ('saldo_inicial','entrada_compra','ajuste','inventario','cancelamento_venda','devolucao_cliente','estorno_os') and new.custo_unitario_centavos > 0 then
    -- entrada com custo: média ponderada
    new.custo_medio_apos := case when p.estoque_atual <= 0 then new.custo_unitario_centavos
      else round((p.estoque_atual * p.custo_medio_centavos + new.quantidade * new.custo_unitario_centavos) / v_novo)::bigint end;
  elsif new.quantidade < 0 and new.tipo = 'devolucao_fornecedor' and v_novo > 0 then
    -- devolução ao fornecedor sai pelo custo da entrada original
    new.custo_medio_apos := greatest(0, round((p.estoque_atual * p.custo_medio_centavos + new.quantidade * new.custo_unitario_centavos) / v_novo))::bigint;
  else
    new.custo_medio_apos := p.custo_medio_centavos;
    if new.custo_unitario_centavos = 0 then new.custo_unitario_centavos := p.custo_medio_centavos; end if;
  end if;
  new.saldo_apos := v_novo;
  update nucleo.produtos set estoque_atual = v_novo, custo_medio_centavos = new.custo_medio_apos where id = p.id;
  return new;
end $$;
drop trigger if exists trg_estoque_movimento on nucleo.estoque_movimentos;
create trigger trg_estoque_movimento before insert on nucleo.estoque_movimentos
  for each row execute function nucleo.fn_movimento_estoque();
drop trigger if exists trg_estmov_imutavel on nucleo.estoque_movimentos;
create trigger trg_estmov_imutavel before update or delete on nucleo.estoque_movimentos
  for each row execute function public.fn_bloquear_alteracao();

drop trigger if exists trg_produtos_atualizado on nucleo.produtos;
create trigger trg_produtos_atualizado before update on nucleo.produtos
  for each row execute function public.fn_atualizado_em();
drop trigger if exists trg_series_atualizado on nucleo.produto_series;
create trigger trg_series_atualizado before update on nucleo.produto_series
  for each row execute function public.fn_atualizado_em();

-- auditoria de produto: preço, nome, ativo… (estoque/custo mudam pelo kardex)
create or replace function nucleo.fn_auditar_produto()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (to_jsonb(old) - 'estoque_atual' - 'custo_medio_centavos' - 'atualizado_em')
                         = (to_jsonb(new) - 'estoque_atual' - 'custo_medio_centavos' - 'atualizado_em') then
    return new;
  end if;
  insert into public.auditoria (tabela, registro_id, acao, antes, depois, usuario_id)
  values ('produtos', new.id, tg_op, case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new), auth.uid());
  return new;
end $$;
drop trigger if exists trg_produtos_auditoria on nucleo.produtos;
create trigger trg_produtos_auditoria after insert or update on nucleo.produtos
  for each row execute function nucleo.fn_auditar_produto();

-- ---------------------------------------------------------------------
-- RLS (as views abaixo rodam com as permissões de quem está logado)
-- ---------------------------------------------------------------------
create or replace function privado.ve_catalogo()
returns boolean language sql stable security definer set search_path = public as $$
  select privado.pode('estoque.ver') or privado.pode('vendas.criar') or privado.pode('os.editar') or privado.pode('os.criar')
$$;
drop policy if exists produtos_ler on nucleo.produtos;
create policy produtos_ler on nucleo.produtos for select to authenticated using ((select privado.ve_catalogo()));
drop policy if exists series_ler on nucleo.produto_series;
create policy series_ler on nucleo.produto_series for select to authenticated using ((select privado.ve_catalogo()));
drop policy if exists estmov_ler on nucleo.estoque_movimentos;
create policy estmov_ler on nucleo.estoque_movimentos for select to authenticated using ((select privado.pode('estoque.ver')));
grant select on nucleo.produtos, nucleo.produto_series, nucleo.estoque_movimentos to authenticated;

create or replace view public.produtos with (security_invoker = true) as
select p.id, p.sku, p.codigo_barras, p.nome, p.categoria_id, c.nome as categoria, p.marca, p.modelo, p.condicao, p.tipo,
       p.controla_estoque, p.controla_serie, p.unidade, p.preco_venda_centavos,
       case when privado.pode('estoque.ver_custo') then p.custo_medio_centavos end as custo_medio_centavos,
       p.estoque_atual, p.estoque_minimo, p.garantia_dias, p.ncm, p.cest, p.origem_fiscal, p.observacoes, p.ativo,
       (p.controla_estoque and p.estoque_atual <= p.estoque_minimo) as estoque_baixo,
       p.criado_em, p.atualizado_em
from nucleo.produtos p
left join public.categorias c on c.id = p.categoria_id;

create or replace view public.produto_series with (security_invoker = true) as
select s.id, s.produto_id, p.nome as produto, p.sku, s.serie, s.status,
       case when privado.pode('estoque.ver_custo') then s.custo_centavos end as custo_centavos,
       s.entrada_id, s.venda_item_id, s.observacao, s.criado_em, s.atualizado_em
from nucleo.produto_series s join nucleo.produtos p on p.id = s.produto_id;

create or replace view public.estoque_movimentos with (security_invoker = true) as
select m.id, m.produto_id, p.nome as produto, p.sku, m.tipo, m.quantidade,
       case when privado.pode('estoque.ver_custo') then m.custo_unitario_centavos end as custo_unitario_centavos,
       m.saldo_apos,
       case when privado.pode('estoque.ver_custo') then m.custo_medio_apos end as custo_medio_apos,
       m.serie_id, s.serie, m.venda_id, m.entrada_id, m.os_id, m.devolucao_id, m.motivo,
       m.criado_por, pf.nome as usuario, m.criado_em
from nucleo.estoque_movimentos m
join nucleo.produtos p on p.id = m.produto_id
left join nucleo.produto_series s on s.id = m.serie_id
left join public.perfis pf on pf.user_id = m.criado_por;

grant select on public.produtos, public.produto_series, public.estoque_movimentos to authenticated;

-- ---------------------------------------------------------------------
-- Cadastro de produto
-- ---------------------------------------------------------------------
create or replace function public.salvar_produto(p jsonb)
returns uuid language plpgsql security definer set search_path = nucleo, public as $$
declare v_id uuid := nullif(p->>'id','')::uuid; v_cat uuid := nullif(p->>'categoria_id','')::uuid; v_old record;
        v_serie boolean := coalesce((p->>'controla_serie')::boolean, false);
        v_ctrl boolean := coalesce((p->>'controla_estoque')::boolean, true);
        v_tipo text := coalesce(nullif(p->>'tipo',''), 'produto');
begin
  if not privado.pode('estoque.produtos') then raise exception 'Sem permissão para cadastrar produtos.'; end if;
  if v_cat is not null and (select tipo from public.categorias where id = v_cat) <> 'venda' then
    raise exception 'Categoria inválida.';
  end if;
  if v_tipo = 'servico' then v_ctrl := false; v_serie := false; end if;
  if v_id is null then
    insert into nucleo.produtos (sku, codigo_barras, nome, categoria_id, marca, modelo, condicao, tipo, controla_estoque, controla_serie,
                                 unidade, preco_venda_centavos, estoque_minimo, garantia_dias, ncm, cest, origem_fiscal, observacoes)
    values (coalesce(nullif(upper(trim(p->>'sku')),''), 'P' || nextval('nucleo.produtos_sku_seq')),
            nullif(trim(p->>'codigo_barras'),''), trim(p->>'nome'), v_cat, nullif(trim(p->>'marca'),''), nullif(trim(p->>'modelo'),''),
            coalesce(nullif(p->>'condicao',''),'novo'), v_tipo, v_ctrl, v_serie, coalesce(nullif(p->>'unidade',''),'un'),
            coalesce((p->>'preco_venda_centavos')::bigint, 0), coalesce((p->>'estoque_minimo')::numeric, 0),
            nullif(p->>'garantia_dias','')::int, nullif(p->>'ncm',''), nullif(p->>'cest',''), nullif(p->>'origem_fiscal','')::smallint,
            nullif(trim(p->>'observacoes'),''))
    returning id into v_id;
  else
    select * into v_old from nucleo.produtos where id = v_id for update;
    if v_old.controla_serie <> v_serie and v_old.estoque_atual <> 0 then
      raise exception 'Para mudar o controle de IMEI/série, o estoque do produto precisa estar zerado.';
    end if;
    if v_old.controla_estoque and not v_ctrl and v_old.estoque_atual <> 0 then
      raise exception 'Para deixar de controlar estoque, zere o estoque do produto antes.';
    end if;
    update nucleo.produtos set
      sku = coalesce(nullif(upper(trim(p->>'sku')),''), sku),
      codigo_barras = nullif(trim(p->>'codigo_barras'),''),
      nome = trim(p->>'nome'), categoria_id = v_cat,
      marca = nullif(trim(p->>'marca'),''), modelo = nullif(trim(p->>'modelo'),''),
      condicao = coalesce(nullif(p->>'condicao',''),'novo'), tipo = v_tipo,
      controla_estoque = v_ctrl, controla_serie = v_serie, unidade = coalesce(nullif(p->>'unidade',''),'un'),
      preco_venda_centavos = coalesce((p->>'preco_venda_centavos')::bigint, preco_venda_centavos),
      estoque_minimo = coalesce((p->>'estoque_minimo')::numeric, 0),
      garantia_dias = nullif(p->>'garantia_dias','')::int,
      ncm = nullif(p->>'ncm',''), cest = nullif(p->>'cest',''), origem_fiscal = nullif(p->>'origem_fiscal','')::smallint,
      observacoes = nullif(trim(p->>'observacoes'),''),
      ativo = coalesce((p->>'ativo')::boolean, ativo)
    where id = v_id;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'Já existe um produto com esse SKU ou código de barras.';
end $$;

-- ---------------------------------------------------------------------
-- Ajustes, perdas e inventário
-- ---------------------------------------------------------------------
-- Ajuste de produto SEM série: p_tipo ajuste|perda; p_quantidade com sinal (+ entra / − sai)
create or replace function public.ajustar_estoque(p_produto uuid, p_quantidade numeric, p_tipo text, p_motivo text, p_custo bigint default null)
returns bigint language plpgsql security definer set search_path = nucleo, public as $$
declare v_id bigint;
begin
  if not privado.pode('estoque.ajustar') then raise exception 'Sem permissão para ajustar estoque.'; end if;
  if p_tipo not in ('ajuste','perda') then raise exception 'Tipo de ajuste inválido.'; end if;
  if p_tipo = 'perda' and p_quantidade > 0 then raise exception 'Perda é sempre saída.'; end if;
  if coalesce(length(trim(p_motivo)),0) < 3 then raise exception 'Informe o motivo do ajuste.'; end if;
  if (select controla_serie from nucleo.produtos where id = p_produto) then
    raise exception 'Este produto usa IMEI/série: ajuste pela lista de séries.';
  end if;
  insert into nucleo.estoque_movimentos (produto_id, tipo, quantidade, custo_unitario_centavos, motivo)
  values (p_produto, p_tipo, p_quantidade, case when privado.pode('estoque.ver_custo') then coalesce(p_custo, 0) else 0 end, trim(p_motivo))
  returning id into v_id;
  return v_id;
end $$;

-- Inventário: informe a quantidade contada; o sistema lança a diferença
-- p: [{produto_id, contado}]
create or replace function public.registrar_inventario(p jsonb, p_motivo text default 'Inventário')
returns int language plpgsql security definer set search_path = nucleo, public as $$
declare r jsonb; v_atual numeric; v_n int := 0; v_serie boolean;
begin
  if not privado.pode('estoque.ajustar') then raise exception 'Sem permissão para inventário.'; end if;
  for r in select * from jsonb_array_elements(p) loop
    select estoque_atual, controla_serie into v_atual, v_serie from nucleo.produtos where id = (r->>'produto_id')::uuid for update;
    if v_serie then continue; end if;
    if (r->>'contado')::numeric <> v_atual then
      insert into nucleo.estoque_movimentos (produto_id, tipo, quantidade, motivo)
      values ((r->>'produto_id')::uuid, 'inventario', (r->>'contado')::numeric - v_atual, coalesce(nullif(trim(p_motivo),''), 'Inventário'));
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

-- Séries (IMEI): incluir unidade avulsa (ajuste +1) ou dar baixa (defeito/perda)
create or replace function public.adicionar_serie(p_produto uuid, p_serie text, p_custo bigint, p_motivo text)
returns uuid language plpgsql security definer set search_path = nucleo, public as $$
declare v_id uuid;
begin
  if not privado.pode('estoque.ajustar') then raise exception 'Sem permissão.'; end if;
  if coalesce(length(trim(p_motivo)),0) < 3 then raise exception 'Informe o motivo.'; end if;
  if not (select controla_serie from nucleo.produtos where id = p_produto) then raise exception 'Este produto não usa IMEI/série.'; end if;
  insert into nucleo.produto_series (produto_id, serie, custo_centavos) values (p_produto, upper(trim(p_serie)), coalesce(p_custo,0)) returning id into v_id;
  insert into nucleo.estoque_movimentos (produto_id, tipo, quantidade, custo_unitario_centavos, serie_id, motivo)
  values (p_produto, 'ajuste', 1, coalesce(p_custo,0), v_id, trim(p_motivo));
  return v_id;
exception when unique_violation then
  raise exception 'O IMEI/série % já está cadastrado.', upper(trim(p_serie));
end $$;

create or replace function public.baixar_serie(p_serie uuid, p_status text, p_motivo text)
returns void language plpgsql security definer set search_path = nucleo, public as $$
declare s record;
begin
  if not privado.pode('estoque.ajustar') then raise exception 'Sem permissão.'; end if;
  if p_status not in ('defeito','baixado') then raise exception 'Situação inválida.'; end if;
  if coalesce(length(trim(p_motivo)),0) < 3 then raise exception 'Informe o motivo.'; end if;
  select * into s from nucleo.produto_series where id = p_serie for update;
  if s.status <> 'disponivel' then raise exception 'Só dá para baixar unidade disponível.'; end if;
  insert into nucleo.estoque_movimentos (produto_id, tipo, quantidade, custo_unitario_centavos, serie_id, motivo)
  values (s.produto_id, 'perda', -1, s.custo_centavos, s.id, trim(p_motivo));
  update nucleo.produto_series set status = p_status, observacao = trim(p_motivo) where id = s.id;
end $$;

-- ---------------------------------------------------------------------
-- ENTRADAS DE MERCADORIA (compra de fornecedor)
-- ---------------------------------------------------------------------
create table if not exists public.entradas (
  id                   uuid primary key default gen_random_uuid(),
  numero               bigint generated always as identity unique,
  fornecedor_id        uuid references public.fornecedores(id),
  data                 date not null,
  nf_numero            text,
  observacao           text,
  frete_centavos       bigint not null default 0 check (frete_centavos >= 0),
  total_centavos       bigint not null default 0 check (total_centavos >= 0),
  status               text not null default 'confirmada' check (status in ('confirmada','cancelada')),
  motivo_cancelamento  text,
  cancelada_em         timestamptz,
  criado_por           uuid default auth.uid() references public.perfis(user_id),
  criado_em            timestamptz not null default now()
);
create table if not exists nucleo.entrada_itens (
  id                       uuid primary key default gen_random_uuid(),
  entrada_id               uuid not null references public.entradas(id),
  produto_id               uuid not null references nucleo.produtos(id),
  quantidade               numeric(15,3) not null check (quantidade > 0),
  custo_unitario_centavos  bigint not null check (custo_unitario_centavos >= 0),   -- já com frete rateado
  custo_nota_centavos      bigint not null check (custo_nota_centavos >= 0)        -- valor da nota
);
alter table public.entradas      enable row level security;
alter table nucleo.entrada_itens enable row level security;
drop policy if exists entradas_ler on public.entradas;
create policy entradas_ler on public.entradas for select to authenticated using ((select privado.pode('estoque.entrada')) or (select privado.pode('estoque.ver_custo')));
drop policy if exists entrada_itens_ler on nucleo.entrada_itens;
create policy entrada_itens_ler on nucleo.entrada_itens for select to authenticated using ((select privado.pode('estoque.entrada')) or (select privado.pode('estoque.ver_custo')));
grant select on public.entradas, nucleo.entrada_itens to authenticated;
create or replace view public.entrada_itens with (security_invoker = true) as
select i.id, i.entrada_id, i.produto_id, p.nome as produto, p.sku, i.quantidade, i.custo_unitario_centavos, i.custo_nota_centavos,
       (select array_agg(s.serie order by s.serie) from nucleo.produto_series s where s.entrada_id = i.entrada_id and s.produto_id = i.produto_id) as series
from nucleo.entrada_itens i join nucleo.produtos p on p.id = i.produto_id;
grant select on public.entrada_itens to authenticated;

alter table public.titulos drop constraint if exists titulos_entrada_fk;
alter table public.titulos add constraint titulos_entrada_fk foreign key (entrada_id) references public.entradas(id);

drop trigger if exists trg_entradas_auditoria on public.entradas;
create trigger trg_entradas_auditoria after insert or update on public.entradas
  for each row execute function public.fn_auditar();

-- p: {fornecedor_id, data, nf_numero, observacao, frete_centavos,
--     itens:[{produto_id, quantidade, custo_unitario_centavos, series:[...]}],
--     pagamento:{modo:'avista'|'prazo'|'nenhum', conta_id, parcelas:[{vencimento, valor_centavos}]}}
create or replace function public.registrar_entrada(p jsonb)
returns uuid language plpgsql security definer set search_path = nucleo, public as $$
declare v_id uuid; v_item jsonb; v_prod record; v_qtd numeric; v_custo bigint; v_frete bigint := coalesce((p->>'frete_centavos')::bigint, 0);
        v_bruto bigint := 0; v_rateado bigint := 0; v_total bigint; v_i int := 0; v_n int; v_parte bigint; v_unit bigint;
        v_serie text; v_sid uuid; v_data date := coalesce(nullif(p->>'data','')::date, (now() at time zone 'America/Sao_Paulo')::date);
        v_modo text := coalesce(p->'pagamento'->>'modo', 'nenhum'); v_parc jsonb; v_np int; v_k int := 0; v_soma bigint := 0;
        v_tid uuid; v_desc text; v_forn text;
begin
  if not privado.pode('estoque.entrada') then raise exception 'Sem permissão para dar entrada de mercadoria.'; end if;
  v_n := jsonb_array_length(coalesce(p->'itens','[]'::jsonb));
  if v_n = 0 then raise exception 'Adicione pelo menos um produto.'; end if;
  if v_data > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'A data não pode ser no futuro.'; end if;
  for v_item in select * from jsonb_array_elements(p->'itens') loop
    v_bruto := v_bruto + round((v_item->>'quantidade')::numeric * (v_item->>'custo_unitario_centavos')::bigint)::bigint;
  end loop;
  v_total := v_bruto + v_frete;

  insert into public.entradas (fornecedor_id, data, nf_numero, observacao, frete_centavos, total_centavos)
  values (nullif(p->>'fornecedor_id','')::uuid, v_data, nullif(trim(p->>'nf_numero'),''), nullif(trim(p->>'observacao'),''), v_frete, v_total)
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(p->'itens') loop
    v_i := v_i + 1;
    select * into v_prod from nucleo.produtos where id = (v_item->>'produto_id')::uuid;
    if not found then raise exception 'Produto não encontrado na linha %.', v_i; end if;
    if not v_prod.controla_estoque then raise exception '"%" não controla estoque.', v_prod.nome; end if;
    v_qtd := (v_item->>'quantidade')::numeric;
    v_custo := (v_item->>'custo_unitario_centavos')::bigint;
    if v_qtd <= 0 then raise exception 'Quantidade inválida para "%".', v_prod.nome; end if;
    -- frete rateado pelo valor; a última linha fica com a sobra dos centavos
    if v_i = v_n then v_parte := v_frete - v_rateado;
    elsif v_bruto > 0 then v_parte := round(v_frete::numeric * (v_qtd * v_custo) / v_bruto)::bigint;
    else v_parte := 0; end if;
    v_rateado := v_rateado + v_parte;
    v_unit := v_custo + round(v_parte / v_qtd)::bigint;
    insert into nucleo.entrada_itens (entrada_id, produto_id, quantidade, custo_unitario_centavos, custo_nota_centavos)
    values (v_id, v_prod.id, v_qtd, v_unit, v_custo);

    if v_prod.controla_serie then
      if v_qtd <> trunc(v_qtd) or jsonb_array_length(coalesce(v_item->'series','[]'::jsonb)) <> v_qtd then
        raise exception 'Informe 1 IMEI/série para cada unidade de "%" (% unidades).', v_prod.nome, v_qtd;
      end if;
      for v_serie in select upper(trim(x)) from jsonb_array_elements_text(v_item->'series') x loop
        begin
          insert into nucleo.produto_series (produto_id, serie, custo_centavos, entrada_id) values (v_prod.id, v_serie, v_unit, v_id) returning id into v_sid;
        exception when unique_violation then
          raise exception 'O IMEI/série % já está cadastrado.', v_serie;
        end;
        insert into nucleo.estoque_movimentos (produto_id, tipo, quantidade, custo_unitario_centavos, serie_id, entrada_id, motivo)
        values (v_prod.id, 'entrada_compra', 1, v_unit, v_sid, v_id, 'Entrada nº ' || (select numero from public.entradas where id = v_id));
      end loop;
    else
      insert into nucleo.estoque_movimentos (produto_id, tipo, quantidade, custo_unitario_centavos, entrada_id, motivo)
      values (v_prod.id, 'entrada_compra', v_qtd, v_unit, v_id, 'Entrada nº ' || (select numero from public.entradas where id = v_id));
    end if;
  end loop;

  -- financeiro
  select nome into v_forn from public.fornecedores where id = nullif(p->>'fornecedor_id','')::uuid;
  v_desc := 'Compra de mercadoria' || coalesce(' — ' || v_forn, '') || coalesce(' (NF ' || nullif(trim(p->>'nf_numero'),'') || ')', '');
  if v_modo = 'avista' and v_total > 0 then
    if nullif(p->'pagamento'->>'conta_id','') is null then raise exception 'Escolha de qual conta saiu o pagamento.'; end if;
    insert into public.titulos (tipo, descricao, categoria_id, fornecedor_id, entrada_id, competencia, vencimento, valor_centavos)
    values ('pagar', v_desc, privado.cat('compra_mercadoria'), nullif(p->>'fornecedor_id','')::uuid, v_id, v_data, v_data, v_total)
    returning id into v_tid;
    perform privado.baixar(v_tid, v_data, (p->'pagamento'->>'conta_id')::uuid, v_total);
  elsif v_modo = 'prazo' and v_total > 0 then
    v_np := jsonb_array_length(coalesce(p->'pagamento'->'parcelas','[]'::jsonb));
    if v_np = 0 then raise exception 'Informe os vencimentos.'; end if;
    for v_parc in select * from jsonb_array_elements(p->'pagamento'->'parcelas') loop
      v_k := v_k + 1; v_soma := v_soma + (v_parc->>'valor_centavos')::bigint;
      insert into public.titulos (tipo, descricao, categoria_id, fornecedor_id, entrada_id, competencia, vencimento, parcela, parcelas, valor_centavos)
      values ('pagar', v_desc, privado.cat('compra_mercadoria'), nullif(p->>'fornecedor_id','')::uuid, v_id, v_data,
              (v_parc->>'vencimento')::date, v_k, v_np, (v_parc->>'valor_centavos')::bigint);
    end loop;
    if v_soma <> v_total then
      raise exception 'A soma das parcelas (R$ %) é diferente do total da entrada (R$ %).',
        to_char(v_soma/100.0, 'FM999G999G990D00'), to_char(v_total/100.0, 'FM999G999G990D00');
    end if;
  end if;
  return v_id;
end $$;

create or replace function public.cancelar_entrada(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = nucleo, public as $$
declare e record; i record; s record; t record;
begin
  if not privado.pode('estoque.entrada') then raise exception 'Sem permissão.'; end if;
  if coalesce(length(trim(p_motivo)),0) < 3 then raise exception 'Informe o motivo.'; end if;
  select * into e from public.entradas where id = p_id for update;
  if e.status = 'cancelada' then raise exception 'Entrada já cancelada.'; end if;
  for t in select * from public.titulos where entrada_id = p_id and status <> 'cancelado' loop
    if t.pago_centavos > 0 and not privado.pode('financeiro.baixar') then
      raise exception 'A compra já foi paga. Peça para quem cuida do financeiro cancelar.';
    end if;
    perform privado.cancelar_titulo(t.id, 'Entrada cancelada: ' || trim(p_motivo), true);
  end loop;
  for i in select * from nucleo.entrada_itens where entrada_id = p_id loop
    if (select controla_serie from nucleo.produtos where id = i.produto_id) then
      for s in select * from nucleo.produto_series where entrada_id = p_id and produto_id = i.produto_id for update loop
        if s.status <> 'disponivel' then raise exception 'O IMEI % já foi vendido/usado. Não dá para cancelar a entrada.', s.serie; end if;
        insert into nucleo.estoque_movimentos (produto_id, tipo, quantidade, custo_unitario_centavos, serie_id, entrada_id, motivo)
        values (i.produto_id, 'devolucao_fornecedor', -1, s.custo_centavos, s.id, p_id, 'Cancelamento da entrada nº ' || e.numero);
        update nucleo.produto_series set status = 'devolvido_fornecedor' where id = s.id;
      end loop;
    else
      insert into nucleo.estoque_movimentos (produto_id, tipo, quantidade, custo_unitario_centavos, entrada_id, motivo)
      values (i.produto_id, 'devolucao_fornecedor', -i.quantidade, i.custo_unitario_centavos, p_id, 'Cancelamento da entrada nº ' || e.numero);
    end if;
  end loop;
  update public.entradas set status = 'cancelada', motivo_cancelamento = trim(p_motivo), cancelada_em = now() where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- IMPORTAÇÃO DE PLANILHA
-- p: [{linha, sku, codigo_barras, nome, categoria, marca, modelo, condicao, preco_venda_centavos,
--      custo_centavos, estoque, estoque_minimo, series:[...]}]
-- Produto encontrado por SKU → código de barras → nome; senão é criado.
-- Se "estoque" vier preenchido, o sistema lança a diferença como inventário.
-- ---------------------------------------------------------------------
create or replace function public.importar_produtos(p jsonb, p_atualizar_precos boolean default true)
returns jsonb language plpgsql security definer set search_path = nucleo, public as $$
declare r jsonb; v_id uuid; v_cat uuid; v_criados int := 0; v_atual int := 0; v_erros jsonb := '[]'::jsonb; v_prod record;
        v_estoque numeric; v_custo bigint; v_serie text; v_sid uuid; v_novo boolean; v_custo_ok boolean := privado.pode('estoque.ver_custo');
begin
  if not privado.pode('estoque.importar') then raise exception 'Sem permissão para importar.'; end if;
  for r in select * from jsonb_array_elements(p) loop
    begin
      if coalesce(length(trim(r->>'nome')),0) < 2 and nullif(trim(r->>'sku'),'') is null and nullif(trim(r->>'codigo_barras'),'') is null then
        raise exception 'Sem nome, SKU ou código de barras.';
      end if;
      v_cat := null;
      if nullif(trim(r->>'categoria'),'') is not null then
        select id into v_cat from public.categorias where tipo = 'venda' and lower(nome) = lower(trim(r->>'categoria'));
        if v_cat is null then
          insert into public.categorias (tipo, nome) values ('venda', trim(r->>'categoria')) returning id into v_cat;
        end if;
      end if;
      v_id := null; v_novo := false;
      if nullif(trim(r->>'sku'),'') is not null then select id into v_id from nucleo.produtos where sku = upper(trim(r->>'sku')); end if;
      if v_id is null and nullif(trim(r->>'codigo_barras'),'') is not null then select id into v_id from nucleo.produtos where codigo_barras = trim(r->>'codigo_barras'); end if;
      if v_id is null and nullif(trim(r->>'nome'),'') is not null then
        select id into v_id from nucleo.produtos where lower(nome) = lower(trim(r->>'nome')) and coalesce(lower(condicao),'') = coalesce(lower(nullif(r->>'condicao','')), 'novo') limit 1;
      end if;
      if v_id is null then
        insert into nucleo.produtos (sku, codigo_barras, nome, categoria_id, marca, modelo, condicao, controla_serie, preco_venda_centavos, estoque_minimo)
        values (coalesce(nullif(upper(trim(r->>'sku')),''), 'P' || nextval('nucleo.produtos_sku_seq')), nullif(trim(r->>'codigo_barras'),''),
                trim(r->>'nome'), v_cat, nullif(trim(r->>'marca'),''), nullif(trim(r->>'modelo'),''),
                coalesce(nullif(lower(r->>'condicao'),''),'novo'),
                jsonb_array_length(coalesce(r->'series','[]'::jsonb)) > 0,
                coalesce((r->>'preco_venda_centavos')::bigint, 0), coalesce((r->>'estoque_minimo')::numeric, 0))
        returning id into v_id;
        v_criados := v_criados + 1; v_novo := true;
      else
        update nucleo.produtos set
          nome = coalesce(nullif(trim(r->>'nome'),''), nome),
          categoria_id = coalesce(v_cat, categoria_id),
          marca = coalesce(nullif(trim(r->>'marca'),''), marca),
          modelo = coalesce(nullif(trim(r->>'modelo'),''), modelo),
          codigo_barras = coalesce(nullif(trim(r->>'codigo_barras'),''), codigo_barras),
          preco_venda_centavos = case when p_atualizar_precos and nullif(r->>'preco_venda_centavos','') is not null
                                      then (r->>'preco_venda_centavos')::bigint else preco_venda_centavos end,
          estoque_minimo = coalesce(nullif(r->>'estoque_minimo','')::numeric, estoque_minimo),
          ativo = true
        where id = v_id;
        v_atual := v_atual + 1;
      end if;
      select * into v_prod from nucleo.produtos where id = v_id;
      v_custo := case when v_custo_ok then coalesce(nullif(r->>'custo_centavos','')::bigint, 0) else 0 end;
      if jsonb_array_length(coalesce(r->'series','[]'::jsonb)) > 0 then
        if not v_prod.controla_serie then raise exception 'Este produto não usa IMEI/série, mas a linha tem IMEIs.'; end if;
        for v_serie in select upper(trim(x)) from jsonb_array_elements_text(r->'series') x where trim(x) <> '' loop
          if not exists (select 1 from nucleo.produto_series where upper(serie) = v_serie) then
            insert into nucleo.produto_series (produto_id, serie, custo_centavos) values (v_id, v_serie, v_custo) returning id into v_sid;
            insert into nucleo.estoque_movimentos (produto_id, tipo, quantidade, custo_unitario_centavos, serie_id, motivo)
            values (v_id, case when v_novo then 'saldo_inicial' else 'inventario' end, 1, v_custo, v_sid, 'Importação de planilha');
          end if;
        end loop;
      elsif nullif(r->>'estoque','') is not null and not v_prod.controla_serie and v_prod.controla_estoque then
        v_estoque := (r->>'estoque')::numeric;
        if v_estoque <> v_prod.estoque_atual then
          insert into nucleo.estoque_movimentos (produto_id, tipo, quantidade, custo_unitario_centavos, motivo)
          values (v_id, case when v_novo then 'saldo_inicial' else 'inventario' end, v_estoque - v_prod.estoque_atual,
                  case when v_estoque > v_prod.estoque_atual then v_custo else 0 end, 'Importação de planilha');
        end if;
      end if;
    exception when others then
      v_erros := v_erros || jsonb_build_object('linha', r->>'linha', 'erro', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('criados', v_criados, 'atualizados', v_atual, 'erros', v_erros);
end $$;

-- Busca rápida para o PDV: nome, SKU, código de barras ou IMEI
create or replace function public.buscar_produto(p_termo text, p_limite int default 20)
returns table (produto_id uuid, nome text, sku text, codigo_barras text, condicao text, categoria text,
               preco_venda_centavos bigint, estoque_atual numeric, controla_estoque boolean, controla_serie boolean,
               garantia_dias int, serie_id uuid, serie text)
language sql stable security invoker set search_path = public as $$
  with t as (select trim(p_termo) as q)
  (select s.produto_id, p.nome, p.sku, p.codigo_barras, p.condicao, p.categoria, p.preco_venda_centavos, p.estoque_atual,
          p.controla_estoque, p.controla_serie, p.garantia_dias, s.id, s.serie
   from public.produto_series s join public.produtos p on p.id = s.produto_id, t
   where s.status = 'disponivel' and length(t.q) >= 4 and upper(s.serie) like '%' || upper(t.q) || '%'
   limit p_limite)
  union all
  (select p.id, p.nome, p.sku, p.codigo_barras, p.condicao, p.categoria, p.preco_venda_centavos, p.estoque_atual,
          p.controla_estoque, p.controla_serie, p.garantia_dias, null::uuid, null::text
   from public.produtos p, t
   where p.ativo and (p.sku = upper(t.q) or p.codigo_barras = t.q or p.nome ilike '%' || t.q || '%'
                      or coalesce(p.marca,'') || ' ' || coalesce(p.modelo,'') ilike '%' || t.q || '%')
   order by (p.sku = upper(t.q) or p.codigo_barras = t.q) desc, p.nome
   limit p_limite)
$$;
grant execute on function public.buscar_produto(text, int) to authenticated;
