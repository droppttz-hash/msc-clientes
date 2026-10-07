-- =====================================================================
-- Etapa 4 — Assistência técnica (ordens de serviço): tabelas e views
-- =====================================================================

-- Parâmetros da loja
alter table public.empresa
  add column if not exists garantia_os_dias int not null default 90 check (garantia_os_dias between 0 and 3650),
  add column if not exists dias_abandono_os int not null default 90 check (dias_abandono_os between 7 and 3650),
  add column if not exists checklist_os jsonb not null default
    '["Liga normalmente","Tela / touch","Câmeras","Áudio e microfone","Carregamento","Botões","Face ID / biometria","Wi-Fi / sinal","Sinais de líquido / oxidação","Tampa e carcaça"]'::jsonb,
  add column if not exists texto_os_entrada text default
    'O orçamento é feito sem compromisso e o serviço só é executado após aprovação do cliente. A loja não se responsabiliza por dados do aparelho: faça backup. Aparelho com sinais de líquido pode apresentar outros defeitos durante o reparo. Aparelho não retirado em até 90 dias após o aviso de pronto poderá ser considerado abandonado, conforme a lei.';

-- Permissão nova: cancelar OS e marcar como abandonada
insert into public.permissoes_catalogo (chave, modulo, descricao, ordem) values
  ('os.cancelar', 'Ordens de serviço', 'Cancelar OS e marcar aparelho abandonado', 55)
on conflict (chave) do update set modulo = excluded.modulo, descricao = excluded.descricao, ordem = excluded.ordem;
insert into public.permissoes_cargo (cargo, permissao, permitido) values
  ('vendedor', 'os.cancelar', false), ('tecnico', 'os.cancelar', false)
on conflict (cargo, permissao) do nothing;

-- Categoria da receita de assistência
insert into public.categorias (tipo, nome, ordem, sistema) values ('receita', 'Assistência técnica', 4, 'assistencia')
on conflict do nothing;

-- Ordem de serviço
create table if not exists public.ordens_servico (
  id                   uuid primary key default gen_random_uuid(),
  numero               bigint generated always as identity unique,
  interna              boolean not null default false,
  cliente_id           uuid references public.clientes(id),
  serie_id             uuid references nucleo.produto_series(id),
  produto_id           uuid references nucleo.produtos(id),
  aparelho             text not null check (length(trim(aparelho)) >= 2),
  imei                 text,
  cor                  text,
  defeito              text not null check (length(trim(defeito)) >= 3),
  acessorios           text,
  estado_entrada       text,
  checklist            jsonb not null default '{}'::jsonb,
  tecnico_id           uuid references public.perfis(user_id),
  prioridade           text not null default 'normal' check (prioridade in ('normal','urgente')),
  previsao             date,
  status               text not null default 'aberta' check (status in ('aberta','diagnostico','aguardando_aprovacao','aprovada',
                         'em_execucao','aguardando_peca','pronta','entregue','reprovada','cancelada','abandonada')),
  diagnostico          text,
  desconto_centavos    bigint not null default 0 check (desconto_centavos >= 0),
  total_centavos       bigint not null default 0 check (total_centavos >= 0),
  taxa_diagnostico_centavos bigint not null default 0 check (taxa_diagnostico_centavos >= 0),
  orcamento_enviado_em timestamptz,
  aprovado             boolean,
  aprovacao_em         timestamptz,
  aprovacao_meio       text check (aprovacao_meio is null or aprovacao_meio in ('presencial','whatsapp','telefone','outro')),
  aprovacao_nome       text,
  aprovacao_obs        text,
  aprovacao_por        uuid references public.perfis(user_id),
  valor_aprovado_centavos bigint,
  pronta_em            timestamptz,
  entregue_em          timestamptz,
  entregue_por         uuid references public.perfis(user_id),
  garantia_dias        int check (garantia_dias is null or garantia_dias between 0 and 3650),
  garantia_ate         date,
  os_origem_id         uuid references public.ordens_servico(id),
  retorno_garantia     boolean not null default false,
  abandonada_em        timestamptz,
  cancelada_em         timestamptz,
  motivo_cancelamento  text,
  observacao           text,
  criado_por           uuid default auth.uid() references public.perfis(user_id),
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now(),
  check (interna or cliente_id is not null),
  check (not interna or serie_id is not null)
);
create index if not exists os_status_idx on public.ordens_servico (status);
create index if not exists os_cliente_idx on public.ordens_servico (cliente_id);
create index if not exists os_tecnico_idx on public.ordens_servico (tecnico_id, status);
create index if not exists os_imei_idx on public.ordens_servico (upper(imei));

-- Itens do orçamento (peças do estoque e serviços); custo fica escondido
create table if not exists nucleo.os_itens (
  id                      uuid primary key default gen_random_uuid(),
  os_id                   uuid not null references public.ordens_servico(id),
  tipo                    text not null check (tipo in ('peca','servico')),
  produto_id              uuid references nucleo.produtos(id),
  descricao               text not null check (length(trim(descricao)) >= 2),
  quantidade              numeric(15,3) not null default 1 check (quantidade > 0),
  preco_unitario_centavos bigint not null check (preco_unitario_centavos >= 0),
  custo_unitario_centavos bigint not null default 0 check (custo_unitario_centavos >= 0),
  aplicado                boolean not null default false,
  aplicado_em             timestamptz,
  removido                boolean not null default false,
  criado_por              uuid default auth.uid() references public.perfis(user_id),
  criado_em               timestamptz not null default now()
);
create index if not exists os_itens_os_idx on nucleo.os_itens (os_id);

-- Fotos da entrada e do reparo
create table if not exists nucleo.os_fotos (
  id          uuid primary key default gen_random_uuid(),
  os_id       uuid not null references public.ordens_servico(id),
  imagem      text not null check (imagem like 'data:image/%' and length(imagem) <= 700000),
  legenda     text,
  removida    boolean not null default false,
  criado_por  uuid default auth.uid() references public.perfis(user_id),
  criado_em   timestamptz not null default now()
);
create index if not exists os_fotos_os_idx on nucleo.os_fotos (os_id) where not removida;

-- Linha do tempo
create table if not exists nucleo.os_eventos (
  id          bigint generated always as identity primary key,
  os_id       uuid not null references public.ordens_servico(id),
  tipo        text not null,
  descricao   text not null,
  criado_por  uuid default auth.uid(),
  criado_em   timestamptz not null default now()
);
create index if not exists os_eventos_os_idx on nucleo.os_eventos (os_id, id);

-- Senha / padrão do aparelho: ninguém lê direto, só pela função (que registra quem viu); apagada na entrega
create table if not exists nucleo.os_senhas (
  os_id       uuid primary key references public.ordens_servico(id),
  tipo        text not null check (tipo in ('senha','padrao')),
  valor       text,
  apagada_em  timestamptz
);

-- Pagamentos recebidos na entrega
create table if not exists public.os_pagamentos (
  id                  uuid primary key default gen_random_uuid(),
  os_id               uuid not null references public.ordens_servico(id),
  forma               text not null references public.formas_pagamento(forma),
  valor_centavos      bigint not null check (valor_centavos > 0),
  parcelas            smallint not null default 1 check (parcelas between 1 and 24),
  taxa_centavos       bigint not null default 0 check (taxa_centavos >= 0),
  primeiro_vencimento date
);
create index if not exists os_pag_os_idx on public.os_pagamentos (os_id);

alter table public.ordens_servico enable row level security;
alter table public.os_pagamentos  enable row level security;
alter table nucleo.os_itens       enable row level security;
alter table nucleo.os_fotos       enable row level security;
alter table nucleo.os_eventos     enable row level security;
alter table nucleo.os_senhas      enable row level security;
create policy os_ler          on public.ordens_servico for select to authenticated using ((select privado.pode('os.ver')));
create policy os_pag_ler      on public.os_pagamentos  for select to authenticated using ((select privado.pode('os.ver')));
create policy os_itens_ler    on nucleo.os_itens       for select to authenticated using ((select privado.pode('os.ver')));
create policy os_fotos_ler    on nucleo.os_fotos       for select to authenticated using ((select privado.pode('os.ver')));
create policy os_eventos_ler  on nucleo.os_eventos     for select to authenticated using ((select privado.pode('os.ver')));
revoke all on public.ordens_servico, public.os_pagamentos from anon;
revoke insert, update, delete, truncate on public.ordens_servico, public.os_pagamentos from authenticated;
grant select on public.ordens_servico, public.os_pagamentos to authenticated;
grant select on nucleo.os_itens, nucleo.os_fotos, nucleo.os_eventos to authenticated;
revoke all on nucleo.os_senhas from anon, authenticated;

create or replace trigger trg_os_auditoria after insert or update on public.ordens_servico for each row execute function public.fn_auditar();
create or replace trigger trg_os_atualizado before update on public.ordens_servico for each row execute function public.fn_atualizado_em();
create or replace trigger trg_os_eventos_imutavel before update or delete on nucleo.os_eventos for each row execute function public.fn_bloquear_alteracao();

-- Só diz se existe senha guardada (sem revelar)
create or replace function privado.os_tem_senha(p_os uuid)
returns boolean language sql stable security definer set search_path = nucleo, public as $$
  select exists (select 1 from nucleo.os_senhas s where s.os_id = p_os and s.valor is not null)
$$;
grant execute on function privado.os_tem_senha(uuid) to authenticated;

-- Views
create or replace view public.os_lista with (security_invoker = true) as
select o.*, c.nome as cliente_nome, c.telefone as cliente_telefone, c.cpf as cliente_cpf, c.cnpj as cliente_cnpj,
       t.nome as tecnico_nome, pf.nome as atendente_nome,
       (o.previsao < (now() at time zone 'America/Sao_Paulo')::date and o.status in ('aberta','diagnostico','aguardando_aprovacao','aprovada','em_execucao','aguardando_peca')) as atrasada,
       case when o.status in ('pronta','reprovada') then
         ((now() at time zone 'America/Sao_Paulo')::date - (coalesce(o.pronta_em, o.aprovacao_em, o.criado_em) at time zone 'America/Sao_Paulo')::date) end as dias_aguardando_retirada,
       (o.status in ('pronta','reprovada') and coalesce(o.pronta_em, o.aprovacao_em, o.criado_em)
          < now() - make_interval(days => (select dias_abandono_os from public.empresa where id = 1))) as pode_abandonar,
       privado.os_tem_senha(o.id) as tem_senha,
       (select count(*) from nucleo.os_fotos f where f.os_id = o.id and not f.removida) as fotos_qtd,
       orig.numero as os_origem_numero
from public.ordens_servico o
left join public.clientes c on c.id = o.cliente_id
left join public.perfis t on t.user_id = o.tecnico_id
left join public.perfis pf on pf.user_id = o.criado_por
left join public.ordens_servico orig on orig.id = o.os_origem_id;

create or replace view public.os_itens with (security_invoker = true) as
select i.id, i.os_id, i.tipo, i.produto_id, p.sku, i.descricao, i.quantidade, i.preco_unitario_centavos,
       round(i.quantidade * i.preco_unitario_centavos)::bigint as total_centavos,
       case when privado.pode('vendas.ver_lucro') or privado.pode('estoque.ver_custo') then
         case when i.aplicado then i.custo_unitario_centavos else p.custo_medio_centavos end end as custo_unitario_centavos,
       p.estoque_atual, i.aplicado, i.aplicado_em, i.criado_em
from nucleo.os_itens i left join nucleo.produtos p on p.id = i.produto_id
where not i.removido;

create or replace view public.os_eventos with (security_invoker = true) as
select e.id, e.os_id, e.tipo, e.descricao, e.criado_em, pf.nome as usuario
from nucleo.os_eventos e left join public.perfis pf on pf.user_id = e.criado_por;

create or replace view public.os_fotos with (security_invoker = true) as
select id, os_id, imagem, legenda, criado_em from nucleo.os_fotos where not removida;

revoke all on public.os_lista, public.os_itens, public.os_eventos, public.os_fotos from anon;
grant select on public.os_lista, public.os_itens, public.os_eventos, public.os_fotos to authenticated;
