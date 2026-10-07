-- =====================================================================
-- Etapa 2 — Aparelhos: visões e funções usadas pelas telas
-- =====================================================================

-- Itens de venda: inclui o retrato do aparelho
create or replace view public.venda_itens with (security_invoker = true) as
select i.id, i.venda_id, i.ordem, i.produto_id, i.descricao, i.categoria_id, c.nome as categoria, i.quantidade,
       i.preco_tabela_centavos, i.preco_unitario_centavos, i.desconto_centavos, i.total_centavos,
       case when privado.pode('vendas.ver_lucro') then i.custo_unitario_centavos end as custo_unitario_centavos,
       i.serie_id, i.serie, i.garantia_dias, i.devolvido_qtd, i.detalhes
from nucleo.venda_itens i left join public.categorias c on c.id = i.categoria_id;

-- Lista de aparelhos (um por IMEI), com custo e lucro só para quem pode ver
create or replace view public.aparelhos with (security_invoker = true) as
select s.id, s.produto_id, p.nome as produto, p.marca, p.modelo, p.sku, cat.nome as categoria,
       s.serie as imei, s.imei2, s.status,
       coalesce(s.condicao, case when p.condicao = 'novo' then 'lacrado' else 'seminovo' end) as condicao,
       s.grau, s.bateria_pct, s.cor, s.capacidade, s.pecas_trocadas, s.checklist,
       coalesce(s.preco_venda_centavos, p.preco_venda_centavos) as preco_venda_centavos,
       s.preco_venda_centavos as preco_proprio_centavos,
       coalesce(s.garantia_dias, p.garantia_dias) as garantia_dias,
       case when privado.pode('estoque.ver_custo') then s.custo_centavos end as custo_aquisicao_centavos,
       case when privado.pode('estoque.ver_custo') then s.custo_recond_centavos end as custo_recond_centavos,
       case when privado.pode('estoque.ver_custo') then s.custo_centavos + s.custo_recond_centavos end as custo_total_centavos,
       coalesce(s.procedencia, case when s.entrada_id is not null then 'fornecedor' end) as procedencia,
       coalesce(f.nome, cli_o.nome) as origem_nome, s.cliente_origem_id, s.entrada_id, e.numero as entrada_numero,
       s.observacao, s.criado_em, s.atualizado_em,
       case when s.status in ('disponivel','reservado','em_teste','em_reparo','em_garantia')
            then ((now() at time zone 'America/Sao_Paulo')::date - (s.criado_em at time zone 'America/Sao_Paulo')::date) end as dias_em_estoque,
       vi.venda_id, v.numero as venda_numero, v.data as venda_data, v.cliente_id as venda_cliente_id, cl.nome as venda_cliente_nome,
       pf.nome as venda_vendedor_nome,
       case when vi.id is not null then round(vi.total_centavos::numeric * case when v.subtotal_centavos > 0 then v.total_centavos::numeric / v.subtotal_centavos else 1 end)::bigint end as venda_valor_centavos,
       case when privado.pode('vendas.ver_lucro') and vi.id is not null then
         round(coalesce((select sum(vp.taxa_centavos) from public.venda_pagamentos vp where vp.venda_id = v.id), 0)::numeric
               * vi.total_centavos / nullif(v.subtotal_centavos, 0))::bigint end as venda_taxa_centavos,
       case when privado.pode('vendas.ver_lucro') and vi.id is not null then
         round(vi.total_centavos::numeric * case when v.subtotal_centavos > 0 then v.total_centavos::numeric / v.subtotal_centavos else 1 end)::bigint
         - vi.custo_unitario_centavos
         - round(coalesce((select sum(vp.taxa_centavos) from public.venda_pagamentos vp where vp.venda_id = v.id), 0)::numeric
                 * vi.total_centavos / nullif(v.subtotal_centavos, 0))::bigint end as lucro_centavos,
       (select count(*) from nucleo.serie_fotos fo where fo.serie_id = s.id and not fo.removida) as fotos_qtd
from nucleo.produto_series s
join nucleo.produtos p on p.id = s.produto_id
left join public.categorias cat on cat.id = p.categoria_id
left join public.entradas e on e.id = s.entrada_id
left join public.fornecedores f on f.id = e.fornecedor_id
left join public.clientes cli_o on cli_o.id = s.cliente_origem_id
left join nucleo.venda_itens vi on vi.id = s.venda_item_id
left join public.vendas v on v.id = vi.venda_id and v.status in ('concluida','devolvida','aguardando_aprovacao')
left join public.clientes cl on cl.id = v.cliente_id
left join public.perfis pf on pf.user_id = v.criado_por;

create or replace view public.aparelho_eventos with (security_invoker = true) as
select e.id, e.serie_id, e.tipo, e.descricao, e.criado_em, pf.nome as usuario
from nucleo.serie_eventos e left join public.perfis pf on pf.user_id = e.criado_por;

create or replace view public.aparelho_custos with (security_invoker = true) as
select c.id, c.serie_id, c.descricao, c.valor_centavos, c.cancelado, c.motivo_cancelamento, c.criado_em, pf.nome as usuario
from nucleo.serie_custos c left join public.perfis pf on pf.user_id = c.criado_por;

create or replace view public.aparelho_fotos with (security_invoker = true) as
select id, serie_id, imagem, legenda, criado_em from nucleo.serie_fotos where not removida;

revoke all on public.aparelhos, public.aparelho_eventos, public.aparelho_custos, public.aparelho_fotos from anon;
grant select on public.aparelhos, public.aparelho_eventos, public.aparelho_custos, public.aparelho_fotos, public.venda_itens to authenticated;

-- Salvar a ficha
create or replace function public.salvar_aparelho(p jsonb)
returns void language plpgsql security definer set search_path = nucleo, public as $$
declare s record; v_preco bigint;
begin
  if not privado.pode('aparelhos.editar') then raise exception 'Sem permissão para editar aparelhos.'; end if;
  select * into s from nucleo.produto_series where id = (p->>'id')::uuid for update;
  if not found then raise exception 'Aparelho não encontrado.'; end if;
  v_preco := s.preco_venda_centavos;
  if p ? 'preco_venda_centavos' then
    if not privado.pode('estoque.produtos') then raise exception 'Sem permissão para mudar preço.'; end if;
    v_preco := nullif(p->>'preco_venda_centavos','')::bigint;
  end if;
  update nucleo.produto_series set
    imei2 = nullif(upper(trim(p->>'imei2')),''),
    condicao = nullif(p->>'condicao',''),
    grau = nullif(p->>'grau',''),
    bateria_pct = nullif(p->>'bateria_pct','')::smallint,
    cor = nullif(trim(p->>'cor'),''),
    capacidade = nullif(trim(p->>'capacidade'),''),
    pecas_trocadas = nullif(trim(p->>'pecas_trocadas'),''),
    checklist = coalesce(p->'checklist', checklist),
    garantia_dias = nullif(p->>'garantia_dias','')::int,
    procedencia = nullif(p->>'procedencia',''),
    cliente_origem_id = nullif(p->>'cliente_origem_id','')::uuid,
    preco_venda_centavos = v_preco,
    observacao = nullif(trim(p->>'observacao'),'')
  where id = s.id;
exception when unique_violation then
  raise exception 'Esse IMEI 2 já está em outro aparelho.';
end $$;

-- Mudar situação (teste, reparo, garantia, disponível)
create or replace function public.mudar_status_aparelho(p_serie uuid, p_status text, p_obs text default null)
returns void language plpgsql security definer set search_path = nucleo, public as $$
declare s record;
begin
  if not privado.pode('aparelhos.editar') then raise exception 'Sem permissão para editar aparelhos.'; end if;
  if p_status not in ('disponivel','em_teste','em_reparo','em_garantia') then raise exception 'Situação inválida.'; end if;
  select * into s from nucleo.produto_series where id = p_serie for update;
  if not found then raise exception 'Aparelho não encontrado.'; end if;
  if s.status not in ('disponivel','em_teste','em_reparo','em_garantia') then
    raise exception 'Este aparelho está "%" e não pode mudar de situação por aqui.', s.status;
  end if;
  if s.status = p_status then return; end if;
  update nucleo.produto_series set status = p_status, observacao = coalesce(nullif(trim(p_obs),''), observacao) where id = s.id;
end $$;

-- Custos de recondicionamento
create or replace function public.adicionar_custo_aparelho(p_serie uuid, p_descricao text, p_valor bigint)
returns uuid language plpgsql security definer set search_path = nucleo, public as $$
declare v_id uuid; v_st text;
begin
  if not privado.pode('aparelhos.editar') then raise exception 'Sem permissão para lançar custos.'; end if;
  select status into v_st from nucleo.produto_series where id = p_serie for update;
  if not found then raise exception 'Aparelho não encontrado.'; end if;
  if v_st in ('vendido','devolvido_fornecedor','baixado') then raise exception 'Aparelho já saiu do estoque.'; end if;
  if coalesce(p_valor, 0) <= 0 then raise exception 'Informe o valor.'; end if;
  insert into nucleo.serie_custos (serie_id, descricao, valor_centavos) values (p_serie, trim(p_descricao), p_valor) returning id into v_id;
  return v_id;
end $$;

create or replace function public.cancelar_custo_aparelho(p_custo uuid, p_motivo text)
returns void language plpgsql security definer set search_path = nucleo, public as $$
declare c record;
begin
  if not (privado.pode('aparelhos.editar') and privado.pode('estoque.ver_custo')) then raise exception 'Sem permissão.'; end if;
  if coalesce(length(trim(p_motivo)),0) < 3 then raise exception 'Informe o motivo.'; end if;
  select * into c from nucleo.serie_custos where id = p_custo for update;
  if not found or c.cancelado then raise exception 'Custo não encontrado ou já cancelado.'; end if;
  if (select status from nucleo.produto_series where id = c.serie_id) = 'vendido' then raise exception 'Aparelho já vendido: o custo entrou no lucro da venda.'; end if;
  update nucleo.serie_custos set cancelado = true, motivo_cancelamento = trim(p_motivo) where id = c.id;
end $$;

-- Fotos
create or replace function public.adicionar_foto_aparelho(p_serie uuid, p_imagem text, p_legenda text default null)
returns uuid language plpgsql security definer set search_path = nucleo, public as $$
declare v_id uuid;
begin
  if not privado.pode('aparelhos.editar') then raise exception 'Sem permissão para incluir fotos.'; end if;
  if not exists (select 1 from nucleo.produto_series where id = p_serie) then raise exception 'Aparelho não encontrado.'; end if;
  if (select count(*) from nucleo.serie_fotos where serie_id = p_serie and not removida) >= 8 then raise exception 'Máximo de 8 fotos por aparelho.'; end if;
  insert into nucleo.serie_fotos (serie_id, imagem, legenda) values (p_serie, p_imagem, nullif(trim(p_legenda),'')) returning id into v_id;
  insert into nucleo.serie_eventos (serie_id, tipo, descricao) values (p_serie, 'foto', 'Foto incluída' || coalesce(': ' || nullif(trim(p_legenda),''), ''));
  return v_id;
end $$;

create or replace function public.remover_foto_aparelho(p_foto uuid)
returns void language plpgsql security definer set search_path = nucleo, public as $$
declare v_serie uuid;
begin
  if not privado.pode('aparelhos.editar') then raise exception 'Sem permissão.'; end if;
  update nucleo.serie_fotos set removida = true where id = p_foto and not removida returning serie_id into v_serie;
  if v_serie is not null then insert into nucleo.serie_eventos (serie_id, tipo, descricao) values (v_serie, 'foto', 'Foto removida'); end if;
end $$;

-- Anotação livre na linha do tempo
create or replace function public.anotar_aparelho(p_serie uuid, p_texto text)
returns void language plpgsql security definer set search_path = nucleo, public as $$
begin
  if not privado.ve_catalogo() then raise exception 'Sem permissão.'; end if;
  if coalesce(length(trim(p_texto)),0) < 2 then raise exception 'Escreva a anotação.'; end if;
  insert into nucleo.serie_eventos (serie_id, tipo, descricao) values (p_serie, 'nota', trim(p_texto));
end $$;

-- Resumo para o Início e para a tela Aparelhos
create or replace function public.aparelhos_resumo()
returns jsonb language plpgsql stable security definer set search_path = nucleo, public as $$
declare v_dias int; r jsonb;
begin
  if not privado.pode('estoque.ver') then raise exception 'Sem permissão.'; end if;
  select dias_alerta_aparelho_parado into v_dias from public.empresa where id = 1;
  select jsonb_build_object(
    'dias_alerta', v_dias,
    'disponiveis', count(*) filter (where s.status = 'disponivel'),
    'em_teste', count(*) filter (where s.status = 'em_teste'),
    'em_reparo', count(*) filter (where s.status = 'em_reparo'),
    'em_garantia', count(*) filter (where s.status = 'em_garantia'),
    'reservados', count(*) filter (where s.status = 'reservado'),
    'parados', count(*) filter (where s.status in ('disponivel','em_teste','em_reparo') and s.criado_em < now() - make_interval(days => v_dias)),
    'valor_venda', coalesce(sum(coalesce(s.preco_venda_centavos, p.preco_venda_centavos)) filter (where s.status = 'disponivel'), 0),
    'valor_custo', case when privado.pode('estoque.ver_custo') then coalesce(sum(s.custo_centavos + s.custo_recond_centavos) filter (where s.status in ('disponivel','reservado','em_teste','em_reparo','em_garantia')), 0) end
  ) into r
  from nucleo.produto_series s join nucleo.produtos p on p.id = s.produto_id;
  return r;
end $$;

-- Busca geral: IMEI de qualquer aparelho (inclusive vendido) abre a ficha
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
  foreach f in array array['public.salvar_aparelho(jsonb)','public.mudar_status_aparelho(uuid,text,text)',
    'public.adicionar_custo_aparelho(uuid,text,bigint)','public.cancelar_custo_aparelho(uuid,text)',
    'public.adicionar_foto_aparelho(uuid,text,text)','public.remover_foto_aparelho(uuid)',
    'public.anotar_aparelho(uuid,text)','public.aparelhos_resumo()','public.busca_geral(text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  execute 'revoke execute on function nucleo.fn_evento_serie(), nucleo.fn_recalcular_custo_recond() from public, anon, authenticated';
end $$;
