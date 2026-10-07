-- =====================================================================
-- Etapa 6 — CRM e WhatsApp: tabelas, views e permissões
-- Funil de interessados, lista de espera de aparelho, modelos de
-- mensagem, registro de contatos e histórico de consentimento (LGPD)
-- =====================================================================

insert into public.permissoes_catalogo (chave, modulo, descricao, ordem) values
  ('crm.campanhas', 'CRM', 'Ver segmentos (aniversário, upgrade, sumidos) e mandar mensagens de oferta', 62),
  ('crm.modelos',   'CRM', 'Editar os modelos de mensagem do WhatsApp', 63)
on conflict (chave) do update set modulo = excluded.modulo, descricao = excluded.descricao, ordem = excluded.ordem;
insert into public.permissoes_cargo (cargo, permissao, permitido) values
  ('vendedor', 'crm.campanhas', true), ('tecnico', 'crm.campanhas', false),
  ('vendedor', 'crm.modelos', false),  ('tecnico', 'crm.modelos', false)
on conflict (cargo, permissao) do nothing;

alter table public.empresa
  add column if not exists crm_meses_upgrade int not null default 12 check (crm_meses_upgrade between 1 and 60),
  add column if not exists crm_dias_recontato int not null default 30 check (crm_dias_recontato between 1 and 365),
  add column if not exists crm_dias_espera int not null default 60 check (crm_dias_espera between 1 and 365),
  add column if not exists texto_optout text not null default 'Se não quiser mais receber mensagens da loja, é só responder SAIR.';

-- ---------------------------------------------------------------------
-- Funil de interessados (leads)
-- ---------------------------------------------------------------------
create table if not exists public.leads (
  id                       uuid primary key default gen_random_uuid(),
  numero                   bigint generated always as identity unique,
  cliente_id               uuid references public.clientes(id),
  nome                     text not null check (length(trim(nome)) >= 2),
  telefone                 text check (telefone is null or telefone ~ '^\d{10,11}$'),
  interesse                text not null check (length(trim(interesse)) >= 2),
  origem                   text,
  etapa                    text not null default 'novo' check (etapa in ('novo','em_contato','proposta','ganho','perdido')),
  valor_estimado_centavos  bigint check (valor_estimado_centavos is null or valor_estimado_centavos >= 0),
  responsavel_id           uuid default auth.uid() references public.perfis(user_id),
  proximo_contato          date,
  motivo_perda             text,
  venda_id                 uuid references public.vendas(id),
  observacao               text,
  fechado_em               timestamptz,
  criado_por               uuid default auth.uid() references public.perfis(user_id),
  criado_em                timestamptz not null default now(),
  atualizado_em            timestamptz not null default now()
);
create index if not exists leads_etapa_idx on public.leads (etapa, proximo_contato);
create index if not exists leads_resp_idx on public.leads (responsavel_id);

create table if not exists public.lead_eventos (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.leads(id),
  tipo       text not null check (tipo in ('criado','nota','whatsapp','ligacao','etapa','edicao')),
  texto      text,
  criado_por uuid default auth.uid() references public.perfis(user_id),
  criado_em  timestamptz not null default now()
);
create index if not exists lead_eventos_lead_idx on public.lead_eventos (lead_id, criado_em);

-- ---------------------------------------------------------------------
-- Lista de espera de aparelho
-- ---------------------------------------------------------------------
create table if not exists public.lista_espera (
  id                  uuid primary key default gen_random_uuid(),
  numero              bigint generated always as identity unique,
  cliente_id          uuid not null references public.clientes(id),
  modelo              text not null check (length(trim(modelo)) >= 2),
  capacidade          text,
  cor                 text,
  condicao            text not null default 'qualquer' check (condicao in ('qualquer','lacrado','seminovo')),
  preco_max_centavos  bigint check (preco_max_centavos is null or preco_max_centavos > 0),
  validade            date not null,
  status              text not null default 'aguardando' check (status in ('aguardando','avisado','atendido','cancelado')),
  avisado_em          timestamptz,
  serie_avisada_id    uuid references nucleo.produto_series(id),
  venda_id            uuid references public.vendas(id),
  observacao          text,
  motivo_cancelamento text,
  criado_por          uuid default auth.uid() references public.perfis(user_id),
  criado_em           timestamptz not null default now()
);
create index if not exists lista_espera_status_idx on public.lista_espera (status);

-- ---------------------------------------------------------------------
-- Modelos de mensagem e registro de contatos
-- ---------------------------------------------------------------------
create table if not exists public.mensagens_modelos (
  codigo        text primary key check (codigo ~ '^[a-z_]{2,30}$'),
  nome          text not null,
  texto         text not null check (length(trim(texto)) >= 5),
  marketing     boolean not null default true,
  ordem         int not null default 100,
  atualizado_em timestamptz not null default now()
);
insert into public.mensagens_modelos (codigo, nome, texto, marketing, ordem) values
  ('aniversario', 'Aniversário', 'Feliz aniversário, {nome}! A equipe da {loja} deseja um novo ano cheio de conquistas. Passa aqui na loja, temos um mimo esperando por você!', true, 1),
  ('upgrade', 'Hora de trocar de aparelho', 'Oi, {nome}! Tudo bem? Aqui é da {loja}. Seu {aparelho} já tem {meses} meses de uso. Que tal ver quanto ele vale na troca por um modelo mais novo? A avaliação é na hora e sem compromisso.', true, 2),
  ('sumido', 'Cliente sumido', 'Oi, {nome}! Aqui é da {loja}. Faz tempo que você não passa por aqui! Chegaram novidades em aparelhos e acessórios. Se precisar de qualquer coisa, é só chamar.', true, 3),
  ('espera', 'Chegou o aparelho da lista de espera', 'Oi, {nome}! Aqui é da {loja}. Chegou o aparelho que você estava esperando: {aparelho} por {preco}. Quer que eu separe para você?', false, 4),
  ('lead', 'Retorno para interessado', 'Oi, {nome}! Aqui é da {loja}. Passando para saber se você ainda tem interesse em {interesse}. Posso te ajudar?', false, 5)
on conflict (codigo) do nothing;

create table if not exists public.crm_contatos (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid references public.clientes(id),
  lead_id     uuid references public.leads(id),
  espera_id   uuid references public.lista_espera(id),
  segmento    text not null check (segmento in ('aniversario','upgrade','sumido','espera','lead','avulso')),
  enviado_por uuid default auth.uid() references public.perfis(user_id),
  enviado_em  timestamptz not null default now()
);
create index if not exists crm_contatos_cli_idx on public.crm_contatos (cliente_id, segmento, enviado_em);

-- Histórico de consentimento (LGPD): quem marcou/desmarcou, quando e como
create table if not exists public.clientes_consentimentos (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null references public.clientes(id),
  aceita        boolean not null,
  meio          text not null default 'cadastro',
  registrado_por uuid default auth.uid() references public.perfis(user_id),
  registrado_em timestamptz not null default now()
);
create index if not exists cli_consent_idx on public.clientes_consentimentos (cliente_id, registrado_em);

create or replace function public.fn_log_consentimento() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT' and new.aceita_marketing)
     or (tg_op = 'UPDATE' and new.aceita_marketing is distinct from old.aceita_marketing) then
    insert into public.clientes_consentimentos (cliente_id, aceita, meio)
    values (new.id, new.aceita_marketing, coalesce(nullif(current_setting('msc.meio_consentimento', true), ''), 'cadastro'));
  end if;
  return new;
end $$;
create or replace trigger trg_clientes_consentimento after insert or update of aceita_marketing on public.clientes
  for each row execute function public.fn_log_consentimento();

-- ---------------------------------------------------------------------
-- Aparelhos em estoque compatíveis com um pedido da lista de espera
-- ---------------------------------------------------------------------
create or replace function privado.espera_series(p_espera uuid)
returns table (serie_id uuid, descricao text, preco_centavos bigint, condicao text, cor text, capacidade text)
language sql stable security definer set search_path = public as $$
  select s.id,
         trim(p.nome || coalesce(' ' || nullif(s.capacidade, ''), '') || coalesce(' ' || nullif(s.cor, ''), '')),
         coalesce(s.preco_venda_centavos, p.preco_venda_centavos)::bigint,
         coalesce(s.condicao, case when p.condicao = 'novo' then 'lacrado' else 'seminovo' end),
         s.cor, s.capacidade
  from public.lista_espera e
  join nucleo.produto_series s on s.status = 'disponivel'
  join public.produtos p on p.id = s.produto_id
  where e.id = p_espera
    and not exists (
      select 1 from regexp_split_to_table(lower(trim(e.modelo)), '\s+') w
      where w <> '' and position(w in lower(p.nome || ' ' || coalesce(p.marca, '') || ' ' || coalesce(p.modelo, ''))) = 0)
    and (coalesce(e.capacidade, '') = '' or regexp_replace(lower(coalesce(s.capacidade, '')), '\s', '', 'g')
                                            = regexp_replace(lower(e.capacidade), '\s', '', 'g'))
    and (e.condicao = 'qualquer'
         or (e.condicao = 'lacrado' and coalesce(s.condicao, case when p.condicao = 'novo' then 'lacrado' else 'seminovo' end) = 'lacrado')
         or (e.condicao = 'seminovo' and coalesce(s.condicao, case when p.condicao = 'novo' then 'lacrado' else 'seminovo' end) <> 'lacrado'))
    and (e.preco_max_centavos is null or coalesce(s.preco_venda_centavos, p.preco_venda_centavos) <= e.preco_max_centavos)
  order by coalesce(s.preco_venda_centavos, p.preco_venda_centavos), s.criado_em
$$;
revoke all on function privado.espera_series(uuid) from public, anon;
grant execute on function privado.espera_series(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.leads                   enable row level security;
alter table public.lead_eventos            enable row level security;
alter table public.lista_espera            enable row level security;
alter table public.mensagens_modelos       enable row level security;
alter table public.crm_contatos            enable row level security;
alter table public.clientes_consentimentos enable row level security;

create policy leads_ler on public.leads for select to authenticated using (
  (select privado.pode('crm.ver_todos'))
  or ((select privado.pode('crm.usar')) and (responsavel_id = (select auth.uid()) or criado_por = (select auth.uid()))));
create policy lead_eventos_ler on public.lead_eventos for select to authenticated using (
  exists (select 1 from public.leads l where l.id = lead_id));
create policy lista_espera_ler on public.lista_espera for select to authenticated using (
  (select privado.pode('crm.usar')) or (select privado.pode('crm.ver_todos')));
create policy modelos_ler on public.mensagens_modelos for select to authenticated using ((select privado.tem_acesso()));
create policy crm_contatos_ler on public.crm_contatos for select to authenticated using (
  (select privado.pode('crm.usar')) or (select privado.pode('crm.ver_todos')));
create policy cli_consent_ler on public.clientes_consentimentos for select to authenticated using ((select privado.pode('clientes.ver')));

revoke all on public.leads, public.lead_eventos, public.lista_espera, public.mensagens_modelos, public.crm_contatos, public.clientes_consentimentos from anon;
revoke insert, update, delete, truncate on public.leads, public.lead_eventos, public.lista_espera, public.mensagens_modelos, public.crm_contatos, public.clientes_consentimentos from authenticated;
grant select on public.leads, public.lead_eventos, public.lista_espera, public.mensagens_modelos, public.crm_contatos, public.clientes_consentimentos to authenticated;

create or replace trigger trg_leads_atualizado before update on public.leads for each row execute function public.fn_atualizado_em();
create or replace trigger trg_leads_auditoria after insert or update on public.leads for each row execute function public.fn_auditar();
create or replace trigger trg_lista_espera_auditoria after insert or update on public.lista_espera for each row execute function public.fn_auditar();

-- ---------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------
create or replace view public.leads_lista with (security_invoker = true) as
select l.id, l.numero, l.cliente_id, coalesce(c.nome, l.nome) as nome, coalesce(c.telefone, l.telefone) as telefone,
       l.interesse, l.origem, l.etapa, l.valor_estimado_centavos, l.responsavel_id, r.nome as responsavel_nome,
       l.proximo_contato, l.motivo_perda, l.venda_id, v.numero as venda_numero, l.observacao, l.fechado_em,
       l.criado_por, l.criado_em, l.atualizado_em,
       (l.etapa not in ('ganho','perdido') and l.proximo_contato is not null
        and l.proximo_contato < (now() at time zone 'America/Sao_Paulo')::date) as atrasado,
       ((now() at time zone 'America/Sao_Paulo')::date - (l.atualizado_em at time zone 'America/Sao_Paulo')::date) as dias_parado,
       (select max(e.criado_em) from public.lead_eventos e where e.lead_id = l.id and e.tipo in ('whatsapp','ligacao')) as ultimo_contato
from public.leads l
left join public.clientes c on c.id = l.cliente_id
left join public.perfis r on r.user_id = l.responsavel_id
left join public.vendas v on v.id = l.venda_id;

create or replace view public.lista_espera_lista with (security_invoker = true) as
select e.id, e.numero, e.cliente_id, c.nome as cliente_nome, c.telefone as cliente_telefone, e.modelo, e.capacidade, e.cor,
       e.condicao, e.preco_max_centavos, e.validade, e.status, e.avisado_em, e.serie_avisada_id, e.venda_id, e.observacao,
       e.motivo_cancelamento, e.criado_por, p.nome as criado_por_nome, e.criado_em,
       (e.status in ('aguardando','avisado') and e.validade < (now() at time zone 'America/Sao_Paulo')::date) as vencido,
       case when e.status in ('aguardando','avisado') then (select count(*) from privado.espera_series(e.id))::int else 0 end as compativeis
from public.lista_espera e
join public.clientes c on c.id = e.cliente_id
left join public.perfis p on p.user_id = e.criado_por;

revoke all on public.leads_lista, public.lista_espera_lista from anon;
grant select on public.leads_lista, public.lista_espera_lista to authenticated;
