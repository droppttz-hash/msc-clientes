-- =====================================================================
-- Etapa 1 — acertos rápidos
--  * aparelho devolvido volta "em teste" (não vai direto para a venda)
--  * venda de aparelho (IMEI) exige cliente
--  * código IBGE do município (cliente e empresa), para a nota fiscal no futuro
--  * tempo de inatividade para encerrar a sessão
-- =====================================================================
alter table nucleo.produto_series drop constraint if exists produto_series_status_check;
alter table nucleo.produto_series add constraint produto_series_status_check
  check (status in ('disponivel','reservado','vendido','em_os','em_teste','devolvido_fornecedor','defeito','baixado'));

alter table public.clientes add column if not exists ibge text check (ibge is null or ibge ~ '^[0-9]{7}$');
alter table public.empresa  add column if not exists ibge text check (ibge is null or ibge ~ '^[0-9]{7}$');
alter table public.empresa  add column if not exists sessao_inatividade_min int not null default 60
  check (sessao_inatividade_min between 0 and 1440);
update public.empresa set ibge = '3302270' where id = 1 and ibge is null and cidade = 'Japeri';

create or replace function public.finalizar_venda(p jsonb)
returns jsonb language plpgsql security definer set search_path = nucleo, public as $$
declare v_key uuid := nullif(p->>'chave','')::uuid; v_exist record; v_id uuid; v_num bigint; it jsonb; pg jsonb; pr record; s record;
        v_ordem int := 0; v_qtd numeric; v_preco bigint; v_tab bigint; v_desc_item bigint; v_total_item bigint; v_custo bigint;
        v_descricao text; v_cat uuid; v_gar int; v_tabela bigint := 0; v_sub bigint := 0; v_desc bigint; v_acr bigint; v_total bigint;
        v_pct numeric := 0; v_pagto bigint := 0; v_cli uuid := nullif(p->>'cliente_id','')::uuid; v_emp record; v_forma record;
        v_item_id uuid; v_status text; v_parc int; v_series uuid[] := '{}'; v_sid uuid; v_stxt text;
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
    v_sid := null; v_stxt := null;
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
        v_custo := s.custo_centavos;
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
                                    desconto_centavos, total_centavos, custo_unitario_centavos, serie_id, serie, garantia_dias)
    values (v_id, v_ordem, nullif(it->>'produto_id','')::uuid, v_descricao, v_cat, v_qtd, v_tab, v_preco,
            v_desc_item, v_total_item, v_custo, v_sid, v_stxt, v_gar)
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

create or replace function public.devolver_venda(p jsonb)
returns uuid language plpgsql security definer set search_path = nucleo, public as $$
declare v record; it jsonb; i record; v_dev uuid; v_qtd numeric; v_valor bigint; v_total bigint := 0; v_tid uuid; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
        v_reemb text := coalesce(p->>'reembolso','conta');
begin
  if not privado.pode('vendas.devolver') then raise exception 'Sem permissão para devolução.'; end if;
  if coalesce(length(trim(p->>'motivo')),0) < 3 then raise exception 'Informe o motivo da devolução.'; end if;
  select * into v from public.vendas where id = (p->>'venda_id')::uuid for update;
  if v.status <> 'concluida' then raise exception 'Só dá para devolver venda concluída.'; end if;
  if v_reemb = 'conta' and nullif(p->>'conta_id','') is null then raise exception 'Escolha de qual conta sai o dinheiro devolvido.'; end if;

  insert into public.devolucoes (venda_id, motivo, valor_centavos, reembolso, conta_id)
  values (v.id, trim(p->>'motivo'), 0, v_reemb, nullif(p->>'conta_id','')::uuid) returning id into v_dev;

  for it in select * from jsonb_array_elements(p->'itens') loop
    v_qtd := (it->>'quantidade')::numeric;
    if coalesce(v_qtd,0) <= 0 then continue; end if;
    select vi.*, pr.controla_estoque into i from nucleo.venda_itens vi left join nucleo.produtos pr on pr.id = vi.produto_id
      where vi.id = (it->>'venda_item_id')::uuid and vi.venda_id = v.id for update of vi;
    if not found then raise exception 'Item não pertence a esta venda.'; end if;
    if v_qtd > i.quantidade - i.devolvido_qtd then raise exception 'Quantidade maior do que a vendida em "%".', i.descricao; end if;
    -- valor proporcional, já com o desconto/acréscimo geral da venda
    v_valor := round(i.total_centavos::numeric * v_qtd / i.quantidade
                     * case when v.subtotal_centavos > 0 then v.total_centavos::numeric / v.subtotal_centavos else 1 end)::bigint;
    v_total := v_total + v_valor;
    insert into nucleo.devolucao_itens (devolucao_id, venda_item_id, quantidade, valor_centavos) values (v_dev, i.id, v_qtd, v_valor);
    update nucleo.venda_itens set devolvido_qtd = devolvido_qtd + v_qtd where id = i.id;
    if i.produto_id is not null and i.controla_estoque then
      if i.serie_id is not null then
        update nucleo.produto_series set status = 'em_teste', venda_item_id = null,
               observacao = 'Devolvido na venda nº ' || v.numero || ': testar antes de vender de novo' where id = i.serie_id;
      end if;
      insert into nucleo.estoque_movimentos (produto_id, tipo, quantidade, custo_unitario_centavos, serie_id, venda_id, venda_item_id, devolucao_id, motivo)
      values (i.produto_id, 'devolucao_cliente', v_qtd, i.custo_unitario_centavos, i.serie_id, v.id, i.id, v_dev, 'Devolução da venda nº ' || v.numero);
    end if;
  end loop;
  if v_total = 0 and not exists (select 1 from nucleo.devolucao_itens where devolucao_id = v_dev) then raise exception 'Escolha os itens devolvidos.'; end if;
  update public.devolucoes set valor_centavos = v_total where id = v_dev;

  if v_reemb = 'conta' and v_total > 0 then
    insert into public.titulos (tipo, descricao, categoria_id, cliente_id, devolucao_id, competencia, vencimento, valor_centavos)
    values ('pagar', 'Devolução da venda nº ' || v.numero, privado.cat('devolucao'), v.cliente_id, v_dev, v_hoje, v_hoje, v_total)
    returning id into v_tid;
    perform privado.baixar(v_tid, v_hoje, (p->>'conta_id')::uuid, v_total);
  end if;

  if not exists (select 1 from nucleo.venda_itens where venda_id = v.id and devolvido_qtd < quantidade) then
    update public.vendas set status = 'devolvida' where id = v.id;
  end if;
  return v_dev;
end $$;

-- Aparelho em teste: aprovar (volta à venda) ou reprovar (vai para defeito e sai do estoque)
create or replace function public.concluir_teste_serie(p_serie uuid, p_aprovado boolean, p_motivo text default null)
returns void language plpgsql security definer set search_path = nucleo, public as $$
declare s record;
begin
  if not privado.pode('estoque.ajustar') then raise exception 'Sem permissão para liberar aparelhos.'; end if;
  select * into s from nucleo.produto_series where id = p_serie for update;
  if not found then raise exception 'IMEI não encontrado.'; end if;
  if s.status <> 'em_teste' then raise exception 'Este aparelho não está em teste.'; end if;
  if p_aprovado then
    update nucleo.produto_series set status = 'disponivel',
           observacao = coalesce(nullif(trim(p_motivo),''), 'Testado e liberado para venda') where id = s.id;
  else
    if coalesce(length(trim(p_motivo)),0) < 3 then raise exception 'Informe o defeito encontrado.'; end if;
    insert into nucleo.estoque_movimentos (produto_id, tipo, quantidade, custo_unitario_centavos, serie_id, motivo)
    values (s.produto_id, 'perda', -1, s.custo_centavos, s.id, 'Reprovado no teste: ' || trim(p_motivo));
    update nucleo.produto_series set status = 'defeito', observacao = 'Reprovado no teste: ' || trim(p_motivo) where id = s.id;
  end if;
end $$;
revoke execute on function public.concluir_teste_serie(uuid, boolean, text) from public, anon;
grant execute on function public.concluir_teste_serie(uuid, boolean, text) to authenticated;
