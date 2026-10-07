-- =====================================================================
-- Etapa 2 — Aparelhos: ficha completa de cada IMEI, custos de
-- recondicionamento, fotos, rastreio, preço por unidade e lucro por aparelho
-- =====================================================================

-- Permissão nova
insert into public.permissoes_catalogo (chave, modulo, descricao, ordem) values
  ('aparelhos.editar', 'Aparelhos', 'Editar a ficha dos aparelhos (grau, bateria, checklist, fotos, custos de reparo)', 36)
on conflict (chave) do update set modulo = excluded.modulo, descricao = excluded.descricao, ordem = excluded.ordem;
insert into public.permissoes_cargo (cargo, permissao, permitido) values
  ('vendedor', 'aparelhos.editar', false), ('tecnico', 'aparelhos.editar', true)
on conflict (cargo, permissao) do nothing;

-- Parâmetros da loja
alter table public.empresa add column if not exists dias_alerta_aparelho_parado int not null default 60
  check (dias_alerta_aparelho_parado between 1 and 3650);
alter table public.empresa add column if not exists checklist_aparelho jsonb not null default
  '["Tela e touch","Face ID / Touch ID","Câmeras (frontal e traseiras)","Bateria / carregamento","Botões","Alto-falante e microfone","Wi-Fi e Bluetooth","Chip / sinal","iCloud desconectado","IMEI regular (sem bloqueio)"]'::jsonb;

-- Ficha do aparelho (cada IMEI)
alter table nucleo.produto_series drop constraint if exists produto_series_status_check;
alter table nucleo.produto_series add constraint produto_series_status_check
  check (status in ('disponivel','reservado','vendido','em_os','em_teste','em_reparo','em_garantia','devolvido_fornecedor','defeito','baixado'));
alter table nucleo.produto_series
  add column if not exists imei2 text check (imei2 is null or length(trim(imei2)) >= 3),
  add column if not exists condicao text check (condicao is null or condicao in ('lacrado','seminovo','usado')),
  add column if not exists grau text check (grau is null or grau in ('A','B','C')),
  add column if not exists bateria_pct smallint check (bateria_pct is null or bateria_pct between 0 and 100),
  add column if not exists cor text,
  add column if not exists capacidade text,
  add column if not exists pecas_trocadas text,
  add column if not exists checklist jsonb not null default '{}'::jsonb,
  add column if not exists custo_recond_centavos bigint not null default 0 check (custo_recond_centavos >= 0),
  add column if not exists preco_venda_centavos bigint check (preco_venda_centavos is null or preco_venda_centavos >= 0),
  add column if not exists garantia_dias int check (garantia_dias is null or garantia_dias between 0 and 3650),
  add column if not exists procedencia text check (procedencia is null or procedencia in ('fornecedor','compra_cliente','trade_in','outro')),
  add column if not exists cliente_origem_id uuid references public.clientes(id);
create unique index if not exists series_imei2_uk on nucleo.produto_series (upper(imei2)) where imei2 is not null;

-- Custos de recondicionamento (peças, mão de obra) — somam no custo do aparelho
create table if not exists nucleo.serie_custos (
  id              uuid primary key default gen_random_uuid(),
  serie_id        uuid not null references nucleo.produto_series(id),
  descricao       text not null check (length(trim(descricao)) >= 2),
  valor_centavos  bigint not null check (valor_centavos > 0),
  cancelado       boolean not null default false,
  motivo_cancelamento text,
  criado_por      uuid default auth.uid() references public.perfis(user_id),
  criado_em       timestamptz not null default now()
);
create index if not exists serie_custos_serie_idx on nucleo.serie_custos (serie_id);

-- Fotos reais do aparelho (imagem reduzida, guardada no banco)
create table if not exists nucleo.serie_fotos (
  id          uuid primary key default gen_random_uuid(),
  serie_id    uuid not null references nucleo.produto_series(id),
  imagem      text not null check (imagem like 'data:image/%' and length(imagem) <= 700000),
  legenda     text,
  removida    boolean not null default false,
  criado_por  uuid default auth.uid() references public.perfis(user_id),
  criado_em   timestamptz not null default now()
);
create index if not exists serie_fotos_serie_idx on nucleo.serie_fotos (serie_id) where not removida;

-- Linha do tempo do aparelho
create table if not exists nucleo.serie_eventos (
  id          bigint generated always as identity primary key,
  serie_id    uuid not null references nucleo.produto_series(id),
  tipo        text not null,
  descricao   text not null,
  criado_por  uuid default auth.uid(),
  criado_em   timestamptz not null default now()
);
create index if not exists serie_eventos_serie_idx on nucleo.serie_eventos (serie_id, id);

alter table nucleo.serie_custos  enable row level security;
alter table nucleo.serie_fotos   enable row level security;
alter table nucleo.serie_eventos enable row level security;
create policy serie_custos_ler  on nucleo.serie_custos  for select to authenticated using ((select privado.pode('estoque.ver_custo')));
create policy serie_fotos_ler   on nucleo.serie_fotos   for select to authenticated using ((select privado.ve_catalogo()));
create policy serie_eventos_ler on nucleo.serie_eventos for select to authenticated using ((select privado.ve_catalogo()));
grant select on nucleo.serie_custos, nucleo.serie_fotos, nucleo.serie_eventos to authenticated;
create or replace trigger trg_serie_eventos_imutavel before update or delete on nucleo.serie_eventos
  for each row execute function public.fn_bloquear_alteracao();

-- Valor em reais no formato brasileiro (R$ 1.234,56)
create or replace function privado.fmt_moeda(p bigint)
returns text language sql immutable set search_path = public as $$
  select case when p is null then null else
    (case when p < 0 then '-' else '' end) || 'R$ ' ||
    translate(to_char(abs(p) / 100.0, 'FM999,999,999,990.00'), ',.', '.,') end
$$;
grant execute on function privado.fmt_moeda(bigint) to authenticated;

-- Gatilho: registra entrada, mudança de situação e alterações da ficha
create or replace function nucleo.fn_evento_serie()
returns trigger language plpgsql security definer set search_path = nucleo, public as $$
declare v_txt text; v_mud text[] := '{}';
  rot constant jsonb := '{"disponivel":"Disponível","reservado":"Reservado","vendido":"Vendido","em_os":"Em OS","em_teste":"Em teste","em_reparo":"Em reparo","em_garantia":"Em garantia (fornecedor)","devolvido_fornecedor":"Devolvido ao fornecedor","defeito":"Defeito","baixado":"Baixado"}';
begin
  if tg_op = 'INSERT' then
    insert into nucleo.serie_eventos (serie_id, tipo, descricao)
    values (new.id, 'entrada', 'Entrou no estoque' || case when new.entrada_id is not null
      then ' (entrada nº ' || (select numero from public.entradas where id = new.entrada_id) || ')' else '' end);
    return new;
  end if;
  if new.status is distinct from old.status then
    v_txt := coalesce(rot->>old.status, old.status) || ' → ' || coalesce(rot->>new.status, new.status);
    if new.status = 'vendido' and new.venda_item_id is not null then
      v_txt := v_txt || coalesce(' na venda nº ' || (select v.numero from nucleo.venda_itens i join public.vendas v on v.id = i.venda_id where i.id = new.venda_item_id), '');
    end if;
    if new.observacao is distinct from old.observacao and new.observacao is not null then v_txt := v_txt || ' — ' || new.observacao; end if;
    insert into nucleo.serie_eventos (serie_id, tipo, descricao) values (new.id, 'status', v_txt);
  end if;
  if new.grau is distinct from old.grau then v_mud := v_mud || ('grau ' || coalesce(new.grau, '—')); end if;
  if new.bateria_pct is distinct from old.bateria_pct then v_mud := v_mud || ('bateria ' || coalesce(new.bateria_pct::text || '%', '—')); end if;
  if new.condicao is distinct from old.condicao then v_mud := v_mud || ('condição ' || coalesce(new.condicao, '—')); end if;
  if new.pecas_trocadas is distinct from old.pecas_trocadas then v_mud := v_mud || 'peças trocadas'::text; end if;
  if new.checklist is distinct from old.checklist then v_mud := v_mud || 'checklist'::text; end if;
  if new.preco_venda_centavos is distinct from old.preco_venda_centavos then
    v_mud := v_mud || ('preço ' || coalesce(privado.fmt_moeda(new.preco_venda_centavos), 'do produto'));
  end if;
  if new.cor is distinct from old.cor or new.capacidade is distinct from old.capacidade or new.imei2 is distinct from old.imei2 then
    v_mud := v_mud || 'dados do aparelho'::text;
  end if;
  if array_length(v_mud, 1) > 0 then
    insert into nucleo.serie_eventos (serie_id, tipo, descricao) values (new.id, 'ficha', 'Ficha atualizada: ' || array_to_string(v_mud, ', '));
  end if;
  return new;
end $$;
create or replace trigger trg_serie_eventos after insert or update on nucleo.produto_series
  for each row execute function nucleo.fn_evento_serie();

-- Histórico dos aparelhos que já existiam
insert into nucleo.serie_eventos (serie_id, tipo, descricao, criado_em)
select s.id, 'entrada', 'Entrou no estoque', s.criado_em from nucleo.produto_series s
where not exists (select 1 from nucleo.serie_eventos e where e.serie_id = s.id);

-- Custo de recondicionamento = soma dos custos não cancelados
create or replace function nucleo.fn_recalcular_custo_recond()
returns trigger language plpgsql security definer set search_path = nucleo, public as $$
begin
  update nucleo.produto_series set custo_recond_centavos =
    coalesce((select sum(valor_centavos) from nucleo.serie_custos where serie_id = new.serie_id and not cancelado), 0)
  where id = new.serie_id;
  insert into nucleo.serie_eventos (serie_id, tipo, descricao)
  values (new.serie_id, 'custo', case when tg_op = 'INSERT' then 'Custo de reparo: ' else 'Custo cancelado: ' end || new.descricao
          || case when tg_op = 'UPDATE' and new.motivo_cancelamento is not null then ' (' || new.motivo_cancelamento || ')' else '' end);
  return new;
end $$;
create or replace trigger trg_serie_custos after insert or update on nucleo.serie_custos
  for each row execute function nucleo.fn_recalcular_custo_recond();

-- Item de venda guarda o retrato do aparelho (condição, grau, bateria…)
alter table nucleo.venda_itens add column if not exists detalhes jsonb;
