-- =====================================================================
-- Etapa 8 — Fiscal: regras de tributação, dados fiscais de produtos e
-- categorias, notas fiscais (NFC-e, NF-e, NFS-e) e pacote do contador.
-- O envio automático para a SEFAZ/prefeitura depende do emissor que a loja
-- contratar; até lá o sistema prepara a nota, confere o que falta e
-- registra a nota emitida no emissor.
-- =====================================================================

insert into public.permissoes_catalogo (chave, modulo, descricao, ordem) values
  ('fiscal.notas',  'Fiscal', 'Preparar e registrar notas fiscais das vendas e OS', 110),
  ('fiscal.config', 'Fiscal', 'Configurar regras fiscais, NCM e baixar o pacote do contador', 111)
on conflict (chave) do update set modulo = excluded.modulo, descricao = excluded.descricao, ordem = excluded.ordem;
insert into public.permissoes_cargo (cargo, permissao, permitido) values
  ('vendedor', 'fiscal.notas', false), ('tecnico', 'fiscal.notas', false),
  ('vendedor', 'fiscal.config', false), ('tecnico', 'fiscal.config', false)
on conflict (cargo, permissao) do nothing;

alter table public.empresa
  add column if not exists fiscal_ambiente text not null default 'homologacao' check (fiscal_ambiente in ('homologacao','producao')),
  add column if not exists fiscal_emissor text not null default 'nenhum',
  add column if not exists nfce_serie int not null default 1 check (nfce_serie between 0 and 999),
  add column if not exists nfe_serie int not null default 1 check (nfe_serie between 0 and 999),
  add column if not exists cnae text,
  add column if not exists certificado_validade date,
  add column if not exists fiscal_obs_padrao text;

-- Regras de tributação (o contador confere e ajusta)
create table if not exists public.regras_fiscais (
  id                  uuid primary key default gen_random_uuid(),
  nome                text not null check (length(trim(nome)) >= 2),
  tipo                text not null default 'produto' check (tipo in ('produto','servico')),
  cfop_interno        text check (cfop_interno is null or cfop_interno ~ '^[0-9]{4}$'),
  cfop_interestadual  text check (cfop_interestadual is null or cfop_interestadual ~ '^[0-9]{4}$'),
  csosn               text check (csosn is null or csosn ~ '^[0-9]{3}$'),
  cst_icms            text check (cst_icms is null or cst_icms ~ '^[0-9]{2}$'),
  aliquota_icms       numeric(5,2) check (aliquota_icms is null or aliquota_icms between 0 and 100),
  cst_pis_cofins      text check (cst_pis_cofins is null or cst_pis_cofins ~ '^[0-9]{2}$'),
  codigo_servico      text,
  aliquota_iss        numeric(5,2) check (aliquota_iss is null or aliquota_iss between 0 and 100),
  iss_retido          boolean not null default false,
  padrao              boolean not null default false,
  ativo               boolean not null default true,
  observacao          text,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);
create unique index if not exists regras_fiscais_padrao_uk on public.regras_fiscais (tipo) where padrao and ativo;
insert into public.regras_fiscais (nome, tipo, cfop_interno, cfop_interestadual, csosn, cst_pis_cofins, padrao, observacao)
select 'Revenda de mercadoria (Simples Nacional)', 'produto', '5102', '6102', '102', '49', true,
       'Padrão para loja no Simples Nacional sem ICMS-ST. Conferir com o contador.'
where not exists (select 1 from public.regras_fiscais);
insert into public.regras_fiscais (nome, tipo, cfop_interno, cfop_interestadual, csosn, cst_pis_cofins, observacao)
select 'Mercadoria com ICMS-ST (ex.: celulares, carregadores)', 'produto', '5405', '6404', '500', '49',
       'Produtos com substituição tributária: o ICMS já foi recolhido antes. Conferir a lista com o contador.'
where not exists (select 1 from public.regras_fiscais where csosn = '500');
insert into public.regras_fiscais (nome, tipo, codigo_servico, padrao, observacao)
select 'Assistência técnica (conserto de aparelhos)', 'servico', '14.01', true,
       'Item 14.01 da LC 116 (conserto e manutenção de aparelhos). Falta a alíquota de ISS do município.'
where not exists (select 1 from public.regras_fiscais where tipo = 'servico');

alter table nucleo.produtos add column if not exists regra_fiscal_id uuid references public.regras_fiscais(id);
alter table public.categorias
  add column if not exists ncm_padrao text check (ncm_padrao is null or ncm_padrao ~ '^[0-9]{8}$'),
  add column if not exists regra_fiscal_id uuid references public.regras_fiscais(id);

-- NCM padrão por tipo de categoria (o contador confere)
update public.categorias set ncm_padrao = case
    when lower(nome) ~ 'celular|iphone|smartphone|aparelho' then '85171300'
    when lower(nome) ~ 'película|pelicula' then '39199090'
    when lower(nome) ~ 'capa|case' then '39269090'
    when lower(nome) ~ 'carregador|fonte' then '85044010'
    when lower(nome) ~ 'fone' then '85183000'
    when lower(nome) ~ 'cabo' then '85444200'
    when lower(nome) ~ 'notebook' then '84713012'
    when lower(nome) ~ 'tablet|ipad' then '84713019'
  end
where tipo = 'venda' and ncm_padrao is null;

-- produtos: expõe a regra fiscal (mantém as colunas existentes)
create or replace view public.produtos with (security_invoker = true) as
select p.id, p.sku, p.codigo_barras, p.nome, p.categoria_id, c.nome as categoria, p.marca, p.modelo, p.condicao, p.tipo,
       p.controla_estoque, p.controla_serie, p.unidade, p.preco_venda_centavos,
       case when privado.pode('estoque.ver_custo') then p.custo_medio_centavos end as custo_medio_centavos,
       p.estoque_atual, p.estoque_minimo, p.garantia_dias, p.ncm, p.cest, p.origem_fiscal, p.observacoes, p.ativo,
       (p.controla_estoque and p.estoque_atual <= p.estoque_minimo) as estoque_baixo, p.criado_em, p.atualizado_em,
       p.regra_fiscal_id
from nucleo.produtos p
left join public.categorias c on c.id = p.categoria_id;

-- Notas fiscais (uma por venda/OS e tipo; cancelada libera para emitir de novo)
create table if not exists public.notas_fiscais (
  id                  uuid primary key default gen_random_uuid(),
  tipo                text not null check (tipo in ('nfce','nfe','nfse')),
  venda_id            uuid references public.vendas(id),
  os_id               uuid references public.ordens_servico(id),
  status              text not null default 'emitida' check (status in ('emitida','cancelada')),
  ambiente            text not null default 'producao',
  numero              bigint not null check (numero > 0),
  serie               text,
  chave               text check (chave is null or chave ~ '^[0-9]{44}$'),
  protocolo           text,
  url                 text,
  valor_centavos      bigint not null check (valor_centavos >= 0),
  dados               jsonb not null default '{}'::jsonb,
  emitida_em          timestamptz not null default now(),
  registrada_por      uuid default auth.uid() references public.perfis(user_id),
  criado_em           timestamptz not null default now(),
  cancelada_em        timestamptz,
  motivo_cancelamento text,
  check ((venda_id is not null) <> (os_id is not null))
);
create unique index if not exists notas_venda_uk on public.notas_fiscais (tipo, venda_id) where status = 'emitida' and venda_id is not null;
create unique index if not exists notas_os_uk on public.notas_fiscais (tipo, os_id) where status = 'emitida' and os_id is not null;
create unique index if not exists notas_numero_uk on public.notas_fiscais (tipo, serie, numero, ambiente) where status = 'emitida';
create index if not exists notas_emitida_idx on public.notas_fiscais (emitida_em);

alter table public.regras_fiscais enable row level security;
alter table public.notas_fiscais  enable row level security;
create policy regras_fiscais_ler on public.regras_fiscais for select to authenticated using ((select privado.tem_acesso()));
create policy regras_fiscais_gerir on public.regras_fiscais for all to authenticated
  using ((select privado.pode('fiscal.config'))) with check ((select privado.pode('fiscal.config')));
create policy notas_ler on public.notas_fiscais for select to authenticated using (
  (select privado.pode('fiscal.notas')) or (select privado.pode('fiscal.config')) or (select privado.pode('financeiro.ver')));
revoke all on public.regras_fiscais, public.notas_fiscais from anon;
revoke insert, update, delete, truncate on public.notas_fiscais from authenticated;
grant select on public.notas_fiscais to authenticated;
grant select, insert, update on public.regras_fiscais to authenticated;
revoke delete on public.regras_fiscais from authenticated;
create or replace trigger trg_regras_fiscais_atualizado before update on public.regras_fiscais for each row execute function public.fn_atualizado_em();
create or replace trigger trg_regras_fiscais_auditoria after insert or update on public.regras_fiscais for each row execute function public.fn_auditar();
create or replace trigger trg_notas_fiscais_auditoria after insert or update on public.notas_fiscais for each row execute function public.fn_auditar();
