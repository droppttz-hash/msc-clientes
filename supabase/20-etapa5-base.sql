-- =====================================================================
-- Etapa 5 — Finanças e comissões: tabelas e views
-- =====================================================================

-- Permissões
insert into public.permissoes_catalogo (chave, modulo, descricao, ordem) values
  ('comissoes.ver_proprias', 'Comissões', 'Ver a própria comissão do mês', 46),
  ('comissoes.gerir',        'Comissões', 'Ver comissões de todos, ajustar e fechar o mês', 47),
  ('financeiro.conciliar',   'Finanças',  'Importar extrato do banco (OFX) e conciliar', 45)
on conflict (chave) do update set modulo = excluded.modulo, descricao = excluded.descricao, ordem = excluded.ordem;
insert into public.permissoes_cargo (cargo, permissao, permitido) values
  ('vendedor', 'comissoes.ver_proprias', true), ('tecnico', 'comissoes.ver_proprias', true),
  ('vendedor', 'comissoes.gerir', false), ('tecnico', 'comissoes.gerir', false),
  ('vendedor', 'financeiro.conciliar', false), ('tecnico', 'financeiro.conciliar', false)
on conflict (cargo, permissao) do nothing;

-- % de comissão de cada pessoa
alter table public.perfis
  add column if not exists comissao_venda_pct numeric(5,2) not null default 0 check (comissao_venda_pct between 0 and 100),
  add column if not exists comissao_os_pct numeric(5,2) not null default 0 check (comissao_os_pct between 0 and 100);

insert into public.categorias (tipo, nome, ordem, sistema) values ('despesa', 'Comissões', 3, 'comissao')
on conflict do nothing;

-- Comissão do técnico por OS (só existe quando o gerente ajusta; senão vale a sugestão)
create table if not exists public.os_comissoes (
  os_id           uuid primary key references public.ordens_servico(id),
  valor_centavos  bigint not null check (valor_centavos >= 0),
  motivo          text,
  ajustado_por    uuid default auth.uid() references public.perfis(user_id),
  ajustado_em     timestamptz not null default now()
);

-- Fechamento do mês: um registro por pessoa
create table if not exists public.comissoes_fechamentos (
  id                     uuid primary key default gen_random_uuid(),
  mes                    date not null check (extract(day from mes) = 1),
  user_id                uuid not null references public.perfis(user_id),
  base_venda_centavos    bigint not null default 0,
  pct_venda              numeric(5,2) not null default 0,
  valor_venda_centavos   bigint not null default 0,
  base_os_centavos       bigint not null default 0,
  valor_os_centavos      bigint not null default 0,
  ajuste_centavos        bigint not null default 0,
  motivo_ajuste          text,
  total_centavos         bigint not null check (total_centavos >= 0),
  detalhes               jsonb not null default '{}'::jsonb,
  titulo_id              uuid references public.titulos(id),
  status                 text not null default 'fechado' check (status in ('fechado','cancelado')),
  motivo_cancelamento    text,
  criado_por             uuid default auth.uid() references public.perfis(user_id),
  criado_em              timestamptz not null default now()
);
create unique index if not exists comissoes_fech_uk on public.comissoes_fechamentos (mes, user_id) where status = 'fechado';

-- Taxas por bandeira (débito e crédito por parcela). Sem linha = usa a taxa padrão da forma.
create table if not exists public.bandeiras (
  codigo  text primary key check (codigo ~ '^[a-z]{2,20}$'),
  nome    text not null,
  ativo   boolean not null default true,
  ordem   int not null default 100
);
insert into public.bandeiras (codigo, nome, ordem) values
  ('visa','Visa',1), ('master','Mastercard',2), ('elo','Elo',3), ('amex','American Express',4), ('hiper','Hipercard',5)
on conflict do nothing;
create table if not exists public.bandeira_taxas (
  bandeira  text not null references public.bandeiras(codigo),
  forma     text not null check (forma in ('debito','credito')),
  parcelas  smallint not null default 1 check (parcelas between 1 and 24),
  taxa_pct  numeric(6,3) not null check (taxa_pct between 0 and 100),
  primary key (bandeira, forma, parcelas)
);
alter table public.venda_pagamentos add column if not exists bandeira text references public.bandeiras(codigo);
alter table public.os_pagamentos    add column if not exists bandeira text references public.bandeiras(codigo);

create or replace function privado.taxa_forma(p_forma text, p_parcelas int, p_bandeira text)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(
    (select taxa_pct from public.bandeira_taxas where p_bandeira is not null and bandeira = p_bandeira and forma = p_forma
       and parcelas = case when p_forma = 'debito' then 1 else greatest(p_parcelas,1) end),
    privado.taxa_forma(p_forma, p_parcelas))
$$;

-- Conferência do caixa por forma de pagamento (sistema × relatório da maquininha/banco)
create table if not exists public.caixa_conferencias (
  id                 uuid primary key default gen_random_uuid(),
  data               date not null,
  forma              text not null references public.formas_pagamento(forma),
  sistema_centavos   bigint not null,
  informado_centavos bigint not null check (informado_centavos >= 0),
  diferenca_centavos bigint not null,
  observacao         text,
  criado_por         uuid default auth.uid() references public.perfis(user_id),
  criado_em          timestamptz not null default now()
);
create index if not exists caixa_conf_data_idx on public.caixa_conferencias (data);

-- Áreas da loja (para DRE e relatórios)
alter table public.categorias add column if not exists area text
  check (area is null or area in ('aparelhos','acessorios','informatica','assistencia','outros'));
update public.categorias set area = case
    when lower(nome) ~ 'celular|iphone|smartphone|aparelho|tablet|ipad' then 'aparelhos'
    when lower(nome) ~ 'notebook|informática|informatica|computador|pc|monitor' then 'informatica'
    when lower(nome) ~ 'serviço|servico|assistência|assistencia|conserto|reparo' then 'assistencia'
    when lower(nome) ~ 'acess|capa|película|pelicula|fone|carregador|cabo' then 'acessorios'
    else 'outros' end
where tipo = 'venda' and area is null;

-- Extrato do banco importado (OFX) para conciliação
create table if not exists public.extrato_importado (
  id             uuid primary key default gen_random_uuid(),
  conta_id       uuid not null references public.contas_financeiras(id),
  fitid          text not null,
  data           date not null,
  valor_centavos bigint not null check (valor_centavos <> 0),
  descricao      text,
  status         text not null default 'pendente' check (status in ('pendente','conciliado','ignorado','lancado')),
  movimento_id   bigint references public.movimentos_financeiros(id),
  titulo_id      uuid references public.titulos(id),
  importado_por  uuid default auth.uid() references public.perfis(user_id),
  importado_em   timestamptz not null default now(),
  resolvido_por  uuid references public.perfis(user_id),
  resolvido_em   timestamptz,
  unique (conta_id, fitid)
);
create index if not exists extrato_conta_data_idx on public.extrato_importado (conta_id, data);
create unique index if not exists extrato_mov_uk on public.extrato_importado (movimento_id) where movimento_id is not null;

alter table public.os_comissoes          enable row level security;
alter table public.comissoes_fechamentos enable row level security;
alter table public.bandeiras             enable row level security;
alter table public.bandeira_taxas        enable row level security;
alter table public.caixa_conferencias    enable row level security;
alter table public.extrato_importado     enable row level security;
create policy os_comissoes_ler on public.os_comissoes for select to authenticated using ((select privado.pode('comissoes.gerir')));
create policy comissoes_fech_ler on public.comissoes_fechamentos for select to authenticated using (
  (select privado.pode('comissoes.gerir')) or (user_id = (select auth.uid()) and (select privado.pode('comissoes.ver_proprias'))));
create policy bandeiras_ler on public.bandeiras for select to authenticated using ((select privado.tem_acesso()));
create policy bandeiras_gerir on public.bandeiras for all to authenticated using ((select privado.pode('config.gerenciar'))) with check ((select privado.pode('config.gerenciar')));
create policy bandeira_taxas_ler on public.bandeira_taxas for select to authenticated using ((select privado.tem_acesso()));
create policy bandeira_taxas_gerir on public.bandeira_taxas for all to authenticated using ((select privado.pode('config.gerenciar'))) with check ((select privado.pode('config.gerenciar')));
create policy caixa_conf_ler on public.caixa_conferencias for select to authenticated using ((select privado.pode('financeiro.caixa')) or (select privado.pode('financeiro.ver')));
create policy extrato_ler on public.extrato_importado for select to authenticated using ((select privado.pode('financeiro.conciliar')) or (select privado.pode('financeiro.ver')));
revoke all on public.os_comissoes, public.comissoes_fechamentos, public.bandeiras, public.bandeira_taxas, public.caixa_conferencias, public.extrato_importado from anon;
revoke insert, update, delete, truncate on public.os_comissoes, public.comissoes_fechamentos, public.caixa_conferencias, public.extrato_importado from authenticated;
grant select on public.os_comissoes, public.comissoes_fechamentos, public.caixa_conferencias, public.extrato_importado to authenticated;
grant select, insert, update, delete on public.bandeiras, public.bandeira_taxas to authenticated;

