-- =====================================================================
-- MSC — VIRADA (já aplicada no Supabase da MSC em 06/10/2026)
-- Copia as compras antigas para Vendas e o caixa antigo para Finanças,
-- sem apagar nem renomear nada. Pode rodar de novo: o que já foi copiado
-- não é copiado outra vez. Em projeto novo (01–08) não faz nada.
-- =====================================================================
do $mig$
declare r record; v_venda uuid; v_tid uuid; v_conta uuid; v_banco uuid;
begin
  select id into v_banco from public.contas_financeiras where sistema = 'banco';
  if to_regclass('public.compras') is not null then
    for r in execute 'select c.*, (select nome from public.clientes where id = c.cliente_id) as cli from public.compras c
                      where not exists (select 1 from public.vendas v where v.legado_compra_id = c.id) order by c.numero' loop
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
    execute 'revoke all on public.compras from anon, authenticated';
  end if;

  if to_regclass('public.lancamentos') is not null then
    for r in execute 'select * from public.lancamentos l
                      where not exists (select 1 from public.titulos t where t.observacao = ''legado:'' || l.id::text) order by numero' loop
      select coalesce(conta_id, v_banco) into v_conta from public.formas_pagamento where forma = r.forma_pagamento;
      insert into public.titulos (tipo, descricao, categoria_id, forma_pagamento, conta_prevista_id, competencia, vencimento,
                                  valor_centavos, observacao, criado_por, criado_em, status, cancelado_em, motivo_cancelamento)
      values (case when r.tipo = 'saida' then 'pagar' else 'receber' end, r.descricao, r.categoria_id, r.forma_pagamento, v_conta,
              r.data, r.data, r.valor_centavos, 'legado:' || r.id::text, r.criado_por, r.criado_em,
              case when r.status = 'ativo' then 'aberto' else 'cancelado' end, r.cancelado_em, r.motivo_cancelamento)
      returning id into v_tid;
      if r.status = 'ativo' then perform privado.baixar(v_tid, r.data, v_conta, r.valor_centavos); end if;
    end loop;
    execute 'revoke all on public.lancamentos from anon, authenticated';
  end if;
  if to_regclass('public.caixa_movimentos') is not null then
    execute 'revoke all on public.caixa_movimentos from anon, authenticated';
  end if;
end $mig$;
