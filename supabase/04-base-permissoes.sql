-- =====================================================================
-- MSC — Onda 1 / parte 1: empresa (tema), permissões por ação, fornecedores
-- =====================================================================

-- ---------------------------------------------------------------------
-- EMPRESA (uma linha só) — dados da loja, aparência e parâmetros
-- Para replicar o sistema para outro cliente: editar esta linha na tela
-- Configurações › Empresa. Nada de nome/cor fica preso no código.
-- ---------------------------------------------------------------------
create table if not exists public.empresa (
  id                         smallint primary key default 1 check (id = 1),
  nome_fantasia              text not null default 'Minha Empresa',
  razao_social               text,
  cnpj                       text check (cnpj is null or cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$'),
  ie                         text,
  im                         text,
  regime_tributario          text check (regime_tributario is null or regime_tributario in ('mei','simples','presumido','real')),
  telefone                   text,
  whatsapp                   text,
  email                      text,
  instagram                  text,
  site                       text,
  cep                        text,
  logradouro                 text,
  numero                     text,
  complemento                text,
  bairro                     text,
  cidade                     text,
  uf                         text,
  logo                       text,           -- imagem pequena em data URL (PNG/WebP até ~300 KB)
  cor_primaria               text not null default '#1d4ed8' check (cor_primaria ~ '^#[0-9a-fA-F]{6}$'),
  cor_sidebar                text not null default '#ffffff' check (cor_sidebar ~ '^#[0-9a-fA-F]{6}$'),
  modo_tema                  text not null default 'auto' check (modo_tema in ('claro','escuro','auto')),
  permitir_estoque_negativo  boolean not null default false,
  desconto_max_pct           numeric(5,2) not null default 10 check (desconto_max_pct between 0 and 100),
  garantia_padrao_dias       int not null default 90 check (garantia_padrao_dias between 0 and 3650),
  texto_recibo               text,
  texto_garantia             text,
  dias_alerta_sem_compra     int not null default 90,
  atualizado_em              timestamptz not null default now()
);
insert into public.empresa (id, nome_fantasia, razao_social, telefone, whatsapp, cep, logradouro, numero, bairro, cidade, uf,
                            texto_recibo, texto_garantia)
values (1, 'MSC Assistência Técnica', 'Marcelo da Silva Cortes Tecnologia', '21981209833', '21981209833',
        '26445010', 'Praça Olavo Bilac', '12', 'Engenheiro Pedreira', 'Japeri', 'RJ',
        'Obrigado pela preferência! Trocas somente com este recibo.',
        'A garantia cobre defeitos de funcionamento. Não cobre quedas, contato com líquidos, tela quebrada, mau uso ou violação do lacre.')
on conflict (id) do nothing;
alter table public.empresa enable row level security;

drop trigger if exists trg_empresa_atualizado on public.empresa;
create trigger trg_empresa_atualizado before update on public.empresa
  for each row execute function public.fn_atualizado_em();

-- ---------------------------------------------------------------------
-- CARGOS: agora também Técnico
-- ---------------------------------------------------------------------
alter table public.perfis drop constraint if exists perfis_cargo_check;
alter table public.perfis add constraint perfis_cargo_check check (cargo in ('gerente','vendedor','tecnico'));
alter table public.perfis add column if not exists telefone text;
alter table public.perfis add column if not exists meta_mensal_centavos bigint check (meta_mensal_centavos is null or meta_mensal_centavos >= 0);

-- ---------------------------------------------------------------------
-- PERMISSÕES POR AÇÃO (RBAC). Gerente sempre pode tudo.
-- ---------------------------------------------------------------------
create table if not exists public.permissoes_catalogo (
  chave      text primary key,
  modulo     text not null,
  descricao  text not null,
  ordem      int not null default 100
);
create table if not exists public.permissoes_cargo (
  cargo      text not null check (cargo in ('vendedor','tecnico')),
  permissao  text not null references public.permissoes_catalogo(chave) on delete cascade,
  permitido  boolean not null default false,
  primary key (cargo, permissao)
);
alter table public.permissoes_catalogo enable row level security;
alter table public.permissoes_cargo    enable row level security;

insert into public.permissoes_catalogo (chave, modulo, descricao, ordem) values
  ('clientes.ver',            'Clientes',      'Ver e buscar clientes', 10),
  ('clientes.criar',          'Clientes',      'Cadastrar clientes', 11),
  ('clientes.editar',         'Clientes',      'Editar dados de clientes', 12),
  ('clientes.inativar',       'Clientes',      'Inativar / reativar clientes', 13),
  ('clientes.ver_valores',    'Clientes',      'Ver total gasto e ticket médio dos clientes', 14),
  ('clientes.exportar',       'Clientes',      'Exportar planilha de clientes', 15),
  ('vendas.criar',            'Vendas',        'Fazer vendas', 20),
  ('vendas.ver_todas',        'Vendas',        'Ver todas as vendas (lista e relatórios)', 21),
  ('vendas.cancelar_proprias','Vendas',        'Cancelar / editar as próprias vendas no mesmo dia', 22),
  ('vendas.cancelar_todas',   'Vendas',        'Cancelar qualquer venda', 23),
  ('vendas.devolver',         'Vendas',        'Registrar devolução / troca', 24),
  ('vendas.desconto_livre',   'Vendas',        'Dar desconto acima do limite sem aprovação', 25),
  ('vendas.aprovar',          'Vendas',        'Aprovar vendas com desconto acima do limite', 26),
  ('vendas.ver_lucro',        'Vendas',        'Ver custo e lucro das vendas', 27),
  ('estoque.ver',             'Estoque',       'Consultar produtos e estoque', 30),
  ('estoque.ver_custo',       'Estoque',       'Ver custo dos produtos', 31),
  ('estoque.produtos',        'Estoque',       'Cadastrar e editar produtos e preços', 32),
  ('estoque.entrada',         'Estoque',       'Dar entrada de mercadoria (compras)', 33),
  ('estoque.ajustar',         'Estoque',       'Ajustar estoque, perdas e inventário', 34),
  ('estoque.importar',        'Estoque',       'Importar planilha de produtos', 35),
  ('financeiro.ver',          'Finanças',      'Ver contas a pagar/receber e saldos', 40),
  ('financeiro.lancar',       'Finanças',      'Lançar contas a pagar/receber e despesas fixas', 41),
  ('financeiro.baixar',       'Finanças',      'Dar baixa (pagar/receber) e estornar', 42),
  ('financeiro.caixa',        'Finanças',      'Abrir/fechar o caixa, sangria e suprimento', 43),
  ('financeiro.relatorios',   'Finanças',      'Ver fluxo de caixa e DRE', 44),
  ('os.ver',                  'Ordens de serviço', 'Ver ordens de serviço', 50),
  ('os.criar',                'Ordens de serviço', 'Abrir ordens de serviço', 51),
  ('os.editar',               'Ordens de serviço', 'Diagnóstico, orçamento e mudança de status', 52),
  ('os.entregar',             'Ordens de serviço', 'Entregar OS e receber pagamento', 53),
  ('os.ver_senha',            'Ordens de serviço', 'Ver senha / padrão do aparelho', 54),
  ('crm.usar',                'CRM',           'Usar o funil de interessados', 60),
  ('crm.ver_todos',           'CRM',           'Ver interessados de todos os vendedores', 61),
  ('painel.ver_valores',      'Início',        'Ver faturamento e valores no Início', 70),
  ('config.gerenciar',        'Configurações', 'Empresa, usuários, permissões, categorias e formas de pagamento', 80),
  ('auditoria.ver',           'Configurações', 'Ver histórico de alterações', 81)
on conflict (chave) do update set modulo = excluded.modulo, descricao = excluded.descricao, ordem = excluded.ordem;

-- Padrão: o que cada cargo pode (o gerente muda na tela Configurações › Permissões)
insert into public.permissoes_cargo (cargo, permissao, permitido)
select c.cargo, p.chave,
  case c.cargo
    when 'vendedor' then p.chave in ('clientes.ver','clientes.criar','clientes.editar','vendas.criar','vendas.cancelar_proprias',
                                     'estoque.ver','financeiro.caixa','os.ver','os.criar','os.entregar','crm.usar')
    when 'tecnico'  then p.chave in ('clientes.ver','clientes.criar','clientes.editar','estoque.ver',
                                     'os.ver','os.criar','os.editar','os.entregar','os.ver_senha')
  end
from public.permissoes_catalogo p cross join (values ('vendedor'),('tecnico')) c(cargo)
on conflict (cargo, permissao) do nothing;

create or replace function privado.pode(p_chave text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case when pf.cargo = 'gerente' then true
                else coalesce((select pc.permitido from public.permissoes_cargo pc
                               where pc.cargo = pf.cargo and pc.permissao = p_chave), false) end
    from public.perfis pf where pf.user_id = auth.uid() and pf.ativo
  ), false)
$$;

-- Lista das permissões de quem está logado (o site usa para montar o menu)
create or replace function public.minhas_permissoes()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(c.chave order by c.ordem), '{}')
  from public.permissoes_catalogo c
  where privado.pode(c.chave)
$$;

-- ---------------------------------------------------------------------
-- FORNECEDORES
-- ---------------------------------------------------------------------
create table if not exists public.fornecedores (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null check (length(trim(nome)) >= 2),
  documento      text check (documento is null or documento ~ '^[0-9A-Z]{11,14}$'),
  telefone       text check (telefone is null or telefone ~ '^[0-9]{10,11}$'),
  email          text,
  contato        text,
  observacoes    text,
  ativo          boolean not null default true,
  criado_por     uuid default auth.uid() references public.perfis(user_id),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index if not exists fornecedores_nome_idx on public.fornecedores (lower(nome));
alter table public.fornecedores enable row level security;
drop trigger if exists trg_fornecedores_atualizado on public.fornecedores;
create trigger trg_fornecedores_atualizado before update on public.fornecedores
  for each row execute function public.fn_atualizado_em();

-- Clientes: consentimento de marketing (LGPD) e CPF opcional
alter table public.clientes add column if not exists aceita_marketing boolean not null default false;
alter table public.clientes add column if not exists aceita_marketing_em timestamptz;
alter table public.clientes add column if not exists cpf text check (cpf is null or cpf ~ '^[0-9]{11}$');
create index if not exists clientes_cpf_idx on public.clientes (cpf);

-- ---------------------------------------------------------------------
-- Auditoria genérica para tabelas sem coluna "id" uuid
-- ---------------------------------------------------------------------
alter table public.auditoria alter column registro_id drop not null;
alter table public.auditoria add column if not exists registro_texto text;

create or replace function public.fn_auditar_generico()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  v_id := coalesce(to_jsonb(new)->>'id', to_jsonb(new)->>'user_id', to_jsonb(new)->>'chave');
  insert into public.auditoria (tabela, registro_id, registro_texto, acao, antes, depois, usuario_id)
  values (tg_table_name,
          case when v_id ~ '^[0-9a-f-]{36}$' then v_id::uuid end,
          v_id, tg_op,
          case when tg_op = 'UPDATE' then to_jsonb(old) end,
          to_jsonb(new), auth.uid());
  return new;
end $$;

drop trigger if exists trg_empresa_auditoria on public.empresa;
create trigger trg_empresa_auditoria after update on public.empresa
  for each row execute function public.fn_auditar_generico();
drop trigger if exists trg_permissoes_auditoria on public.permissoes_cargo;
create trigger trg_permissoes_auditoria after insert or update on public.permissoes_cargo
  for each row execute function public.fn_auditar_generico();
drop trigger if exists trg_fornecedores_auditoria on public.fornecedores;
create trigger trg_fornecedores_auditoria after insert or update on public.fornecedores
  for each row execute function public.fn_auditar();
