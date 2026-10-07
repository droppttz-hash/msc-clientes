-- =====================================================================
-- Etapa 2 — Aparelhos: venda usa preço próprio do aparelho, custo com
-- recondicionamento e guarda o retrato do aparelho no item
-- =====================================================================
create or replace function public.finalizar_venda(p jsonb)
returns jsonb language plpgsql security definer set search_path = nucleo, public as $$
declare v_key uuid := nullif(p->>'chave','')::uuid; v_exist record; v_id uuid; v_num bigint; it jsonb; pg jsonb; pr record; s record;
        v_ordem int := 0; v_qtd numeric; v_preco bigint; v_tab bigint; v_desc_item bigint; v_total_item bigint; v_custo bigint;
        v_descricao text; v_cat uuid; v_gar int; v_tabela bigint := 0; v_sub bigint := 0; v_desc bigint; v_acr bigint; v_total bigint;
        v_pct numeric := 0; v_pagto bigint := 0; v_cli uuid := nullif(p->>'cliente_id','')::uuid; v_emp record; v_forma record;
        v_item_id uuid; v_status text; v_parc int; v_series uuid[] := '{}'; v_sid uuid; v_stxt text; v_det jsonb;
begin
  if not privado.pode('vendas.criar') then raise exception 'Sem permissão para vender.'; end if;
  if v_key is not null then
    select id, numero, status into v_exist from public.vendas where idempotency_key = v_key;
    if found then return jsonb_build_object('id', v_exist.id, 'numero', v_exist.numero, 'status', v_exist.status, 'repetida', true); end if;
  end if;
  if jsonb_array_length(coalesce(p->'itens','[]'::jsonb)) = 0 then raise exception 'Adicione pelo menos um item.'; end if;
  if v_cli is not null and not exists (select 1 from public.clientes where id = v_cli and ativo) then raise exception 'Cliente não encontrado ou inativo.'; end if;
  select * into v_emp from public.empresa where id = 1;

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
        if s.status <> 'disponivel' then raise exception 'O IMEI/série % não está disponível.', s.serie; end if;
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

  if v_total > 0 and jsonb_array_length(coalesce(p->'pagamentos','[]'::jsonb)) = 0 then raise exception 'Informe a forma de pagamento.'; end if;
  for pg in select * from jsonb_array_elements(coalesce(p->'pagamentos','[]'::jsonb)) loop
    select * into v_forma from public.formas_pagamento where forma = pg->>'forma' and ativo;
    if not found then raise exception 'Forma de pagamento inválida: %.', pg->>'forma'; end if;
    v_parc := coalesce((pg->>'parcelas')::int, 1);
    if v_parc < 1 or v_parc > 24 then raise exception 'Número de parcelas inválido.'; end if;
    if v_parc > 1 and v_forma.forma not in ('credito','crediario','boleto') then raise exception 'Parcelas só no crédito, crediário ou boleto.'; end if;
    if v_forma.forma = 'crediario' and v_cli is null then raise exception 'Venda no crediário/fiado precisa de cliente cadastrado.'; end if;
    if coalesce((pg->>'valor_centavos')::bigint, 0) <= 0 then raise exception 'Valor de pagamento inválido.'; end if;
    v_pagto := v_pagto + (pg->>'valor_centavos')::bigint;
    insert into public.venda_pagamentos (venda_id, forma, valor_centavos, parcelas, taxa_centavos, primeiro_vencimento)
    values (v_id, v_forma.forma, (pg->>'valor_centavos')::bigint, v_parc,
            round((pg->>'valor_centavos')::bigint * privado.taxa_forma(v_forma.forma, v_parc) / 100)::bigint,
            nullif(pg->>'primeiro_vencimento','')::date);
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
