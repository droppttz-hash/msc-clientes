-- =====================================================================
-- Etapa 5 — DRE por área; bandeira do cartão na venda e na entrega da OS
-- (taxa por bandeira; sem taxa cadastrada para a bandeira, vale a taxa padrão)
-- =====================================================================

create or replace function public.dre(p_inicio date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path = nucleo, public as $$
declare v_rec bigint; v_dev bigint; v_taxa bigint; v_cmv bigint; v_cmv_dev bigint; v_outras jsonb; v_desp jsonb; v_quebra bigint;
        v_tot_outras bigint; v_tot_desp bigint; v_compras bigint; v_caixa jsonb; v_lb bigint; v_os bigint; v_os_custo bigint; v_os_taxa bigint; v_area jsonb;
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
  -- assistência técnica: OS entregues no período
  select coalesce(sum(o.total_centavos),0) into v_os from public.ordens_servico o
    where o.status = 'entregue' and not o.interna and (o.entregue_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim;
  select coalesce(sum(round(i.custo_unitario_centavos * i.quantidade)),0)::bigint into v_os_custo
    from nucleo.os_itens i join public.ordens_servico o on o.id = i.os_id
    where i.aplicado and not i.removido and o.status = 'entregue' and not o.interna and o.aprovado is not false
      and (o.entregue_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim;
  select coalesce(sum(op.taxa_centavos),0) into v_os_taxa from public.os_pagamentos op join public.ordens_servico o on o.id = op.os_id
    where o.status = 'entregue' and (o.entregue_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim;
  select coalesce(jsonb_agg(jsonb_build_object('categoria', nome, 'valor', total) order by total desc), '[]'::jsonb), coalesce(sum(total),0)
    into v_outras, v_tot_outras from (
      select coalesce(c.nome,'Sem categoria') nome, sum(t.valor_centavos) total
      from public.titulos t left join public.categorias c on c.id = t.categoria_id
      where t.tipo = 'receber' and t.status <> 'cancelado' and t.venda_id is null and t.os_id is null
        and (t.reserva_id is null or exists (select 1 from public.reservas r where r.id = t.reserva_id and r.status = 'cancelada' and not r.sinal_devolvido))
        and t.competencia between p_inicio and p_fim group by 1) z;
  select coalesce(jsonb_agg(jsonb_build_object('categoria', nome, 'valor', total) order by total desc), '[]'::jsonb), coalesce(sum(total),0)
    into v_desp, v_tot_desp from (
      select coalesce(c.nome,'Sem categoria') nome, sum(t.valor_centavos) total
      from public.titulos t left join public.categorias c on c.id = t.categoria_id
      where t.tipo = 'pagar' and t.status <> 'cancelado' and t.entrada_id is null and t.devolucao_id is null and t.reserva_id is null
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
  -- por área (aparelhos, acessórios, informática, assistência): receita, devoluções e custo
  select coalesce(jsonb_agg(jsonb_build_object('area', area, 'receita', receita, 'devolucoes', devol, 'cmv', cmv, 'lucro', receita - devol - cmv) order by receita desc), '[]'::jsonb)
  into v_area from (
    select area, sum(receita)::bigint receita, sum(devol)::bigint devol, sum(cmv)::bigint cmv from (
      select coalesce(c.area, 'outros') area,
             round(i.total_centavos * case when v.subtotal_centavos > 0 then v.total_centavos::numeric / v.subtotal_centavos else 1 end) receita,
             0 devol, round(i.custo_unitario_centavos * i.quantidade) cmv
      from nucleo.venda_itens i join public.vendas v on v.id = i.venda_id left join public.categorias c on c.id = i.categoria_id
      where v.data between p_inicio and p_fim and v.status in ('concluida','devolvida')
      union all
      select coalesce(c.area, 'outros'), 0, di.valor_centavos, -round(i.custo_unitario_centavos * di.quantidade)
      from nucleo.devolucao_itens di join nucleo.venda_itens i on i.id = di.venda_item_id join public.devolucoes d on d.id = di.devolucao_id
      left join public.categorias c on c.id = i.categoria_id
      where d.data between p_inicio and p_fim
      union all
      select 'assistencia', v_os, 0, v_os_custo where v_os <> 0 or v_os_custo <> 0
    ) z group by area) y;
  v_lb := v_rec + v_os - v_dev - v_taxa - v_os_taxa - (v_cmv - v_cmv_dev) - v_os_custo;
  return jsonb_build_object(
    'inicio', p_inicio, 'fim', p_fim,
    'receita_vendas', v_rec, 'receita_servicos', v_os,
    'receita_bruta', v_rec + v_os, 'devolucoes', v_dev, 'receita_liquida', v_rec + v_os - v_dev,
    'taxas_cartao', v_taxa + v_os_taxa, 'cmv', v_cmv - v_cmv_dev, 'custo_pecas_os', v_os_custo, 'lucro_bruto', v_lb,
    'margem_bruta_pct', case when v_rec + v_os - v_dev > 0 then round(v_lb::numeric * 100 / (v_rec + v_os - v_dev), 1) end,
    'outras_receitas', v_outras, 'total_outras_receitas', v_tot_outras,
    'despesas', v_desp, 'total_despesas', v_tot_desp, 'quebra_caixa', v_quebra,
    'resultado', v_lb + v_tot_outras - v_tot_desp + v_quebra,
    'compras_mercadoria', v_compras, 'por_area', v_area,
    'caixa', v_caixa);
end $$;

create or replace function public.finalizar_venda(p jsonb)
returns jsonb language plpgsql security definer set search_path = nucleo, public as $$
declare v_key uuid := nullif(p->>'chave','')::uuid; v_exist record; v_id uuid; v_num bigint; it jsonb; pg jsonb; pr record; s record;
        v_ordem int := 0; v_qtd numeric; v_preco bigint; v_tab bigint; v_desc_item bigint; v_total_item bigint; v_custo bigint;
        v_descricao text; v_cat uuid; v_gar int; v_tabela bigint := 0; v_sub bigint := 0; v_desc bigint; v_acr bigint; v_total bigint;
        v_pct numeric := 0; v_pagto bigint := 0; v_cli uuid := nullif(p->>'cliente_id','')::uuid; v_emp record; v_forma record;
        v_item_id uuid; v_status text; v_parc int; v_series uuid[] := '{}'; v_sid uuid; v_stxt text; v_det jsonb;
        v_band text; v_res record; v_res_id uuid; v_res_serie uuid; v_res_valor bigint; v_troca bigint := 0; tr jsonb; v_orc uuid := nullif(p->>'orcamento_id','')::uuid;
begin
  if not privado.pode('vendas.criar') then raise exception 'Sem permissão para vender.'; end if;
  if v_key is not null then
    select id, numero, status into v_exist from public.vendas where idempotency_key = v_key;
    if found then return jsonb_build_object('id', v_exist.id, 'numero', v_exist.numero, 'status', v_exist.status, 'repetida', true); end if;
  end if;
  if jsonb_array_length(coalesce(p->'itens','[]'::jsonb)) = 0 then raise exception 'Adicione pelo menos um item.'; end if;
  if v_cli is not null and not exists (select 1 from public.clientes where id = v_cli and ativo) then raise exception 'Cliente não encontrado ou inativo.'; end if;
  select * into v_emp from public.empresa where id = 1;

  -- reserva com sinal: a venda usa o aparelho reservado e o sinal já pago
  if nullif(p->>'reserva_id','') is not null then
    select * into v_res from public.reservas where id = (p->>'reserva_id')::uuid for update;
    if not found or v_res.status <> 'ativa' then raise exception 'Reserva não encontrada ou já encerrada.'; end if;
    if v_cli is null then v_cli := v_res.cliente_id; end if;
    if v_cli <> v_res.cliente_id then raise exception 'A reserva é de outro cliente.'; end if;
    v_res_id := v_res.id; v_res_serie := v_res.serie_id; v_res_valor := v_res.valor_sinal_centavos;
    if not exists (select 1 from jsonb_array_elements(p->'itens') x where x->>'serie_id' = v_res.serie_id::text) then
      raise exception 'O aparelho reservado precisa estar na venda.';
    end if;
  end if;
  if jsonb_array_length(coalesce(p->'trocas','[]'::jsonb)) > 0 then
    if not privado.pode('vendas.troca') then raise exception 'Sem permissão para aceitar aparelho na troca.'; end if;
    if v_cli is null then raise exception 'Aparelho na troca precisa de cliente cadastrado (quem está entregando o aparelho).'; end if;
  end if;
  if v_orc is not null and not exists (select 1 from public.orcamentos where id = v_orc and status = 'aberto') then
    raise exception 'O orçamento já foi usado ou cancelado.';
  end if;

  insert into public.vendas (cliente_id, observacao, idempotency_key, status)
  values (v_cli, nullif(trim(p->>'observacao'),''), v_key, 'aguardando_aprovacao')
  returning id, numero into v_id, v_num;

  for it in select * from jsonb_array_elements(p->'itens') loop
    v_ordem := v_ordem + 1;
    v_qtd := coalesce((it->>'quantidade')::numeric, 1);
    v_preco := (it->>'preco_unitario_centavos')::bigint;
    v_desc_item := coalesce((it->>'desconto_centavos')::bigint, 0);
    if v_qtd <= 0 then raise exception 'Quantidade inválida no item %.', v_ordem; end if;
    if v_preco is null or v_preco < 0 then raise exception 'Preço inválido no item %.', v_ordem; end if;
    v_sid := null; v_stxt := null; v_det := null;
    if nullif(it->>'produto_id','') is not null then
      select * into pr from nucleo.produtos where id = (it->>'produto_id')::uuid;
      if not found or not pr.ativo then raise exception 'Produto do item % não encontrado ou inativo.', v_ordem; end if;
      v_tab := pr.preco_venda_centavos;
      v_descricao := pr.nome || case when pr.condicao <> 'novo' then ' (' || pr.condicao || ')' else '' end;
      v_cat := pr.categoria_id;
      v_custo := pr.custo_medio_centavos;
      v_gar := coalesce(nullif(it->>'garantia_dias','')::int, pr.garantia_dias, v_emp.garantia_padrao_dias);
      if pr.controla_serie then
        if nullif(it->>'serie_id','') is null then raise exception 'Escolha o IMEI/série de "%".', pr.nome; end if;
        if v_qtd <> 1 then raise exception 'Produto com IMEI vai 1 por linha ("%").', pr.nome; end if;
        select * into s from nucleo.produto_series where id = (it->>'serie_id')::uuid for update;
        if not found or s.produto_id <> pr.id then raise exception 'IMEI/série não pertence a "%".', pr.nome; end if;
        if not (s.status = 'disponivel' or (s.status = 'reservado' and v_res_id is not null and s.id = v_res_serie and s.venda_item_id is null)) then
          raise exception 'O IMEI/série % não está disponível.', s.serie;
        end if;
        if s.id = any(v_series) then raise exception 'O IMEI/série % está repetido na venda.', s.serie; end if;
        v_series := v_series || s.id;
        v_custo := s.custo_centavos + s.custo_recond_centavos;
        v_tab := coalesce(s.preco_venda_centavos, pr.preco_venda_centavos);
        v_gar := coalesce(nullif(it->>'garantia_dias','')::int, s.garantia_dias, pr.garantia_dias, v_emp.garantia_padrao_dias);
        v_det := jsonb_strip_nulls(jsonb_build_object('condicao', coalesce(s.condicao, case when pr.condicao = 'novo' then 'lacrado' else 'seminovo' end),
                   'grau', s.grau, 'bateria_pct', s.bateria_pct, 'cor', s.cor, 'capacidade', s.capacidade, 'imei2', s.imei2, 'pecas_trocadas', s.pecas_trocadas));
        v_sid := s.id; v_stxt := s.serie;
      end if;
    else
      v_descricao := nullif(trim(it->>'descricao'),'');
      v_cat := nullif(it->>'categoria_id','')::uuid;
      if v_descricao is null then raise exception 'Descreva o item %.', v_ordem; end if;
      if v_cat is null or (select tipo from public.categorias where id = v_cat) <> 'venda' then raise exception 'Escolha a categoria do item %.', v_ordem; end if;
      v_tab := v_preco;
      v_custo := case when privado.pode('estoque.ver_custo') then coalesce((it->>'custo_unitario_centavos')::bigint, 0) else 0 end;
      v_gar := nullif(it->>'garantia_dias','')::int;
    end if;
    v_total_item := round(v_qtd * v_preco)::bigint - v_desc_item;
    if v_desc_item < 0 or v_total_item < 0 then raise exception 'Desconto maior que o valor no item %.', v_ordem; end if;
    insert into nucleo.venda_itens (venda_id, ordem, produto_id, descricao, categoria_id, quantidade, preco_tabela_centavos, preco_unitario_centavos,
                                    desconto_centavos, total_centavos, custo_unitario_centavos, serie_id, serie, garantia_dias, detalhes)
    values (v_id, v_ordem, nullif(it->>'produto_id','')::uuid, v_descricao, v_cat, v_qtd, v_tab, v_preco,
            v_desc_item, v_total_item, v_custo, v_sid, v_stxt, v_gar, v_det)
    returning id into v_item_id;
    if v_sid is not null then
      update nucleo.produto_series set status = 'reservado', venda_item_id = v_item_id where id = v_sid;
    end if;
    v_tabela := v_tabela + round(v_qtd * v_tab)::bigint;
    v_sub := v_sub + v_total_item;
  end loop;

  if v_cli is null and array_length(v_series, 1) > 0 then
    raise exception 'Venda de aparelho (com IMEI) precisa de cliente cadastrado, para a garantia ficar no nome dele.';
  end if;
  v_desc := coalesce((p->>'desconto_centavos')::bigint, 0);
  v_acr := coalesce((p->>'acrescimo_centavos')::bigint, 0);
  if v_desc < 0 or v_desc > v_sub then raise exception 'Desconto inválido.'; end if;
  if v_acr < 0 then raise exception 'Acréscimo inválido.'; end if;
  v_total := v_sub - v_desc + v_acr;
  if v_tabela > 0 then v_pct := round(greatest(0, v_tabela - (v_sub - v_desc))::numeric * 100 / v_tabela, 2); end if;

  -- aparelhos recebidos na troca entram em teste e viram crédito na venda
  for tr in select * from jsonb_array_elements(coalesce(p->'trocas','[]'::jsonb)) loop
    perform privado.receber_aparelho(tr, 'troca', v_cli, v_id);
    v_troca := v_troca + (tr->>'valor_centavos')::bigint;
  end loop;
  if v_troca > 0 then
    if v_troca > v_total then raise exception 'O valor da troca (R$ %) passa do total da compra (R$ %).', to_char(v_troca/100.0,'FM999G999G990D00'), to_char(v_total/100.0,'FM999G999G990D00'); end if;
    insert into public.venda_pagamentos (venda_id, forma, valor_centavos, parcelas, taxa_centavos) values (v_id, 'troca', v_troca, 1, 0);
    v_pagto := v_pagto + v_troca;
  end if;
  if v_res_id is not null then
    insert into public.venda_pagamentos (venda_id, forma, valor_centavos, parcelas, taxa_centavos) values (v_id, 'sinal', v_res_valor, 1, 0);
    v_pagto := v_pagto + v_res_valor;
    update public.reservas set status = 'convertida', venda_id = v_id where id = v_res_id;
  end if;
  if v_orc is not null then update public.orcamentos set status = 'convertido', venda_id = v_id where id = v_orc; end if;

  if v_total > v_pagto and jsonb_array_length(coalesce(p->'pagamentos','[]'::jsonb)) = 0 then raise exception 'Informe a forma de pagamento.'; end if;
  for pg in select * from jsonb_array_elements(coalesce(p->'pagamentos','[]'::jsonb)) loop
    select * into v_forma from public.formas_pagamento where forma = pg->>'forma' and ativo and not interna;
    if not found then raise exception 'Forma de pagamento inválida: %.', pg->>'forma'; end if;
    v_parc := coalesce((pg->>'parcelas')::int, 1);
    if v_parc < 1 or v_parc > 24 then raise exception 'Número de parcelas inválido.'; end if;
    if v_parc > 1 and v_forma.forma not in ('credito','crediario','boleto') then raise exception 'Parcelas só no crédito, crediário ou boleto.'; end if;
    if v_forma.forma = 'crediario' and v_cli is null then raise exception 'Venda no crediário/fiado precisa de cliente cadastrado.'; end if;
    if coalesce((pg->>'valor_centavos')::bigint, 0) <= 0 then raise exception 'Valor de pagamento inválido.'; end if;
    v_band := case when v_forma.forma in ('debito','credito') then nullif(pg->>'bandeira','') end;
    if v_band is not null and not exists (select 1 from public.bandeiras where codigo = v_band and ativo) then raise exception 'Bandeira inválida.'; end if;
    v_pagto := v_pagto + (pg->>'valor_centavos')::bigint;
    insert into public.venda_pagamentos (venda_id, forma, valor_centavos, parcelas, taxa_centavos, primeiro_vencimento, bandeira)
    values (v_id, v_forma.forma, (pg->>'valor_centavos')::bigint, v_parc,
            round((pg->>'valor_centavos')::bigint * privado.taxa_forma(v_forma.forma, v_parc, v_band) / 100)::bigint,
            nullif(pg->>'primeiro_vencimento','')::date, v_band);
  end loop;
  if v_pagto <> v_total then
    raise exception 'Os pagamentos somam R$ % mas o total é R$ %.', to_char(v_pagto/100.0,'FM999G999G990D00'), to_char(v_total/100.0,'FM999G999G990D00');
  end if;

  update public.vendas set valor_tabela_centavos = v_tabela, subtotal_centavos = v_sub, desconto_centavos = v_desc,
         acrescimo_centavos = v_acr, total_centavos = v_total, desconto_pct = v_pct
  where id = v_id;

  if v_pct > v_emp.desconto_max_pct and not privado.pode('vendas.desconto_livre') then
    v_status := 'aguardando_aprovacao';
  else
    if v_pct > v_emp.desconto_max_pct then update public.vendas set aprovado_por = auth.uid(), aprovado_em = now() where id = v_id; end if;
    perform privado.efetivar_venda(v_id);
    v_status := 'concluida';
  end if;
  return jsonb_build_object('id', v_id, 'numero', v_num, 'status', v_status, 'total_centavos', v_total, 'desconto_pct', v_pct);
end $$;

create or replace function public.entregar_os(p jsonb)
returns jsonb language plpgsql security definer set search_path = nucleo, public as $$
declare o record; pg jsonb; f record; v_total bigint; v_pago bigint := 0; v_parc int; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
        v_n int; v_k int; v_parte bigint; v_taxa bigint; v_taxa_parte bigint; v_soma bigint; v_soma_taxa bigint; v_venc date; v_tid uuid; v_cli text; v_reparou boolean; v_band text;
begin
  if not privado.pode('os.entregar') then raise exception 'Sem permissão para entregar OS.'; end if;
  select * into o from public.ordens_servico where id = (p->>'id')::uuid for update;
  if not found then raise exception 'OS não encontrada.'; end if;
  if o.interna then raise exception 'OS interna se encerra sozinha ao concluir o reparo.'; end if;
  if o.status not in ('pronta','reprovada') then
    raise exception 'Só dá para entregar OS pronta ou com orçamento recusado (esta está "%").', privado.os_rotulo(o.status);
  end if;
  v_reparou := o.status = 'pronta';
  if v_reparou and p ? 'desconto_centavos' then
    update public.ordens_servico set desconto_centavos = coalesce((p->>'desconto_centavos')::bigint, 0) where id = o.id;
    perform privado.os_recalcular(o.id);
  end if;
  select case when v_reparou then total_centavos else taxa_diagnostico_centavos end into v_total from public.ordens_servico where id = o.id;
  select nome into v_cli from public.clientes where id = o.cliente_id;

  for pg in select * from jsonb_array_elements(coalesce(p->'pagamentos','[]'::jsonb)) loop
    if coalesce((pg->>'valor_centavos')::bigint, 0) <= 0 then continue; end if;
    select * into f from public.formas_pagamento where forma = pg->>'forma' and ativo and not interna;
    if not found then raise exception 'Forma de pagamento inválida: %.', pg->>'forma'; end if;
    v_parc := coalesce((pg->>'parcelas')::int, 1);
    if v_parc < 1 or v_parc > 24 then raise exception 'Número de parcelas inválido.'; end if;
    if v_parc > 1 and f.forma not in ('credito','crediario','boleto') then raise exception 'Parcelas só no crédito, crediário ou boleto.'; end if;
    v_band := case when f.forma in ('debito','credito') then nullif(pg->>'bandeira','') end;
    if v_band is not null and not exists (select 1 from public.bandeiras where codigo = v_band and ativo) then raise exception 'Bandeira inválida.'; end if;
    v_taxa := round((pg->>'valor_centavos')::bigint * privado.taxa_forma(f.forma, v_parc, v_band) / 100)::bigint;
    insert into public.os_pagamentos (os_id, forma, valor_centavos, parcelas, taxa_centavos, primeiro_vencimento, bandeira)
    values (o.id, f.forma, (pg->>'valor_centavos')::bigint, v_parc, v_taxa, nullif(pg->>'primeiro_vencimento','')::date, v_band);
    v_pago := v_pago + (pg->>'valor_centavos')::bigint;

    if f.forma = 'credito' and f.antecipar then v_n := 1; else v_n := v_parc; end if;
    if f.forma not in ('credito','crediario','boleto') then v_n := 1; end if;
    v_soma := 0; v_soma_taxa := 0;
    for v_k in 1..v_n loop
      if v_k = v_n then v_parte := (pg->>'valor_centavos')::bigint - v_soma; v_taxa_parte := v_taxa - v_soma_taxa;
      else v_parte := (pg->>'valor_centavos')::bigint / v_n; v_taxa_parte := v_taxa / v_n; end if;
      v_soma := v_soma + v_parte; v_soma_taxa := v_soma_taxa + v_taxa_parte;
      v_venc := coalesce(nullif(pg->>'primeiro_vencimento','')::date, v_hoje + f.dias_repasse);
      if v_k > 1 then v_venc := (v_venc + make_interval(months => v_k - 1))::date; end if;
      insert into public.titulos (tipo, descricao, categoria_id, cliente_id, os_id, forma_pagamento, conta_prevista_id,
                                  competencia, vencimento, parcela, parcelas, valor_centavos, taxa_prevista_centavos, baixa_automatica)
      values ('receber', 'OS nº ' || o.numero || coalesce(' — ' || v_cli, ''), privado.cat('assistencia'), o.cliente_id, o.id, f.forma, f.conta_id,
              v_hoje, v_venc, v_k, v_n, v_parte, v_taxa_parte, f.baixa_automatica and f.conta_id is not null)
      returning id into v_tid;
      if f.baixa_automatica and f.conta_id is not null and v_venc <= v_hoje then
        perform privado.baixar(v_tid, v_venc, f.conta_id, v_parte, 0, 0, 0, v_taxa_parte, true);
      end if;
    end loop;
  end loop;
  if v_pago <> v_total then
    raise exception 'Os pagamentos somam % mas o total a cobrar é %.', privado.fmt_moeda(v_pago), privado.fmt_moeda(v_total);
  end if;

  update public.ordens_servico set status = 'entregue', entregue_em = now(), entregue_por = auth.uid(),
         total_centavos = case when v_reparou then total_centavos else v_total end,
         garantia_ate = case when v_reparou and coalesce(garantia_dias,0) > 0 then v_hoje + garantia_dias end
  where id = o.id;
  update nucleo.os_senhas set valor = null, apagada_em = now() where os_id = o.id;
  perform privado.os_evento(o.id, 'entrega', case when v_reparou then 'Entregue ao cliente' else 'Devolvido sem reparo (orçamento recusado)' end
          || ' · cobrado ' || privado.fmt_moeda(v_total) || ' · senha apagada');
  return jsonb_build_object('total_centavos', v_total);
end $$;
