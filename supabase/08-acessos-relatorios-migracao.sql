-- =====================================================================
-- MSC — Onda 1 / parte 5: regras de acesso por permissão, relatórios
-- (Início, DRE), clientes_resumo novo e migração dos dados antigos
-- (compras → vendas, lançamentos do caixa → contas pagas/recebidas).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) MIGRAÇÃO DOS DADOS ANTIGOS (só roda uma vez)
-- ---------------------------------------------------------------------
drop view if exists public.caixa_movimentos;
drop view if exists public.clientes_resumo;

do $mig$
declare r record; v_venda uuid; v_tid uuid; v_conta uuid; v_banco uuid;
begin
  select id into v_banco from public.contas_financeiras where sistema = 'banco';

  if to_regclass('public.compras') is not null then
    for r in select c.*, (select nome from public.clientes where id = c.cliente_id) as cli from public.compras c order by c.numero loop
      insert into public.vendas (numero, cliente_id, data, status, valor_tabela_centavos, subtotal_centavos, total_centavos, observacao,
                                 legado_compra_id, criado_por, criado_em, motivo_cancelamento, cancelada_em)
      values (r.numero, r.cliente_id, r.data, case when r.status = 'ativa' then 'concluida' else 'cancelada' end,
              r.valor_centavos, r.valor_centavos, r.valor_centavos, r.observacao, r.id, r.criado_por, r.criado_em,
              r.motivo_cancelamento, r.cancelada_em)
      returning id into v_venda;
      insert into nucleo.venda_itens (venda_id, ordem, descricao, categoria_id, quantidade, preco_tabela_centavos, preco_unitario_centavos, total_centavos)
      values (v_venda, 1, r.descricao, r.categoria_id, 1, r.valor_centavos, r.valor_centavos, r.valor_centavos);
      insert into public.venda_pagamentos (venda_id, forma, valor_centavos, parcelas)
      values (v_venda, r.forma_pagamento, r.valor_centavos, r.parcelas);
      if r.status = 'ativa' then
        select coalesce(conta_id, v_banco) into v_conta from public.formas_pagamento where forma = r.forma_pagamento;
        insert into public.titulos (tipo, descricao, categoria_id, cliente_id, venda_id, forma_pagamento, conta_prevista_id,
                                    competencia, vencimento, valor_centavos, criado_por, criado_em)
        values ('receber', 'Venda nº ' || r.numero || coalesce(' — ' || r.cli, ''), privado.cat('vendas'), r.cliente_id, v_venda,
                r.forma_pagamento, v_conta, r.data, r.data, r.valor_centavos, r.criado_por, r.criado_em)
        returning id into v_tid;
        perform privado.baixar(v_tid, r.data, v_conta, r.valor_centavos, 0, 0, 0, 0, true);
      end if;
    end loop;
    perform setval(pg_get_serial_sequence('public.vendas', 'numero'), greatest((select coalesce(max(numero), 0) from public.vendas), 1),
                   (select count(*) > 0 from public.vendas));
    alter table public.compras rename to legado_compras;
    revoke all on public.legado_compras from anon, authenticated;
  end if;

  if to_regclass('public.lancamentos') is not null then
    for r in select * from public.lancamentos order by numero loop
      select coalesce(conta_id, v_banco) into v_conta from public.formas_pagamento where forma = r.forma_pagamento;
      insert into public.titulos (tipo, descricao, categoria_id, forma_pagamento, conta_prevista_id, competencia, vencimento,
                                  valor_centavos, observacao, criado_por, criado_em, status, cancelado_em, motivo_cancelamento)
      values (case when r.tipo = 'saida' then 'pagar' else 'receber' end, r.descricao, r.categoria_id, r.forma_pagamento, v_conta,
              r.data, r.data, r.valor_centavos, r.observacao, r.criado_por, r.criado_em,
              case when r.status = 'ativo' then 'aberto' else 'cancelado' end, r.cancelado_em, r.motivo_cancelamento)
      returning id into v_tid;
      if r.status = 'ativo' then
        perform privado.baixar(v_tid, r.data, v_conta, r.valor_centavos);
      end if;
    end loop;
    alter table public.lancamentos rename to legado_lancamentos;
    revoke all on public.legado_lancamentos from anon, authenticated;
  end if;
end $mig$;

-- ---------------------------------------------------------------------
-- 2) CLIENTES: resumo a partir das vendas (valores só p/ quem pode ver)
-- ---------------------------------------------------------------------
create or replace view public.clientes_resumo with (security_invoker = true) as
select c.*,
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

-- ---------------------------------------------------------------------
-- 3) REGRAS DE ACESSO
-- ---------------------------------------------------------------------
-- clientes
alter policy clientes_ler    on public.clientes using ((select privado.pode('clientes.ver')));
alter policy clientes_criar  on public.clientes with check ((select privado.pode('clientes.criar')));
alter policy clientes_editar on public.clientes using ((select privado.pode('clientes.editar'))) with check ((select privado.pode('clientes.editar')));

create or replace function public.fn_regras_vendedor_clientes()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    new.criado_por := auth.uid();
    if not privado.pode('clientes.inativar') then new.ativo := true; end if;
  elsif new.ativo is distinct from old.ativo and not privado.pode('clientes.inativar') then
    raise exception 'Sem permissão para inativar ou reativar clientes.';
  end if;
  if new.aceita_marketing and (tg_op = 'INSERT' or not old.aceita_marketing) then new.aceita_marketing_em := now(); end if;
  if not new.aceita_marketing then new.aceita_marketing_em := null; end if;
  return new;
end $$;

-- perfis: todos veem nomes da equipe; só quem gerencia altera
alter policy perfis_ler    on public.perfis using ((select privado.tem_acesso()) or user_id = (select auth.uid()));
alter policy perfis_editar on public.perfis using ((select privado.pode('config.gerenciar'))) with check ((select privado.pode('config.gerenciar')));

-- categorias
alter policy categorias_criar  on public.categorias with check ((select privado.pode('config.gerenciar')));
alter policy categorias_editar on public.categorias using ((select privado.pode('config.gerenciar'))) with check ((select privado.pode('config.gerenciar')));

-- auditoria
alter policy auditoria_ler on public.auditoria using ((select privado.pode('auditoria.ver')));

-- empresa
drop policy if exists empresa_ler on public.empresa;
drop policy if exists empresa_editar on public.empresa;
create policy empresa_ler    on public.empresa for select to authenticated using (true);
create policy empresa_editar on public.empresa for update to authenticated using ((select privado.pode('config.gerenciar'))) with check ((select privado.pode('config.gerenciar')));

-- permissões
drop policy if exists permcat_ler on public.permissoes_catalogo;
create policy permcat_ler on public.permissoes_catalogo for select to authenticated using ((select privado.tem_acesso()));
drop policy if exists permcargo_ler on public.permissoes_cargo;
drop policy if exists permcargo_editar on public.permissoes_cargo;
create policy permcargo_ler    on public.permissoes_cargo for select to authenticated using ((select privado.tem_acesso()));
create policy permcargo_editar on public.permissoes_cargo for update to authenticated using ((select privado.pode('config.gerenciar'))) with check ((select privado.pode('config.gerenciar')));

-- fornecedores
drop policy if exists fornecedores_ler on public.fornecedores;
drop policy if exists fornecedores_criar on public.fornecedores;
drop policy if exists fornecedores_editar on public.fornecedores;
create policy fornecedores_ler on public.fornecedores for select to authenticated
  using ((select privado.pode('estoque.ver')) or (select privado.pode('estoque.entrada')) or (select privado.pode('financeiro.ver')));
create policy fornecedores_criar on public.fornecedores for insert to authenticated
  with check ((select privado.pode('estoque.entrada')) or (select privado.pode('financeiro.lancar')));
create policy fornecedores_editar on public.fornecedores for update to authenticated
  using ((select privado.pode('estoque.entrada')) or (select privado.pode('financeiro.lancar')))
  with check ((select privado.pode('estoque.entrada')) or (select privado.pode('financeiro.lancar')));

-- finanças
drop policy if exists contas_ler on public.contas_financeiras;
drop policy if exists contas_criar on public.contas_financeiras;
drop policy if exists contas_editar on public.contas_financeiras;
create policy contas_ler on public.contas_financeiras for select to authenticated using (
  (select privado.pode('financeiro.ver')) or (select privado.pode('financeiro.caixa')) or (select privado.pode('vendas.devolver'))
  or (select privado.pode('estoque.entrada')) or (select privado.pode('config.gerenciar')));
create policy contas_criar  on public.contas_financeiras for insert to authenticated with check ((select privado.pode('config.gerenciar')));
create policy contas_editar on public.contas_financeiras for update to authenticated using ((select privado.pode('config.gerenciar'))) with check ((select privado.pode('config.gerenciar')));

drop policy if exists formas_ler on public.formas_pagamento;
drop policy if exists formas_editar on public.formas_pagamento;
create policy formas_ler    on public.formas_pagamento for select to authenticated using ((select privado.tem_acesso()));
create policy formas_editar on public.formas_pagamento for update to authenticated using ((select privado.pode('config.gerenciar'))) with check ((select privado.pode('config.gerenciar')));
drop policy if exists credtaxas_ler on public.credito_taxas;
drop policy if exists credtaxas_criar on public.credito_taxas;
drop policy if exists credtaxas_editar on public.credito_taxas;
create policy credtaxas_ler    on public.credito_taxas for select to authenticated using ((select privado.tem_acesso()));
create policy credtaxas_criar  on public.credito_taxas for insert to authenticated with check ((select privado.pode('config.gerenciar')));
create policy credtaxas_editar on public.credito_taxas for update to authenticated using ((select privado.pode('config.gerenciar'))) with check ((select privado.pode('config.gerenciar')));

drop policy if exists titulos_ler on public.titulos;
create policy titulos_ler on public.titulos for select to authenticated using ((select privado.pode('financeiro.ver')));
drop policy if exists baixas_ler on public.baixas;
create policy baixas_ler on public.baixas for select to authenticated using ((select privado.pode('financeiro.ver')));
drop policy if exists movfin_ler on public.movimentos_financeiros;
create policy movfin_ler on public.movimentos_financeiros for select to authenticated using ((select privado.pode('financeiro.ver')));
drop policy if exists transf_ler on public.transferencias;
create policy transf_ler on public.transferencias for select to authenticated using ((select privado.pode('financeiro.ver')));
drop policy if exists recorr_ler on public.recorrencias;
create policy recorr_ler on public.recorrencias for select to authenticated using ((select privado.pode('financeiro.ver')));
drop policy if exists sessoes_ler on public.sessoes_caixa;
create policy sessoes_ler on public.sessoes_caixa for select to authenticated using ((select privado.pode('financeiro.ver')) or (select privado.pode('financeiro.caixa')));

-- Grants mínimos (o resto é bloqueado pela RLS e pelas funções)
revoke all on public.empresa, public.permissoes_catalogo, public.permissoes_cargo, public.fornecedores, public.contas_financeiras,
              public.formas_pagamento, public.credito_taxas, public.titulos, public.baixas, public.transferencias,
              public.sessoes_caixa, public.movimentos_financeiros, public.recorrencias, public.entradas, public.vendas,
              public.venda_pagamentos, public.devolucoes from anon;
revoke insert, update, delete, truncate on public.titulos, public.baixas, public.transferencias, public.sessoes_caixa,
              public.movimentos_financeiros, public.recorrencias, public.entradas, public.vendas, public.venda_pagamentos,
              public.devolucoes, public.permissoes_catalogo from authenticated;
revoke delete, truncate on public.empresa, public.permissoes_cargo, public.fornecedores, public.contas_financeiras,
              public.formas_pagamento, public.credito_taxas from authenticated;
grant select on public.empresa, public.permissoes_catalogo, public.permissoes_cargo, public.fornecedores, public.contas_financeiras,
              public.formas_pagamento, public.credito_taxas, public.titulos, public.baixas, public.transferencias,
              public.sessoes_caixa, public.movimentos_financeiros, public.recorrencias, public.entradas, public.vendas,
              public.venda_pagamentos, public.devolucoes, public.saldos_contas, public.clientes_resumo to authenticated;
grant update on public.empresa, public.permissoes_cargo, public.fornecedores, public.contas_financeiras,
              public.formas_pagamento, public.credito_taxas to authenticated;
grant insert on public.fornecedores, public.contas_financeiras, public.credito_taxas to authenticated;
revoke all on public.clientes_resumo, public.saldos_contas, public.produtos, public.produto_series, public.estoque_movimentos,
              public.entrada_itens, public.venda_itens, public.vendas_lista from anon;

-- Funções internas: só as usadas pelas regras de acesso ficam liberadas
revoke execute on all functions in schema privado from public, anon, authenticated;
grant execute on function privado.pode(text), privado.tem_acesso(), privado.eh_gerente(), privado.meu_cargo(),
                          privado.hoje_sp(), privado.ve_catalogo() to authenticated;
revoke execute on all functions in schema nucleo from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4) CAIXA DO DIA para quem opera o caixa (sem ver o resto das finanças)
-- ---------------------------------------------------------------------
create or replace function public.caixa_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb := '[]'::jsonb; c record; s record; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not (privado.pode('financeiro.caixa') or privado.pode('financeiro.ver')) then raise exception 'Sem permissão.'; end if;
  for c in select * from public.contas_financeiras where tipo = 'caixa' and ativo order by ordem loop
    select * into s from public.sessoes_caixa where conta_id = c.id and fechada_em is null;
    v := v || jsonb_build_object(
      'conta_id', c.id, 'nome', c.nome, 'saldo', privado.saldo_conta(c.id),
      'sessao', case when s.id is null then null else jsonb_build_object('id', s.id, 'aberta_em', s.aberta_em,
                 'aberta_por', (select nome from public.perfis where user_id = s.aberta_por), 'valor_abertura', s.valor_abertura_centavos) end,
      'entradas_hoje', coalesce((select sum(valor_centavos) from public.movimentos_financeiros where conta_id = c.id and data = v_hoje and tipo = 'entrada'), 0),
      'saidas_hoje', coalesce((select sum(valor_centavos) from public.movimentos_financeiros where conta_id = c.id and data = v_hoje and tipo = 'saida'), 0),
      'movimentos_hoje', coalesce((select jsonb_agg(jsonb_build_object('hora', to_char(m.criado_em at time zone 'America/Sao_Paulo', 'HH24:MI'),
                                   'tipo', m.tipo, 'valor', m.valor_centavos, 'descricao', m.descricao) order by m.id desc)
                                   from public.movimentos_financeiros m where m.conta_id = c.id and m.data = v_hoje), '[]'::jsonb),
      'ultimos_fechamentos', coalesce((select jsonb_agg(x order by x->>'fechada_em' desc) from (
          select jsonb_build_object('fechada_em', fechada_em, 'por', (select nome from public.perfis where user_id = fechada_por),
                                    'contado', valor_contado_centavos, 'esperado', saldo_sistema_fechamento, 'diferenca', diferenca_centavos) x
          from public.sessoes_caixa where conta_id = c.id and fechada_em is not null order by fechada_em desc limit 5) z), '[]'::jsonb)
    );
  end loop;
  return jsonb_build_object('caixas', v,
    'bancos', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nome', nome) order by ordem), '[]'::jsonb)
               from public.contas_financeiras where tipo <> 'caixa' and ativo));
end $$;

-- ---------------------------------------------------------------------
-- 5) INÍCIO (painel): só devolve o que a pessoa pode ver
-- ---------------------------------------------------------------------
create or replace function public.painel()
returns jsonb language plpgsql security definer set search_path = nucleo, public as $$
declare r jsonb := '{}'::jsonb; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
        v_ini date := date_trunc('month', v_hoje)::date; v_ini_ant date := (date_trunc('month', v_hoje) - interval '1 month')::date;
        v_dia_ant date := least((v_ini_ant + (v_hoje - v_ini))::date, (v_ini - 1)); v_meta bigint;
begin
  if not privado.tem_acesso() then raise exception 'Sem acesso.'; end if;
  perform public.processar_recebiveis();
  perform public.gerar_recorrencias();

  if privado.pode('vendas.criar') then
    r := r || jsonb_build_object('minhas_vendas_hoje', (
      select jsonb_build_object('qtd', count(*), 'total', coalesce(sum(total_centavos),0))
      from public.vendas where criado_por = auth.uid() and data = v_hoje and status in ('concluida','devolvida')));
  end if;

  if privado.pode('painel.ver_valores') then
    select sum(meta_mensal_centavos) into v_meta from public.perfis where ativo;
    r := r || jsonb_build_object(
      'vendas_hoje', (select jsonb_build_object('qtd', count(*), 'total', coalesce(sum(total_centavos),0))
                      from public.vendas where data = v_hoje and status in ('concluida','devolvida')),
      'mes', (select jsonb_build_object('qtd', count(*), 'total', coalesce(sum(total_centavos),0))
              from public.vendas where data between v_ini and v_hoje and status in ('concluida','devolvida')),
      'mes_anterior_ate_hoje', (select coalesce(sum(total_centavos),0) from public.vendas
              where data between v_ini_ant and v_dia_ant and status in ('concluida','devolvida')),
      'mes_anterior', (select coalesce(sum(total_centavos),0) from public.vendas
              where data between v_ini_ant and v_ini - 1 and status in ('concluida','devolvida')),
      'devolucoes_mes', (select coalesce(sum(valor_centavos),0) from public.devolucoes where data between v_ini and v_hoje),
      'meta_mes', v_meta,
      'por_dia', (select coalesce(jsonb_agg(jsonb_build_object('dia', d::date, 'total', coalesce(t.total,0)) order by d), '[]'::jsonb)
                  from generate_series(v_ini, v_hoje, interval '1 day') d
                  left join (select data, sum(total_centavos) total from public.vendas
                             where data between v_ini and v_hoje and status in ('concluida','devolvida') group by data) t on t.data = d::date),
      'top_produtos', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                  select jsonb_build_object('nome', i.descricao, 'qtd', sum(i.quantidade - i.devolvido_qtd), 'total', sum(i.total_centavos)) x
                  from nucleo.venda_itens i join public.vendas v on v.id = i.venda_id
                  where v.data between v_ini and v_hoje and v.status in ('concluida','devolvida')
                  group by i.descricao order by sum(i.total_centavos) desc limit 5) z),
      'top_categorias', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                  select jsonb_build_object('nome', coalesce(c.nome, 'Sem categoria'), 'total', sum(i.total_centavos)) x
                  from nucleo.venda_itens i join public.vendas v on v.id = i.venda_id left join public.categorias c on c.id = i.categoria_id
                  where v.data between v_ini and v_hoje and v.status in ('concluida','devolvida')
                  group by c.nome order by sum(i.total_centavos) desc limit 6) z),
      'top_clientes', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                  select jsonb_build_object('id', c.id, 'nome', c.nome, 'total', sum(v.total_centavos)) x
                  from public.vendas v join public.clientes c on c.id = v.cliente_id
                  where v.data between v_ini and v_hoje and v.status in ('concluida','devolvida')
                  group by c.id, c.nome order by sum(v.total_centavos) desc limit 5) z),
      'ranking_vendedores', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                  select jsonb_build_object('nome', pf.nome, 'qtd', count(v.id), 'total', coalesce(sum(v.total_centavos),0), 'meta', pf.meta_mensal_centavos) x
                  from public.perfis pf left join public.vendas v on v.criado_por = pf.user_id
                       and v.data between v_ini and v_hoje and v.status in ('concluida','devolvida')
                  where pf.ativo group by pf.user_id, pf.nome, pf.meta_mensal_centavos
                  having count(v.id) > 0 or pf.meta_mensal_centavos is not null
                  order by coalesce(sum(v.total_centavos),0) desc) z)
    );
  end if;

  if privado.pode('vendas.ver_lucro') then
    r := r || jsonb_build_object('lucro_bruto_mes', (
      select coalesce(sum(round((i.total_centavos::numeric / i.quantidade - i.custo_unitario_centavos) * (i.quantidade - i.devolvido_qtd))), 0)::bigint
      from nucleo.venda_itens i join public.vendas v on v.id = i.venda_id
      where v.data between v_ini and v_hoje and v.status in ('concluida','devolvida')));
  end if;

  if privado.pode('financeiro.ver') then
    r := r || jsonb_build_object(
      'saldo_contas', (select coalesce(sum(privado.saldo_conta(id)),0) from public.contas_financeiras where ativo),
      'receber', (select jsonb_build_object(
          'vencido', coalesce(sum(valor_centavos - pago_centavos) filter (where vencimento < v_hoje), 0),
          'hoje', coalesce(sum(valor_centavos - pago_centavos) filter (where vencimento = v_hoje), 0),
          'semana', coalesce(sum(valor_centavos - pago_centavos) filter (where vencimento between v_hoje and v_hoje + 7), 0))
        from public.titulos where tipo = 'receber' and status in ('aberto','parcial')),
      'pagar', (select jsonb_build_object(
          'vencido', coalesce(sum(valor_centavos - pago_centavos) filter (where vencimento < v_hoje), 0),
          'hoje', coalesce(sum(valor_centavos - pago_centavos) filter (where vencimento = v_hoje), 0),
          'semana', coalesce(sum(valor_centavos - pago_centavos) filter (where vencimento between v_hoje and v_hoje + 7), 0))
        from public.titulos where tipo = 'pagar' and status in ('aberto','parcial'))
    );
  end if;

  if privado.pode('estoque.ver') then
    r := r || jsonb_build_object('estoque_baixo', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('id', id, 'nome', nome, 'estoque', estoque_atual, 'minimo', estoque_minimo) x
        from nucleo.produtos where ativo and controla_estoque and estoque_atual <= estoque_minimo and (estoque_minimo > 0 or estoque_atual < 0)
        order by estoque_atual - estoque_minimo limit 10) z),
      'estoque_baixo_qtd', (select count(*) from nucleo.produtos where ativo and controla_estoque and estoque_atual <= estoque_minimo and (estoque_minimo > 0 or estoque_atual < 0)));
  end if;

  if privado.pode('vendas.aprovar') then
    r := r || jsonb_build_object('aguardando_aprovacao', (select count(*) from public.vendas where status = 'aguardando_aprovacao'));
  end if;

  if privado.pode('clientes.ver') then
    r := r || jsonb_build_object('aniversariantes_hoje', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'telefone', telefone)), '[]'::jsonb)
        from public.clientes where ativo and data_nascimento is not null
          and extract(month from data_nascimento) = extract(month from v_hoje) and extract(day from data_nascimento) = extract(day from v_hoje)));
  end if;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- 6) DRE gerencial (competência) + resumo pelo regime de caixa
-- ---------------------------------------------------------------------
create or replace function public.dre(p_inicio date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path = nucleo, public as $$
declare v_rec bigint; v_dev bigint; v_taxa bigint; v_cmv bigint; v_cmv_dev bigint; v_outras jsonb; v_desp jsonb; v_quebra bigint;
        v_tot_outras bigint; v_tot_desp bigint; v_compras bigint; v_caixa jsonb; v_lb bigint;
begin
  if not privado.pode('financeiro.relatorios') then raise exception 'Sem permissão.'; end if;
  select coalesce(sum(total_centavos),0) into v_rec from public.vendas where data between p_inicio and p_fim and status in ('concluida','devolvida');
  select coalesce(sum(valor_centavos),0) into v_dev from public.devolucoes where data between p_inicio and p_fim;
  select coalesce(sum(vp.taxa_centavos),0) into v_taxa from public.venda_pagamentos vp join public.vendas v on v.id = vp.venda_id
    where v.data between p_inicio and p_fim and v.status in ('concluida','devolvida');
  select coalesce(sum(round(i.custo_unitario_centavos * i.quantidade)),0)::bigint into v_cmv
    from nucleo.venda_itens i join public.vendas v on v.id = i.venda_id
    where v.data between p_inicio and p_fim and v.status in ('concluida','devolvida');
  select coalesce(sum(round(i.custo_unitario_centavos * di.quantidade)),0)::bigint into v_cmv_dev
    from nucleo.devolucao_itens di join nucleo.venda_itens i on i.id = di.venda_item_id join public.devolucoes d on d.id = di.devolucao_id
    where d.data between p_inicio and p_fim;
  select coalesce(jsonb_agg(jsonb_build_object('categoria', nome, 'valor', total) order by total desc), '[]'::jsonb), coalesce(sum(total),0)
    into v_outras, v_tot_outras from (
      select coalesce(c.nome,'Sem categoria') nome, sum(t.valor_centavos) total
      from public.titulos t left join public.categorias c on c.id = t.categoria_id
      where t.tipo = 'receber' and t.status <> 'cancelado' and t.venda_id is null and t.os_id is null
        and t.competencia between p_inicio and p_fim group by 1) z;
  select coalesce(jsonb_agg(jsonb_build_object('categoria', nome, 'valor', total) order by total desc), '[]'::jsonb), coalesce(sum(total),0)
    into v_desp, v_tot_desp from (
      select coalesce(c.nome,'Sem categoria') nome, sum(t.valor_centavos) total
      from public.titulos t left join public.categorias c on c.id = t.categoria_id
      where t.tipo = 'pagar' and t.status <> 'cancelado' and t.entrada_id is null and t.devolucao_id is null
        and coalesce(c.sistema,'') not in ('compra_mercadoria','devolucao')
        and t.competencia between p_inicio and p_fim group by 1) z;
  select coalesce(sum(case when tipo = 'entrada' then valor_centavos else -valor_centavos end),0) into v_quebra
    from public.movimentos_financeiros where origem = 'quebra_caixa' and data between p_inicio and p_fim;
  select coalesce(sum(total_centavos),0) into v_compras from public.entradas where status = 'confirmada' and data between p_inicio and p_fim;
  select jsonb_build_object(
      'entradas', coalesce(sum(valor_centavos) filter (where tipo = 'entrada'), 0),
      'saidas', coalesce(sum(valor_centavos) filter (where tipo = 'saida'), 0),
      'por_categoria', coalesce((select jsonb_agg(jsonb_build_object('categoria', coalesce(c.nome,'Outros'), 'tipo', m2.tipo, 'valor', m2.total) order by m2.total desc)
          from (select categoria_id, tipo, sum(valor_centavos) total from public.movimentos_financeiros
                where data between p_inicio and p_fim and origem <> 'transferencia' group by 1,2) m2
          left join public.categorias c on c.id = m2.categoria_id), '[]'::jsonb))
    into v_caixa from public.movimentos_financeiros where data between p_inicio and p_fim and origem <> 'transferencia';
  v_lb := v_rec - v_dev - v_taxa - (v_cmv - v_cmv_dev);
  return jsonb_build_object(
    'inicio', p_inicio, 'fim', p_fim,
    'receita_bruta', v_rec, 'devolucoes', v_dev, 'receita_liquida', v_rec - v_dev,
    'taxas_cartao', v_taxa, 'cmv', v_cmv - v_cmv_dev, 'lucro_bruto', v_lb,
    'margem_bruta_pct', case when v_rec - v_dev > 0 then round(v_lb::numeric * 100 / (v_rec - v_dev), 1) end,
    'outras_receitas', v_outras, 'total_outras_receitas', v_tot_outras,
    'despesas', v_desp, 'total_despesas', v_tot_desp, 'quebra_caixa', v_quebra,
    'resultado', v_lb + v_tot_outras - v_tot_desp + v_quebra,
    'compras_mercadoria', v_compras,
    'caixa', v_caixa);
end $$;

-- Busca geral (Ctrl+K)
create or replace function public.busca_geral(p_termo text)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare q text := trim(p_termo); d text := regexp_replace(p_termo, '\D', '', 'g'); r jsonb := '[]'::jsonb;
begin
  if length(q) < 2 then return r; end if;
  if privado.pode('clientes.ver') then
    r := r || coalesce((select jsonb_agg(jsonb_build_object('tipo','cliente','id',id,'titulo',nome,'sub',coalesce(telefone,email,''))) from (
      select id, nome, telefone, email from public.clientes
      where nome ilike '%' || q || '%' or (length(d) >= 4 and (telefone like '%' || d || '%' or cpf like '%' || d || '%')) or email ilike '%' || q || '%'
      order by ativo desc, nome limit 6) z), '[]'::jsonb);
  end if;
  if privado.ve_catalogo() then
    r := r || coalesce((select jsonb_agg(jsonb_build_object('tipo', case when b.serie_id is null then 'produto' else 'serie' end,
                 'id', b.produto_id, 'titulo', b.nome, 'sub', coalesce('IMEI ' || b.serie, b.sku || ' · estoque ' || trim(to_char(b.estoque_atual, 'FM999G990D###')))))
      from public.buscar_produto(q, 6) b), '[]'::jsonb);
  end if;
  if d <> '' and length(d) <= 9 then
    r := r || coalesce((select jsonb_agg(jsonb_build_object('tipo','venda','id',id,'titulo','Venda nº ' || numero,'sub', coalesce(cliente_nome,'Venda balcão') || ' · ' || to_char(data,'DD/MM/YYYY')))
      from public.vendas_lista where numero = d::bigint), '[]'::jsonb);
  end if;
  return r;
end $$;
