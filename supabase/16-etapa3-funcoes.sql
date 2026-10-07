-- =====================================================================
-- Etapa 3 — funções: troca, compra de cliente, reserva, orçamento,
-- e ajustes em efetivar/aprovar/cancelar venda, DRE e busca
-- =====================================================================

-- Recebe um aparelho do cliente (troca ou compra): cria a unidade "em teste" e a avaliação
create or replace function privado.receber_aparelho(p jsonb, p_tipo text, p_cliente uuid, p_venda uuid default null)
returns uuid language plpgsql security definer set search_path = nucleo, public as $$
declare pr record; v_sid uuid; v_av uuid; v_valor bigint := (p->>'valor_centavos')::bigint; v_imei text := upper(trim(p->>'imei'));
        v_num bigint; v_ref text;
begin
  select * into pr from nucleo.produtos where id = (p->>'produto_id')::uuid;
  if not found then raise exception 'Escolha o modelo do aparelho recebido.'; end if;
  if not pr.controla_serie then raise exception 'O modelo "%" não controla IMEI. Escolha um aparelho com IMEI.', pr.nome; end if;
  if coalesce(length(v_imei),0) < 5 then raise exception 'Informe o IMEI do aparelho recebido.'; end if;
  if coalesce(v_valor,0) <= 0 then raise exception 'Informe o valor da avaliação.'; end if;
  begin
    insert into nucleo.produto_series (produto_id, serie, status, custo_centavos, imei2, condicao, grau, bateria_pct, cor, capacidade,
                                       pecas_trocadas, checklist, procedencia, cliente_origem_id, observacao)
    values (pr.id, v_imei, 'em_teste', v_valor, nullif(upper(trim(p->>'imei2')),''), coalesce(nullif(p->>'condicao',''), 'seminovo'),
            nullif(p->>'grau',''), nullif(p->>'bateria_pct','')::smallint, nullif(trim(p->>'cor'),''), nullif(upper(trim(p->>'capacidade')),''),
            nullif(trim(p->>'pecas_trocadas'),''), coalesce(p->'checklist', '{}'::jsonb), case when p_tipo = 'troca' then 'trade_in' else 'compra_cliente' end,
            p_cliente, nullif(trim(p->>'observacao'),''))
    returning id into v_sid;
  exception when unique_violation then
    raise exception 'O IMEI % já está cadastrado no sistema.', v_imei;
  end;
  insert into public.avaliacoes (tipo, cliente_id, serie_id, produto_id, imei, valor_centavos, detalhes, documento, venda_id, observacao)
  values (p_tipo, p_cliente, v_sid, pr.id, v_imei, v_valor,
          jsonb_strip_nulls(jsonb_build_object('condicao', coalesce(nullif(p->>'condicao',''), 'seminovo'), 'grau', nullif(p->>'grau',''),
            'bateria_pct', nullif(p->>'bateria_pct','')::int, 'cor', nullif(trim(p->>'cor'),''), 'capacidade', nullif(upper(trim(p->>'capacidade')),''),
            'imei2', nullif(upper(trim(p->>'imei2')),''), 'checklist', p->'checklist')),
          nullif(regexp_replace(coalesce(p->>'documento',''), '[^0-9A-Za-z]', '', 'g'), ''), p_venda, nullif(trim(p->>'observacao'),''))
  returning id, numero into v_av, v_num;
  v_ref := case when p_tipo = 'troca' then 'Recebido na troca (avaliação nº ' || v_num || ')' else 'Comprado de cliente (avaliação nº ' || v_num || ')' end;
  insert into nucleo.estoque_movimentos (produto_id, tipo, quantidade, custo_unitario_centavos, serie_id, venda_id, motivo)
  values (pr.id, 'entrada_compra', 1, v_valor, v_sid, p_venda, v_ref);
  insert into nucleo.serie_eventos (serie_id, tipo, descricao) values (v_sid, 'entrada', v_ref || ' por ' || privado.fmt_moeda(v_valor));
  return v_av;
end $$;

-- Desfaz o que a venda trouxe junto (aparelhos na troca, reserva, orçamento) quando ela é cancelada ou reprovada
create or replace function privado.desfazer_extras_venda(p_venda uuid, p_motivo text)
returns void language plpgsql security definer set search_path = nucleo, public as $$
declare a record; s record; r record;
begin
  for a in select * from public.avaliacoes where venda_id = p_venda and status = 'ativa' for update loop
    select * into s from nucleo.produto_series where id = a.serie_id for update;
    if s.status not in ('em_teste','disponivel','em_reparo','em_garantia') then
      raise exception 'O aparelho recebido na troca (IMEI %) já foi vendido ou baixado. Resolva isso antes de cancelar a venda.', a.imei;
    end if;
    insert into nucleo.estoque_movimentos (produto_id, tipo, quantidade, custo_unitario_centavos, serie_id, venda_id, motivo)
    values (s.produto_id, 'ajuste', -1, s.custo_centavos, s.id, p_venda, 'Troca desfeita: ' || p_motivo);
    update nucleo.produto_series set status = 'baixado', observacao = 'Troca desfeita (devolvido ao cliente): ' || p_motivo where id = s.id;
    update public.avaliacoes set status = 'cancelada', motivo_cancelamento = p_motivo, cancelada_em = now() where id = a.id;
  end loop;
  for r in select * from public.reservas where venda_id = p_venda and status = 'convertida' for update loop
    update public.reservas set status = 'ativa', venda_id = null where id = r.id;
    update nucleo.produto_series set status = 'reservado', venda_item_id = null, observacao = 'Reserva nº ' || r.numero
    where id = r.serie_id and status in ('disponivel','reservado');
  end loop;
  update public.orcamentos set status = 'aberto', venda_id = null where venda_id = p_venda and status = 'convertido';
end $$;

-- Compra de aparelho de cliente (sem venda): entra em teste e paga o cliente
create or replace function public.comprar_aparelho_cliente(p jsonb)
returns jsonb language plpgsql security definer set search_path = nucleo, public as $$
declare v_cli record; v_doc text := upper(regexp_replace(coalesce(p->>'documento',''), '[^0-9A-Za-z]', '', 'g')); v_av uuid; v_num bigint; v_tid uuid;
        v_valor bigint := (p->>'valor_centavos')::bigint; v_conta uuid := nullif(p->>'conta_id','')::uuid; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not privado.pode('aparelhos.comprar') then raise exception 'Sem permissão para comprar aparelhos.'; end if;
  select * into v_cli from public.clientes where id = (p->>'cliente_id')::uuid;
  if not found then raise exception 'Escolha quem está vendendo o aparelho (cadastro de cliente).'; end if;
  if v_doc = '' then v_doc := coalesce(v_cli.cpf, v_cli.cnpj, ''); end if;
  if not (privado.cpf_valido(v_doc) or privado.cnpj_valido(v_doc)) then raise exception 'Informe um CPF ou CNPJ válido de quem está vendendo.'; end if;
  if v_conta is null then raise exception 'Escolha de qual conta sai o pagamento (caixa, PIX…).'; end if;
  if length(v_doc) = 11 and v_cli.cpf is null then update public.clientes set cpf = v_doc where id = v_cli.id; end if;
  if length(v_doc) = 14 and v_cli.cnpj is null then update public.clientes set cnpj = v_doc, tipo_pessoa = 'pj' where id = v_cli.id; end if;
  v_av := privado.receber_aparelho(p || jsonb_build_object('documento', v_doc), 'compra', v_cli.id, null);
  select numero into v_num from public.avaliacoes where id = v_av;
  insert into public.titulos (tipo, descricao, categoria_id, cliente_id, competencia, vencimento, valor_centavos, observacao)
  values ('pagar', 'Compra de aparelho de cliente nº ' || v_num || ' — ' || v_cli.nome, privado.cat('compra_mercadoria'), v_cli.id,
          v_hoje, v_hoje, v_valor, 'IMEI ' || upper(trim(p->>'imei')))
  returning id into v_tid;
  perform privado.baixar(v_tid, v_hoje, v_conta, v_valor);
  update public.avaliacoes set titulo_id = v_tid where id = v_av;
  return jsonb_build_object('id', v_av, 'numero', v_num);
end $$;

create or replace function public.cancelar_compra_aparelho(p_avaliacao uuid, p_motivo text, p_conta uuid default null)
returns void language plpgsql security definer set search_path = nucleo, public as $$
declare a record; s record;
begin
  if not privado.pode('aparelhos.comprar') then raise exception 'Sem permissão.'; end if;
  if coalesce(length(trim(p_motivo)),0) < 3 then raise exception 'Informe o motivo.'; end if;
  select * into a from public.avaliacoes where id = p_avaliacao for update;
  if not found or a.status <> 'ativa' or a.tipo <> 'compra' then raise exception 'Compra não encontrada ou já cancelada.'; end if;
  select * into s from nucleo.produto_series where id = a.serie_id for update;
  if s.status not in ('em_teste','disponivel','em_reparo','em_garantia') then raise exception 'O aparelho já foi vendido ou baixado.'; end if;
  insert into nucleo.estoque_movimentos (produto_id, tipo, quantidade, custo_unitario_centavos, serie_id, motivo)
  values (s.produto_id, 'ajuste', -1, s.custo_centavos, s.id, 'Compra de cliente cancelada: ' || trim(p_motivo));
  update nucleo.produto_series set status = 'baixado', observacao = 'Compra cancelada: ' || trim(p_motivo) where id = s.id;
  if a.titulo_id is not null then perform privado.cancelar_titulo(a.titulo_id, 'Compra de aparelho cancelada: ' || trim(p_motivo), true); end if;
  update public.avaliacoes set status = 'cancelada', motivo_cancelamento = trim(p_motivo), cancelada_em = now() where id = a.id;
end $$;

-- Reserva com sinal
create or replace function public.criar_reserva(p jsonb)
returns jsonb language plpgsql security definer set search_path = nucleo, public as $$
declare s record; f record; v_id uuid; v_num bigint; v_tid uuid; v_valor bigint := (p->>'valor_sinal_centavos')::bigint;
        v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_val date; v_cli text; v_taxa bigint;
begin
  if not privado.pode('vendas.reservar') then raise exception 'Sem permissão para reservar.'; end if;
  select nome into v_cli from public.clientes where id = (p->>'cliente_id')::uuid and ativo;
  if v_cli is null then raise exception 'Escolha o cliente da reserva.'; end if;
  select * into s from nucleo.produto_series where id = (p->>'serie_id')::uuid for update;
  if not found or s.status <> 'disponivel' then raise exception 'Este aparelho não está disponível para reserva.'; end if;
  if coalesce(v_valor,0) <= 0 then raise exception 'Informe o valor do sinal.'; end if;
  select * into f from public.formas_pagamento where forma = p->>'forma' and ativo and not interna;
  if not found or f.forma in ('crediario','boleto') then raise exception 'Forma de pagamento do sinal inválida.'; end if;
  if f.conta_id is null then raise exception 'A forma "%" não tem conta definida em Configurações › Pagamentos.', f.nome; end if;
  v_val := coalesce(nullif(p->>'validade','')::date, v_hoje + (select reserva_dias_padrao from public.empresa where id = 1));
  if v_val < v_hoje then raise exception 'A validade não pode ser no passado.'; end if;
  insert into public.reservas (cliente_id, serie_id, valor_sinal_centavos, forma, validade, observacao)
  values ((p->>'cliente_id')::uuid, s.id, v_valor, f.forma, v_val, nullif(trim(p->>'observacao'),''))
  returning id, numero into v_id, v_num;
  update nucleo.produto_series set status = 'reservado', venda_item_id = null, observacao = 'Reserva nº ' || v_num || ' — ' || v_cli where id = s.id;
  v_taxa := round(v_valor * privado.taxa_forma(f.forma, 1) / 100)::bigint;
  insert into public.titulos (tipo, descricao, categoria_id, cliente_id, reserva_id, forma_pagamento, conta_prevista_id, competencia, vencimento, valor_centavos, taxa_prevista_centavos)
  values ('receber', 'Sinal da reserva nº ' || v_num || ' — ' || v_cli, privado.cat('sinal'), (p->>'cliente_id')::uuid, v_id, f.forma, f.conta_id,
          v_hoje, v_hoje, v_valor, v_taxa)
  returning id into v_tid;
  perform privado.baixar(v_tid, v_hoje, f.conta_id, v_valor, 0, 0, 0, v_taxa, true);
  return jsonb_build_object('id', v_id, 'numero', v_num);
end $$;

create or replace function public.cancelar_reserva(p_reserva uuid, p_devolver boolean, p_motivo text, p_conta uuid default null)
returns void language plpgsql security definer set search_path = nucleo, public as $$
declare r record; v_tid uuid; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not privado.pode('vendas.reservar') then raise exception 'Sem permissão.'; end if;
  if coalesce(length(trim(p_motivo)),0) < 3 then raise exception 'Informe o motivo.'; end if;
  select * into r from public.reservas where id = p_reserva for update;
  if not found or r.status <> 'ativa' then raise exception 'Reserva não encontrada ou já encerrada.'; end if;
  if p_devolver then
    if p_conta is null then raise exception 'Escolha de qual conta sai a devolução do sinal.'; end if;
    insert into public.titulos (tipo, descricao, categoria_id, cliente_id, reserva_id, competencia, vencimento, valor_centavos)
    values ('pagar', 'Devolução do sinal da reserva nº ' || r.numero, privado.cat('devolucao'), r.cliente_id, r.id, v_hoje, v_hoje, r.valor_sinal_centavos)
    returning id into v_tid;
    perform privado.baixar(v_tid, v_hoje, p_conta, r.valor_sinal_centavos);
  end if;
  update public.reservas set status = 'cancelada', sinal_devolvido = p_devolver, motivo_cancelamento = trim(p_motivo), cancelada_em = now() where id = r.id;
  update nucleo.produto_series set status = 'disponivel', observacao = 'Reserva nº ' || r.numero || ' cancelada: ' || trim(p_motivo)
  where id = r.serie_id and status = 'reservado' and venda_item_id is null;
end $$;

-- Orçamentos
create or replace function public.salvar_orcamento(p jsonb)
returns jsonb language plpgsql security definer set search_path = nucleo, public as $$
declare v_id uuid := nullif(p->>'id','')::uuid; it jsonb; v_itens jsonb := '[]'::jsonb; v_sub bigint := 0; v_desc bigint := coalesce((p->>'desconto_centavos')::bigint, 0);
        v_qtd numeric; v_preco bigint; v_num bigint; v_val date; v_tel text := nullif(regexp_replace(coalesce(p->>'cliente_telefone',''), '\D', '', 'g'), '');
begin
  if not privado.pode('vendas.orcamento') then raise exception 'Sem permissão para orçamentos.'; end if;
  if jsonb_array_length(coalesce(p->'itens','[]'::jsonb)) = 0 then raise exception 'Adicione pelo menos um item.'; end if;
  if nullif(p->>'cliente_id','') is null and coalesce(length(trim(p->>'cliente_nome')),0) < 2 then raise exception 'Informe o cliente (cadastro ou nome).'; end if;
  for it in select * from jsonb_array_elements(p->'itens') loop
    v_qtd := coalesce((it->>'quantidade')::numeric, 1); v_preco := (it->>'preco_unitario_centavos')::bigint;
    if v_qtd <= 0 or coalesce(v_preco, -1) < 0 then raise exception 'Item inválido no orçamento.'; end if;
    if coalesce(length(trim(it->>'descricao')),0) < 2 then raise exception 'Descreva todos os itens.'; end if;
    v_sub := v_sub + round(v_qtd * v_preco)::bigint;
    v_itens := v_itens || jsonb_strip_nulls(jsonb_build_object('produto_id', nullif(it->>'produto_id',''), 'serie_id', nullif(it->>'serie_id',''),
      'serie', nullif(it->>'serie',''), 'descricao', trim(it->>'descricao'), 'categoria_id', nullif(it->>'categoria_id',''),
      'quantidade', v_qtd, 'preco_unitario_centavos', v_preco, 'detalhes', it->'detalhes', 'garantia_dias', nullif(it->>'garantia_dias','')::int));
  end loop;
  if v_desc < 0 or v_desc > v_sub then raise exception 'Desconto inválido.'; end if;
  v_val := coalesce(nullif(p->>'validade','')::date, (now() at time zone 'America/Sao_Paulo')::date + (select orcamento_validade_dias from public.empresa where id = 1));
  if v_id is null then
    insert into public.orcamentos (cliente_id, cliente_nome, cliente_telefone, itens, subtotal_centavos, desconto_centavos, total_centavos, validade, condicoes, observacao)
    values (nullif(p->>'cliente_id','')::uuid, nullif(trim(p->>'cliente_nome'),''), v_tel, v_itens, v_sub, v_desc, v_sub - v_desc, v_val,
            nullif(trim(p->>'condicoes'),''), nullif(trim(p->>'observacao'),''))
    returning id, numero into v_id, v_num;
  else
    update public.orcamentos set cliente_id = nullif(p->>'cliente_id','')::uuid, cliente_nome = nullif(trim(p->>'cliente_nome'),''), cliente_telefone = v_tel,
      itens = v_itens, subtotal_centavos = v_sub, desconto_centavos = v_desc, total_centavos = v_sub - v_desc, validade = v_val,
      condicoes = nullif(trim(p->>'condicoes'),''), observacao = nullif(trim(p->>'observacao'),'')
    where id = v_id and status = 'aberto' and (criado_por = auth.uid() or privado.pode('vendas.ver_todas'))
    returning numero into v_num;
    if v_num is null then raise exception 'Só dá para alterar orçamento em aberto (e seu).'; end if;
  end if;
  return jsonb_build_object('id', v_id, 'numero', v_num);
end $$;

create or replace function public.cancelar_orcamento(p_orcamento uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not privado.pode('vendas.orcamento') then raise exception 'Sem permissão.'; end if;
  update public.orcamentos set status = 'cancelado', motivo_cancelamento = coalesce(nullif(trim(p_motivo),''), 'Cancelado')
  where id = p_orcamento and status = 'aberto' and (criado_por = auth.uid() or privado.pode('vendas.ver_todas'));
  if not found then raise exception 'Orçamento não encontrado ou já encerrado.'; end if;
end $$;

create or replace function privado.efetivar_venda(p_venda uuid)
returns void language plpgsql security definer set search_path = nucleo, public as $$
declare v record; i record; s record; pg record; f record; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
        v_n int; v_k int; v_parte bigint; v_taxa_parte bigint; v_soma bigint; v_soma_taxa bigint; v_venc date; v_tid uuid;
        v_desc text; v_cli text;
begin
  select * into v from public.vendas where id = p_venda for update;
  select nome into v_cli from public.clientes where id = v.cliente_id;

  for i in select vi.*, pr.controla_estoque, pr.controla_serie from nucleo.venda_itens vi
           left join nucleo.produtos pr on pr.id = vi.produto_id where vi.venda_id = p_venda order by vi.ordem loop
    if i.produto_id is null or not i.controla_estoque then continue; end if;
    if i.serie_id is not null then
      select * into s from nucleo.produto_series where id = i.serie_id for update;
      if not (s.status = 'disponivel' or (s.status = 'reservado' and s.venda_item_id = i.id)) then
        raise exception 'O IMEI/série % não está disponível (situação: %).', s.serie, s.status;
      end if;
      update nucleo.produto_series set status = 'vendido', venda_item_id = i.id where id = s.id;
      insert into nucleo.estoque_movimentos (produto_id, tipo, quantidade, custo_unitario_centavos, serie_id, venda_id, venda_item_id, motivo, criado_por)
      values (i.produto_id, 'venda', -1, s.custo_centavos, s.id, p_venda, i.id, 'Venda nº ' || v.numero, v.criado_por);
    else
      insert into nucleo.estoque_movimentos (produto_id, tipo, quantidade, custo_unitario_centavos, venda_id, venda_item_id, motivo, criado_por)
      values (i.produto_id, 'venda', -i.quantidade, i.custo_unitario_centavos, p_venda, i.id, 'Venda nº ' || v.numero, v.criado_por);
    end if;
  end loop;

  v_desc := 'Venda nº ' || v.numero || coalesce(' — ' || v_cli, '');
  for pg in select * from public.venda_pagamentos where venda_id = p_venda loop
    select * into f from public.formas_pagamento where forma = pg.forma;
    if f.interna then continue; end if;  -- troca e sinal não geram conta a receber
    if pg.forma = 'credito' and f.antecipar then v_n := 1; else v_n := pg.parcelas; end if;
    if pg.forma not in ('credito','crediario','boleto') then v_n := 1; end if;
    v_soma := 0; v_soma_taxa := 0;
    for v_k in 1..v_n loop
      if v_k = v_n then v_parte := pg.valor_centavos - v_soma; v_taxa_parte := pg.taxa_centavos - v_soma_taxa;
      else v_parte := pg.valor_centavos / v_n; v_taxa_parte := pg.taxa_centavos / v_n; end if;
      v_soma := v_soma + v_parte; v_soma_taxa := v_soma_taxa + v_taxa_parte;
      v_venc := coalesce(pg.primeiro_vencimento, v.data + f.dias_repasse);
      if v_k > 1 then v_venc := (v_venc + make_interval(months => v_k - 1))::date; end if;
      insert into public.titulos (tipo, descricao, categoria_id, cliente_id, venda_id, forma_pagamento, conta_prevista_id,
                                  competencia, vencimento, parcela, parcelas, valor_centavos, taxa_prevista_centavos, baixa_automatica, criado_por)
      values ('receber', v_desc, privado.cat('vendas'), v.cliente_id, p_venda, pg.forma, f.conta_id,
              v.data, v_venc, v_k, v_n, v_parte, v_taxa_parte, f.baixa_automatica and f.conta_id is not null, v.criado_por)
      returning id into v_tid;
      if f.baixa_automatica and f.conta_id is not null and v_venc <= v_hoje then
        perform privado.baixar(v_tid, v_venc, f.conta_id, v_parte, 0, 0, 0, v_taxa_parte, true);
      end if;
    end loop;
  end loop;

  update public.vendas set status = 'concluida' where id = p_venda;
end $$;

create or replace function public.aprovar_venda(p_venda uuid, p_aprovar boolean, p_motivo text default null)
returns void language plpgsql security definer set search_path = nucleo, public as $$
declare v record;
begin
  if not privado.pode('vendas.aprovar') then raise exception 'Sem permissão para aprovar vendas.'; end if;
  select * into v from public.vendas where id = p_venda for update;
  if v.status <> 'aguardando_aprovacao' then raise exception 'Esta venda não está aguardando aprovação.'; end if;
  if p_aprovar then
    update public.vendas set aprovado_por = auth.uid(), aprovado_em = now() where id = p_venda;
    perform privado.efetivar_venda(p_venda);
  else
    update nucleo.produto_series set status = 'disponivel', venda_item_id = null
    where venda_item_id in (select id from nucleo.venda_itens where venda_id = p_venda) and status = 'reservado';
    perform privado.desfazer_extras_venda(p_venda, 'Venda reprovada');
    update public.vendas set status = 'cancelada', cancelada_em = now(), cancelada_por = auth.uid(),
           motivo_cancelamento = 'Reprovada: ' || coalesce(nullif(trim(p_motivo),''), 'desconto não aprovado')
    where id = p_venda;
  end if;
end $$;

create or replace function public.cancelar_venda(p_venda uuid, p_motivo text)
returns void language plpgsql security definer set search_path = nucleo, public as $$
declare v record; i record; t record; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if coalesce(length(trim(p_motivo)),0) < 3 then raise exception 'Informe o motivo do cancelamento.'; end if;
  select * into v from public.vendas where id = p_venda for update;
  if not found then raise exception 'Venda não encontrada.'; end if;
  if v.status in ('cancelada','devolvida') then raise exception 'Esta venda já está %.', v.status; end if;
  if not (privado.pode('vendas.cancelar_todas')
          or (privado.pode('vendas.cancelar_proprias') and v.criado_por = auth.uid()
              and (v.criado_em at time zone 'America/Sao_Paulo')::date = v_hoje)) then
    raise exception 'Sem permissão para cancelar esta venda.';
  end if;
  if exists (select 1 from public.devolucoes where venda_id = p_venda) then
    raise exception 'Esta venda já teve devolução. Use a devolução para os itens que faltam.';
  end if;

  if v.status = 'aguardando_aprovacao' then
    update nucleo.produto_series set status = 'disponivel', venda_item_id = null
    where venda_item_id in (select id from nucleo.venda_itens where venda_id = p_venda) and status = 'reservado';
  else
    for i in select vi.*, pr.controla_estoque from nucleo.venda_itens vi join nucleo.produtos pr on pr.id = vi.produto_id
             where vi.venda_id = p_venda and pr.controla_estoque loop
      if i.serie_id is not null then
        update nucleo.produto_series set status = 'disponivel', venda_item_id = null where id = i.serie_id;
        insert into nucleo.estoque_movimentos (produto_id, tipo, quantidade, custo_unitario_centavos, serie_id, venda_id, venda_item_id, motivo)
        values (i.produto_id, 'cancelamento_venda', 1, i.custo_unitario_centavos, i.serie_id, p_venda, i.id, 'Cancelamento da venda nº ' || v.numero);
      else
        insert into nucleo.estoque_movimentos (produto_id, tipo, quantidade, custo_unitario_centavos, venda_id, venda_item_id, motivo)
        values (i.produto_id, 'cancelamento_venda', i.quantidade, i.custo_unitario_centavos, p_venda, i.id, 'Cancelamento da venda nº ' || v.numero);
      end if;
    end loop;
    for t in select id from public.titulos where venda_id = p_venda and status <> 'cancelado' loop
      perform privado.cancelar_titulo(t.id, 'Venda cancelada: ' || trim(p_motivo), true);
    end loop;
  end if;
  perform privado.desfazer_extras_venda(p_venda, 'Venda cancelada: ' || trim(p_motivo));
  update public.vendas set status = 'cancelada', motivo_cancelamento = trim(p_motivo), cancelada_em = now(), cancelada_por = auth.uid()
  where id = p_venda;
end $$;

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

create or replace function public.busca_geral(p_termo text)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare q text := trim(p_termo); d text := regexp_replace(p_termo, '\D', '', 'g'); r jsonb := '[]'::jsonb;
begin
  if length(q) < 2 then return r; end if;
  if privado.pode('clientes.ver') then
    r := r || coalesce((select jsonb_agg(jsonb_build_object('tipo','cliente','id',id,'titulo',nome,'sub',coalesce(telefone,email,''))) from (
      select id, nome, telefone, email from public.clientes
      where nome ilike '%' || q || '%' or (length(d) >= 4 and (telefone like '%' || d || '%' or cpf like '%' || d || '%'))
         or (length(q) >= 4 and upper(cnpj) like '%' || upper(regexp_replace(q, '[^0-9A-Za-z]', '', 'g')) || '%') or email ilike '%' || q || '%'
      order by ativo desc, nome limit 6) z), '[]'::jsonb);
  end if;
  if privado.ve_catalogo() then
    if length(q) >= 4 then
      r := r || coalesce((select jsonb_agg(jsonb_build_object('tipo','aparelho','id',a.id,'titulo',a.produto,
                   'sub','IMEI ' || a.imei || coalesce(' · ' || a.cor, '') || coalesce(' · grau ' || a.grau, '') || ' · ' || a.status))
        from (select * from public.aparelhos where upper(imei) like '%' || upper(q) || '%' or upper(coalesce(imei2,'')) like '%' || upper(q) || '%'
              order by criado_em desc limit 5) a), '[]'::jsonb);
    end if;
    r := r || coalesce((select jsonb_agg(jsonb_build_object('tipo','produto','id', b.produto_id, 'titulo', b.nome,
                 'sub', b.sku || ' · estoque ' || trim(to_char(b.estoque_atual, 'FM999G990D###'))))
      from public.buscar_produto(q, 6) b where b.serie_id is null), '[]'::jsonb);
  end if;
  if d <> '' and length(d) <= 9 then
    r := r || coalesce((select jsonb_agg(jsonb_build_object('tipo','venda','id',id,'titulo','Venda nº ' || numero,'sub', coalesce(cliente_nome,'Venda balcão') || ' · ' || to_char(data,'DD/MM/YYYY')))
      from public.vendas_lista where numero = d::bigint), '[]'::jsonb);
  end if;
  return r;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.comprar_aparelho_cliente(jsonb)','public.cancelar_compra_aparelho(uuid,text,uuid)',
    'public.criar_reserva(jsonb)','public.cancelar_reserva(uuid,boolean,text,uuid)','public.salvar_orcamento(jsonb)',
    'public.cancelar_orcamento(uuid,text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  execute 'revoke execute on function privado.receber_aparelho(jsonb,text,uuid,uuid), privado.desfazer_extras_venda(uuid,text) from public, anon, authenticated';
end $$;
