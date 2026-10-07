-- =====================================================================
-- Etapa 4 — Assistência técnica: funções (abrir, orçamento, aprovação,
-- fila, peças, entrega com pagamento, garantia, abandono, interna)
-- =====================================================================

create or replace function privado.os_evento(p_os uuid, p_tipo text, p_txt text)
returns void language sql security definer set search_path = nucleo, public as $$
  insert into nucleo.os_eventos (os_id, tipo, descricao) values (p_os, p_tipo, p_txt);
$$;

create or replace function privado.os_rotulo(p_status text)
returns text language sql immutable as $$
  select coalesce(('{"aberta":"Aberta","diagnostico":"Em diagnóstico","aguardando_aprovacao":"Aguardando aprovação","aprovada":"Aprovada",
    "em_execucao":"Em execução","aguardando_peca":"Aguardando peça","pronta":"Pronta","entregue":"Entregue","reprovada":"Orçamento recusado",
    "cancelada":"Cancelada","abandonada":"Abandonada"}'::jsonb)->>p_status, p_status)
$$;
grant execute on function privado.os_rotulo(text) to authenticated;

-- Recalcula o total da OS pelos itens
create or replace function privado.os_recalcular(p_os uuid)
returns bigint language plpgsql security definer set search_path = nucleo, public as $$
declare v_sub bigint; v_desc bigint;
begin
  select coalesce(sum(round(quantidade * preco_unitario_centavos)),0)::bigint into v_sub from nucleo.os_itens where os_id = p_os and not removido;
  select desconto_centavos into v_desc from public.ordens_servico where id = p_os;
  if v_desc > v_sub then v_desc := v_sub; end if;
  update public.ordens_servico set total_centavos = v_sub - v_desc, desconto_centavos = v_desc where id = p_os;
  return v_sub - v_desc;
end $$;

-- ---------------------------------------------------------------------
-- Abrir OS (cliente) ou OS interna (recondicionar aparelho do estoque)
-- ---------------------------------------------------------------------
create or replace function public.abrir_os(p jsonb)
returns jsonb language plpgsql security definer set search_path = nucleo, public as $$
declare v_id uuid; v_num bigint; v_int boolean := coalesce((p->>'interna')::boolean, false); s record; pr record;
        v_cli uuid := nullif(p->>'cliente_id','')::uuid; v_ap text := nullif(trim(p->>'aparelho'),''); v_imei text := nullif(upper(trim(p->>'imei')),'');
        v_cor text := nullif(trim(p->>'cor'),''); v_prod uuid := nullif(p->>'produto_id','')::uuid; v_tec uuid := nullif(p->>'tecnico_id','')::uuid;
        v_sid uuid;
begin
  if not privado.pode('os.criar') then raise exception 'Sem permissão para abrir OS.'; end if;
  if v_int then
    if not privado.pode('aparelhos.editar') then raise exception 'Sem permissão para mandar aparelho do estoque para reparo.'; end if;
    select * into s from nucleo.produto_series where id = (p->>'serie_id')::uuid for update;
    if not found then raise exception 'Escolha o aparelho do estoque.'; end if;
    if s.status not in ('disponivel','em_teste','em_reparo') then raise exception 'Este aparelho está "%" e não pode ir para reparo.', s.status; end if;
    if exists (select 1 from public.ordens_servico where serie_id = s.id and status not in ('entregue','cancelada','abandonada')) then
      raise exception 'Este aparelho já tem uma OS interna aberta.';
    end if;
    select * into pr from nucleo.produtos where id = s.produto_id;
    v_sid := s.id; v_cli := null; v_prod := pr.id; v_imei := s.serie; v_cor := coalesce(v_cor, s.cor);
    v_ap := coalesce(v_ap, pr.nome || coalesce(' ' || s.capacidade, ''));
  else
    if v_cli is null or not exists (select 1 from public.clientes where id = v_cli and ativo) then raise exception 'Escolha o cliente dono do aparelho.'; end if;
    if v_ap is null and v_prod is not null then select nome into v_ap from nucleo.produtos where id = v_prod; end if;
  end if;
  if v_ap is null then raise exception 'Informe o aparelho (marca e modelo).'; end if;
  if coalesce(length(trim(p->>'defeito')),0) < 3 then raise exception 'Descreva o defeito relatado.'; end if;
  if v_tec is not null and not exists (select 1 from public.perfis where user_id = v_tec and ativo) then raise exception 'Técnico inválido.'; end if;

  insert into public.ordens_servico (interna, cliente_id, serie_id, produto_id, aparelho, imei, cor, defeito, acessorios, estado_entrada, checklist,
                                     tecnico_id, prioridade, previsao, observacao, garantia_dias)
  values (v_int, v_cli, v_sid, v_prod, v_ap, v_imei, v_cor, trim(p->>'defeito'), nullif(trim(p->>'acessorios'),''),
          nullif(trim(p->>'estado_entrada'),''), coalesce(p->'checklist','{}'::jsonb), v_tec, coalesce(nullif(p->>'prioridade',''),'normal'),
          nullif(p->>'previsao','')::date, nullif(trim(p->>'observacao'),''),
          case when v_int then 0 else (select garantia_os_dias from public.empresa where id = 1) end)
  returning id, numero into v_id, v_num;

  if nullif(p->>'senha','') is not null then
    insert into nucleo.os_senhas (os_id, tipo, valor) values (v_id, coalesce(nullif(p->>'senha_tipo',''),'senha'), p->>'senha');
  end if;
  perform privado.os_evento(v_id, 'abertura', case when v_int then 'OS interna aberta (recondicionamento do estoque)' else 'OS aberta' end
          || case when nullif(p->>'senha','') is not null then ' · senha guardada' else '' end);
  if v_int then
    update nucleo.produto_series set status = 'em_reparo', observacao = 'OS interna nº ' || v_num where id = v_sid;
  end if;
  return jsonb_build_object('id', v_id, 'numero', v_num);
end $$;

-- Editar dados da OS (aparelho, defeito, técnico, previsão…)
create or replace function public.editar_os(p jsonb)
returns void language plpgsql security definer set search_path = nucleo, public as $$
declare o record; v_tec uuid := nullif(p->>'tecnico_id','')::uuid;
begin
  if not (privado.pode('os.editar') or privado.pode('os.criar')) then raise exception 'Sem permissão.'; end if;
  select * into o from public.ordens_servico where id = (p->>'id')::uuid for update;
  if not found then raise exception 'OS não encontrada.'; end if;
  if o.status in ('entregue','cancelada','abandonada') then raise exception 'OS encerrada não pode ser alterada.'; end if;
  if v_tec is not null and not exists (select 1 from public.perfis where user_id = v_tec and ativo) then raise exception 'Técnico inválido.'; end if;
  if coalesce(length(trim(p->>'defeito')),0) < 3 then raise exception 'Descreva o defeito relatado.'; end if;
  update public.ordens_servico set
    aparelho = case when o.interna then aparelho else coalesce(nullif(trim(p->>'aparelho'),''), aparelho) end,
    imei = case when o.interna then imei else nullif(upper(trim(p->>'imei')),'') end,
    cor = nullif(trim(p->>'cor'),''), defeito = trim(p->>'defeito'), acessorios = nullif(trim(p->>'acessorios'),''),
    estado_entrada = nullif(trim(p->>'estado_entrada'),''), checklist = coalesce(p->'checklist', checklist),
    tecnico_id = v_tec, prioridade = coalesce(nullif(p->>'prioridade',''),'normal'), previsao = nullif(p->>'previsao','')::date,
    observacao = nullif(trim(p->>'observacao'),'')
  where id = o.id;
  if v_tec is distinct from o.tecnico_id then
    perform privado.os_evento(o.id, 'tecnico', 'Técnico: ' || coalesce((select nome from public.perfis where user_id = v_tec), 'nenhum'));
  end if;
  if p ? 'senha' and o.status not in ('entregue','cancelada','abandonada') then
    if nullif(p->>'senha','') is null then
      update nucleo.os_senhas set valor = null, apagada_em = now() where os_id = o.id;
    else
      insert into nucleo.os_senhas (os_id, tipo, valor) values (o.id, coalesce(nullif(p->>'senha_tipo',''),'senha'), p->>'senha')
      on conflict (os_id) do update set tipo = excluded.tipo, valor = excluded.valor, apagada_em = null;
    end if;
    perform privado.os_evento(o.id, 'senha', 'Senha do aparelho alterada');
  end if;
end $$;

-- Ver a senha (só quem pode; fica registrado quem viu)
create or replace function public.ver_senha_os(p_os uuid)
returns jsonb language plpgsql security definer set search_path = nucleo, public as $$
declare s record;
begin
  if not privado.pode('os.ver_senha') then raise exception 'Sem permissão para ver a senha do aparelho.'; end if;
  select * into s from nucleo.os_senhas where os_id = p_os;
  if not found or s.valor is null then raise exception 'Esta OS não tem senha guardada (ou ela já foi apagada na entrega).'; end if;
  perform privado.os_evento(p_os, 'senha', 'Senha visualizada');
  return jsonb_build_object('tipo', s.tipo, 'valor', s.valor);
end $$;

-- ---------------------------------------------------------------------
-- Orçamento: diagnóstico + itens (peças do estoque e serviços)
-- p: {id, diagnostico, desconto_centavos, taxa_diagnostico_centavos, garantia_dias, enviar (bool),
--     itens:[{id?, tipo, produto_id?, descricao, quantidade, preco_unitario_centavos}]}
-- ---------------------------------------------------------------------
create or replace function public.salvar_orcamento_os(p jsonb)
returns jsonb language plpgsql security definer set search_path = nucleo, public as $$
declare o record; it jsonb; pr record; v_ids uuid[] := '{}'; v_id uuid; v_total bigint; v_status text; v_qtd numeric; v_preco bigint; v_desc text; v_tipo text;
begin
  if not privado.pode('os.editar') then raise exception 'Sem permissão para fazer o orçamento.'; end if;
  select * into o from public.ordens_servico where id = (p->>'id')::uuid for update;
  if not found then raise exception 'OS não encontrada.'; end if;
  if o.status in ('pronta','entregue','cancelada','abandonada','reprovada') then
    raise exception 'Não dá para mudar o orçamento de uma OS "%".', privado.os_rotulo(o.status);
  end if;
  for it in select * from jsonb_array_elements(coalesce(p->'itens','[]'::jsonb)) loop
    v_tipo := coalesce(it->>'tipo','servico');
    v_qtd := coalesce((it->>'quantidade')::numeric, 1); v_preco := (it->>'preco_unitario_centavos')::bigint;
    if v_qtd <= 0 or coalesce(v_preco,-1) < 0 then raise exception 'Item inválido no orçamento.'; end if;
    v_desc := nullif(trim(it->>'descricao'),'');
    if nullif(it->>'produto_id','') is not null then
      select * into pr from nucleo.produtos where id = (it->>'produto_id')::uuid;
      if not found then raise exception 'Produto do orçamento não encontrado.'; end if;
      if pr.controla_serie then raise exception 'Peça com IMEI/série não entra em OS ("%").', pr.nome; end if;
      v_tipo := case when pr.controla_estoque then 'peca' else 'servico' end;
      v_desc := coalesce(v_desc, pr.nome);
    elsif v_tipo = 'peca' then
      raise exception 'Peça precisa ser escolhida do estoque ("%"). Para algo fora do estoque, use serviço.', coalesce(v_desc,'');
    end if;
    if v_desc is null then raise exception 'Descreva todos os itens.'; end if;
    v_id := nullif(it->>'id','')::uuid;
    if v_id is not null and exists (select 1 from nucleo.os_itens where id = v_id and os_id = o.id and not removido) then
      if exists (select 1 from nucleo.os_itens where id = v_id and aplicado) then
        v_ids := v_ids || v_id; continue;
      end if;
      update nucleo.os_itens set tipo = v_tipo, produto_id = nullif(it->>'produto_id','')::uuid, descricao = v_desc, quantidade = v_qtd,
             preco_unitario_centavos = v_preco where id = v_id;
    else
      insert into nucleo.os_itens (os_id, tipo, produto_id, descricao, quantidade, preco_unitario_centavos)
      values (o.id, v_tipo, nullif(it->>'produto_id','')::uuid, v_desc, v_qtd, v_preco) returning id into v_id;
    end if;
    v_ids := v_ids || v_id;
  end loop;
  update nucleo.os_itens set removido = true where os_id = o.id and not removido and not aplicado and not (id = any(v_ids));

  update public.ordens_servico set diagnostico = nullif(trim(p->>'diagnostico'),''),
         desconto_centavos = coalesce((p->>'desconto_centavos')::bigint, 0),
         taxa_diagnostico_centavos = coalesce((p->>'taxa_diagnostico_centavos')::bigint, taxa_diagnostico_centavos),
         garantia_dias = coalesce(nullif(p->>'garantia_dias','')::int, garantia_dias)
  where id = o.id;
  v_total := privado.os_recalcular(o.id);

  v_status := o.status;
  if o.interna or o.retorno_garantia then
    -- sem aprovação do cliente
    if o.status in ('aberta','diagnostico','aguardando_aprovacao') then v_status := 'aprovada'; end if;
  elsif coalesce((p->>'enviar')::boolean, false) then
    v_status := 'aguardando_aprovacao';
  elsif o.status in ('aprovada','em_execucao','aguardando_peca') and v_total > coalesce(o.valor_aprovado_centavos, 0) then
    v_status := 'aguardando_aprovacao';  -- valor subiu: precisa de nova aprovação
  elsif o.status = 'aberta' then
    v_status := 'diagnostico';
  end if;
  if v_status <> o.status then
    update public.ordens_servico set status = v_status,
           orcamento_enviado_em = case when v_status = 'aguardando_aprovacao' then now() else orcamento_enviado_em end,
           aprovado = case when v_status = 'aprovada' and (o.interna or o.retorno_garantia) then true else aprovado end,
           valor_aprovado_centavos = case when v_status = 'aprovada' then v_total else valor_aprovado_centavos end
    where id = o.id;
    perform privado.os_evento(o.id, 'status', privado.os_rotulo(o.status) || ' → ' || privado.os_rotulo(v_status)
            || case when v_status = 'aguardando_aprovacao' then ' (orçamento de ' || privado.fmt_moeda(v_total) || ')' else '' end);
  else
    perform privado.os_evento(o.id, 'orcamento', 'Orçamento atualizado: ' || privado.fmt_moeda(v_total));
  end if;
  return jsonb_build_object('total_centavos', v_total, 'status', v_status);
end $$;

-- Aprovação do cliente registrada (quem, como, quando)
create or replace function public.registrar_aprovacao_os(p_os uuid, p_aprovado boolean, p_meio text, p_nome text default null, p_obs text default null)
returns void language plpgsql security definer set search_path = nucleo, public as $$
declare o record;
begin
  if not (privado.pode('os.editar') or privado.pode('os.criar')) then raise exception 'Sem permissão.'; end if;
  select * into o from public.ordens_servico where id = p_os for update;
  if not found then raise exception 'OS não encontrada.'; end if;
  if o.status not in ('aguardando_aprovacao','diagnostico') then raise exception 'Esta OS não está esperando aprovação.'; end if;
  if p_meio not in ('presencial','whatsapp','telefone','outro') then raise exception 'Informe como o cliente respondeu.'; end if;
  if p_aprovado and not exists (select 1 from nucleo.os_itens where os_id = o.id and not removido) then
    raise exception 'Monte o orçamento antes de registrar a aprovação.';
  end if;
  update public.ordens_servico set status = case when p_aprovado then 'aprovada' else 'reprovada' end, aprovado = p_aprovado,
         aprovacao_em = now(), aprovacao_meio = p_meio, aprovacao_nome = nullif(trim(p_nome),''), aprovacao_obs = nullif(trim(p_obs),''),
         aprovacao_por = auth.uid(), valor_aprovado_centavos = case when p_aprovado then total_centavos else valor_aprovado_centavos end
  where id = o.id;
  perform privado.os_evento(o.id, 'aprovacao', case when p_aprovado then 'Cliente APROVOU o orçamento de ' || privado.fmt_moeda(o.total_centavos)
          else 'Cliente RECUSOU o orçamento' end || ' (' || p_meio || coalesce(', ' || nullif(trim(p_nome),''), '') || ')'
          || coalesce(' — ' || nullif(trim(p_obs),''), ''));
end $$;

-- Baixa as peças no estoque (ao concluir). Na OS interna, o custo vira custo de recondicionamento do aparelho.
create or replace function privado.os_aplicar_pecas(p_os uuid)
returns void language plpgsql security definer set search_path = nucleo, public as $$
declare o record; i record; v_custo bigint;
begin
  select * into o from public.ordens_servico where id = p_os;
  for i in select it.*, pr.controla_estoque, pr.nome as prod_nome from nucleo.os_itens it left join nucleo.produtos pr on pr.id = it.produto_id
           where it.os_id = p_os and not it.removido and not it.aplicado order by it.criado_em loop
    v_custo := 0;
    if i.produto_id is not null and i.controla_estoque then
      select custo_medio_centavos into v_custo from nucleo.produtos where id = i.produto_id;
      insert into nucleo.estoque_movimentos (produto_id, tipo, quantidade, custo_unitario_centavos, os_id, motivo)
      values (i.produto_id, 'uso_os', -i.quantidade, v_custo, p_os, 'OS nº ' || o.numero || ' — ' || o.aparelho);
      if o.interna and round(v_custo * i.quantidade) > 0 then
        insert into nucleo.serie_custos (serie_id, descricao, valor_centavos)
        values (o.serie_id, 'Peça: ' || i.descricao || ' (OS nº ' || o.numero || ')', round(v_custo * i.quantidade)::bigint);
      end if;
    end if;
    update nucleo.os_itens set aplicado = true, aplicado_em = now(), custo_unitario_centavos = coalesce(v_custo, 0) where id = i.id;
  end loop;
end $$;

-- Devolve ao estoque as peças já baixadas (cancelamento)
create or replace function privado.os_estornar_pecas(p_os uuid, p_motivo text)
returns void language plpgsql security definer set search_path = nucleo, public as $$
declare o record; i record;
begin
  select * into o from public.ordens_servico where id = p_os;
  for i in select it.*, pr.controla_estoque from nucleo.os_itens it join nucleo.produtos pr on pr.id = it.produto_id
           where it.os_id = p_os and it.aplicado and not it.removido and pr.controla_estoque loop
    insert into nucleo.estoque_movimentos (produto_id, tipo, quantidade, custo_unitario_centavos, os_id, motivo)
    values (i.produto_id, 'estorno_os', i.quantidade, i.custo_unitario_centavos, p_os, 'OS nº ' || o.numero || ' cancelada: ' || p_motivo);
    update nucleo.os_itens set aplicado = false, aplicado_em = null where id = i.id;
  end loop;
  if o.interna then
    update nucleo.serie_custos set cancelado = true, motivo_cancelamento = 'OS nº ' || o.numero || ' cancelada'
    where serie_id = o.serie_id and not cancelado and descricao like '%(OS nº ' || o.numero || ')';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Mudar a situação (fila do técnico)
-- ---------------------------------------------------------------------
create or replace function public.mudar_status_os(p_os uuid, p_status text, p_obs text default null)
returns void language plpgsql security definer set search_path = nucleo, public as $$
declare o record; ok boolean;
begin
  if not privado.pode('os.editar') then raise exception 'Sem permissão.'; end if;
  select * into o from public.ordens_servico where id = p_os for update;
  if not found then raise exception 'OS não encontrada.'; end if;
  ok := (o.status, p_status) in (('aberta','diagnostico'), ('aprovada','em_execucao'), ('em_execucao','aguardando_peca'),
          ('aguardando_peca','em_execucao'), ('aprovada','aguardando_peca'), ('aprovada','pronta'), ('em_execucao','pronta'),
          ('aguardando_peca','pronta'), ('pronta','em_execucao'));
  if not ok then raise exception 'Não dá para passar de "%" para "%".', privado.os_rotulo(o.status), privado.os_rotulo(p_status); end if;
  if p_status = 'pronta' then
    perform privado.os_aplicar_pecas(o.id);
  end if;
  update public.ordens_servico set status = p_status, pronta_em = case when p_status = 'pronta' then now() else pronta_em end,
         tecnico_id = coalesce(tecnico_id, case when p_status in ('em_execucao','pronta') then auth.uid() end)
  where id = o.id;
  perform privado.os_evento(o.id, 'status', privado.os_rotulo(o.status) || ' → ' || privado.os_rotulo(p_status) || coalesce(' — ' || nullif(trim(p_obs),''), ''));
  -- OS interna pronta: aparelho volta para teste e a OS se encerra
  if p_status = 'pronta' and o.interna then
    update nucleo.produto_series set status = 'em_teste', observacao = 'Reparo concluído na OS nº ' || o.numero where id = o.serie_id and status = 'em_reparo';
    update public.ordens_servico set status = 'entregue', entregue_em = now(), entregue_por = auth.uid() where id = o.id;
    update nucleo.os_senhas set valor = null, apagada_em = now() where os_id = o.id;
    perform privado.os_evento(o.id, 'entrega', 'Reparo interno concluído: aparelho voltou para o estoque (em teste)');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Entrega ao cliente com pagamento
-- p: {id, pagamentos:[{forma, valor_centavos, parcelas, primeiro_vencimento}], desconto_centavos?}
-- ---------------------------------------------------------------------
create or replace function public.entregar_os(p jsonb)
returns jsonb language plpgsql security definer set search_path = nucleo, public as $$
declare o record; pg jsonb; f record; v_total bigint; v_pago bigint := 0; v_parc int; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
        v_n int; v_k int; v_parte bigint; v_taxa bigint; v_taxa_parte bigint; v_soma bigint; v_soma_taxa bigint; v_venc date; v_tid uuid; v_cli text; v_reparou boolean;
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
    v_taxa := round((pg->>'valor_centavos')::bigint * privado.taxa_forma(f.forma, v_parc) / 100)::bigint;
    insert into public.os_pagamentos (os_id, forma, valor_centavos, parcelas, taxa_centavos, primeiro_vencimento)
    values (o.id, f.forma, (pg->>'valor_centavos')::bigint, v_parc, v_taxa, nullif(pg->>'primeiro_vencimento','')::date);
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

-- Cancelar (antes da entrega): peças voltam ao estoque
create or replace function public.cancelar_os(p_os uuid, p_motivo text)
returns void language plpgsql security definer set search_path = nucleo, public as $$
declare o record;
begin
  if not privado.pode('os.cancelar') then raise exception 'Sem permissão para cancelar OS.'; end if;
  if coalesce(length(trim(p_motivo)),0) < 3 then raise exception 'Informe o motivo.'; end if;
  select * into o from public.ordens_servico where id = p_os for update;
  if not found then raise exception 'OS não encontrada.'; end if;
  if o.status in ('entregue','cancelada','abandonada') then raise exception 'Esta OS já está encerrada.'; end if;
  perform privado.os_estornar_pecas(o.id, trim(p_motivo));
  update public.ordens_servico set status = 'cancelada', cancelada_em = now(), motivo_cancelamento = trim(p_motivo) where id = o.id;
  update nucleo.os_senhas set valor = null, apagada_em = now() where os_id = o.id;
  if o.interna then
    update nucleo.produto_series set status = 'em_teste', observacao = 'OS interna nº ' || o.numero || ' cancelada' where id = o.serie_id and status = 'em_reparo';
  end if;
  perform privado.os_evento(o.id, 'cancelamento', 'OS cancelada: ' || trim(p_motivo));
end $$;

-- Aparelho não retirado no prazo
create or replace function public.marcar_os_abandonada(p_os uuid, p_obs text)
returns void language plpgsql security definer set search_path = nucleo, public as $$
declare o record; v_dias int;
begin
  if not privado.pode('os.cancelar') then raise exception 'Sem permissão.'; end if;
  if coalesce(length(trim(p_obs)),0) < 3 then raise exception 'Registre como o cliente foi avisado (ex.: WhatsApp em 10/01, ligação em 20/01).'; end if;
  select * into o from public.ordens_servico where id = p_os for update;
  if not found or o.status not in ('pronta','reprovada') then raise exception 'Só OS pronta ou recusada aguardando retirada pode ser marcada como abandonada.'; end if;
  select dias_abandono_os into v_dias from public.empresa where id = 1;
  if coalesce(o.pronta_em, o.aprovacao_em, o.criado_em) > now() - make_interval(days => v_dias) then
    raise exception 'Ainda não passaram % dias desde que a OS ficou pronta.', v_dias;
  end if;
  update public.ordens_servico set status = 'abandonada', abandonada_em = now() where id = o.id;
  update nucleo.os_senhas set valor = null, apagada_em = now() where os_id = o.id;
  perform privado.os_evento(o.id, 'abandono', 'Marcada como abandonada após ' || v_dias || ' dias — ' || trim(p_obs));
end $$;

-- Retorno em garantia: nova OS ligada à original, sem cobrança por padrão
create or replace function public.abrir_retorno_garantia(p_os uuid, p_defeito text)
returns jsonb language plpgsql security definer set search_path = nucleo, public as $$
declare o record; v_id uuid; v_num bigint;
begin
  if not privado.pode('os.criar') then raise exception 'Sem permissão.'; end if;
  select * into o from public.ordens_servico where id = p_os;
  if not found or o.status <> 'entregue' or o.interna then raise exception 'Só OS entregue ao cliente tem retorno em garantia.'; end if;
  if o.garantia_ate is null or o.garantia_ate < (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'A garantia desta OS terminou em %.', coalesce(to_char(o.garantia_ate,'DD/MM/YYYY'), '(sem garantia)');
  end if;
  if coalesce(length(trim(p_defeito)),0) < 3 then raise exception 'Descreva o problema do retorno.'; end if;
  insert into public.ordens_servico (cliente_id, produto_id, aparelho, imei, cor, defeito, tecnico_id, os_origem_id, retorno_garantia, garantia_dias, prioridade)
  values (o.cliente_id, o.produto_id, o.aparelho, o.imei, o.cor, trim(p_defeito), o.tecnico_id, o.id, true, 0, 'urgente')
  returning id, numero into v_id, v_num;
  perform privado.os_evento(v_id, 'abertura', 'Retorno em garantia da OS nº ' || o.numero);
  perform privado.os_evento(o.id, 'garantia', 'Cliente voltou na garantia: OS nº ' || v_num);
  return jsonb_build_object('id', v_id, 'numero', v_num);
end $$;

-- Notas e fotos
create or replace function public.anotar_os(p_os uuid, p_texto text)
returns void language plpgsql security definer set search_path = nucleo, public as $$
begin
  if not privado.pode('os.ver') then raise exception 'Sem permissão.'; end if;
  if coalesce(length(trim(p_texto)),0) < 2 then raise exception 'Escreva a anotação.'; end if;
  if not exists (select 1 from public.ordens_servico where id = p_os) then raise exception 'OS não encontrada.'; end if;
  perform privado.os_evento(p_os, 'nota', trim(p_texto));
end $$;

create or replace function public.adicionar_foto_os(p_os uuid, p_imagem text, p_legenda text default null)
returns uuid language plpgsql security definer set search_path = nucleo, public as $$
declare v_id uuid;
begin
  if not (privado.pode('os.criar') or privado.pode('os.editar')) then raise exception 'Sem permissão para incluir fotos.'; end if;
  if not exists (select 1 from public.ordens_servico where id = p_os) then raise exception 'OS não encontrada.'; end if;
  if (select count(*) from nucleo.os_fotos where os_id = p_os and not removida) >= 10 then raise exception 'Máximo de 10 fotos por OS.'; end if;
  insert into nucleo.os_fotos (os_id, imagem, legenda) values (p_os, p_imagem, nullif(trim(p_legenda),'')) returning id into v_id;
  perform privado.os_evento(p_os, 'foto', 'Foto incluída' || coalesce(': ' || nullif(trim(p_legenda),''), ''));
  return v_id;
end $$;

create or replace function public.remover_foto_os(p_foto uuid)
returns void language plpgsql security definer set search_path = nucleo, public as $$
declare v_os uuid;
begin
  if not privado.pode('os.editar') then raise exception 'Sem permissão.'; end if;
  update nucleo.os_fotos set removida = true where id = p_foto and not removida returning os_id into v_os;
  if v_os is not null then perform privado.os_evento(v_os, 'foto', 'Foto removida'); end if;
end $$;

-- Números para o Início e a fila
create or replace function public.os_resumo()
returns jsonb language plpgsql stable security definer set search_path = nucleo, public as $$
declare v_dias int; r jsonb;
begin
  if not privado.pode('os.ver') then raise exception 'Sem permissão.'; end if;
  select dias_abandono_os into v_dias from public.empresa where id = 1;
  select jsonb_build_object(
    'abertas', count(*) filter (where status not in ('entregue','cancelada','abandonada')),
    'aguardando_aprovacao', count(*) filter (where status = 'aguardando_aprovacao'),
    'na_bancada', count(*) filter (where status in ('aberta','diagnostico','aprovada','em_execucao','aguardando_peca')),
    'aguardando_peca', count(*) filter (where status = 'aguardando_peca'),
    'prontas', count(*) filter (where status = 'pronta'),
    'atrasadas', count(*) filter (where previsao < (now() at time zone 'America/Sao_Paulo')::date and status in ('aberta','diagnostico','aguardando_aprovacao','aprovada','em_execucao','aguardando_peca')),
    'minhas', count(*) filter (where tecnico_id = auth.uid() and status in ('aberta','diagnostico','aprovada','em_execucao','aguardando_peca')),
    'para_abandono', count(*) filter (where status in ('pronta','reprovada') and coalesce(pronta_em, aprovacao_em, criado_em) < now() - make_interval(days => v_dias)),
    'dias_abandono', v_dias,
    'entregues_mes', count(*) filter (where status = 'entregue' and not interna and entregue_em >= date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'),
    'faturado_mes', case when privado.pode('painel.ver_valores') then coalesce(sum(total_centavos) filter (where status = 'entregue' and not interna
                      and entregue_em >= date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'), 0) end
  ) into r from public.ordens_servico;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- DRE com a assistência técnica (receita, peças e taxas das OS entregues)
-- ---------------------------------------------------------------------
create or replace function public.dre(p_inicio date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path = nucleo, public as $$
declare v_rec bigint; v_dev bigint; v_taxa bigint; v_cmv bigint; v_cmv_dev bigint; v_outras jsonb; v_desp jsonb; v_quebra bigint;
        v_tot_outras bigint; v_tot_desp bigint; v_compras bigint; v_caixa jsonb; v_lb bigint; v_os bigint; v_os_custo bigint; v_os_taxa bigint;
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
    'compras_mercadoria', v_compras,
    'caixa', v_caixa);
end $$;

-- Busca geral: inclui OS (por número e IMEI)
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
  if privado.pode('os.ver') then
    r := r || coalesce((select jsonb_agg(jsonb_build_object('tipo','os','id',o.id,'titulo','OS nº ' || o.numero || ' — ' || o.aparelho,
                 'sub', coalesce(o.cliente_nome, 'Interna') || ' · ' || privado.os_rotulo(o.status)))
      from (select * from public.os_lista where (d <> '' and length(d) <= 9 and numero = d::bigint)
                or (length(q) >= 4 and upper(coalesce(imei,'')) like '%' || upper(q) || '%')
            order by criado_em desc limit 5) o), '[]'::jsonb);
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
  foreach f in array array['public.abrir_os(jsonb)','public.editar_os(jsonb)','public.ver_senha_os(uuid)','public.salvar_orcamento_os(jsonb)',
    'public.registrar_aprovacao_os(uuid,boolean,text,text,text)','public.mudar_status_os(uuid,text,text)','public.entregar_os(jsonb)',
    'public.cancelar_os(uuid,text)','public.marcar_os_abandonada(uuid,text)','public.abrir_retorno_garantia(uuid,text)',
    'public.anotar_os(uuid,text)','public.adicionar_foto_os(uuid,text,text)','public.remover_foto_os(uuid)','public.os_resumo()'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  execute 'revoke execute on function privado.os_evento(uuid,text,text), privado.os_recalcular(uuid), privado.os_aplicar_pecas(uuid), privado.os_estornar_pecas(uuid,text) from public, anon, authenticated';
end $$;
