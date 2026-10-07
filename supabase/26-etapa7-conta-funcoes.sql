-- =====================================================================
-- Etapa 7 — Conta e equipe: funções
-- =====================================================================

-- Situação do acesso do usuário agora (para a tela avisar fora do horário)
create or replace function public.acesso_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e record; v_cargo text; t timestamp := now() at time zone 'America/Sao_Paulo';
begin
  select cargo into v_cargo from public.perfis where user_id = auth.uid() and ativo;
  select * into e from public.empresa where id = 1;
  return jsonb_build_object(
    'restrito', coalesce(e.restringir_horario, false),
    'gerente', v_cargo = 'gerente',
    'liberado', v_cargo = 'gerente' or privado.dentro_horario(),
    'horario_hoje', case when t::date = any (coalesce(e.feriados, '{}')) then null else e.horario -> extract(isodow from t)::int::text end,
    'feriado', t::date = any (coalesce(e.feriados, '{}')),
    'liberado_ate', case when e.acesso_liberado_ate > now() then e.acesso_liberado_ate end);
end $$;

-- Gerente libera o acesso fora do horário por algumas horas (0 = cancela a liberação)
create or replace function public.liberar_acesso(p_horas int)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v timestamptz;
begin
  if not privado.pode('config.gerenciar') then raise exception 'Sem permissão.'; end if;
  if p_horas < 0 or p_horas > 24 then raise exception 'Escolha de 1 a 24 horas.'; end if;
  v := case when p_horas = 0 then null else now() + make_interval(hours => p_horas) end;
  update public.empresa set acesso_liberado_ate = v where id = 1;
  insert into public.auditoria (tabela, registro_texto, acao, depois, usuario_id)
  values ('acesso', 'Acesso fora do horário', case when v is null then 'BLOQUEAR' else 'LIBERAR' end, jsonb_build_object('ate', v), auth.uid());
  return v;
end $$;

-- Minha conta: o próprio usuário muda nome e telefone
create or replace function public.atualizar_meu_perfil(p_nome text, p_telefone text)
returns void language plpgsql security definer set search_path = public as $$
declare v_tel text := nullif(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), '');
begin
  if auth.uid() is null or not exists (select 1 from public.perfis where user_id = auth.uid() and ativo) then raise exception 'Sem acesso.'; end if;
  if coalesce(length(trim(p_nome)), 0) < 2 then raise exception 'Informe seu nome.'; end if;
  if v_tel is not null and v_tel !~ '^\d{10,11}$' then raise exception 'Telefone com DDD (10 ou 11 números).'; end if;
  update public.perfis set nome = trim(p_nome), telefone = v_tel where user_id = auth.uid();
end $$;

-- Usadas pela função "equipe" (criar funcionário / redefinir senha)
create or replace function public.pode_gerir_equipe()
returns boolean language sql stable security definer set search_path = public as $$
  select privado.pode('config.gerenciar')
$$;
create or replace function public.registrar_equipe(p_acao text, p_alvo uuid, p_detalhe jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not privado.pode('config.gerenciar') then raise exception 'Sem permissão.'; end if;
  if p_acao not in ('CRIAR_USUARIO','REDEFINIR_SENHA') then raise exception 'Ação inválida.'; end if;
  insert into public.auditoria (tabela, registro_id, registro_texto, acao, depois, usuario_id)
  values ('perfis', p_alvo, (select nome from public.perfis where user_id = p_alvo), p_acao, coalesce(p_detalhe, '{}'::jsonb), auth.uid());
end $$;

-- ---------------------------------------------------------------------
-- LGPD: exportar tudo o que a loja guarda de um cliente
-- ---------------------------------------------------------------------
create or replace function public.cliente_exportar(p_cliente uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c record; r jsonb;
begin
  if not privado.pode('clientes.lgpd') then raise exception 'Sem permissão.'; end if;
  select * into c from public.clientes where id = p_cliente;
  if not found then raise exception 'Cliente não encontrado.'; end if;
  r := jsonb_build_object(
    'gerado_em', now(),
    'loja', (select jsonb_build_object('nome', nome_fantasia, 'razao_social', razao_social, 'cnpj', cnpj, 'email', email, 'telefone', telefone) from public.empresa where id = 1),
    'cadastro', to_jsonb(c) - 'criado_por',
    'consentimentos', coalesce((select jsonb_agg(jsonb_build_object('aceita', aceita, 'meio', meio, 'em', registrado_em) order by registrado_em)
                                from public.clientes_consentimentos where cliente_id = p_cliente), '[]'::jsonb),
    'compras', coalesce((select jsonb_agg(jsonb_build_object('numero', v.numero, 'data', v.data, 'status', v.status, 'total_centavos', v.total_centavos,
                           'itens', (select jsonb_agg(jsonb_build_object('descricao', i.descricao, 'quantidade', i.quantidade, 'total_centavos', i.total_centavos,
                                       'imei', i.serie, 'garantia_dias', i.garantia_dias) order by i.ordem) from public.venda_itens i where i.venda_id = v.id)) order by v.data)
                         from public.vendas v where v.cliente_id = p_cliente), '[]'::jsonb),
    'ordens_servico', coalesce((select jsonb_agg(jsonb_build_object('numero', o.numero, 'aparelho', o.aparelho, 'imei', o.imei, 'defeito', o.defeito,
                           'status', o.status, 'total_centavos', o.total_centavos, 'entrada', o.criado_em, 'entregue_em', o.entregue_em, 'garantia_ate', o.garantia_ate) order by o.criado_em)
                         from public.ordens_servico o where o.cliente_id = p_cliente), '[]'::jsonb),
    'orcamentos', coalesce((select jsonb_agg(jsonb_build_object('numero', numero, 'data', criado_em, 'total_centavos', total_centavos, 'status', status) order by criado_em)
                         from public.orcamentos where cliente_id = p_cliente), '[]'::jsonb),
    'reservas', coalesce((select jsonb_agg(jsonb_build_object('numero', numero, 'data', criado_em, 'sinal_centavos', valor_sinal_centavos, 'status', status) order by criado_em)
                         from public.reservas where cliente_id = p_cliente), '[]'::jsonb),
    'aparelhos_vendidos_a_loja', coalesce((select jsonb_agg(jsonb_build_object('numero', numero, 'tipo', tipo, 'imei', imei, 'documento', documento, 'valor_centavos', valor_centavos,
                           'data', criado_em, 'status', status) order by criado_em) from public.avaliacoes where cliente_id = p_cliente), '[]'::jsonb),
    'contas_a_receber', coalesce((select jsonb_agg(jsonb_build_object('descricao', descricao, 'vencimento', vencimento, 'valor_centavos', valor_centavos,
                           'pago_centavos', pago_centavos, 'status', status) order by vencimento) from public.titulos where cliente_id = p_cliente), '[]'::jsonb),
    'interesses', coalesce((select jsonb_agg(jsonb_build_object('interesse', interesse, 'etapa', etapa, 'data', criado_em) order by criado_em)
                         from public.leads where cliente_id = p_cliente), '[]'::jsonb),
    'lista_de_espera', coalesce((select jsonb_agg(jsonb_build_object('modelo', modelo, 'status', status, 'data', criado_em) order by criado_em)
                         from public.lista_espera where cliente_id = p_cliente), '[]'::jsonb),
    'mensagens_registradas', coalesce((select jsonb_agg(jsonb_build_object('tipo', segmento, 'em', enviado_em) order by enviado_em)
                         from public.crm_contatos where cliente_id = p_cliente), '[]'::jsonb));
  insert into public.lgpd_registros (cliente_id, tipo) values (p_cliente, 'exportacao');
  return r;
end $$;

-- ---------------------------------------------------------------------
-- LGPD: anonimizar (apaga os dados pessoais e mantém o histórico de vendas
-- e financeiro sem identificar a pessoa)
-- ---------------------------------------------------------------------
create or replace function public.anonimizar_cliente(p_cliente uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare c record; v_rot text; v_ids uuid[];
begin
  if not privado.pode('clientes.lgpd') then raise exception 'Sem permissão.'; end if;
  if coalesce(length(trim(p_motivo)), 0) < 5 then raise exception 'Informe o motivo (ex.: pedido do titular por WhatsApp em 10/10).'; end if;
  select * into c from public.clientes where id = p_cliente for update;
  if not found then raise exception 'Cliente não encontrado.'; end if;
  if c.anonimizado_em is not null then raise exception 'Este cliente já foi anonimizado.'; end if;
  if exists (select 1 from public.titulos where cliente_id = p_cliente and tipo = 'receber' and status in ('aberto','parcial')) then
    raise exception 'O cliente tem contas a receber em aberto. Receba ou cancele antes de anonimizar.';
  end if;
  if exists (select 1 from public.ordens_servico where cliente_id = p_cliente and status not in ('entregue','cancelada','abandonada')) then
    raise exception 'O cliente tem OS em andamento. Entregue ou cancele antes de anonimizar.';
  end if;
  if exists (select 1 from public.reservas where cliente_id = p_cliente and status = 'ativa') then
    raise exception 'O cliente tem reserva ativa. Converta ou cancele antes de anonimizar.';
  end if;
  v_rot := 'Cliente anonimizado ' || upper(left(replace(p_cliente::text, '-', ''), 6));

  -- descrições das contas que levam o nome (o extrato das contas é imutável e fica como registro contábil)
  if length(c.nome) >= 3 then
    update public.titulos set descricao = replace(descricao, c.nome, v_rot) where cliente_id = p_cliente and position(c.nome in descricao) > 0;
  end if;

  update public.clientes set nome = v_rot, telefone = null, email = null, cpf = null, cnpj = null, cep = null, logradouro = null, numero = null,
    complemento = null, bairro = null, cidade = null, uf = null, ibge = null, data_nascimento = null, observacoes = null, como_conheceu = null,
    tags = '{}', aceita_marketing = false, ativo = false, anonimizado_em = now()
  where id = p_cliente;

  update public.orcamentos set cliente_nome = v_rot, cliente_telefone = null, observacao = null where cliente_id = p_cliente;
  update public.avaliacoes set documento = null, observacao = null where cliente_id = p_cliente;
  update public.ordens_servico set aprovacao_nome = null, observacao = null where cliente_id = p_cliente;
  select coalesce(array_agg(id), '{}') into v_ids from public.leads where cliente_id = p_cliente;
  update public.leads set nome = v_rot, telefone = null, observacao = null where id = any (v_ids);
  update public.lead_eventos set texto = null where lead_id = any (v_ids) and tipo in ('nota','ligacao');
  update public.lista_espera set observacao = null where cliente_id = p_cliente;

  -- o histórico de alterações não pode guardar os dados antigos
  update public.auditoria set antes = null, depois = jsonb_build_object('anonimizado', true)
  where (tabela = 'clientes' and registro_id = p_cliente)
     or (tabela = 'leads' and registro_id = any (v_ids))
     or (tabela in ('orcamentos','avaliacoes','lista_espera','ordens_servico')
         and registro_id in (select id from public.orcamentos where cliente_id = p_cliente
                             union all select id from public.avaliacoes where cliente_id = p_cliente
                             union all select id from public.lista_espera where cliente_id = p_cliente
                             union all select id from public.ordens_servico where cliente_id = p_cliente));

  insert into public.lgpd_registros (cliente_id, tipo, motivo) values (p_cliente, 'anonimizacao', trim(p_motivo));
end $$;

-- ---------------------------------------------------------------------
-- Backup: o navegador baixa tabela por tabela em lotes e monta um arquivo
-- ---------------------------------------------------------------------
create or replace function privado.backup_lista()
returns table (esquema text, tabela text) language sql stable security definer set search_path = public as $$
  select table_schema::text, table_name::text from information_schema.tables
  where table_schema in ('public','nucleo') and table_type = 'BASE TABLE'
    and table_name not in ('os_senhas')
  order by (table_name = 'empresa') desc, table_schema, table_name
$$;

create or replace function public.backup_tabelas()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb := '[]'::jsonb; x record; n bigint;
begin
  if not privado.pode('backup.baixar') then raise exception 'Sem permissão para baixar o backup.'; end if;
  for x in select * from privado.backup_lista() loop
    execute format('select count(*) from %I.%I', x.esquema, x.tabela) into n;
    r := r || jsonb_build_object('tabela', x.esquema || '.' || x.tabela, 'linhas', n);
  end loop;
  return r;
end $$;

create or replace function public.backup_lote(p_tabela text, p_offset int default 0, p_limite int default 500)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_esq text := split_part(p_tabela, '.', 1); v_tab text := split_part(p_tabela, '.', 2); r jsonb;
begin
  if not privado.pode('backup.baixar') then raise exception 'Sem permissão para baixar o backup.'; end if;
  if not exists (select 1 from privado.backup_lista() b where b.esquema = v_esq and b.tabela = v_tab) then raise exception 'Tabela inválida.'; end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (select * from %I.%I order by 1 offset %s limit %s) t',
                 v_esq, v_tab, greatest(p_offset, 0), least(greatest(p_limite, 1), 2000)) into r;
  return r;
end $$;

create or replace function public.backup_registrar(p_tabelas int, p_linhas bigint, p_fotos boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not privado.pode('backup.baixar') then raise exception 'Sem permissão.'; end if;
  insert into public.backups_log (tabelas, linhas, com_fotos) values (p_tabelas, p_linhas, coalesce(p_fotos, false));
  update public.empresa set ultimo_backup_em = now() where id = 1;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.acesso_status()','public.liberar_acesso(int)','public.atualizar_meu_perfil(text,text)','public.pode_gerir_equipe()',
    'public.registrar_equipe(text,uuid,jsonb)','public.cliente_exportar(uuid)','public.anonimizar_cliente(uuid,text)','public.backup_tabelas()',
    'public.backup_lote(text,int,int)','public.backup_registrar(int,bigint,boolean)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  execute 'revoke execute on function privado.backup_lista() from public, anon, authenticated';
end $$;

-- funções auxiliares do CRM com search_path fixo (aviso do Supabase)
alter function privado.proximo_aniversario(date, date) set search_path = public;
alter function privado.etapa_rotulo(text) set search_path = public;
