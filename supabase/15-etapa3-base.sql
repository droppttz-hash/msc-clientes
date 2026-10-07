-- =====================================================================
-- Etapa 3 — Cadastros e vendas avançadas (estrutura)
--  * cliente PF/PJ com CNPJ (inclusive alfanumérico), "como conheceu" e etiquetas
--  * aparelho na troca (trade-in) e compra de aparelho de cliente (avaliações)
--  * reserva de aparelho com sinal
--  * orçamentos que viram venda
-- =====================================================================

-- CNPJ (numérico ou alfanumérico, regra da Receita a partir de 2026)
create or replace function privado.cnpj_valido(p text)
returns boolean language plpgsql immutable set search_path = public as $$
declare v text := upper(regexp_replace(coalesce(p,''), '[^0-9A-Za-z]', '', 'g')); s int; i int; d1 int; d2 int;
begin
  if v !~ '^[0-9A-Z]{12}[0-9]{2}$' or v ~ '^(.)\1{13}$' then return false; end if;
  s := 0;
  for i in 1..12 loop s := s + (ascii(substr(v, i, 1)) - 48) * (array[5,4,3,2,9,8,7,6,5,4,3,2])[i]; end loop;
  d1 := case when s % 11 < 2 then 0 else 11 - s % 11 end;
  s := 0;
  for i in 1..13 loop s := s + (ascii(substr(v, i, 1)) - 48) * (array[6,5,4,3,2,9,8,7,6,5,4,3,2])[i]; end loop;
  d2 := case when s % 11 < 2 then 0 else 11 - s % 11 end;
  return substr(v, 13, 1)::int = d1 and substr(v, 14, 1)::int = d2;
end $$;

create or replace function privado.cpf_valido(p text)
returns boolean language plpgsql immutable set search_path = public as $$
declare v text := regexp_replace(coalesce(p,''), '\D', '', 'g'); s int; i int; d1 int; d2 int;
begin
  if v !~ '^[0-9]{11}$' or v ~ '^(.)\1{10}$' then return false; end if;
  s := 0; for i in 1..9 loop s := s + substr(v, i, 1)::int * (11 - i); end loop;
  d1 := (s * 10) % 11; if d1 = 10 then d1 := 0; end if;
  s := 0; for i in 1..10 loop s := s + substr(v, i, 1)::int * (12 - i); end loop;
  d2 := (s * 10) % 11; if d2 = 10 then d2 := 0; end if;
  return substr(v, 10, 1)::int = d1 and substr(v, 11, 1)::int = d2;
end $$;
grant execute on function privado.cnpj_valido(text), privado.cpf_valido(text) to authenticated;

-- Cliente PF/PJ
alter table public.clientes
  add column if not exists tipo_pessoa text not null default 'pf' check (tipo_pessoa in ('pf','pj')),
  add column if not exists cnpj text check (cnpj is null or privado.cnpj_valido(cnpj)),
  add column if not exists como_conheceu text check (como_conheceu is null or como_conheceu in ('instagram','whatsapp','indicacao','passou_na_frente','google','trafego_pago','outro')),
  add column if not exists tags text[] not null default '{}';
create index if not exists clientes_cnpj_idx on public.clientes (cnpj);
create index if not exists clientes_tags_idx on public.clientes using gin (tags);

create or replace view public.clientes_lista with (security_invoker = true) as
select c.id, c.nome, c.tipo_pessoa, c.cpf, c.cnpj, c.telefone, c.email, c.cep, c.logradouro, c.numero, c.complemento, c.bairro,
       c.cidade, c.uf, c.ibge, c.data_nascimento, c.observacoes, c.ativo, c.aceita_marketing, c.aceita_marketing_em,
       c.como_conheceu, c.tags, c.criado_por, c.criado_em, c.atualizado_em,
       case when privado.pode('clientes.ver_valores') then
         (coalesce(sum(v.total_centavos) filter (where v.status in ('concluida','devolvida')), 0)
          - coalesce((select sum(d.valor_centavos) from public.devolucoes d join public.vendas v2 on v2.id = d.venda_id where v2.cliente_id = c.id), 0))::bigint
       end as total_centavos,
       count(v.id) filter (where v.status in ('concluida','devolvida')) as qtd_compras,
       max(v.data) filter (where v.status in ('concluida','devolvida')) as ultima_compra,
       extract(month from c.data_nascimento)::int as mes_aniversario,
       (select nome from public.perfis where user_id = c.criado_por) as cadastrado_por
from public.clientes c
left join public.vendas v on v.cliente_id = c.id
group by c.id;
revoke all on public.clientes_lista from anon;
grant select on public.clientes_lista to authenticated;

-- Parâmetros
alter table public.empresa
  add column if not exists reserva_dias_padrao int not null default 7 check (reserva_dias_padrao between 1 and 90),
  add column if not exists orcamento_validade_dias int not null default 7 check (orcamento_validade_dias between 1 and 90),
  add column if not exists texto_termo_compra text default
    'Declaro, sob as penas da lei, que sou o legítimo proprietário do aparelho descrito acima, que ele não é produto de furto, roubo ou qualquer ato ilícito, que não possui bloqueio de operadora ou conta (iCloud/Google) e que o entrego livre de ônus, pelo valor acordado.';

-- Permissões novas
insert into public.permissoes_catalogo (chave, modulo, descricao, ordem) values
  ('vendas.troca',      'Vendas',    'Aceitar aparelho do cliente como parte do pagamento (troca)', 28),
  ('vendas.reservar',   'Vendas',    'Reservar aparelho com sinal', 29),
  ('vendas.orcamento',  'Vendas',    'Fazer orçamentos', 19),
  ('aparelhos.comprar', 'Aparelhos', 'Comprar aparelho de cliente (sem venda junto)', 37)
on conflict (chave) do update set modulo = excluded.modulo, descricao = excluded.descricao, ordem = excluded.ordem;
insert into public.permissoes_cargo (cargo, permissao, permitido) values
  ('vendedor', 'vendas.troca', true), ('vendedor', 'vendas.reservar', true), ('vendedor', 'vendas.orcamento', true), ('vendedor', 'aparelhos.comprar', false),
  ('tecnico', 'vendas.troca', false), ('tecnico', 'vendas.reservar', false), ('tecnico', 'vendas.orcamento', false), ('tecnico', 'aparelhos.comprar', false)
on conflict (cargo, permissao) do nothing;

-- Formas internas: aparelho na troca e sinal de reserva (não geram conta a receber)
alter table public.formas_pagamento add column if not exists interna boolean not null default false;
alter table public.formas_pagamento drop constraint if exists formas_pagamento_forma_check;
alter table public.formas_pagamento add constraint formas_pagamento_forma_check
  check (forma in ('dinheiro','pix','debito','credito','boleto','crediario','outro','troca','sinal'));
insert into public.formas_pagamento (forma, nome, ativo, conta_id, taxa_pct, dias_repasse, baixa_automatica, interna, ordem) values
  ('troca', 'Aparelho na troca', true, null, 0, 0, false, true, 90),
  ('sinal', 'Sinal da reserva', true, null, 0, 0, false, true, 91)
on conflict (forma) do update set interna = true;

insert into public.categorias (tipo, nome, ordem, sistema) values ('receita', 'Sinal de reserva', 5, 'sinal')
on conflict do nothing;

-- Avaliações: aparelho recebido na troca ou comprado de cliente
create table if not exists public.avaliacoes (
  id                   uuid primary key default gen_random_uuid(),
  numero               bigint generated always as identity unique,
  tipo                 text not null check (tipo in ('troca','compra')),
  cliente_id           uuid not null references public.clientes(id),
  serie_id             uuid references nucleo.produto_series(id),
  produto_id           uuid not null references nucleo.produtos(id),
  imei                 text not null,
  valor_centavos       bigint not null check (valor_centavos > 0),
  detalhes             jsonb not null default '{}'::jsonb,
  documento            text,
  venda_id             uuid references public.vendas(id),
  titulo_id            uuid references public.titulos(id),
  observacao           text,
  status               text not null default 'ativa' check (status in ('ativa','cancelada')),
  motivo_cancelamento  text,
  cancelada_em         timestamptz,
  criado_por           uuid default auth.uid() references public.perfis(user_id),
  criado_em            timestamptz not null default now()
);
create index if not exists avaliacoes_venda_idx on public.avaliacoes (venda_id);
create index if not exists avaliacoes_cliente_idx on public.avaliacoes (cliente_id);

-- Reservas com sinal
create table if not exists public.reservas (
  id                   uuid primary key default gen_random_uuid(),
  numero               bigint generated always as identity unique,
  cliente_id           uuid not null references public.clientes(id),
  serie_id             uuid not null references nucleo.produto_series(id),
  valor_sinal_centavos bigint not null check (valor_sinal_centavos > 0),
  forma                text not null references public.formas_pagamento(forma),
  validade             date not null,
  status               text not null default 'ativa' check (status in ('ativa','convertida','cancelada')),
  sinal_devolvido      boolean not null default false,
  venda_id             uuid references public.vendas(id),
  observacao           text,
  motivo_cancelamento  text,
  cancelada_em         timestamptz,
  criado_por           uuid default auth.uid() references public.perfis(user_id),
  criado_em            timestamptz not null default now()
);
create unique index if not exists reservas_serie_ativa_uk on public.reservas (serie_id) where status = 'ativa';
alter table public.titulos add column if not exists reserva_id uuid references public.reservas(id);

-- Orçamentos
create table if not exists public.orcamentos (
  id                uuid primary key default gen_random_uuid(),
  numero            bigint generated always as identity unique,
  cliente_id        uuid references public.clientes(id),
  cliente_nome      text,
  cliente_telefone  text check (cliente_telefone is null or cliente_telefone ~ '^[0-9]{10,11}$'),
  itens             jsonb not null check (jsonb_typeof(itens) = 'array' and jsonb_array_length(itens) > 0),
  subtotal_centavos bigint not null check (subtotal_centavos >= 0),
  desconto_centavos bigint not null default 0 check (desconto_centavos >= 0),
  total_centavos    bigint not null check (total_centavos >= 0),
  validade          date not null,
  condicoes         text,
  observacao        text,
  status            text not null default 'aberto' check (status in ('aberto','convertido','cancelado')),
  venda_id          uuid references public.vendas(id),
  motivo_cancelamento text,
  criado_por        uuid default auth.uid() references public.perfis(user_id),
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

alter table public.avaliacoes enable row level security;
alter table public.reservas   enable row level security;
alter table public.orcamentos enable row level security;
create policy avaliacoes_ler on public.avaliacoes for select to authenticated using (
  (select privado.pode('aparelhos.comprar')) or (select privado.pode('estoque.ver_custo')) or criado_por = (select auth.uid()));
create policy reservas_ler on public.reservas for select to authenticated using (
  (select privado.pode('vendas.reservar')) or (select privado.pode('vendas.ver_todas')) or (select privado.ve_catalogo()));
create policy orcamentos_ler on public.orcamentos for select to authenticated using (
  (select privado.pode('vendas.ver_todas')) or criado_por = (select auth.uid()) or (select privado.pode('vendas.orcamento')));
revoke all on public.avaliacoes, public.reservas, public.orcamentos from anon;
revoke insert, update, delete, truncate on public.avaliacoes, public.reservas, public.orcamentos from authenticated;
grant select on public.avaliacoes, public.reservas, public.orcamentos to authenticated;

create or replace trigger trg_avaliacoes_auditoria after insert or update on public.avaliacoes for each row execute function public.fn_auditar();
create or replace trigger trg_reservas_auditoria after insert or update on public.reservas for each row execute function public.fn_auditar();
create or replace trigger trg_orcamentos_auditoria after insert or update on public.orcamentos for each row execute function public.fn_auditar();
create or replace trigger trg_orcamentos_atualizado before update on public.orcamentos for each row execute function public.fn_atualizado_em();

create or replace view public.reservas_lista with (security_invoker = true) as
select r.*, c.nome as cliente_nome, c.telefone as cliente_telefone, a.produto, a.imei, a.cor, a.capacidade, a.grau, a.preco_venda_centavos,
       fp.nome as forma_nome, pf.nome as vendedor_nome,
       (r.validade < (now() at time zone 'America/Sao_Paulo')::date and r.status = 'ativa') as vencida,
       v.numero as venda_numero
from public.reservas r
join public.clientes c on c.id = r.cliente_id
join public.aparelhos a on a.id = r.serie_id
left join public.formas_pagamento fp on fp.forma = r.forma
left join public.perfis pf on pf.user_id = r.criado_por
left join public.vendas v on v.id = r.venda_id;

create or replace view public.orcamentos_lista with (security_invoker = true) as
select o.*, coalesce(c.nome, o.cliente_nome) as nome_cliente, coalesce(c.telefone, o.cliente_telefone) as telefone_cliente,
       pf.nome as vendedor_nome, v.numero as venda_numero,
       (o.validade < (now() at time zone 'America/Sao_Paulo')::date and o.status = 'aberto') as vencido
from public.orcamentos o
left join public.clientes c on c.id = o.cliente_id
left join public.perfis pf on pf.user_id = o.criado_por
left join public.vendas v on v.id = o.venda_id;

create or replace view public.avaliacoes_lista with (security_invoker = true) as
select a.*, c.nome as cliente_nome, c.cpf as cliente_cpf, c.cnpj as cliente_cnpj, c.telefone as cliente_telefone,
       p.nome as produto, s.status as aparelho_status, v.numero as venda_numero, pf.nome as usuario
from public.avaliacoes a
join public.clientes c on c.id = a.cliente_id
join nucleo.produtos p on p.id = a.produto_id
left join nucleo.produto_series s on s.id = a.serie_id
left join public.vendas v on v.id = a.venda_id
left join public.perfis pf on pf.user_id = a.criado_por;

revoke all on public.reservas_lista, public.orcamentos_lista, public.avaliacoes_lista from anon;
grant select on public.reservas_lista, public.orcamentos_lista, public.avaliacoes_lista to authenticated;
