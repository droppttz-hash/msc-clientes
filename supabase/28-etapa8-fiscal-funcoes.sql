-- =====================================================================
-- Etapa 8 — Fiscal: funções
-- =====================================================================

-- Regra fiscal que vale para um produto: a do produto, senão a da categoria, senão a padrão
create or replace function privado.regra_produto(p_produto uuid)
returns public.regras_fiscais language sql stable security definer set search_path = public as $$
  select r.* from nucleo.produtos p
  left join public.categorias c on c.id = p.categoria_id
  join public.regras_fiscais r on r.id = coalesce(p.regra_fiscal_id, c.regra_fiscal_id,
       (select x.id from public.regras_fiscais x where x.padrao and x.ativo
          and x.tipo = case when p.tipo = 'servico' then 'servico' else 'produto' end limit 1))
  where p.id = p_produto
$$;

create or replace function privado.tpag(p_forma text) returns text language sql immutable set search_path = public as $$
  select case p_forma when 'dinheiro' then '01' when 'credito' then '03' when 'debito' then '04' when 'crediario' then '05'
                      when 'boleto' then '15' when 'pix' then '17' else '99' end
$$;

-- Monta os dados da nota e lista o que falta. Não grava nada.
create or replace function public.fiscal_preparar(p_tipo text, p_venda uuid default null, p_os uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e record; v record; o record; c record; probs text[] := '{}'; avisos text[] := '{}'; itens jsonb := '[]'::jsonb;
        pags jsonb := '[]'::jsonb; dest jsonb; fator numeric; v_inter boolean := false; x record; r public.regras_fiscais;
        v_ncm text; v_qtd numeric; v_total bigint; v_bruto bigint; t_bruto bigint := 0; t_desc bigint := 0; t_total bigint := 0; v_pecas bigint := 0;
        v_nota record; v_origem jsonb;
begin
  if not (privado.pode('fiscal.notas') or privado.pode('fiscal.config')) then raise exception 'Sem permissão para notas fiscais.'; end if;
  if p_tipo not in ('nfce','nfe','nfse') then raise exception 'Tipo de nota inválido.'; end if;
  select * into e from public.empresa where id = 1;

  -- emitente
  if coalesce(e.cnpj, '') !~ '^[0-9]{14}$' then probs := array_append(probs, ('CNPJ da loja (Configurações › Empresa).')::text); end if;
  if coalesce(trim(e.razao_social), '') = '' then probs := array_append(probs, ('Razão social da loja.')::text); end if;
  if coalesce(e.regime_tributario, '') = '' then probs := array_append(probs, ('Regime tributário da loja.')::text); end if;
  if coalesce(e.ibge, '') = '' or coalesce(e.logradouro, '') = '' or coalesce(e.numero, '') = '' or coalesce(e.uf, '') = '' then
    probs := array_append(probs, ('Endereço completo da loja com CEP consultado (código IBGE).')::text);
  end if;
  if p_tipo in ('nfce','nfe') and coalesce(trim(e.ie), '') = '' then probs := array_append(probs, ('Inscrição estadual da loja.')::text); end if;
  if p_tipo = 'nfse' and coalesce(trim(e.im), '') = '' then probs := array_append(probs, ('Inscrição municipal da loja.')::text); end if;

  if p_tipo in ('nfce','nfe') then
    if p_venda is null then raise exception 'Informe a venda.'; end if;
    select * into v from public.vendas where id = p_venda;
    if not found then raise exception 'Venda não encontrada.'; end if;
    if v.status not in ('concluida','devolvida') then probs := array_append(probs, ('A venda não está concluída.')::text); end if;
    select * into c from public.clientes where id = v.cliente_id;
    select * into v_nota from public.notas_fiscais where venda_id = p_venda and tipo = p_tipo and status = 'emitida';
    v_origem := jsonb_build_object('venda_id', p_venda, 'numero', v.numero, 'data', v.data);
    if p_tipo = 'nfe' then
      if c.id is null then probs := array_append(probs, ('NF-e precisa de cliente cadastrado.')::text);
      else
        if coalesce(c.cpf, c.cnpj, '') = '' then probs := array_append(probs, ('CPF ou CNPJ do cliente.')::text); end if;
        if coalesce(c.ibge, '') = '' or coalesce(c.logradouro, '') = '' or coalesce(c.numero, '') = '' or coalesce(c.uf, '') = '' then
          probs := array_append(probs, ('Endereço completo do cliente com CEP consultado.')::text);
        end if;
        v_inter := c.uf is not null and e.uf is not null and upper(c.uf) <> upper(e.uf);
      end if;
    end if;
    fator := case when v.subtotal_centavos > 0 then v.total_centavos::numeric / v.subtotal_centavos else 1 end;
    for x in select vi.*, p.ncm, p.cest, p.origem_fiscal, p.tipo as p_tipo, p.unidade, p.sku, cat.ncm_padrao
             from nucleo.venda_itens vi join nucleo.produtos p on p.id = vi.produto_id left join public.categorias cat on cat.id = p.categoria_id
             where vi.venda_id = p_venda order by vi.ordem loop
      v_qtd := x.quantidade - x.devolvido_qtd;
      continue when v_qtd <= 0;
      if x.p_tipo = 'servico' then avisos := array_append(avisos, (('"' || x.descricao || '" é serviço: vai na NFS-e, não nesta nota.'))::text); continue; end if;
      r := privado.regra_produto(x.produto_id);
      v_ncm := coalesce(x.ncm, x.ncm_padrao);
      if v_ncm is null then probs := array_append(probs, (('NCM do produto "' || x.descricao || '" (ou da categoria).'))::text); end if;
      if r.id is null or coalesce(case when v_inter then r.cfop_interestadual else r.cfop_interno end, '') = '' then
        probs := array_append(probs, (('CFOP da regra fiscal de "' || x.descricao || '".'))::text);
      end if;
      if r.id is not null and coalesce(r.csosn, r.cst_icms, '') = '' then probs := array_append(probs, (('CSOSN/CST da regra "' || r.nome || '".'))::text); end if;
      v_bruto := round(v_qtd * x.preco_unitario_centavos);
      v_total := round(x.total_centavos * (v_qtd / x.quantidade) * fator);
      t_bruto := t_bruto + v_bruto; t_total := t_total + v_total; t_desc := t_desc + (v_bruto - v_total);
      itens := itens || jsonb_build_object('codigo', coalesce(x.sku, left(x.produto_id::text, 8)), 'descricao', x.descricao, 'ncm', v_ncm, 'cest', x.cest,
        'origem', coalesce(x.origem_fiscal, 0), 'cfop', case when v_inter then r.cfop_interestadual else r.cfop_interno end,
        'csosn', r.csosn, 'cst_icms', r.cst_icms, 'aliquota_icms', r.aliquota_icms, 'cst_pis_cofins', r.cst_pis_cofins, 'regra', r.nome,
        'unidade', coalesce(x.unidade, 'UN'), 'quantidade', v_qtd, 'valor_unitario_centavos', x.preco_unitario_centavos,
        'valor_bruto_centavos', v_bruto, 'desconto_centavos', v_bruto - v_total, 'valor_total_centavos', v_total, 'imei', x.serie);
    end loop;
    if jsonb_array_length(itens) = 0 then probs := array_append(probs, ('Nenhum produto para esta nota.')::text); end if;
    select coalesce(jsonb_agg(jsonb_build_object('forma', vp.forma, 'tpag', privado.tpag(vp.forma), 'valor_centavos', vp.valor_centavos,
             'parcelas', vp.parcelas, 'bandeira', vp.bandeira) order by vp.valor_centavos desc), '[]'::jsonb)
      into pags from public.venda_pagamentos vp where vp.venda_id = p_venda;
    if t_total <> v.total_centavos and v.status = 'concluida' then
      avisos := array_append(avisos, (('Total dos produtos (' || privado.fmt_moeda(t_total) || ') diferente do total da venda (' || privado.fmt_moeda(v.total_centavos) || ').'))::text);
    end if;
  else
    if p_os is null then raise exception 'Informe a OS.'; end if;
    select * into o from public.ordens_servico where id = p_os;
    if not found then raise exception 'OS não encontrada.'; end if;
    if o.status <> 'entregue' then probs := array_append(probs, ('A OS ainda não foi entregue.')::text); end if;
    if o.interna then raise exception 'OS interna (estoque) não tem nota.'; end if;
    select * into c from public.clientes where id = o.cliente_id;
    select * into v_nota from public.notas_fiscais where os_id = p_os and tipo = 'nfse' and status = 'emitida';
    v_origem := jsonb_build_object('os_id', p_os, 'numero', o.numero, 'data', (o.entregue_em at time zone 'America/Sao_Paulo')::date);
    if coalesce(c.cpf, c.cnpj, '') = '' then avisos := array_append(avisos, ('Cliente sem CPF/CNPJ: algumas prefeituras exigem.')::text); end if;
    select * into r from public.regras_fiscais where tipo = 'servico' and padrao and ativo limit 1;
    if r.id is null then probs := array_append(probs, ('Regra fiscal de serviço.')::text);
    else
      if coalesce(r.codigo_servico, '') = '' then probs := array_append(probs, ('Código do serviço (LC 116) na regra de serviço.')::text); end if;
      if r.aliquota_iss is null then probs := array_append(probs, ('Alíquota de ISS na regra de serviço (pergunte ao contador).')::text); end if;
    end if;
    fator := case when (o.total_centavos + o.desconto_centavos) > 0 then o.total_centavos::numeric / (o.total_centavos + o.desconto_centavos) else 1 end;
    for x in select * from nucleo.os_itens where os_id = p_os and not removido order by criado_em loop
      v_bruto := round(x.quantidade * x.preco_unitario_centavos);
      v_total := round(v_bruto * fator);
      if x.tipo <> 'servico' then v_pecas := v_pecas + v_total; continue; end if;
      t_bruto := t_bruto + v_bruto; t_total := t_total + v_total; t_desc := t_desc + (v_bruto - v_total);
      itens := itens || jsonb_build_object('descricao', x.descricao, 'quantidade', x.quantidade, 'valor_unitario_centavos', x.preco_unitario_centavos,
        'valor_bruto_centavos', v_bruto, 'desconto_centavos', v_bruto - v_total, 'valor_total_centavos', v_total,
        'codigo_servico', r.codigo_servico, 'aliquota_iss', r.aliquota_iss, 'iss_retido', r.iss_retido);
    end loop;
    if jsonb_array_length(itens) = 0 then probs := array_append(probs, ('A OS não tem mão de obra (serviço) para a NFS-e.')::text); end if;
    if v_pecas > 0 then avisos := array_append(avisos, (('Peças da OS (' || privado.fmt_moeda(v_pecas) || ') não entram na NFS-e: confirme com o contador se emite NFC-e para elas.'))::text); end if;
  end if;

  if c.id is not null then
    dest := jsonb_build_object('nome', c.nome, 'cpf', c.cpf, 'cnpj', c.cnpj, 'email', c.email, 'telefone', c.telefone,
      'logradouro', c.logradouro, 'numero', c.numero, 'complemento', c.complemento, 'bairro', c.bairro, 'cidade', c.cidade, 'uf', c.uf,
      'cep', c.cep, 'ibge', c.ibge);
  end if;

  return jsonb_build_object(
    'tipo', p_tipo, 'pronta', cardinality(probs) = 0, 'problemas', to_jsonb(probs), 'avisos', to_jsonb(avisos),
    'ambiente', e.fiscal_ambiente, 'serie', case p_tipo when 'nfce' then e.nfce_serie when 'nfe' then e.nfe_serie end,
    'ja_emitida', case when v_nota.id is not null then jsonb_build_object('id', v_nota.id, 'numero', v_nota.numero, 'chave', v_nota.chave) end,
    'origem', v_origem,
    'emitente', jsonb_build_object('cnpj', e.cnpj, 'razao_social', e.razao_social, 'nome_fantasia', e.nome_fantasia, 'ie', e.ie, 'im', e.im,
      'crt', case e.regime_tributario when 'simples' then 1 when 'mei' then 4 when 'presumido' then 3 when 'real' then 3 end, 'regime', e.regime_tributario,
      'cnae', e.cnae, 'logradouro', e.logradouro, 'numero', e.numero, 'complemento', e.complemento, 'bairro', e.bairro, 'cidade', e.cidade,
      'uf', e.uf, 'cep', e.cep, 'ibge', e.ibge, 'telefone', e.telefone),
    'destinatario', dest, 'interestadual', v_inter,
    'itens', itens, 'pagamentos', pags,
    'totais', jsonb_build_object('valor_bruto_centavos', t_bruto, 'desconto_centavos', t_desc, 'valor_total_centavos', t_total),
    'informacoes', e.fiscal_obs_padrao);
end $$;

-- Registra a nota emitida no emissor (número, série, chave)
create or replace function public.fiscal_registrar(p_tipo text, p_venda uuid, p_os uuid, p_numero bigint, p_serie text, p_chave text, p_url text default null, p_protocolo text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare d jsonb; v_id uuid; v_chave text := nullif(regexp_replace(coalesce(p_chave, ''), '\D', '', 'g'), '');
begin
  if not privado.pode('fiscal.notas') then raise exception 'Sem permissão para registrar notas fiscais.'; end if;
  d := public.fiscal_preparar(p_tipo, p_venda, p_os);
  if d->>'ja_emitida' is not null then raise exception 'Já existe nota % emitida para esta %.', upper(p_tipo), case when p_venda is not null then 'venda' else 'OS' end; end if;
  if p_numero is null or p_numero <= 0 then raise exception 'Informe o número da nota.'; end if;
  if p_tipo in ('nfce','nfe') and (v_chave is null or length(v_chave) <> 44) then raise exception 'A chave de acesso tem 44 números.'; end if;
  if (d->'origem'->>'numero') is null then raise exception 'Origem da nota não encontrada.'; end if;
  if p_tipo = 'nfse' and (select status from public.ordens_servico where id = p_os) <> 'entregue' then raise exception 'Só OS entregue tem NFS-e.'; end if;
  if p_tipo <> 'nfse' and (select status from public.vendas where id = p_venda) not in ('concluida','devolvida') then raise exception 'Só venda concluída tem nota.'; end if;
  insert into public.notas_fiscais (tipo, venda_id, os_id, ambiente, numero, serie, chave, protocolo, url, valor_centavos, dados)
  values (p_tipo, case when p_tipo <> 'nfse' then p_venda end, case when p_tipo = 'nfse' then p_os end, d->>'ambiente', p_numero,
          nullif(trim(coalesce(p_serie, d->>'serie', '')), ''), v_chave, nullif(trim(coalesce(p_protocolo, '')), ''), nullif(trim(coalesce(p_url, '')), ''),
          coalesce((d->'totais'->>'valor_total_centavos')::bigint, 0), d)
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'Este número de nota já foi registrado.';
end $$;

create or replace function public.fiscal_cancelar(p_nota uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not privado.pode('fiscal.notas') then raise exception 'Sem permissão.'; end if;
  if coalesce(length(trim(p_motivo)), 0) < 15 then raise exception 'A justificativa do cancelamento precisa ter pelo menos 15 caracteres (exigência da SEFAZ).'; end if;
  update public.notas_fiscais set status = 'cancelada', cancelada_em = now(), motivo_cancelamento = trim(p_motivo)
  where id = p_nota and status = 'emitida';
  if not found then raise exception 'Nota não encontrada ou já cancelada.'; end if;
end $$;

-- Vendas e OS do período ainda sem nota
create or replace function public.fiscal_pendentes(p_inicio date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (privado.pode('fiscal.notas') or privado.pode('fiscal.config')) then raise exception 'Sem permissão.'; end if;
  return jsonb_build_object(
    'vendas', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'numero', v.numero, 'data', v.data, 'total', v.total_centavos,
        'cliente', c.nome, 'tem_doc', coalesce(c.cpf, c.cnpj) is not null) order by v.data, v.numero)
      from public.vendas v left join public.clientes c on c.id = v.cliente_id
      where v.status = 'concluida' and v.data between p_inicio and p_fim
        and not exists (select 1 from public.notas_fiscais n where n.venda_id = v.id and n.status = 'emitida')
        and exists (select 1 from nucleo.venda_itens vi join nucleo.produtos p on p.id = vi.produto_id
                    where vi.venda_id = v.id and p.tipo <> 'servico' and vi.quantidade > vi.devolvido_qtd)), '[]'::jsonb),
    'os', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'numero', o.numero, 'data', (o.entregue_em at time zone 'America/Sao_Paulo')::date,
        'total', o.total_centavos, 'mao_obra', privado.os_mao_de_obra(o.id), 'cliente', c.nome, 'aparelho', o.aparelho) order by o.entregue_em)
      from public.ordens_servico o left join public.clientes c on c.id = o.cliente_id
      where o.status = 'entregue' and not o.interna and (o.entregue_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
        and privado.os_mao_de_obra(o.id) > 0
        and not exists (select 1 from public.notas_fiscais n where n.os_id = o.id and n.status = 'emitida')), '[]'::jsonb));
end $$;

-- O que falta configurar para emitir
create or replace function public.fiscal_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e record;
begin
  if not (privado.pode('fiscal.notas') or privado.pode('fiscal.config')) then raise exception 'Sem permissão.'; end if;
  select * into e from public.empresa where id = 1;
  return jsonb_build_object(
    'emissor', e.fiscal_emissor, 'ambiente', e.fiscal_ambiente, 'certificado_validade', e.certificado_validade,
    'empresa_ok', coalesce(e.cnpj, '') ~ '^[0-9]{14}$' and coalesce(e.razao_social, '') <> '' and coalesce(e.ie, '') <> ''
                  and coalesce(e.regime_tributario, '') <> '' and coalesce(e.ibge, '') <> '',
    'produtos_sem_ncm', (select count(*) from nucleo.produtos p left join public.categorias c on c.id = p.categoria_id
                         where p.ativo and p.tipo <> 'servico' and coalesce(p.ncm, c.ncm_padrao) is null),
    'regras_incompletas', (select count(*) from public.regras_fiscais where ativo and tipo = 'produto'
                           and (cfop_interno is null or coalesce(csosn, cst_icms) is null)),
    'servico_sem_iss', not exists (select 1 from public.regras_fiscais where ativo and padrao and tipo = 'servico' and aliquota_iss is not null and codigo_servico is not null));
end $$;

-- Ajuste em lote dos dados fiscais dos produtos: [{id, ncm, cest, origem_fiscal, regra_fiscal_id}]
create or replace function public.salvar_fiscal_produtos(p_itens jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare x jsonb; n int := 0;
begin
  if not privado.pode('fiscal.config') then raise exception 'Sem permissão.'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    if nullif(x->>'ncm', '') is not null and (x->>'ncm') !~ '^[0-9]{8}$' then raise exception 'NCM inválido: % (8 números).', x->>'ncm'; end if;
    update nucleo.produtos set ncm = nullif(x->>'ncm', ''), cest = nullif(x->>'cest', ''),
      origem_fiscal = coalesce(nullif(x->>'origem_fiscal', '')::smallint, origem_fiscal),
      regra_fiscal_id = nullif(x->>'regra_fiscal_id', '')::uuid
    where id = (x->>'id')::uuid;
    n := n + (case when found then 1 else 0 end);
  end loop;
  return n;
end $$;

-- Pacote do mês para o contador
create or replace function public.pacote_contador(p_mes date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ini date := date_trunc('month', p_mes)::date; fim date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date; e record;
begin
  if not privado.pode('fiscal.config') then raise exception 'Sem permissão.'; end if;
  select * into e from public.empresa where id = 1;
  return jsonb_build_object(
    'mes', to_char(ini, 'YYYY-MM'), 'inicio', ini, 'fim', fim,
    'empresa', jsonb_build_object('razao_social', e.razao_social, 'cnpj', e.cnpj, 'regime', e.regime_tributario),
    'itens_vendidos', coalesce((select jsonb_agg(jsonb_build_object('data', v.data, 'venda', v.numero,
          'nota', (select n.tipo || ' ' || n.numero from public.notas_fiscais n where n.venda_id = v.id and n.status = 'emitida' limit 1),
          'produto', vi.descricao, 'ncm', coalesce(p.ncm, cat.ncm_padrao), 'cfop', (privado.regra_produto(p.id)).cfop_interno,
          'csosn', (privado.regra_produto(p.id)).csosn, 'tipo', p.tipo, 'quantidade', vi.quantidade - vi.devolvido_qtd,
          'valor_centavos', round(vi.total_centavos * ((vi.quantidade - vi.devolvido_qtd) / vi.quantidade)
                                  * case when v.subtotal_centavos > 0 then v.total_centavos::numeric / v.subtotal_centavos else 1 end)::bigint)
          order by v.data, v.numero, vi.ordem)
        from public.vendas v join nucleo.venda_itens vi on vi.venda_id = v.id join nucleo.produtos p on p.id = vi.produto_id
        left join public.categorias cat on cat.id = p.categoria_id
        where v.status in ('concluida','devolvida') and v.data between ini and fim and vi.quantidade > vi.devolvido_qtd), '[]'::jsonb),
    'notas', coalesce((select jsonb_agg(jsonb_build_object('tipo', n.tipo, 'numero', n.numero, 'serie', n.serie, 'chave', n.chave, 'status', n.status,
          'emitida_em', n.emitida_em, 'valor_centavos', n.valor_centavos, 'cancelada_em', n.cancelada_em, 'motivo_cancelamento', n.motivo_cancelamento)
          order by n.tipo, n.numero)
        from public.notas_fiscais n where (n.emitida_em at time zone 'America/Sao_Paulo')::date between ini and fim
           or (n.cancelada_em at time zone 'America/Sao_Paulo')::date between ini and fim), '[]'::jsonb),
    'servicos_os', coalesce((select jsonb_agg(jsonb_build_object('os', o.numero, 'entregue', (o.entregue_em at time zone 'America/Sao_Paulo')::date,
          'cliente', c.nome, 'total_centavos', o.total_centavos, 'mao_de_obra_centavos', privado.os_mao_de_obra(o.id),
          'nfse', (select n.numero from public.notas_fiscais n where n.os_id = o.id and n.status = 'emitida' limit 1)) order by o.entregue_em)
        from public.ordens_servico o left join public.clientes c on c.id = o.cliente_id
        where o.status = 'entregue' and not o.interna and (o.entregue_em at time zone 'America/Sao_Paulo')::date between ini and fim), '[]'::jsonb),
    'devolucoes', coalesce((select jsonb_agg(jsonb_build_object('data', d.data, 'numero', d.numero, 'venda', v.numero, 'valor_centavos', d.valor_centavos, 'motivo', d.motivo) order by d.data)
        from public.devolucoes d join public.vendas v on v.id = d.venda_id where d.data between ini and fim), '[]'::jsonb),
    'compras_mercadoria', coalesce((select jsonb_agg(jsonb_build_object('data', en.data, 'numero', en.numero, 'fornecedor', f.nome, 'nf', en.nf_numero,
          'total_centavos', en.total_centavos) order by en.data)
        from public.entradas en left join public.fornecedores f on f.id = en.fornecedor_id
        where en.data between ini and fim and en.status <> 'cancelada'), '[]'::jsonb),
    'aparelhos_comprados_de_pessoas', coalesce((select jsonb_agg(jsonb_build_object('data', (a.criado_em at time zone 'America/Sao_Paulo')::date, 'numero', a.numero,
          'tipo', a.tipo, 'imei', a.imei, 'valor_centavos', a.valor_centavos, 'vendedor', c.nome, 'documento', a.documento) order by a.criado_em)
        from public.avaliacoes a left join public.clientes c on c.id = a.cliente_id
        where a.status <> 'cancelada' and (a.criado_em at time zone 'America/Sao_Paulo')::date between ini and fim), '[]'::jsonb),
    'resumo', jsonb_build_object(
      'vendas_centavos', (select coalesce(sum(total_centavos), 0) from public.vendas where status in ('concluida','devolvida') and data between ini and fim),
      'devolucoes_centavos', (select coalesce(sum(valor_centavos), 0) from public.devolucoes where data between ini and fim),
      'notas_emitidas_centavos', (select coalesce(sum(valor_centavos), 0) from public.notas_fiscais where status = 'emitida'
                                   and (emitida_em at time zone 'America/Sao_Paulo')::date between ini and fim),
      'servicos_centavos', (select coalesce(sum(privado.os_mao_de_obra(id)), 0) from public.ordens_servico where status = 'entregue' and not interna
                             and (entregue_em at time zone 'America/Sao_Paulo')::date between ini and fim)));
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.fiscal_preparar(text,uuid,uuid)','public.fiscal_registrar(text,uuid,uuid,bigint,text,text,text,text)',
    'public.fiscal_cancelar(uuid,text)','public.fiscal_pendentes(date,date)','public.fiscal_status()','public.salvar_fiscal_produtos(jsonb)',
    'public.pacote_contador(date)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  execute 'revoke execute on function privado.regra_produto(uuid) from public, anon, authenticated';
end $$;
