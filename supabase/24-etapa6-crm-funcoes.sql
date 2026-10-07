-- =====================================================================
-- Etapa 6 — CRM e WhatsApp: funções
-- =====================================================================

create or replace function privado.lead_visivel(p_lead uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.leads l where l.id = p_lead
    and (privado.pode('crm.ver_todos')
         or (privado.pode('crm.usar') and (l.responsavel_id = auth.uid() or l.criado_por = auth.uid()))))
$$;

create or replace function privado.lead_evento(p_lead uuid, p_tipo text, p_texto text)
returns void language sql security definer set search_path = public as $$
  insert into public.lead_eventos (lead_id, tipo, texto) values (p_lead, p_tipo, p_texto)
$$;

create or replace function privado.etapa_rotulo(p text) returns text language sql immutable as $$
  select case p when 'novo' then 'Novo' when 'em_contato' then 'Em contato' when 'proposta' then 'Proposta enviada'
                when 'ganho' then 'Ganho (comprou)' when 'perdido' then 'Perdido' else p end
$$;

-- Próximo aniversário a partir de uma data (29/02 vira 28/02 em ano não bissexto)
create or replace function privado.proximo_aniversario(p_nasc date, p_ref date)
returns date language plpgsql immutable as $$
declare a int := extract(year from p_ref)::int; m int := extract(month from p_nasc)::int; d int := extract(day from p_nasc)::int; r date;
begin
  if p_nasc is null then return null; end if;
  for i in 0..1 loop
    r := make_date(a + i, m, case when m = 2 and d = 29 and not ((a + i) % 4 = 0 and ((a + i) % 100 <> 0 or (a + i) % 400 = 0)) then 28 else d end);
    if r >= p_ref then return r; end if;
  end loop;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- Funil de interessados
-- ---------------------------------------------------------------------
-- p_dados: {cliente_id, nome, telefone, interesse, origem, valor_estimado_centavos, responsavel_id, proximo_contato, observacao}
create or replace function public.salvar_lead(p_id uuid, p_dados jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_cli uuid := nullif(p_dados->>'cliente_id','')::uuid; v_nome text; v_tel text; v_resp uuid;
        v_ant record;
begin
  if not privado.pode('crm.usar') then raise exception 'Sem permissão para usar o funil.'; end if;
  if p_id is not null then
    if not privado.lead_visivel(p_id) then raise exception 'Interessado não encontrado.'; end if;
    if (select etapa from public.leads where id = p_id) in ('ganho','perdido') then raise exception 'Este interessado já foi encerrado. Reabra para editar.'; end if;
  end if;
  if v_cli is not null then
    select nome, telefone into v_nome, v_tel from public.clientes where id = v_cli;
    if not found then raise exception 'Cliente não encontrado.'; end if;
  end if;
  v_nome := coalesce(nullif(trim(p_dados->>'nome'), ''), v_nome);
  v_tel  := coalesce(nullif(regexp_replace(coalesce(p_dados->>'telefone',''), '\D', '', 'g'), ''), v_tel);
  if coalesce(length(v_nome), 0) < 2 then raise exception 'Informe o nome do interessado.'; end if;
  if v_tel is not null and v_tel !~ '^\d{10,11}$' then raise exception 'Telefone inválido: DDD + número.'; end if;
  if coalesce(length(trim(p_dados->>'interesse')), 0) < 2 then raise exception 'Informe o que a pessoa procura.'; end if;
  v_resp := coalesce(nullif(p_dados->>'responsavel_id','')::uuid, auth.uid());
  if v_resp <> auth.uid() and not privado.pode('crm.ver_todos') then raise exception 'Você só pode criar interessados para você mesmo.'; end if;
  if not exists (select 1 from public.perfis where user_id = v_resp and ativo) then raise exception 'Responsável inválido.'; end if;

  if p_id is null then
    insert into public.leads (cliente_id, nome, telefone, interesse, origem, valor_estimado_centavos, responsavel_id, proximo_contato, observacao)
    values (v_cli, v_nome, v_tel, trim(p_dados->>'interesse'), nullif(p_dados->>'origem',''),
            nullif(p_dados->>'valor_estimado_centavos','')::bigint, v_resp,
            coalesce(nullif(p_dados->>'proximo_contato','')::date, (now() at time zone 'America/Sao_Paulo')::date + 1),
            nullif(trim(coalesce(p_dados->>'observacao','')), ''))
    returning id into v_id;
    perform privado.lead_evento(v_id, 'criado', 'Interessado cadastrado');
  else
    select * into v_ant from public.leads where id = p_id;
    update public.leads set cliente_id = v_cli, nome = v_nome, telefone = v_tel, interesse = trim(p_dados->>'interesse'),
      origem = nullif(p_dados->>'origem',''), valor_estimado_centavos = nullif(p_dados->>'valor_estimado_centavos','')::bigint,
      responsavel_id = v_resp, proximo_contato = nullif(p_dados->>'proximo_contato','')::date,
      observacao = nullif(trim(coalesce(p_dados->>'observacao','')), '')
    where id = p_id;
    if v_resp is distinct from v_ant.responsavel_id then
      perform privado.lead_evento(p_id, 'edicao', 'Responsável trocado para ' || (select nome from public.perfis where user_id = v_resp));
    end if;
    v_id := p_id;
  end if;
  return v_id;
end $$;

create or replace function public.mover_lead(p_id uuid, p_etapa text, p_motivo text default null, p_venda uuid default null, p_proximo date default null)
returns void language plpgsql security definer set search_path = public as $$
declare l record;
begin
  if not privado.lead_visivel(p_id) then raise exception 'Interessado não encontrado.'; end if;
  if p_etapa not in ('novo','em_contato','proposta','ganho','perdido') then raise exception 'Etapa inválida.'; end if;
  select * into l from public.leads where id = p_id for update;
  if l.etapa = p_etapa then return; end if;
  if p_etapa = 'perdido' and coalesce(length(trim(p_motivo)), 0) < 3 then raise exception 'Informe por que o interessado foi perdido.'; end if;
  if p_venda is not null and not exists (select 1 from public.vendas where id = p_venda and status in ('concluida','devolvida')
                                          and (l.cliente_id is null or cliente_id = l.cliente_id)) then
    raise exception 'Venda inválida para este cliente.';
  end if;
  update public.leads set etapa = p_etapa,
    motivo_perda = case when p_etapa = 'perdido' then trim(p_motivo) else null end,
    venda_id = case when p_etapa = 'ganho' then p_venda else null end,
    fechado_em = case when p_etapa in ('ganho','perdido') then now() else null end,
    proximo_contato = case when p_etapa in ('ganho','perdido') then null else coalesce(p_proximo, l.proximo_contato) end
  where id = p_id;
  perform privado.lead_evento(p_id, 'etapa', privado.etapa_rotulo(l.etapa) || ' → ' || privado.etapa_rotulo(p_etapa)
    || case when p_etapa = 'perdido' then ' — ' || trim(p_motivo) else '' end
    || case when p_venda is not null then ' (venda nº ' || (select numero from public.vendas where id = p_venda) || ')' else '' end);
end $$;

create or replace function public.anotar_lead(p_id uuid, p_tipo text, p_texto text, p_proximo date default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not privado.lead_visivel(p_id) then raise exception 'Interessado não encontrado.'; end if;
  if p_tipo not in ('nota','whatsapp','ligacao') then raise exception 'Tipo inválido.'; end if;
  if p_tipo = 'nota' and coalesce(length(trim(p_texto)), 0) < 2 then raise exception 'Escreva a anotação.'; end if;
  perform privado.lead_evento(p_id, p_tipo, nullif(trim(coalesce(p_texto,'')), ''));
  update public.leads set atualizado_em = now(),
    etapa = case when etapa = 'novo' and p_tipo in ('whatsapp','ligacao') then 'em_contato' else etapa end,
    proximo_contato = case when etapa in ('ganho','perdido') then proximo_contato else coalesce(p_proximo, proximo_contato) end
  where id = p_id;
end $$;

-- Detalhe do interessado: dados, histórico e vendas do cliente desde o cadastro
create or replace function public.lead_detalhe(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l record;
begin
  if not privado.lead_visivel(p_id) then raise exception 'Interessado não encontrado.'; end if;
  select * into l from public.leads_lista where id = p_id;
  return jsonb_build_object(
    'lead', to_jsonb(l),
    'eventos', coalesce((select jsonb_agg(jsonb_build_object('tipo', e.tipo, 'texto', e.texto, 'em', e.criado_em, 'por', p.nome) order by e.criado_em desc)
                         from public.lead_eventos e left join public.perfis p on p.user_id = e.criado_por where e.lead_id = p_id), '[]'::jsonb),
    'vendas', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'numero', v.numero, 'data', v.data, 'total', v.total_centavos) order by v.data desc)
                        from public.vendas v where l.cliente_id is not null and v.cliente_id = l.cliente_id
                         and v.status in ('concluida','devolvida') and v.data >= (l.criado_em at time zone 'America/Sao_Paulo')::date - 1), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------
-- Lista de espera
-- ---------------------------------------------------------------------
-- p_dados: {cliente_id, modelo, capacidade, cor, condicao, preco_max_centavos, validade, observacao}
create or replace function public.salvar_espera(p_id uuid, p_dados jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_val date;
begin
  if not privado.pode('crm.usar') then raise exception 'Sem permissão.'; end if;
  if nullif(p_dados->>'cliente_id','') is null or not exists (select 1 from public.clientes where id = (p_dados->>'cliente_id')::uuid) then
    raise exception 'Escolha o cliente.';
  end if;
  if coalesce(length(trim(p_dados->>'modelo')), 0) < 2 then raise exception 'Informe o modelo procurado.'; end if;
  v_val := coalesce(nullif(p_dados->>'validade','')::date,
                    (now() at time zone 'America/Sao_Paulo')::date + (select crm_dias_espera from public.empresa limit 1));
  if p_id is null then
    insert into public.lista_espera (cliente_id, modelo, capacidade, cor, condicao, preco_max_centavos, validade, observacao)
    values ((p_dados->>'cliente_id')::uuid, trim(p_dados->>'modelo'), nullif(trim(coalesce(p_dados->>'capacidade','')), ''),
            nullif(trim(coalesce(p_dados->>'cor','')), ''), coalesce(nullif(p_dados->>'condicao',''), 'qualquer'),
            nullif(p_dados->>'preco_max_centavos','')::bigint, v_val, nullif(trim(coalesce(p_dados->>'observacao','')), ''))
    returning id into v_id;
  else
    update public.lista_espera set cliente_id = (p_dados->>'cliente_id')::uuid, modelo = trim(p_dados->>'modelo'),
      capacidade = nullif(trim(coalesce(p_dados->>'capacidade','')), ''), cor = nullif(trim(coalesce(p_dados->>'cor','')), ''),
      condicao = coalesce(nullif(p_dados->>'condicao',''), 'qualquer'), preco_max_centavos = nullif(p_dados->>'preco_max_centavos','')::bigint,
      validade = v_val, observacao = nullif(trim(coalesce(p_dados->>'observacao','')), '')
    where id = p_id and status in ('aguardando','avisado') returning id into v_id;
    if v_id is null then raise exception 'Pedido encerrado não pode ser editado.'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.mudar_espera(p_id uuid, p_status text, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare e record;
begin
  if not privado.pode('crm.usar') then raise exception 'Sem permissão.'; end if;
  select * into e from public.lista_espera where id = p_id for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if p_status = 'cancelado' then
    if coalesce(length(trim(p_motivo)), 0) < 3 then raise exception 'Informe o motivo.'; end if;
    update public.lista_espera set status = 'cancelado', motivo_cancelamento = trim(p_motivo) where id = p_id;
  elsif p_status = 'atendido' then
    update public.lista_espera set status = 'atendido' where id = p_id;
  elsif p_status = 'aguardando' then
    update public.lista_espera set status = 'aguardando', motivo_cancelamento = null, serie_avisada_id = null, avisado_em = null,
      validade = greatest(validade, (now() at time zone 'America/Sao_Paulo')::date + (select crm_dias_espera from public.empresa limit 1))
    where id = p_id;
  else
    raise exception 'Situação inválida.';
  end if;
end $$;

create or replace function public.espera_aparelhos(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (privado.pode('crm.usar') or privado.pode('crm.ver_todos')) then raise exception 'Sem permissão.'; end if;
  return coalesce((select jsonb_agg(to_jsonb(s)) from privado.espera_series(p_id) s), '[]'::jsonb);
end $$;

-- Quando o aparelho avisado é vendido para o mesmo cliente, o pedido é atendido sozinho
create or replace function privado.fn_series_espera() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_venda uuid; v_cli uuid;
begin
  if new.status = 'vendido' and old.status is distinct from 'vendido' and new.venda_item_id is not null then
    select vi.venda_id, v.cliente_id into v_venda, v_cli from public.venda_itens vi join public.vendas v on v.id = vi.venda_id where vi.id = new.venda_item_id;
    update public.lista_espera set status = 'atendido', venda_id = v_venda
    where status in ('aguardando','avisado') and cliente_id = v_cli
      and serie_avisada_id = new.id;
  end if;
  return new;
end $$;
create or replace trigger trg_series_espera after update of status on nucleo.produto_series
  for each row execute function privado.fn_series_espera();

-- ---------------------------------------------------------------------
-- Segmentos para campanhas no WhatsApp
-- p_segmento: aniversario (p_param = dias à frente) | upgrade (meses de uso; p_filtro 'iphone')
--             | sumido (dias sem comprar)
-- ---------------------------------------------------------------------
create or replace function public.crm_segmento(p_segmento text, p_param int default null, p_filtro text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare hoje date := (now() at time zone 'America/Sao_Paulo')::date; emp record; v_param int; r jsonb;
begin
  if not privado.pode('crm.campanhas') then raise exception 'Sem permissão para campanhas.'; end if;
  select * into emp from public.empresa limit 1;

  if p_segmento = 'aniversario' then
    v_param := least(greatest(coalesce(p_param, 7), 0), 31);
    with base as (
      select c.id, c.nome, c.telefone, c.aceita_marketing, privado.proximo_aniversario(c.data_nascimento, hoje) as ref, c.data_nascimento
      from public.clientes c where c.ativo and c.data_nascimento is not null)
    select jsonb_agg(jsonb_build_object('cliente_id', b.id, 'nome', b.nome, 'telefone', b.telefone, 'aceita_marketing', b.aceita_marketing,
             'referencia', b.ref, 'idade', extract(year from age(b.ref, b.data_nascimento))::int,
             'detalhe', case when b.ref = hoje then 'Hoje' else 'Em ' || (b.ref - hoje) || ' dia(s)' end) order by b.ref, b.nome)
    into r from base b where b.ref <= hoje + v_param;

  elsif p_segmento = 'upgrade' then
    v_param := least(greatest(coalesce(p_param, emp.crm_meses_upgrade), 1), 60);
    with comp as (
      select v.cliente_id, v.data, p.nome as aparelho,
             row_number() over (partition by v.cliente_id order by v.data desc, v.criado_em desc) as rn
      from public.venda_itens vi
      join public.vendas v on v.id = vi.venda_id and v.status in ('concluida','devolvida') and v.cliente_id is not null
      join public.produtos p on p.id = vi.produto_id
      where vi.devolvido_qtd < vi.quantidade
        and (vi.serie_id is not null or lower(p.nome || ' ' || coalesce(p.modelo,'')) like '%iphone%')
        and (coalesce(p_filtro,'') = '' or lower(p.nome || ' ' || coalesce(p.marca,'') || ' ' || coalesce(p.modelo,'')) like '%' || lower(p_filtro) || '%'))
    select jsonb_agg(jsonb_build_object('cliente_id', c.id, 'nome', c.nome, 'telefone', c.telefone, 'aceita_marketing', c.aceita_marketing,
             'referencia', x.data, 'aparelho', x.aparelho,
             'meses', (extract(year from age(hoje, x.data)) * 12 + extract(month from age(hoje, x.data)))::int,
             'detalhe', x.aparelho || ' comprado em ' || to_char(x.data, 'DD/MM/YYYY')) order by x.data, c.nome)
    into r from comp x join public.clientes c on c.id = x.cliente_id and c.ativo
    where x.rn = 1 and x.data <= (hoje - make_interval(months => v_param))::date;

  elsif p_segmento = 'sumido' then
    v_param := least(greatest(coalesce(p_param, emp.dias_alerta_sem_compra, 90), 15), 1095);
    with ult as (
      select cliente_id, max(d) as ultima from (
        select cliente_id, data as d from public.vendas where status in ('concluida','devolvida') and cliente_id is not null
        union all
        select cliente_id, (coalesce(entregue_em, criado_em) at time zone 'America/Sao_Paulo')::date from public.ordens_servico
        where cliente_id is not null and status <> 'cancelada') z group by cliente_id)
    select jsonb_agg(jsonb_build_object('cliente_id', c.id, 'nome', c.nome, 'telefone', c.telefone, 'aceita_marketing', c.aceita_marketing,
             'referencia', u.ultima, 'dias', hoje - u.ultima,
             'detalhe', 'Última visita há ' || (hoje - u.ultima) || ' dias') order by u.ultima desc, c.nome)
    into r from ult u join public.clientes c on c.id = u.cliente_id and c.ativo
    where u.ultima <= hoje - v_param;
  else
    raise exception 'Segmento inválido.';
  end if;

  -- último contato deste segmento com cada cliente
  select jsonb_agg(x || jsonb_build_object(
           'ultimo_contato', (select max(k.enviado_em) from public.crm_contatos k where k.cliente_id = (x->>'cliente_id')::uuid and k.segmento = p_segmento),
           'recente', exists (select 1 from public.crm_contatos k where k.cliente_id = (x->>'cliente_id')::uuid and k.segmento = p_segmento
                              and k.enviado_em > now() - make_interval(days => emp.crm_dias_recontato))) order by t.n)
  into r from jsonb_array_elements(coalesce(r, '[]'::jsonb)) with ordinality as t(x, n);
  return jsonb_build_object('segmento', p_segmento, 'param', v_param, 'clientes', coalesce(r, '[]'::jsonb), 'dias_recontato', emp.crm_dias_recontato);
end $$;

-- Registra que a mensagem foi aberta no WhatsApp
create or replace function public.registrar_contato(p_segmento text, p_cliente uuid default null, p_lead uuid default null, p_espera uuid default null, p_serie uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_cli uuid := p_cliente;
begin
  if p_segmento in ('aniversario','upgrade','sumido') then
    if not privado.pode('crm.campanhas') then raise exception 'Sem permissão para campanhas.'; end if;
    if not exists (select 1 from public.clientes where id = p_cliente and aceita_marketing) then
      raise exception 'Este cliente não autorizou receber mensagens de oferta (LGPD).';
    end if;
  elsif p_segmento = 'lead' then
    if p_lead is null or not privado.lead_visivel(p_lead) then raise exception 'Interessado não encontrado.'; end if;
    select cliente_id into v_cli from public.leads where id = p_lead;
    perform public.anotar_lead(p_lead, 'whatsapp', 'Mensagem enviada pelo WhatsApp');
  elsif p_segmento = 'espera' then
    if not privado.pode('crm.usar') then raise exception 'Sem permissão.'; end if;
    select cliente_id into v_cli from public.lista_espera where id = p_espera;
    if v_cli is null then raise exception 'Pedido não encontrado.'; end if;
    update public.lista_espera set status = 'avisado', avisado_em = now(), serie_avisada_id = coalesce(p_serie, serie_avisada_id)
    where id = p_espera and status in ('aguardando','avisado');
  elsif p_segmento = 'avulso' then
    if not privado.pode('clientes.ver') then raise exception 'Sem permissão.'; end if;
  else
    raise exception 'Segmento inválido.';
  end if;
  insert into public.crm_contatos (cliente_id, lead_id, espera_id, segmento) values (v_cli, p_lead, p_espera, p_segmento);
end $$;

-- Consentimento LGPD registrado pelo atendimento (ex.: cliente respondeu SAIR)
create or replace function public.registrar_consentimento(p_cliente uuid, p_aceita boolean, p_meio text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (privado.pode('clientes.editar') or privado.pode('crm.usar')) then raise exception 'Sem permissão.'; end if;
  if coalesce(length(trim(p_meio)), 0) < 3 then raise exception 'Informe como o cliente pediu (ex.: respondeu SAIR no WhatsApp).'; end if;
  perform set_config('msc.meio_consentimento', left(trim(p_meio), 120), true);
  update public.clientes set aceita_marketing = p_aceita where id = p_cliente;
  if not found then raise exception 'Cliente não encontrado.'; end if;
  perform set_config('msc.meio_consentimento', '', true);
end $$;

create or replace function public.salvar_modelo_mensagem(p_codigo text, p_texto text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not privado.pode('crm.modelos') then raise exception 'Sem permissão para editar modelos.'; end if;
  if coalesce(length(trim(p_texto)), 0) < 5 then raise exception 'Escreva a mensagem.'; end if;
  update public.mensagens_modelos set texto = trim(p_texto), atualizado_em = now() where codigo = p_codigo;
  if not found then raise exception 'Modelo não encontrado.'; end if;
end $$;

-- Números para o menu, avisos e a aba "Hoje" do CRM
create or replace function public.crm_resumo()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_todos boolean := privado.pode('crm.ver_todos'); emp record;
begin
  if not (privado.pode('crm.usar') or v_todos) then return '{}'::jsonb; end if;
  select * into emp from public.empresa limit 1;
  return jsonb_build_object(
    'leads_abertos', (select count(*) from public.leads l where l.etapa not in ('ganho','perdido') and (v_todos or l.responsavel_id = auth.uid() or l.criado_por = auth.uid())),
    'leads_retorno', (select count(*) from public.leads l where l.etapa not in ('ganho','perdido') and l.proximo_contato <= hoje
                       and (v_todos or l.responsavel_id = auth.uid() or l.criado_por = auth.uid())),
    'espera_aguardando', (select count(*) from public.lista_espera where status in ('aguardando','avisado')),
    'espera_chegou', (select count(*) from public.lista_espera e where e.status = 'aguardando' and e.validade >= hoje
                       and exists (select 1 from privado.espera_series(e.id))),
    'aniversario_hoje', case when privado.pode('crm.campanhas') then (select count(*) from public.clientes c where c.ativo and c.aceita_marketing
                         and privado.proximo_aniversario(c.data_nascimento, hoje) = hoje
                         and not exists (select 1 from public.crm_contatos k where k.cliente_id = c.id and k.segmento = 'aniversario'
                                         and k.enviado_em > now() - interval '300 days')) else 0 end,
    'ganhos_mes', (select count(*) from public.leads l where l.etapa = 'ganho' and l.fechado_em >= date_trunc('month', now() at time zone 'America/Sao_Paulo')
                    and (v_todos or l.responsavel_id = auth.uid() or l.criado_por = auth.uid())),
    'perdidos_mes', (select count(*) from public.leads l where l.etapa = 'perdido' and l.fechado_em >= date_trunc('month', now() at time zone 'America/Sao_Paulo')
                    and (v_todos or l.responsavel_id = auth.uid() or l.criado_por = auth.uid())),
    'consentimento', jsonb_build_object('sim', (select count(*) from public.clientes where ativo and aceita_marketing),
                                        'total', (select count(*) from public.clientes where ativo)));
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.salvar_lead(uuid,jsonb)','public.mover_lead(uuid,text,text,uuid,date)','public.anotar_lead(uuid,text,text,date)',
    'public.lead_detalhe(uuid)','public.salvar_espera(uuid,jsonb)','public.mudar_espera(uuid,text,text)','public.espera_aparelhos(uuid)',
    'public.crm_segmento(text,int,text)','public.registrar_contato(text,uuid,uuid,uuid,uuid)','public.registrar_consentimento(uuid,boolean,text)',
    'public.salvar_modelo_mensagem(text,text)','public.crm_resumo()'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  execute 'revoke execute on function privado.lead_evento(uuid,text,text), privado.fn_series_espera() from public, anon, authenticated';
  execute 'revoke execute on function public.fn_log_consentimento() from public, anon, authenticated';
  execute 'grant execute on function privado.lead_visivel(uuid), privado.proximo_aniversario(date,date), privado.etapa_rotulo(text) to authenticated';
end $$;
