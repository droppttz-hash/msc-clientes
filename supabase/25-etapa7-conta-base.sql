-- =====================================================================
-- Etapa 7 — Conta e equipe: horário de funcionamento, textos editáveis,
-- LGPD (exportar / anonimizar cliente) e backup
-- =====================================================================

insert into public.permissoes_catalogo (chave, modulo, descricao, ordem) values
  ('clientes.lgpd', 'Clientes', 'Exportar os dados de um cliente e anonimizar (LGPD)', 16),
  ('backup.baixar', 'Configurações', 'Baixar o backup completo dos dados', 92)
on conflict (chave) do update set modulo = excluded.modulo, descricao = excluded.descricao, ordem = excluded.ordem;
insert into public.permissoes_cargo (cargo, permissao, permitido) values
  ('vendedor', 'clientes.lgpd', false), ('tecnico', 'clientes.lgpd', false),
  ('vendedor', 'backup.baixar', false), ('tecnico', 'backup.baixar', false)
on conflict (cargo, permissao) do nothing;

-- Horário: chave = dia da semana ISO (1 = segunda … 7 = domingo); null = fechado
alter table public.empresa
  add column if not exists horario jsonb not null default
    '{"1":{"abre":"09:00","fecha":"18:00"},"2":{"abre":"09:00","fecha":"18:00"},"3":{"abre":"09:00","fecha":"18:00"},"4":{"abre":"09:00","fecha":"18:00"},"5":{"abre":"09:00","fecha":"18:00"},"6":{"abre":"09:00","fecha":"13:00"},"7":null}'::jsonb,
  add column if not exists feriados date[] not null default '{}',
  add column if not exists restringir_horario boolean not null default false,
  add column if not exists horario_tolerancia_min int not null default 30 check (horario_tolerancia_min between 0 and 240),
  add column if not exists acesso_liberado_ate timestamptz,
  add column if not exists texto_orcamento text,
  add column if not exists texto_reserva text not null default 'O aparelho fica reservado até a data acima. Depois dessa data a loja pode liberar o aparelho para venda.',
  add column if not exists texto_os_garantia text not null default 'Cobre o serviço e as peças trocadas. Não cobre queda, contato com líquido, mau uso ou violação por terceiros.',
  add column if not exists ultimo_backup_em timestamptz;

alter table public.clientes add column if not exists anonimizado_em timestamptz;

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
       (select nome from public.perfis where user_id = c.criado_por) as cadastrado_por,
       c.anonimizado_em
from public.clientes c
left join public.vendas v on v.cliente_id = c.id
group by c.id;

insert into public.mensagens_modelos (codigo, nome, texto, marketing, ordem) values
  ('os_pronta', 'OS pronta para retirada', 'Olá, {nome}! Seu {aparelho} (OS nº {os}) está pronto para retirada na {loja}. Valor: {valor}. Te esperamos!', false, 6),
  ('os_abandono', 'OS sem retirada', 'Olá, {nome}! Seu {aparelho} (OS nº {os}) está na {loja} aguardando retirada há {dias} dias. Por favor, venha buscar. Após {limite} dias o aparelho pode ser considerado abandonado.', false, 7)
on conflict (codigo) do nothing;

-- Registro do que foi feito com os dados de clientes (LGPD) e dos backups
create table if not exists public.lgpd_registros (
  id         uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id),
  tipo       text not null check (tipo in ('exportacao','anonimizacao')),
  motivo     text,
  feito_por  uuid default auth.uid() references public.perfis(user_id),
  feito_em   timestamptz not null default now()
);
create table if not exists public.backups_log (
  id        uuid primary key default gen_random_uuid(),
  tabelas   int not null,
  linhas    bigint not null,
  com_fotos boolean not null default false,
  feito_por uuid default auth.uid() references public.perfis(user_id),
  feito_em  timestamptz not null default now()
);
alter table public.lgpd_registros enable row level security;
alter table public.backups_log    enable row level security;
create policy lgpd_ler on public.lgpd_registros for select to authenticated using ((select privado.pode('clientes.lgpd')));
create policy backups_ler on public.backups_log for select to authenticated using ((select privado.pode('backup.baixar')));
revoke all on public.lgpd_registros, public.backups_log from anon;
revoke insert, update, delete, truncate on public.lgpd_registros, public.backups_log from authenticated;
grant select on public.lgpd_registros, public.backups_log to authenticated;

-- ---------------------------------------------------------------------
-- Horário de funcionamento
-- ---------------------------------------------------------------------
create or replace function privado.dentro_horario(p_quando timestamptz default now())
returns boolean language plpgsql stable security definer set search_path = public as $$
declare e record; t timestamp := p_quando at time zone 'America/Sao_Paulo'; d jsonb; m int;
begin
  select restringir_horario, horario, feriados, horario_tolerancia_min, acesso_liberado_ate into e from public.empresa where id = 1;
  if not found or not e.restringir_horario then return true; end if;
  if e.acesso_liberado_ate is not null and e.acesso_liberado_ate > p_quando then return true; end if;
  if t::date = any (e.feriados) then return false; end if;
  d := e.horario -> extract(isodow from t)::int::text;
  if d is null or jsonb_typeof(d) <> 'object' or coalesce(d->>'abre','') = '' or coalesce(d->>'fecha','') = '' then return false; end if;
  m := extract(hour from t)::int * 60 + extract(minute from t)::int;
  return m between (extract(hour from (d->>'abre')::time)::int * 60 + extract(minute from (d->>'abre')::time)::int - e.horario_tolerancia_min)
               and (extract(hour from (d->>'fecha')::time)::int * 60 + extract(minute from (d->>'fecha')::time)::int + e.horario_tolerancia_min);
end $$;

-- Gerente sempre pode; os outros cargos só dentro do horário (quando a loja ativar a restrição)
create or replace function privado.pode(p_chave text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case when pf.cargo = 'gerente' then true
                when not privado.dentro_horario() then false
                else coalesce((select pc.permitido from public.permissoes_cargo pc
                               where pc.cargo = pf.cargo and pc.permissao = p_chave), false) end
    from public.perfis pf where pf.user_id = auth.uid() and pf.ativo
  ), false)
$$;

grant execute on function privado.dentro_horario(timestamptz) to authenticated;
