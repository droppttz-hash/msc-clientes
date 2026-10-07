-- =====================================================================
-- Etapa 5 — funções: comissões, conferência do caixa por forma,
-- conciliação de extrato (OFX) e DRE por área
-- =====================================================================

-- ---------------------------------------------------------------------
-- COMISSÕES
-- ---------------------------------------------------------------------
-- Mão de obra da OS (serviços, já com o desconto proporcional)
create or replace function privado.os_mao_de_obra(p_os uuid)
returns bigint language sql stable security definer set search_path = nucleo, public as $$
  select coalesce(round(sum(round(i.quantidade * i.preco_unitario_centavos))
         * (o.total_centavos::numeric / nullif(o.total_centavos + o.desconto_centavos, 0))), 0)::bigint
  from public.ordens_servico o left join nucleo.os_itens i on i.os_id = o.id and i.tipo = 'servico' and not i.removido
  where o.id = p_os group by o.total_centavos, o.desconto_centavos
$$;

-- Cálculo do mês (sugestão). Quem não gere comissões só vê a própria.
create or replace function public.comissoes_mes(p_mes date)
returns jsonb language plpgsql stable security definer set search_path = nucleo, public as $$
declare v_ini date := date_trunc('month', p_mes)::date; v_fim date; v_gerir boolean := privado.pode('comissoes.gerir');
        v_os jsonb; v_pessoas jsonb; v_fech jsonb;
begin
  if not (v_gerir or privado.pode('comissoes.ver_proprias')) then raise exception 'Sem permissão.'; end if;
  v_fim := (v_ini + interval '1 month - 1 day')::date;

  select coalesce(jsonb_agg(x order by x->>'entregue_em'), '[]'::jsonb) into v_os from (
    select jsonb_build_object('id', o.id, 'numero', o.numero, 'aparelho', o.aparelho, 'cliente', c.nome, 'tecnico_id', o.tecnico_id,
             'tecnico_nome', t.nome, 'entregue_em', o.entregue_em, 'total', o.total_centavos, 'mao_obra', mo.v, 'pct', t.comissao_os_pct,
             'sugerido', round(mo.v * t.comissao_os_pct / 100)::bigint,
             'valor', coalesce(oc.valor_centavos, round(mo.v * t.comissao_os_pct / 100)::bigint),
             'ajustado', oc.os_id is not null, 'motivo', oc.motivo) x
    from public.ordens_servico o
    join public.perfis t on t.user_id = o.tecnico_id
    left join public.clientes c on c.id = o.cliente_id
    left join public.os_comissoes oc on oc.os_id = o.id
    cross join lateral (select privado.os_mao_de_obra(o.id) v) mo
    where o.status = 'entregue' and not o.interna and o.aprovado is not false
      and (o.entregue_em at time zone 'America/Sao_Paulo')::date between v_ini and v_fim
      and (v_gerir or o.tecnico_id = auth.uid())) z;

  with vendedores as (
    select pf.user_id, pf.nome, pf.cargo, pf.comissao_venda_pct, pf.comissao_os_pct,
      (select coalesce(sum(v.total_centavos),0) from public.vendas v where v.criado_por = pf.user_id and v.data between v_ini and v_fim and v.status in ('concluida','devolvida')) as bruto,
      (select count(*) from public.vendas v where v.criado_por = pf.user_id and v.data between v_ini and v_fim and v.status in ('concluida','devolvida')) as qtd,
      (select coalesce(sum(d.valor_centavos),0) from public.devolucoes d join public.vendas v on v.id = d.venda_id where v.criado_por = pf.user_id and d.data between v_ini and v_fim) as devol,
      (select coalesce(sum(v.total_centavos),0) from public.vendas v where v.criado_por = pf.user_id and v.status = 'cancelada'
          and (v.cancelada_em at time zone 'America/Sao_Paulo')::date between v_ini and v_fim and v.data < v_ini
          and exists (select 1 from public.comissoes_fechamentos f where f.user_id = pf.user_id and f.status = 'fechado' and f.mes = date_trunc('month', v.data)::date)) as estornos
    from public.perfis pf where v_gerir or pf.user_id = auth.uid()
  ), tec as (
    select (x->>'tecnico_id')::uuid as user_id, sum((x->>'mao_obra')::bigint) as base_os, sum((x->>'valor')::bigint) as valor_os, count(*) as qtd_os
    from jsonb_array_elements(v_os) x group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('user_id', v.user_id, 'nome', v.nome, 'cargo', v.cargo,
           'pct_venda', v.comissao_venda_pct, 'pct_os', v.comissao_os_pct, 'vendas_qtd', v.qtd, 'vendas_bruto', v.bruto,
           'devolucoes', v.devol, 'estornos', v.estornos, 'base_venda', v.bruto - v.devol - v.estornos,
           'valor_venda', round((v.bruto - v.devol - v.estornos) * v.comissao_venda_pct / 100)::bigint,
           'os_qtd', coalesce(t.qtd_os, 0), 'base_os', coalesce(t.base_os, 0), 'valor_os', coalesce(t.valor_os, 0),
           'total', greatest(0, round((v.bruto - v.devol - v.estornos) * v.comissao_venda_pct / 100)::bigint + coalesce(t.valor_os, 0)))
           order by v.nome), '[]'::jsonb) into v_pessoas
  from vendedores v left join tec t on t.user_id = v.user_id
  where v.bruto <> 0 or v.devol <> 0 or v.estornos <> 0 or t.user_id is not null;

  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'user_id', f.user_id, 'nome', pf.nome, 'total', f.total_centavos, 'ajuste', f.ajuste_centavos,
           'motivo_ajuste', f.motivo_ajuste, 'valor_venda', f.valor_venda_centavos, 'valor_os', f.valor_os_centavos, 'titulo_id', f.titulo_id,
           'titulo_status', t.status, 'vencimento', t.vencimento, 'criado_em', f.criado_em) order by pf.nome), '[]'::jsonb) into v_fech
  from public.comissoes_fechamentos f join public.perfis pf on pf.user_id = f.user_id left join public.titulos t on t.id = f.titulo_id
  where f.mes = v_ini and f.status = 'fechado' and (v_gerir or f.user_id = auth.uid());

  return jsonb_build_object('mes', v_ini, 'fim', v_fim, 'gerir', v_gerir, 'fechado', jsonb_array_length(v_fech) > 0,
                            'pessoas', v_pessoas, 'os', v_os, 'fechamentos', v_fech);
end $$;

-- Gerente ajusta a comissão de uma OS (antes de fechar o mês)
create or replace function public.ajustar_comissao_os(p_os uuid, p_valor bigint, p_motivo text)
returns void language plpgsql security definer set search_path = nucleo, public as $$
declare o record;
begin
  if not privado.pode('comissoes.gerir') then raise exception 'Sem permissão para ajustar comissões.'; end if;
  select * into o from public.ordens_servico where id = p_os;
  if not found or o.status <> 'entregue' or o.tecnico_id is null then raise exception 'Só OS entregue e com técnico tem comissão.'; end if;
  if exists (select 1 from public.comissoes_fechamentos where status = 'fechado' and user_id = o.tecnico_id
             and mes = date_trunc('month', o.entregue_em at time zone 'America/Sao_Paulo')::date) then
    raise exception 'O mês desta OS já foi fechado. Cancele o fechamento para ajustar.';
  end if;
  if p_valor is null then
    delete from public.os_comissoes where os_id = p_os;
    perform privado.os_evento(p_os, 'comissao', 'Comissão do técnico voltou para a sugestão');
    return;
  end if;
  if p_valor < 0 then raise exception 'Valor inválido.'; end if;
  if coalesce(length(trim(p_motivo)),0) < 3 then raise exception 'Informe o motivo do ajuste.'; end if;
  insert into public.os_comissoes (os_id, valor_centavos, motivo) values (p_os, p_valor, trim(p_motivo))
  on conflict (os_id) do update set valor_centavos = excluded.valor_centavos, motivo = excluded.motivo, ajustado_por = auth.uid(), ajustado_em = now();
  perform privado.os_evento(p_os, 'comissao', 'Comissão do técnico ajustada para ' || privado.fmt_moeda(p_valor) || ' — ' || trim(p_motivo));
end $$;

-- Fecha o mês: grava o retrato e lança uma conta a pagar por pessoa
-- p_ajustes: [{user_id, ajuste_centavos, motivo}]
create or replace function public.fechar_comissoes(p_mes date, p_vencimento date, p_ajustes jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = nucleo, public as $$
declare v_ini date := date_trunc('month', p_mes)::date; c jsonb; pe jsonb; v_aj bigint; v_mot text; v_total bigint; v_tid uuid; v_fid uuid; n int := 0; v_soma bigint := 0;
begin
  if not privado.pode('comissoes.gerir') then raise exception 'Sem permissão para fechar comissões.'; end if;
  if v_ini > date_trunc('month', now() at time zone 'America/Sao_Paulo')::date then raise exception 'Não dá para fechar um mês que ainda não começou.'; end if;
  if p_vencimento is null then raise exception 'Informe a data de pagamento das comissões.'; end if;
  if exists (select 1 from public.comissoes_fechamentos where mes = v_ini and status = 'fechado') then raise exception 'Este mês já foi fechado.'; end if;
  c := public.comissoes_mes(v_ini);
  for pe in select * from jsonb_array_elements(c->'pessoas') loop
    select coalesce((a->>'ajuste_centavos')::bigint, 0), nullif(trim(a->>'motivo'),'') into v_aj, v_mot
    from jsonb_array_elements(coalesce(p_ajustes,'[]'::jsonb)) a where a->>'user_id' = pe->>'user_id';
    v_aj := coalesce(v_aj, 0);
    if v_aj <> 0 and coalesce(length(v_mot),0) < 3 then raise exception 'Informe o motivo do ajuste de %.', pe->>'nome'; end if;
    v_total := greatest(0, (pe->>'valor_venda')::bigint + (pe->>'valor_os')::bigint + v_aj);
    v_tid := null;
    if v_total > 0 then
      insert into public.titulos (tipo, descricao, categoria_id, competencia, vencimento, valor_centavos, observacao)
      values ('pagar', 'Comissão ' || to_char(v_ini, 'MM/YYYY') || ' — ' || (pe->>'nome'), privado.cat('comissao'),
              (v_ini + interval '1 month - 1 day')::date, p_vencimento, v_total, v_mot)
      returning id into v_tid;
    end if;
    insert into public.comissoes_fechamentos (mes, user_id, base_venda_centavos, pct_venda, valor_venda_centavos, base_os_centavos, valor_os_centavos,
                                              ajuste_centavos, motivo_ajuste, total_centavos, detalhes, titulo_id)
    values (v_ini, (pe->>'user_id')::uuid, (pe->>'base_venda')::bigint, (pe->>'pct_venda')::numeric, (pe->>'valor_venda')::bigint,
            (pe->>'base_os')::bigint, (pe->>'valor_os')::bigint, v_aj, v_mot, v_total,
            jsonb_build_object('pessoa', pe, 'os', (select coalesce(jsonb_agg(o), '[]'::jsonb) from jsonb_array_elements(c->'os') o where o->>'tecnico_id' = pe->>'user_id')),
            v_tid)
    returning id into v_fid;
    n := n + 1; v_soma := v_soma + v_total;
  end loop;
  if n = 0 then raise exception 'Nenhuma comissão neste mês.'; end if;
  return jsonb_build_object('pessoas', n, 'total_centavos', v_soma);
end $$;

-- Reabre o mês (só se nenhuma comissão foi paga)
create or replace function public.cancelar_fechamento_comissoes(p_mes date, p_motivo text)
returns void language plpgsql security definer set search_path = nucleo, public as $$
declare v_ini date := date_trunc('month', p_mes)::date; r_f record;
begin
  if not privado.pode('comissoes.gerir') then raise exception 'Sem permissão.'; end if;
  if coalesce(length(trim(p_motivo)),0) < 3 then raise exception 'Informe o motivo.'; end if;
  if exists (select 1 from public.comissoes_fechamentos f join public.titulos t on t.id = f.titulo_id
             where f.mes = v_ini and f.status = 'fechado' and t.status in ('pago','parcial')) then
    raise exception 'Alguma comissão deste mês já foi paga. Estorne o pagamento em Contas a pagar antes de reabrir.';
  end if;
  for r_f in select * from public.comissoes_fechamentos where mes = v_ini and status = 'fechado' loop
    if r_f.titulo_id is not null then perform privado.cancelar_titulo(r_f.titulo_id, 'Fechamento de comissões reaberto: ' || trim(p_motivo), true); end if;
    update public.comissoes_fechamentos set status = 'cancelado', motivo_cancelamento = trim(p_motivo) where id = r_f.id;
  end loop;
  if not found then raise exception 'Este mês não está fechado.'; end if;
end $$;

-- ---------------------------------------------------------------------
-- CONFERÊNCIA DO CAIXA POR FORMA DE PAGAMENTO
-- ---------------------------------------------------------------------
create or replace function public.resumo_formas_dia(p_data date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (privado.pode('financeiro.caixa') or privado.pode('financeiro.ver')) then raise exception 'Sem permissão.'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('forma', f.forma, 'nome', f.nome, 'sistema', coalesce(s.total, 0), 'qtd', coalesce(s.qtd, 0),
            'informado', c.informado_centavos, 'diferenca', c.diferenca_centavos, 'conferido_em', c.criado_em, 'conferido_por', pf.nome, 'observacao', c.observacao)
            order by f.ordem), '[]'::jsonb)
    from public.formas_pagamento f
    left join (select forma_pagamento, sum(valor_centavos) total, count(distinct coalesce(venda_id, os_id, reserva_id, id)) qtd from public.titulos
               where tipo = 'receber' and competencia = p_data and status <> 'cancelado' and forma_pagamento is not null
                 and (venda_id is not null or os_id is not null or reserva_id is not null) group by 1) s on s.forma_pagamento = f.forma
    left join lateral (select * from public.caixa_conferencias cc where cc.data = p_data and cc.forma = f.forma order by cc.criado_em desc limit 1) c on true
    left join public.perfis pf on pf.user_id = c.criado_por
    where f.ativo and not f.interna);
end $$;

-- p_itens: [{forma, informado_centavos}]
create or replace function public.conferir_formas(p_data date, p_itens jsonb, p_obs text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare it jsonb; v_sis bigint; r jsonb := '[]'::jsonb; v_inf bigint;
begin
  if not privado.pode('financeiro.caixa') then raise exception 'Sem permissão.'; end if;
  if p_data > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'Data no futuro.'; end if;
  for it in select * from jsonb_array_elements(coalesce(p_itens,'[]'::jsonb)) loop
    if nullif(it->>'informado_centavos','') is null then continue; end if;
    v_inf := (it->>'informado_centavos')::bigint;
    if not exists (select 1 from public.formas_pagamento where forma = it->>'forma' and not interna) then raise exception 'Forma inválida.'; end if;
    select coalesce(sum(valor_centavos),0) into v_sis from public.titulos
    where tipo = 'receber' and competencia = p_data and status <> 'cancelado' and forma_pagamento = it->>'forma'
      and (venda_id is not null or os_id is not null or reserva_id is not null);
    insert into public.caixa_conferencias (data, forma, sistema_centavos, informado_centavos, diferenca_centavos, observacao)
    values (p_data, it->>'forma', v_sis, v_inf, v_inf - v_sis, nullif(trim(p_obs),''));
    r := r || jsonb_build_object('forma', it->>'forma', 'sistema', v_sis, 'informado', v_inf, 'diferenca', v_inf - v_sis);
  end loop;
  if jsonb_array_length(r) = 0 then raise exception 'Informe pelo menos um valor.'; end if;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- EXTRATO DO BANCO (OFX) E CONCILIAÇÃO
-- ---------------------------------------------------------------------
create or replace function privado.extrato_casar(p_conta uuid)
returns int language plpgsql security definer set search_path = public as $$
declare e record; v_mov bigint; n int := 0;
begin
  for e in select * from public.extrato_importado where conta_id = p_conta and status = 'pendente' order by data, id loop
    select m.id into v_mov from public.movimentos_financeiros m
    where m.conta_id = p_conta and m.tipo = case when e.valor_centavos > 0 then 'entrada' else 'saida' end
      and m.valor_centavos = abs(e.valor_centavos) and m.data between e.data - 3 and e.data + 3
      and not exists (select 1 from public.extrato_importado x where x.movimento_id = m.id)
    order by abs(m.data - e.data), m.id limit 1;
    if v_mov is not null then
      update public.extrato_importado set status = 'conciliado', movimento_id = v_mov, resolvido_em = now() where id = e.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- p_linhas: [{fitid, data, valor_centavos (+ entrada / − saída), descricao}]
create or replace function public.importar_extrato(p_conta uuid, p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l jsonb; v_novos int := 0; v_rep int := 0; v_cas int;
begin
  if not privado.pode('financeiro.conciliar') then raise exception 'Sem permissão para importar extrato.'; end if;
  if not exists (select 1 from public.contas_financeiras where id = p_conta) then raise exception 'Escolha a conta do banco.'; end if;
  if jsonb_array_length(coalesce(p_linhas,'[]'::jsonb)) = 0 then raise exception 'O arquivo não tem lançamentos.'; end if;
  for l in select * from jsonb_array_elements(p_linhas) loop
    if coalesce((l->>'valor_centavos')::bigint, 0) = 0 or nullif(l->>'data','') is null then continue; end if;
    insert into public.extrato_importado (conta_id, fitid, data, valor_centavos, descricao)
    values (p_conta, coalesce(nullif(trim(l->>'fitid'),''), md5((l->>'data') || (l->>'valor_centavos') || coalesce(l->>'descricao',''))),
            (l->>'data')::date, (l->>'valor_centavos')::bigint, left(nullif(trim(l->>'descricao'),''), 300))
    on conflict (conta_id, fitid) do nothing;
    if found then v_novos := v_novos + 1; else v_rep := v_rep + 1; end if;
  end loop;
  v_cas := privado.extrato_casar(p_conta);
  return jsonb_build_object('novos', v_novos, 'repetidos', v_rep, 'conciliados', v_cas,
    'pendentes', (select count(*) from public.extrato_importado where conta_id = p_conta and status = 'pendente'));
end $$;

create or replace function public.conciliar_extrato(p_id uuid, p_movimento bigint)
returns void language plpgsql security definer set search_path = public as $$
declare e record; m record;
begin
  if not privado.pode('financeiro.conciliar') then raise exception 'Sem permissão.'; end if;
  select * into e from public.extrato_importado where id = p_id for update;
  if not found or e.status <> 'pendente' then raise exception 'Linha do extrato não encontrada ou já resolvida.'; end if;
  select * into m from public.movimentos_financeiros where id = p_movimento;
  if not found or m.conta_id <> e.conta_id then raise exception 'O lançamento precisa ser da mesma conta.'; end if;
  if m.tipo <> (case when e.valor_centavos > 0 then 'entrada' else 'saida' end) then raise exception 'Entrada só casa com entrada, e saída com saída.'; end if;
  if exists (select 1 from public.extrato_importado where movimento_id = m.id) then raise exception 'Este lançamento já está conciliado com outra linha.'; end if;
  update public.extrato_importado set status = 'conciliado', movimento_id = m.id, resolvido_por = auth.uid(), resolvido_em = now() where id = e.id;
end $$;

create or replace function public.ignorar_extrato(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not privado.pode('financeiro.conciliar') then raise exception 'Sem permissão.'; end if;
  update public.extrato_importado set status = 'ignorado', resolvido_por = auth.uid(), resolvido_em = now() where id = p_id and status = 'pendente';
  if not found then raise exception 'Linha já resolvida.'; end if;
end $$;

create or replace function public.desfazer_extrato(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not privado.pode('financeiro.conciliar') then raise exception 'Sem permissão.'; end if;
  update public.extrato_importado set status = 'pendente', movimento_id = null, resolvido_por = null, resolvido_em = null
  where id = p_id and status in ('conciliado','ignorado');
  if not found then raise exception 'Só dá para desfazer linha conciliada ou ignorada (lançamentos novos se cancelam em Contas a pagar/receber).'; end if;
end $$;

-- Lança no sistema algo que só apareceu no extrato (tarifa, PIX recebido…), já pago na data do banco
create or replace function public.lancar_extrato(p_id uuid, p_categoria uuid, p_descricao text)
returns void language plpgsql security definer set search_path = public as $$
declare e record; v_tipo text; v_ct text; v_tid uuid; v_mov bigint;
begin
  if not (privado.pode('financeiro.conciliar') and privado.pode('financeiro.lancar')) then raise exception 'Sem permissão.'; end if;
  select * into e from public.extrato_importado where id = p_id for update;
  if not found or e.status <> 'pendente' then raise exception 'Linha do extrato não encontrada ou já resolvida.'; end if;
  v_tipo := case when e.valor_centavos > 0 then 'receber' else 'pagar' end;
  select tipo into v_ct from public.categorias where id = p_categoria;
  if v_ct is null or v_ct <> (case when v_tipo = 'receber' then 'receita' else 'despesa' end) then
    raise exception 'Escolha uma categoria de %.', case when v_tipo = 'receber' then 'receita' else 'despesa' end;
  end if;
  insert into public.titulos (tipo, descricao, categoria_id, competencia, vencimento, valor_centavos, observacao)
  values (v_tipo, coalesce(nullif(trim(p_descricao),''), e.descricao, 'Lançamento do extrato'), p_categoria, e.data, e.data, abs(e.valor_centavos), 'Lançado pela conciliação do extrato')
  returning id into v_tid;
  perform privado.baixar(v_tid, e.data, e.conta_id, abs(e.valor_centavos));
  select m.id into v_mov from public.movimentos_financeiros m join public.baixas b on b.id = m.baixa_id
  where b.titulo_id = v_tid and m.origem = 'baixa' order by m.id desc limit 1;
  update public.extrato_importado set status = 'lancado', titulo_id = v_tid, movimento_id = v_mov, resolvido_por = auth.uid(), resolvido_em = now() where id = e.id;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.comissoes_mes(date)','public.ajustar_comissao_os(uuid,bigint,text)','public.fechar_comissoes(date,date,jsonb)',
    'public.cancelar_fechamento_comissoes(date,text)','public.resumo_formas_dia(date)','public.conferir_formas(date,jsonb,text)',
    'public.importar_extrato(uuid,jsonb)','public.conciliar_extrato(uuid,bigint)','public.ignorar_extrato(uuid)','public.desfazer_extrato(uuid)',
    'public.lancar_extrato(uuid,uuid,text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  execute 'revoke execute on function privado.os_mao_de_obra(uuid), privado.extrato_casar(uuid) from public, anon, authenticated';
  execute 'grant execute on function privado.taxa_forma(text,int,text) to authenticated';
end $$;
