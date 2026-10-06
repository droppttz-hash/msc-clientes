// Estoque: produtos, IMEI, entradas, movimentações, inventário, importação, fornecedores
import {
  estado, pode, $, $$, esc, soDigitos, fmtMoeda, fmtData, fmtDataHora, fmtNum, fmtTelefone, hojeSP, somarDias, abrirModal, pedirMotivo, toast, msgErro,
  rpc, consulta, buscarTudo, lista as listaCache, limparCache, baixarCsv, csvMoeda, cabecalho, vazio, carregando, tag, kpi, icone, valorDinheiro, setDinheiro,
  CONDICOES, lerMoeda, lerNumero,
} from '../core.js';

const TIPOS_MOV = {
  saldo_inicial: 'Saldo inicial', entrada_compra: 'Entrada (compra)', venda: 'Venda', cancelamento_venda: 'Venda cancelada', devolucao_cliente: 'Devolução de cliente',
  devolucao_fornecedor: 'Devolução ao fornecedor', ajuste: 'Ajuste', inventario: 'Inventário', perda: 'Perda / defeito', uso_os: 'Usado em OS', estorno_os: 'Estorno de OS',
};
const SERIE_ST = { disponivel: ['Disponível', 'ok'], reservado: ['Reservado', 'warn'], vendido: ['Vendido', 'cinza'], em_os: ['Em OS', 'warn'], devolvido_fornecedor: ['Devolvido ao fornecedor', 'cinza'], defeito: ['Defeito', 'danger'], baixado: ['Baixado', 'cinza'] };

// =====================================================================
// PRODUTOS
// =====================================================================
const est = { termo: '', categoria: '', filtro: 'ativos' };
export async function produtos(el, ctx) {
  const cats = (await listaCache('categorias')).filter((c) => c.tipo === 'venda');
  if (!ctx.ativo()) return;
  const custo = pode('estoque.ver_custo');
  el.innerHTML = `
    ${cabecalho('Produtos e estoque', { sub: 'Tudo o que a loja vende: produtos com estoque, aparelhos com IMEI e serviços.' })}
    <div id="kpis"></div>
    <div class="card">
      <div class="ferramentas">
        <input class="busca" id="f-termo" type="search" placeholder="Nome, SKU, código de barras, marca…" value="${esc(est.termo)}">
        <select id="f-cat"><option value="">Todas as categorias</option>${cats.map((c) => `<option value="${c.id}" ${est.categoria === c.id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select>
        <select id="f-filtro">${[['ativos', 'Ativos'], ['baixo', 'Estoque baixo'], ['zerado', 'Sem estoque'], ['servicos', 'Serviços'], ['inativos', 'Inativos']].map(([v, r]) => `<option value="${v}" ${est.filtro === v ? 'selected' : ''}>${r}</option>`).join('')}</select>
        <span style="flex:1"></span>
        <button class="btn btn-ghost btn-sm" id="b-exp" type="button">Exportar</button>
        ${pode('estoque.produtos') ? `<button class="btn btn-primary btn-sm" id="b-novo" type="button">${icone('mais')} Novo produto</button>` : ''}
      </div>
      <div id="tabela">${carregando()}</div>
    </div>`;
  let dados = [];
  const carregar = async () => {
    try {
      dados = await buscarTudo(() => {
        let q = estado.sb.from('produtos').select('*');
        if (est.categoria) q = q.eq('categoria_id', est.categoria);
        if (est.filtro === 'inativos') q = q.eq('ativo', false); else q = q.eq('ativo', true);
        if (est.filtro === 'baixo') q = q.eq('estoque_baixo', true);
        if (est.filtro === 'zerado') q = q.eq('controla_estoque', true).lte('estoque_atual', 0);
        if (est.filtro === 'servicos') q = q.eq('tipo', 'servico');
        const t = est.termo.trim().replace(/[,()"%]/g, ' ');
        if (t) q = q.or(`nome.ilike."%${t}%",sku.ilike."%${t}%",codigo_barras.eq."${t}",marca.ilike."%${t}%",modelo.ilike."%${t}%"`);
        return q.order('nome');
      });
    } catch (err) { $('#tabela', el).innerHTML = vazio('Erro', esc(msgErro(err))); return; }
    if (!ctx.ativo()) return;
    const comEst = dados.filter((p) => p.controla_estoque);
    const valorEst = comEst.reduce((s, p) => s + Math.max(0, Number(p.estoque_atual)) * (p.custo_medio_centavos || 0), 0);
    const valorVenda = comEst.reduce((s, p) => s + Math.max(0, Number(p.estoque_atual)) * p.preco_venda_centavos, 0);
    $('#kpis', el).innerHTML = `<div class="kpis">${kpi('Produtos na lista', dados.length)}${kpi('Unidades em estoque', fmtNum(comEst.reduce((s, p) => s + Math.max(0, Number(p.estoque_atual)), 0)))}
      ${custo ? kpi('Valor em estoque (custo)', fmtMoeda(valorEst)) : ''}${kpi('Valor em estoque (venda)', fmtMoeda(valorVenda))}
      ${kpi('Estoque baixo', dados.filter((p) => p.estoque_baixo).length, '', dados.some((p) => p.estoque_baixo) ? 'neg' : '')}</div>`;
    $('#tabela', el).innerHTML = dados.length ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Produto</th><th class="esconder-cel">Categoria</th>
      ${custo ? '<th class="num esconder-cel">Custo médio</th>' : ''}<th class="num">Preço</th><th class="num">Estoque</th></tr></thead><tbody>
      ${dados.map((p) => `<tr class="clicavel" data-id="${p.id}"><td><b>${esc(p.nome)}</b>${p.condicao !== 'novo' ? ' ' + tag(CONDICOES[p.condicao], 'cinza') : ''}${p.controla_serie ? ' ' + tag('IMEI') : ''}
          <div class="muted pequeno">${esc([p.sku, p.codigo_barras, p.marca, p.modelo].filter(Boolean).join(' · '))}</div></td>
        <td class="esconder-cel">${esc(p.categoria || '—')}</td>
        ${custo ? `<td class="num esconder-cel">${fmtMoeda(p.custo_medio_centavos)}</td>` : ''}
        <td class="num">${fmtMoeda(p.preco_venda_centavos)}</td>
        <td class="num">${p.controla_estoque ? `<span class="tag ${Number(p.estoque_atual) <= 0 ? 'danger' : p.estoque_baixo ? 'warn' : 'ok'}">${fmtNum(p.estoque_atual)} ${esc(p.unidade)}</span>` : '<span class="muted pequeno">serviço</span>'}</td></tr>`).join('')}
      </tbody></table></div><div class="rodape-tabela"><span>${dados.length} produto(s)</span></div>` : vazio('Nenhum produto', pode('estoque.produtos') ? 'Cadastre ou importe sua planilha.' : '');
    $$('tr[data-id]', el).forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/estoque/produto/${tr.dataset.id}`; }));
  };
  let t; $('#f-termo', el).addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { est.termo = e.target.value; carregar(); }, 280); });
  $('#f-cat', el).addEventListener('change', (e) => { est.categoria = e.target.value; carregar(); });
  $('#f-filtro', el).addEventListener('change', (e) => { est.filtro = e.target.value; carregar(); });
  $('#b-novo', el)?.addEventListener('click', () => novoProduto());
  $('#b-exp', el).addEventListener('click', () => baixarCsv(`produtos-${hojeSP()}.csv`,
    ['SKU', 'Código de barras', 'Nome', 'Categoria', 'Marca', 'Modelo', 'Condição', 'Preço', ...(custo ? ['Custo médio'] : []), 'Estoque', 'Mínimo', 'Tipo'],
    dados.map((p) => [p.sku, p.codigo_barras, p.nome, p.categoria, p.marca, p.modelo, CONDICOES[p.condicao], csvMoeda(p.preco_venda_centavos),
      ...(custo ? [csvMoeda(p.custo_medio_centavos)] : []), fmtNum(p.estoque_atual), fmtNum(p.estoque_minimo), p.tipo === 'servico' ? 'Serviço' : p.controla_serie ? 'Com IMEI' : 'Produto'])));
  carregar();
}

export async function novoProduto() {
  const id = await formProduto(null);
  if (id) location.hash = `#/estoque/produto/${id}`;
}

async function formProduto(p) {
  const cats = (await listaCache('categorias')).filter((c) => c.tipo === 'venda' && (c.ativo || c.id === p?.categoria_id));
  return abrirModal({
    titulo: p ? 'Editar produto' : 'Novo produto', largura: 'lg', botao: 'Salvar produto',
    corpo: `<div class="form-grade">
      <label class="col-2">Nome *<input name="nome" required value="${esc(p?.nome)}" placeholder="Ex.: iPhone 13 128GB Azul"></label>
      <label>Tipo<select name="tipo"><option value="produto">Produto</option><option value="servico" ${p?.tipo === 'servico' ? 'selected' : ''}>Serviço (sem estoque)</option></select></label>
      <label>Categoria<select name="categoria_id"><option value="">—</option>${cats.map((c) => `<option value="${c.id}" ${p?.categoria_id === c.id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></label>
      <label>Marca<input name="marca" value="${esc(p?.marca)}"></label>
      <label>Modelo<input name="modelo" value="${esc(p?.modelo)}"></label>
      <label>Condição<select name="condicao">${Object.entries(CONDICOES).map(([k, v]) => `<option value="${k}" ${p?.condicao === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Preço de venda *<input name="preco" data-mascara="dinheiro" inputmode="numeric" value="${p ? fmtMoeda(p.preco_venda_centavos) : ''}"></label>
      <label>SKU <span class="dica-campo muted">(vazio = automático)</span><input name="sku" value="${esc(p?.sku)}" style="text-transform:uppercase"></label>
      <label>Código de barras<input name="codigo_barras" value="${esc(p?.codigo_barras)}"></label>
      <label>Estoque mínimo<input name="estoque_minimo" inputmode="decimal" value="${p ? fmtNum(p.estoque_minimo) : '0'}"></label>
      <label>Garantia (dias) <span class="dica-campo muted">(vazio = padrão da loja)</span><input name="garantia_dias" inputmode="numeric" value="${esc(p?.garantia_dias)}"></label>
      <label class="check col-2" data-serie-wrap><input type="checkbox" name="controla_serie" ${p?.controla_serie ? 'checked' : ''}> Controlar por IMEI / nº de série (cada unidade cadastrada separadamente — ideal para celulares)</label>
      <details class="col-2"><summary class="muted pequeno" style="cursor:pointer">Dados fiscais (para nota fiscal no futuro)</summary>
        <div class="form-grade" style="margin-top:10px"><label>NCM<input name="ncm" inputmode="numeric" maxlength="8" value="${esc(p?.ncm)}"></label><label>CEST<input name="cest" value="${esc(p?.cest)}"></label></div></details>
      <label class="col-2">Observações<textarea name="observacoes" rows="2">${esc(p?.observacoes)}</textarea></label>
      ${p ? `<label class="check col-2"><input type="checkbox" name="ativo" ${p.ativo ? 'checked' : ''}> Produto ativo (aparece nas vendas)</label>` : ''}
    </div>`,
    aoAbrir: (f) => { const upd = () => { $('[data-serie-wrap]', f).hidden = f.tipo.value === 'servico'; }; f.tipo.addEventListener('change', upd); upd(); },
    aoSalvar: async (f) => {
      if (f.nome.value.trim().length < 2) { f.erro('Informe o nome.'); return false; }
      if (f.ncm.value && !/^\d{8}$/.test(f.ncm.value)) { f.erro('NCM tem 8 números.'); return false; }
      const id = await rpc('salvar_produto', { p: {
        id: p?.id || null, nome: f.nome.value.trim(), tipo: f.tipo.value, categoria_id: f.categoria_id.value || null, marca: f.marca.value, modelo: f.modelo.value,
        condicao: f.condicao.value, preco_venda_centavos: valorDinheiro(f.preco), sku: f.sku.value, codigo_barras: f.codigo_barras.value,
        estoque_minimo: lerNumero(f.estoque_minimo.value), garantia_dias: f.garantia_dias.value || null, controla_serie: f.controla_serie.checked,
        controla_estoque: f.tipo.value !== 'servico', ncm: f.ncm.value, cest: f.cest.value, observacoes: f.observacoes.value, ativo: p ? f.ativo.checked : true,
      } });
      toast(p ? 'Produto atualizado' : 'Produto cadastrado');
      return id;
    },
  });
}

// =====================================================================
// PRODUTO (detalhe + kardex + IMEIs)
// =====================================================================
export async function produto(el, ctx) {
  const id = ctx.params[0];
  const [p, movs, series] = await Promise.all([
    consulta(estado.sb.from('produtos').select('*').eq('id', id).maybeSingle()),
    consulta(estado.sb.from('estoque_movimentos').select('*').eq('produto_id', id).order('id', { ascending: false }).limit(200)),
    consulta(estado.sb.from('produto_series').select('*').eq('produto_id', id).order('status').order('serie')),
  ]);
  if (!ctx.ativo()) return;
  if (!p) { el.innerHTML = vazio('Produto não encontrado', '<a href="#/estoque">Voltar</a>'); return; }
  const custo = pode('estoque.ver_custo');
  const margem = custo && p.custo_medio_centavos ? ((p.preco_venda_centavos - p.custo_medio_centavos) / p.preco_venda_centavos) * 100 : null;
  el.innerHTML = `
    <a class="voltar" href="#/estoque">← Produtos</a>
    ${cabecalho(esc(p.nome), { sub: esc([p.sku, p.categoria, p.marca, p.modelo, CONDICOES[p.condicao]].filter(Boolean).join(' · ')) })}
    <div class="barra-acoes">
      ${pode('estoque.produtos') ? '<button class="btn btn-ghost" id="b-edit" type="button">Editar</button>' : ''}
      ${pode('estoque.ajustar') && p.controla_estoque && !p.controla_serie ? '<button class="btn btn-ghost" id="b-ajuste" type="button">Ajustar estoque</button>' : ''}
      ${pode('estoque.ajustar') && p.controla_serie ? '<button class="btn btn-ghost" id="b-serie" type="button">+ Incluir IMEI avulso</button>' : ''}
      ${pode('estoque.entrada') && p.controla_estoque ? `<a class="btn btn-ghost" href="#/estoque/entradas/nova" id="b-entrada">Dar entrada</a>` : ''}
    </div>
    <div class="kpis">
      ${p.controla_estoque ? kpi('Estoque', `${fmtNum(p.estoque_atual)} ${esc(p.unidade)}`, `mínimo ${fmtNum(p.estoque_minimo)}`, Number(p.estoque_atual) <= 0 ? 'neg' : '') : kpi('Tipo', 'Serviço')}
      ${kpi('Preço de venda', fmtMoeda(p.preco_venda_centavos))}
      ${custo ? kpi('Custo médio', fmtMoeda(p.custo_medio_centavos), margem !== null ? `margem ${fmtNum(margem, 1)}%` : '') : ''}
      ${kpi('Garantia', p.garantia_dias != null ? `${p.garantia_dias} dias` : `${estado.empresa?.garantia_padrao_dias ?? '—'} dias`, p.garantia_dias == null ? 'padrão da loja' : '')}
    </div>
    ${p.controla_serie ? `<div class="card"><div class="card-topo"><h3>Unidades (IMEI / nº de série)</h3><span class="muted pequeno">${series.filter((s) => s.status === 'disponivel').length} disponível(is)</span></div>
      ${series.length ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>IMEI / Série</th><th>Situação</th>${custo ? '<th class="num">Custo</th>' : ''}<th class="esconder-cel">Entrada</th><th></th></tr></thead><tbody>
      ${series.map((s) => `<tr><td><b>${esc(s.serie)}</b>${s.observacao ? `<div class="muted pequeno">${esc(s.observacao)}</div>` : ''}</td><td>${tag(SERIE_ST[s.status][0], SERIE_ST[s.status][1])}</td>
        ${custo ? `<td class="num">${fmtMoeda(s.custo_centavos)}</td>` : ''}<td class="esconder-cel">${fmtData(s.criado_em)}</td>
        <td class="num">${s.status === 'disponivel' && pode('estoque.ajustar') ? `<button class="link-btn perigo" type="button" data-baixa="${s.id}" data-serie="${esc(s.serie)}">Dar baixa</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : vazio('Nenhuma unidade', 'Dê entrada de mercadoria informando os IMEIs.')}</div>` : ''}
    ${p.controla_estoque ? `<div class="card"><div class="card-topo"><h3>Movimentações (kardex)</h3><span class="muted pequeno">últimas 200</span></div>
      ${movs.length ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Quando</th><th>Tipo</th><th class="num">Qtd</th><th class="num">Saldo</th>${custo ? '<th class="num esconder-cel">Custo un.</th><th class="num esconder-cel">Custo médio</th>' : ''}<th class="esconder-cel">Detalhe</th></tr></thead><tbody>
      ${movs.map((m) => `<tr><td>${fmtDataHora(m.criado_em)}<div class="muted pequeno">${esc(m.usuario || '')}</div></td><td>${TIPOS_MOV[m.tipo] || m.tipo}</td>
        <td class="num ${m.quantidade > 0 ? 'pos' : 'neg'}">${m.quantidade > 0 ? '+' : ''}${fmtNum(m.quantidade)}</td><td class="num">${fmtNum(m.saldo_apos)}</td>
        ${custo ? `<td class="num esconder-cel">${fmtMoeda(m.custo_unitario_centavos)}</td><td class="num esconder-cel">${fmtMoeda(m.custo_medio_apos)}</td>` : ''}
        <td class="esconder-cel pequeno">${m.venda_id ? `<a href="#/vendas/${m.venda_id}">${esc(m.motivo || 'venda')}</a>` : m.entrada_id ? `<a href="#/estoque/entradas/${m.entrada_id}">${esc(m.motivo || 'entrada')}</a>` : esc(m.motivo || '')}${m.serie ? `<div class="muted">IMEI ${esc(m.serie)}</div>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : vazio('Sem movimentações', '')}</div>` : ''}`;

  $('#b-edit', el)?.addEventListener('click', async () => { if (await formProduto(p)) produto(el, ctx); });
  $('#b-entrada', el)?.addEventListener('click', () => { estado.preProdutoEntrada = p.id; });
  $('#b-ajuste', el)?.addEventListener('click', async () => { if (await ajustar(p)) produto(el, ctx); });
  $('#b-serie', el)?.addEventListener('click', async () => {
    const ok = await abrirModal({
      titulo: 'Incluir IMEI avulso', largura: 'sm', botao: 'Incluir',
      corpo: `<p class="muted">Use para corrigir o estoque (ex.: aparelho que já estava na loja). Compras de fornecedor entram por “Entradas de mercadoria”.</p>
        <label>IMEI / nº de série *<input name="s" required></label>${pode('estoque.ver_custo') ? '<label>Custo<input name="c" data-mascara="dinheiro" inputmode="numeric"></label>' : ''}
        <label>Motivo *<input name="m" required placeholder="Ex.: aparelho já estava na loja"></label>`,
      aoSalvar: async (f) => { await rpc('adicionar_serie', { p_produto: p.id, p_serie: f.s.value, p_custo: f.c ? valorDinheiro(f.c) : 0, p_motivo: f.m.value }); toast('IMEI incluído'); return true; },
    });
    if (ok) produto(el, ctx);
  });
  $$('[data-baixa]', el).forEach((b) => b.addEventListener('click', async () => {
    const r = await abrirModal({
      titulo: `Dar baixa no IMEI ${b.dataset.serie}`, largura: 'sm', botao: 'Dar baixa', botaoClasse: 'btn-danger',
      corpo: `<label>Situação<select name="st"><option value="defeito">Com defeito (separado)</option><option value="baixado">Perda / roubo / uso interno</option></select></label><label>Motivo *<input name="m" required></label>`,
      aoSalvar: async (f) => { if (f.m.value.trim().length < 3) { f.erro('Informe o motivo.'); return false; } await rpc('baixar_serie', { p_serie: b.dataset.baixa, p_status: f.st.value, p_motivo: f.m.value }); toast('Baixa registrada'); return true; },
    });
    if (r) produto(el, ctx);
  }));
}

function ajustar(p) {
  return abrirModal({
    titulo: `Ajustar estoque — ${esc(p.nome)}`, largura: 'sm', botao: 'Registrar ajuste',
    corpo: `<p>Estoque atual: <b>${fmtNum(p.estoque_atual)} ${esc(p.unidade)}</b></p>
      <label>O que aconteceu?<select name="tipo"><option value="contagem">Contei e o certo é…</option><option value="entrada">Entrou (sem nota/compra)</option><option value="perda">Perda / quebra / defeito</option></select></label>
      <label data-rot>Quantidade contada<input name="q" inputmode="decimal" required></label>
      ${pode('estoque.ver_custo') ? '<label data-custo hidden>Custo unitário<input name="c" data-mascara="dinheiro" inputmode="numeric"></label>' : ''}
      <label>Motivo *<input name="m" required placeholder="Ex.: contagem de outubro, caiu no chão…"></label>`,
    aoAbrir: (f) => f.tipo.addEventListener('change', () => {
      $('[data-rot]', f).firstChild.textContent = { contagem: 'Quantidade contada', entrada: 'Quantidade que entrou', perda: 'Quantidade perdida' }[f.tipo.value];
      const c = $('[data-custo]', f); if (c) c.hidden = f.tipo.value !== 'entrada';
    }),
    aoSalvar: async (f) => {
      const q = lerNumero(f.q.value); if (f.m.value.trim().length < 3) { f.erro('Informe o motivo.'); return false; }
      if (f.tipo.value === 'contagem') { await rpc('registrar_inventario', { p: [{ produto_id: p.id, contado: q }], p_motivo: f.m.value }); }
      else {
        if (q <= 0) { f.erro('Informe a quantidade.'); return false; }
        await rpc('ajustar_estoque', { p_produto: p.id, p_quantidade: f.tipo.value === 'perda' ? -q : q, p_tipo: f.tipo.value === 'perda' ? 'perda' : 'ajuste', p_motivo: f.m.value, p_custo: f.c ? valorDinheiro(f.c) : null });
      }
      toast('Estoque ajustado'); return true;
    },
  });
}

// =====================================================================
// ENTRADAS DE MERCADORIA
// =====================================================================
export async function entradas(el, ctx) {
  const dados = await consulta(estado.sb.from('entradas').select('*, fornecedores(nome)').order('data', { ascending: false }).order('numero', { ascending: false }).limit(300));
  if (!ctx.ativo()) return;
  el.innerHTML = `${cabecalho('Entradas de mercadoria', { sub: 'Compras de fornecedor: o estoque sobe, o custo médio é recalculado e a conta a pagar é criada.' })}
    <div class="barra-acoes">${pode('estoque.entrada') ? `<a class="btn btn-primary" href="#/estoque/entradas/nova">${icone('mais')} Nova entrada</a>` : ''}</div>
    <div class="card">${dados.length ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Entrada</th><th>Fornecedor</th><th class="esconder-cel">Nota</th><th class="num">Total</th><th></th></tr></thead><tbody>
      ${dados.map((e) => `<tr class="clicavel ${e.status === 'cancelada' ? 'cancelado' : ''}" data-id="${e.id}"><td><b>nº ${e.numero}</b><div class="muted pequeno">${fmtData(e.data)}</div></td>
        <td>${esc(e.fornecedores?.nome || '—')}</td><td class="esconder-cel">${esc(e.nf_numero || '—')}</td><td class="num">${fmtMoeda(e.total_centavos)}</td>
        <td class="num">${e.status === 'cancelada' ? tag('Cancelada', 'danger') : ''}</td></tr>`).join('')}</tbody></table></div>` : vazio('Nenhuma entrada ainda', 'Registre aqui as compras de mercadoria.')}</div>`;
  $$('tr[data-id]', el).forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/estoque/entradas/${tr.dataset.id}`; }));
}

export async function entrada(el, ctx) {
  const id = ctx.params[0];
  const [e, itens, tits] = await Promise.all([
    consulta(estado.sb.from('entradas').select('*, fornecedores(nome,telefone)').eq('id', id).maybeSingle()),
    consulta(estado.sb.from('entrada_itens').select('*').eq('entrada_id', id)),
    pode('financeiro.ver') ? consulta(estado.sb.from('titulos').select('*').eq('entrada_id', id).order('vencimento')) : Promise.resolve([]),
  ]);
  if (!ctx.ativo()) return;
  if (!e) { el.innerHTML = vazio('Entrada não encontrada', ''); return; }
  el.innerHTML = `<a class="voltar" href="#/estoque/entradas">← Entradas</a>
    ${cabecalho(`Entrada nº ${e.numero}`, { sub: `${fmtData(e.data)} · ${esc(e.fornecedores?.nome || 'sem fornecedor')}${e.nf_numero ? ` · NF ${esc(e.nf_numero)}` : ''}`, resumo: e.status === 'cancelada' ? tag('Cancelada', 'danger') : '' })}
    ${e.status === 'cancelada' ? `<div class="alerta">${icone('alerta')}<span>Cancelada: ${esc(e.motivo_cancelamento)}</span></div>` : ''}
    <div class="barra-acoes">${e.status !== 'cancelada' && pode('estoque.entrada') ? '<button class="btn btn-ghost" id="b-cancel" type="button" style="color:var(--danger)">Cancelar entrada</button>' : ''}</div>
    <div class="card"><div class="tabela-wrap"><table class="tabela"><thead><tr><th>Produto</th><th class="num">Qtd</th><th class="num">Custo na nota</th><th class="num">Custo c/ frete</th><th class="num">Total</th></tr></thead><tbody>
      ${itens.map((i) => `<tr><td><a href="#/estoque/produto/${i.produto_id}">${esc(i.produto)}</a>${i.series?.length ? `<div class="muted pequeno">IMEI: ${i.series.map(esc).join(', ')}</div>` : ''}</td>
        <td class="num">${fmtNum(i.quantidade)}</td><td class="num">${fmtMoeda(i.custo_nota_centavos)}</td><td class="num">${fmtMoeda(i.custo_unitario_centavos)}</td><td class="num">${fmtMoeda(Math.round(i.quantidade * i.custo_nota_centavos))}</td></tr>`).join('')}
    </tbody><tfoot><tr><td colspan="4">Frete</td><td class="num">${fmtMoeda(e.frete_centavos)}</td></tr><tr><td colspan="4">Total</td><td class="num">${fmtMoeda(e.total_centavos)}</td></tr></tfoot></table></div></div>
    ${tits.length ? `<div class="card"><div class="card-topo"><h3>Pagamento ao fornecedor</h3></div><div class="tabela-wrap"><table class="tabela"><tbody>
      ${tits.map((t) => `<tr><td>${t.parcelas > 1 ? `${t.parcela}/${t.parcelas}` : 'Parcela única'}</td><td>vence ${fmtData(t.vencimento)}</td><td class="num">${fmtMoeda(t.valor_centavos)}</td><td class="num">${tag({ aberto: 'Em aberto', parcial: 'Parcial', pago: 'Pago', cancelado: 'Cancelado' }[t.status], t.status === 'pago' ? 'ok' : t.status === 'cancelado' ? 'cinza' : 'warn')}</td></tr>`).join('')}
    </tbody></table></div></div>` : ''}
    ${e.observacao ? `<div class="card card-pad"><b>Observação:</b> ${esc(e.observacao)}</div>` : ''}`;
  $('#b-cancel', el)?.addEventListener('click', async () => {
    const m = await pedirMotivo({ titulo: `Cancelar entrada nº ${e.numero}`, texto: 'Os produtos saem do estoque (devolução ao fornecedor) e a conta a pagar é cancelada.', botao: 'Cancelar entrada' });
    if (!m) return;
    try { await rpc('cancelar_entrada', { p_id: id, p_motivo: m }); toast('Entrada cancelada'); entrada(el, ctx); } catch (err) { toast(msgErro(err), 'erro'); }
  });
}

export async function novaEntrada(el, ctx) {
  if (!pode('estoque.entrada')) { el.innerHTML = vazio('Sem permissão', ''); return; }
  const [forns, contas] = await Promise.all([listaCache('fornecedores', true), listaCache('contas')]);
  if (!ctx.ativo()) return;
  const itens = [];
  if (estado.preProdutoEntrada) {
    const p = await consulta(estado.sb.from('produtos').select('*').eq('id', estado.preProdutoEntrada).maybeSingle());
    estado.preProdutoEntrada = null;
    if (p) itens.push({ produto: p, qtd: 1, custo: p.custo_medio_centavos || 0, series: '' });
  }
  el.innerHTML = `<a class="voltar" href="#/estoque/entradas">← Entradas</a>
    ${cabecalho('Nova entrada de mercadoria', { sub: 'Informe o que chegou do fornecedor. Para celulares com IMEI, digite um IMEI por linha.' })}
    <div class="card card-pad" style="margin-bottom:16px"><div class="form-grade-3">
      <label>Fornecedor<div class="linha" style="align-items:center"><select id="forn"><option value="">— sem fornecedor —</option>${forns.filter((f) => f.ativo).map((f) => `<option value="${f.id}">${esc(f.nome)}</option>`).join('')}</select>
        <button class="btn btn-ghost btn-sm" type="button" id="b-forn" style="flex:0 0 auto;margin-top:4px">+</button></div></label>
      <label>Data<input type="date" id="data" value="${hojeSP()}" max="${hojeSP()}"></label>
      <label>Nº da nota fiscal<input id="nf"></label>
    </div></div>
    <div class="card" style="margin-bottom:16px">
      <div class="ferramentas"><div class="pdv-busca" style="flex:1">${icone('busca')}<input id="busca" type="search" placeholder="Adicionar produto: nome, SKU ou código de barras…" autocomplete="off"><div class="pdv-sugestoes" id="sug" hidden></div></div>
        ${pode('estoque.produtos') ? '<button class="btn btn-ghost btn-sm" type="button" id="b-novo-prod">+ Produto novo</button>' : ''}</div>
      <div class="tabela-wrap"><table class="tabela pdv-carrinho"><thead><tr><th>Produto</th><th class="num">Qtd</th><th class="num">Custo unitário</th><th class="num">Total</th><th></th></tr></thead><tbody id="itens"></tbody></table></div>
      <div id="vazio">${vazio('Nenhum produto', 'Busque acima para adicionar.')}</div>
    </div>
    <div class="grade-2">
      <div class="card card-pad"><label>Frete / outras despesas da compra<input id="frete" data-mascara="dinheiro" inputmode="numeric" placeholder="R$ 0,00"></label>
        <p class="muted pequeno" style="margin-top:6px">O frete é dividido no custo dos produtos (pelo valor de cada um).</p>
        <label style="margin-top:10px">Observação<input id="obs"></label>
        <div class="separador"></div><div class="pdv-linha"><span class="forte">Total da entrada</span><span class="pdv-total" id="total"></span></div></div>
      <div class="card card-pad"><b>Pagamento ao fornecedor</b>
        <div style="display:grid;gap:8px;margin-top:10px">
          <label class="check"><input type="radio" name="modo" value="avista" checked> Já paguei</label>
          <label class="check"><input type="radio" name="modo" value="prazo"> Vou pagar depois (gera conta a pagar)</label>
          <label class="check"><input type="radio" name="modo" value="nenhum"> Não lançar no financeiro (consignado, brinde…)</label>
        </div>
        <div id="pg-avista" style="margin-top:10px"><label>Saiu de qual conta?<select id="conta">${contas.filter((c) => c.ativo).map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select></label></div>
        <div id="pg-prazo" hidden style="margin-top:10px"><div class="form-grade"><label>Parcelas<select id="nparc">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}x</option>`).join('')}</select></label>
          <label>1º vencimento<input type="date" id="venc1" value="${somarDias(hojeSP(), 30)}"></label></div><div id="parc-lista" class="muted pequeno" style="margin-top:6px"></div></div>
      </div>
    </div>
    <p class="erro" id="erro" hidden></p>
    <div class="barra-acoes" style="justify-content:flex-end"><button class="btn btn-primary btn-lg" id="b-salvar" type="button">Confirmar entrada</button></div>`;

  const bruto = () => itens.reduce((s, i) => s + Math.round(i.qtd * i.custo), 0);
  const totalEnt = () => bruto() + valorDinheiro($('#frete', el));
  const parcelas = () => {
    const n = Number($('#nparc', el).value); const t = totalEnt(); const base = Math.floor(t / n);
    return Array.from({ length: n }, (_, k) => {
      const d = new Date(`${$('#venc1', el).value}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + k);
      return { vencimento: d.toISOString().slice(0, 10), valor_centavos: k === n - 1 ? t - base * (n - 1) : base };
    });
  };
  const desenhar = () => {
    $('#itens', el).innerHTML = itens.map((i, k) => `<tr><td><b>${esc(i.produto.nome)}</b><div class="muted pequeno">${esc(i.produto.sku)} · estoque ${fmtNum(i.produto.estoque_atual)}</div>
        ${i.produto.controla_serie ? `<textarea data-k="${k}" data-c="series" rows="${Math.max(2, Math.min(6, i.qtd))}" placeholder="Um IMEI por linha" style="margin-top:6px;font-family:monospace;font-size:13px">${esc(i.series)}</textarea>` : ''}</td>
      <td class="num">${i.produto.controla_serie ? `<span data-qtd-serie="${k}">${i.qtd}</span>` : `<input class="qtd" data-k="${k}" data-c="qtd" inputmode="decimal" value="${fmtNum(i.qtd)}">`}</td>
      <td class="num"><input data-k="${k}" data-c="custo" data-mascara="dinheiro" inputmode="numeric" value="${fmtMoeda(i.custo)}"></td>
      <td class="num">${fmtMoeda(Math.round(i.qtd * i.custo))}</td><td><button class="link-btn perigo" type="button" data-rem="${k}">✕</button></td></tr>`).join('');
    $('#vazio', el).hidden = itens.length > 0;
    $$('[data-k]', el).forEach((inp) => inp.addEventListener(inp.dataset.c === 'series' ? 'input' : 'change', () => {
      const i = itens[Number(inp.dataset.k)];
      if (inp.dataset.c === 'qtd') i.qtd = Math.max(0, lerNumero(inp.value));
      if (inp.dataset.c === 'custo') i.custo = valorDinheiro(inp);
      if (inp.dataset.c === 'series') { i.series = inp.value; i.qtd = inp.value.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean).length; $(`[data-qtd-serie="${inp.dataset.k}"]`, el).textContent = i.qtd; resumo(); return; }
      desenhar();
    }));
    $$('[data-rem]', el).forEach((b) => b.addEventListener('click', () => { itens.splice(Number(b.dataset.rem), 1); desenhar(); }));
    resumo();
  };
  const resumo = () => {
    $('#total', el).textContent = fmtMoeda(totalEnt());
    if (!$('#pg-prazo', el).hidden) $('#parc-lista', el).innerHTML = parcelas().map((p, k) => `${k + 1}ª ${fmtData(p.vencimento)} — ${fmtMoeda(p.valor_centavos)}`).join('<br>');
  };
  $('#frete', el).addEventListener('change', resumo);
  $$('input[name=modo]', el).forEach((r) => r.addEventListener('change', () => { const m = $('input[name=modo]:checked', el).value; $('#pg-avista', el).hidden = m !== 'avista'; $('#pg-prazo', el).hidden = m !== 'prazo'; resumo(); }));
  $('#nparc', el).addEventListener('change', resumo); $('#venc1', el).addEventListener('change', resumo);
  $('#b-forn', el).addEventListener('click', async () => {
    const f = await formFornecedor(null); if (!f) return;
    limparCache('fornecedores'); const s = $('#forn', el); s.insertAdjacentHTML('beforeend', `<option value="${f.id}">${esc(f.nome)}</option>`); s.value = f.id;
  });
  $('#b-novo-prod', el)?.addEventListener('click', async () => {
    const pid = await formProduto(null); if (!pid) return;
    const p = await consulta(estado.sb.from('produtos').select('*').eq('id', pid).single());
    if (p.controla_estoque) { itens.push({ produto: p, qtd: p.controla_serie ? 0 : 1, custo: 0, series: '' }); desenhar(); }
  });
  // busca de produto
  const busca = $('#busca', el); const sug = $('#sug', el); let res = []; let t;
  busca.addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => {
    const termo = busca.value.trim().replace(/[,()"%]/g, ' ');
    if (termo.length < 2) { sug.hidden = true; return; }
    res = await consulta(estado.sb.from('produtos').select('*').eq('ativo', true).eq('controla_estoque', true)
      .or(`nome.ilike."%${termo}%",sku.ilike."%${termo}%",codigo_barras.eq."${termo}"`).order('nome').limit(12));
    sug.innerHTML = res.length ? res.map((p, i) => `<button type="button" data-i="${i}"><span><b>${esc(p.nome)}</b><small>${esc(p.sku)} · estoque ${fmtNum(p.estoque_atual)}${p.controla_serie ? ' · IMEI' : ''}</small></span></button>`).join('') : '<p class="muted pequeno" style="padding:10px">Nada encontrado.</p>';
    sug.hidden = false;
  }, 220); });
  sug.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]'); if (!b) return;
    const p = res[Number(b.dataset.i)]; sug.hidden = true; busca.value = '';
    if (!itens.some((i) => i.produto.id === p.id)) itens.push({ produto: p, qtd: p.controla_serie ? 0 : 1, custo: p.custo_medio_centavos || 0, series: '' });
    desenhar();
  });
  $('#b-salvar', el).addEventListener('click', async () => {
    const er = $('#erro', el); er.hidden = true;
    if (!itens.length) { er.textContent = 'Adicione os produtos.'; er.hidden = false; return; }
    const modo = $('input[name=modo]:checked', el).value;
    const btn = $('#b-salvar', el); btn.disabled = true;
    try {
      const id = await rpc('registrar_entrada', { p: {
        fornecedor_id: $('#forn', el).value || null, data: $('#data', el).value, nf_numero: $('#nf', el).value, observacao: $('#obs', el).value,
        frete_centavos: valorDinheiro($('#frete', el)),
        itens: itens.map((i) => ({ produto_id: i.produto.id, quantidade: i.qtd, custo_unitario_centavos: i.custo,
          series: i.produto.controla_serie ? i.series.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean) : undefined })),
        pagamento: { modo, conta_id: $('#conta', el).value, parcelas: modo === 'prazo' ? parcelas() : [] },
      } });
      toast('Entrada registrada. Estoque atualizado!');
      location.hash = `#/estoque/entradas/${id}`;
    } catch (err) { er.textContent = msgErro(err); er.hidden = false; }
    finally { btn.disabled = false; }
  });
  desenhar();
}

// =====================================================================
// MOVIMENTAÇÕES (todas)
// =====================================================================
export async function movimentos(el, ctx) {
  const hoje = hojeSP();
  const f = { de: somarDias(hoje, -30), ate: hoje, tipo: '' };
  const custo = pode('estoque.ver_custo');
  el.innerHTML = `${cabecalho('Movimentações de estoque', { sub: 'Tudo que entrou e saiu, com quem fez e por quê.' })}
    <div class="card"><div class="ferramentas"><input type="date" id="de" value="${f.de}"><input type="date" id="ate" value="${f.ate}">
      <select id="tipo"><option value="">Todos os tipos</option>${Object.entries(TIPOS_MOV).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    <div id="tab">${carregando()}</div></div>`;
  const carregar = async () => {
    f.de = $('#de', el).value; f.ate = $('#ate', el).value; f.tipo = $('#tipo', el).value;
    let q = estado.sb.from('estoque_movimentos').select('*').gte('criado_em', `${f.de}T00:00:00-03:00`).lte('criado_em', `${f.ate}T23:59:59-03:00`);
    if (f.tipo) q = q.eq('tipo', f.tipo);
    const d = await consulta(q.order('id', { ascending: false }).limit(500));
    if (!ctx.ativo()) return;
    $('#tab', el).innerHTML = d.length ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Quando</th><th>Produto</th><th>Tipo</th><th class="num">Qtd</th>${custo ? '<th class="num esconder-cel">Custo un.</th>' : ''}<th class="esconder-cel">Detalhe</th></tr></thead><tbody>
      ${d.map((m) => `<tr><td>${fmtDataHora(m.criado_em)}<div class="muted pequeno">${esc(m.usuario || '')}</div></td><td><a href="#/estoque/produto/${m.produto_id}">${esc(m.produto)}</a>${m.serie ? `<div class="muted pequeno">IMEI ${esc(m.serie)}</div>` : ''}</td>
        <td>${TIPOS_MOV[m.tipo]}</td><td class="num ${m.quantidade > 0 ? 'pos' : 'neg'}">${m.quantidade > 0 ? '+' : ''}${fmtNum(m.quantidade)}</td>
        ${custo ? `<td class="num esconder-cel">${fmtMoeda(m.custo_unitario_centavos)}</td>` : ''}<td class="esconder-cel pequeno">${esc(m.motivo || '')}</td></tr>`).join('')}
      </tbody></table></div><div class="rodape-tabela">${d.length} movimentação(ões)${d.length === 500 ? ' (mostrando as 500 mais recentes)' : ''}</div>` : vazio('Nada no período', '');
  };
  ['#de', '#ate', '#tipo'].forEach((s) => $(s, el).addEventListener('change', carregar));
  carregar();
}

// =====================================================================
// INVENTÁRIO (contagem)
// =====================================================================
export async function inventario(el, ctx) {
  if (!pode('estoque.ajustar')) { el.innerHTML = vazio('Sem permissão', ''); return; }
  const cats = (await listaCache('categorias')).filter((c) => c.tipo === 'venda');
  const dados = await buscarTudo(() => estado.sb.from('produtos').select('id,nome,sku,categoria_id,categoria,estoque_atual,unidade,controla_serie').eq('ativo', true).eq('controla_estoque', true).eq('controla_serie', false).order('nome'));
  if (!ctx.ativo()) return;
  el.innerHTML = `${cabecalho('Inventário', { sub: 'Conte o que tem na loja e digite a quantidade. Só os produtos com diferença são ajustados. (Aparelhos com IMEI: confira na tela do produto.)' })}
    <div class="card"><div class="ferramentas"><select id="cat"><option value="">Todas as categorias</option>${cats.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select>
      <input class="busca" type="search" id="b" placeholder="Filtrar…"><span style="flex:1"></span>
      <label>Motivo<input id="motivo" value="Inventário ${hojeSP().split('-').reverse().join('/')}" style="min-width:220px"></label></div>
    <div class="tabela-wrap"><table class="tabela"><thead><tr><th>Produto</th><th class="esconder-cel">Categoria</th><th class="num">No sistema</th><th class="num">Contado</th><th class="num">Diferença</th></tr></thead><tbody id="corpo">
      ${dados.map((p) => `<tr data-cat="${p.categoria_id || ''}" data-nome="${esc((p.nome + ' ' + p.sku).toLowerCase())}"><td><b>${esc(p.nome)}</b><div class="muted pequeno">${esc(p.sku)}</div></td><td class="esconder-cel">${esc(p.categoria || '')}</td>
        <td class="num">${fmtNum(p.estoque_atual)}</td><td class="num"><input data-id="${p.id}" data-atual="${p.estoque_atual}" inputmode="decimal" style="width:80px;margin:0" placeholder="—"></td><td class="num" data-dif></td></tr>`).join('')}
    </tbody></table></div>
    <div class="rodape-tabela"><span id="resumo">Nenhuma diferença ainda.</span><button class="btn btn-primary" id="salvar" type="button">Registrar inventário</button></div></div>`;
  const filtrar = () => { const c = $('#cat', el).value; const b = $('#b', el).value.toLowerCase(); $$('#corpo tr', el).forEach((tr) => { tr.hidden = (c && tr.dataset.cat !== c) || (b && !tr.dataset.nome.includes(b)); }); };
  $('#cat', el).addEventListener('change', filtrar); $('#b', el).addEventListener('input', filtrar);
  const difs = () => $$('#corpo input', el).filter((i) => i.value.trim() !== '').map((i) => ({ produto_id: i.dataset.id, contado: lerNumero(i.value), atual: Number(i.dataset.atual) })).filter((x) => x.contado !== x.atual);
  $('#corpo', el).addEventListener('input', (e) => {
    const i = e.target; if (!i.dataset.id) return;
    const td = i.closest('tr').querySelector('[data-dif]');
    const d = i.value.trim() === '' ? null : lerNumero(i.value) - Number(i.dataset.atual);
    td.innerHTML = d === null || d === 0 ? '' : `<span class="${d > 0 ? 'pos' : 'neg'}">${d > 0 ? '+' : ''}${fmtNum(d)}</span>`;
    $('#resumo', el).textContent = `${difs().length} produto(s) com diferença.`;
  });
  $('#salvar', el).addEventListener('click', async () => {
    const d = difs(); if (!d.length) { toast('Nenhuma diferença para registrar.'); return; }
    try { const n = await rpc('registrar_inventario', { p: d.map(({ produto_id, contado }) => ({ produto_id, contado })), p_motivo: $('#motivo', el).value }); toast(`${n} produto(s) ajustado(s)`); inventario(el, ctx); }
    catch (err) { toast(msgErro(err), 'erro'); }
  });
}

// =====================================================================
// IMPORTAR PLANILHA
// =====================================================================
const CAMPOS = [
  ['nome', 'Nome do produto', ['nome', 'produto', 'descricao', 'descrição', 'item']],
  ['sku', 'SKU / código interno', ['sku', 'codigo', 'código', 'cod', 'ref', 'referencia', 'referência']],
  ['codigo_barras', 'Código de barras', ['codigo de barras', 'código de barras', 'ean', 'gtin', 'barras']],
  ['categoria', 'Categoria', ['categoria', 'grupo', 'tipo']],
  ['marca', 'Marca', ['marca', 'fabricante']],
  ['modelo', 'Modelo', ['modelo']],
  ['condicao', 'Condição (novo/seminovo)', ['condicao', 'condição', 'estado']],
  ['preco', 'Preço de venda', ['preco', 'preço', 'preco venda', 'preço de venda', 'valor', 'valor venda', 'venda']],
  ['custo', 'Custo', ['custo', 'preco custo', 'preço de custo', 'valor custo', 'compra']],
  ['estoque', 'Quantidade em estoque', ['estoque', 'quantidade', 'qtd', 'qtde', 'saldo']],
  ['minimo', 'Estoque mínimo', ['minimo', 'mínimo', 'estoque minimo', 'estoque mínimo']],
  ['series', 'IMEIs (separados por vírgula)', ['imei', 'imeis', 'serie', 'série', 'numero de serie', 'nº de série']],
];
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

async function carregarXlsx() {
  if (window.XLSX) return window.XLSX;
  await new Promise((ok, falha) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = ok; s.onerror = falha; document.head.appendChild(s); });
  return window.XLSX;
}

export async function importar(el, ctx) {
  if (!pode('estoque.importar')) { el.innerHTML = vazio('Sem permissão', ''); return; }
  el.innerHTML = `${cabecalho('Importar planilha de produtos', { sub: 'Envie a planilha do mês (Excel ou CSV). Produtos novos são criados; os que já existem são atualizados e o estoque fica igual à quantidade da planilha.' })}
    <div class="card card-pad">
      <label class="zona-arquivo" id="zona"><input type="file" id="arq" accept=".xlsx,.xls,.csv" hidden><b>Clique ou arraste a planilha aqui</b><br><span class="pequeno">Excel (.xlsx) ou CSV. A primeira linha deve ter os nomes das colunas.</span></label>
      <p class="muted pequeno" style="margin-top:10px">Colunas reconhecidas: nome, SKU, código de barras, categoria, marca, modelo, condição, preço, custo, estoque, mínimo, IMEI.
        <button class="link-btn" type="button" id="modelo">Baixar planilha modelo</button></p>
    </div>
    <div id="passo2"></div>`;
  $('#modelo', el).addEventListener('click', () => baixarCsv('modelo-produtos.csv', ['Nome', 'SKU', 'Código de barras', 'Categoria', 'Marca', 'Modelo', 'Condição', 'Preço de venda', 'Custo', 'Estoque', 'Mínimo', 'IMEI'],
    [['Película 3D iPhone 13', '', '7891234567890', 'Películas', '', '', 'novo', '30,00', '5,00', '50', '10', ''],
     ['iPhone 11 64GB', '', '', 'Celulares', 'Apple', 'iPhone 11', 'seminovo', '1.500,00', '1.100,00', '', '', '351111111111111, 351111111111112']]));
  const zona = $('#zona', el);
  ['dragover', 'dragenter'].forEach((ev) => zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.add('arrastando'); }));
  ['dragleave', 'drop'].forEach((ev) => zona.addEventListener(ev, () => zona.classList.remove('arrastando')));
  zona.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) ler(e.dataTransfer.files[0]); });
  $('#arq', el).addEventListener('change', (e) => { if (e.target.files[0]) ler(e.target.files[0]); });

  async function ler(arquivo) {
    const p2 = $('#passo2', el); p2.innerHTML = carregando();
    let linhas;
    try {
      const XLSX = await carregarXlsx();
      const wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array' });
      linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
    } catch (err) { p2.innerHTML = vazio('Não deu para ler o arquivo', esc(err.message || '')); return; }
    linhas = linhas.filter((l) => l.some((c) => String(c).trim() !== ''));
    if (linhas.length < 2) { p2.innerHTML = vazio('Planilha vazia', ''); return; }
    const cab = linhas[0].map(String); const corpo = linhas.slice(1);
    const mapa = {};
    CAMPOS.forEach(([k, , sin]) => { const i = cab.findIndex((c) => sin.includes(norm(c))); mapa[k] = i; });
    p2.innerHTML = `<div class="card"><div class="card-topo"><h3>Confira as colunas</h3><span class="muted pequeno">${corpo.length} linha(s) em “${esc(arquivo.name)}”</span></div>
      <div class="card-pad"><div class="form-grade-3">${CAMPOS.map(([k, rot]) => `<label>${rot}<select data-campo="${k}"><option value="-1">— não usar —</option>${cab.map((c, i) => `<option value="${i}" ${mapa[k] === i ? 'selected' : ''}>${esc(c || `Coluna ${i + 1}`)}</option>`).join('')}</select></label>`).join('')}</div>
      <label class="check" style="margin-top:12px"><input type="checkbox" id="precos" checked> Atualizar o preço dos produtos que já existem</label></div>
      <div class="card-topo"><h3>Prévia (primeiras 8 linhas)</h3></div><div id="previa"></div>
      <div class="rodape-tabela"><span class="muted">Linhas sem nome, SKU ou código são ignoradas. Linhas com erro são listadas no final.</span><button class="btn btn-primary" id="importar" type="button">Importar ${corpo.length} linha(s)</button></div></div>
      <div id="resultado"></div>`;
    const montar = () => {
      $$('[data-campo]', p2).forEach((s) => { mapa[s.dataset.campo] = Number(s.value); });
      const g = (l, k) => (mapa[k] >= 0 ? String(l[mapa[k]] ?? '').trim() : '');
      return corpo.map((l, n) => {
        const r = { linha: n + 2, nome: g(l, 'nome'), sku: g(l, 'sku'), codigo_barras: g(l, 'codigo_barras').replace(/\s/g, ''), categoria: g(l, 'categoria'), marca: g(l, 'marca'), modelo: g(l, 'modelo') };
        const cond = norm(g(l, 'condicao')); r.condicao = cond.startsWith('semi') ? 'seminovo' : cond.startsWith('usad') ? 'usado' : cond.startsWith('recond') ? 'recondicionado' : cond ? 'novo' : '';
        if (g(l, 'preco')) r.preco_venda_centavos = lerMoeda(g(l, 'preco'));
        if (g(l, 'custo')) r.custo_centavos = lerMoeda(g(l, 'custo'));
        if (g(l, 'estoque') !== '') r.estoque = lerNumero(g(l, 'estoque'));
        if (g(l, 'minimo') !== '') r.estoque_minimo = lerNumero(g(l, 'minimo'));
        const s = g(l, 'series'); if (s) r.series = s.split(/[\s,;/]+/).map((x) => x.trim()).filter((x) => x.length >= 4);
        return r;
      }).filter((r) => r.nome || r.sku || r.codigo_barras);
    };
    const previa = () => {
      const rs = montar().slice(0, 8);
      $('#previa', p2).innerHTML = `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Linha</th><th>Nome</th><th>Categoria</th><th class="num">Preço</th><th class="num">Custo</th><th class="num">Estoque</th><th>IMEIs</th></tr></thead><tbody>
        ${rs.map((r) => `<tr><td>${r.linha}</td><td>${esc(r.nome)}${r.condicao && r.condicao !== 'novo' ? ' ' + tag(CONDICOES[r.condicao], 'cinza') : ''}</td><td>${esc(r.categoria)}</td><td class="num">${r.preco_venda_centavos != null ? fmtMoeda(r.preco_venda_centavos) : ''}</td>
          <td class="num">${r.custo_centavos != null ? fmtMoeda(r.custo_centavos) : ''}</td><td class="num">${r.estoque != null ? fmtNum(r.estoque) : ''}</td><td class="pequeno">${(r.series || []).length || ''}</td></tr>`).join('')}</tbody></table></div>`;
    };
    $$('[data-campo]', p2).forEach((s) => s.addEventListener('change', previa));
    previa();
    $('#importar', p2).addEventListener('click', async () => {
      const rs = montar(); const btn = $('#importar', p2); btn.disabled = true;
      const tot = { criados: 0, atualizados: 0, erros: [] };
      try {
        for (let i = 0; i < rs.length; i += 150) {
          btn.textContent = `Importando… ${Math.min(i + 150, rs.length)}/${rs.length}`;
          const r = await rpc('importar_produtos', { p: rs.slice(i, i + 150), p_atualizar_precos: $('#precos', p2).checked });
          tot.criados += r.criados; tot.atualizados += r.atualizados; tot.erros.push(...r.erros);
        }
      } catch (err) { toast(msgErro(err), 'erro'); }
      limparCache('categorias');
      btn.textContent = 'Importado';
      $('#resultado', p2).innerHTML = `<div class="card card-pad" style="margin-top:16px"><h3>Pronto!</h3><p><b>${tot.criados}</b> produto(s) criado(s) e <b>${tot.atualizados}</b> atualizado(s).</p>
        ${tot.erros.length ? `<div class="alerta">${icone('alerta')}<span>${tot.erros.length} linha(s) com problema:<br>${tot.erros.map((e) => `Linha ${esc(e.linha)}: ${esc(e.erro)}`).join('<br>')}</span></div>` : ''}
        <a class="btn btn-primary" href="#/estoque">Ver produtos</a></div>`;
    });
  }
}

// =====================================================================
// FORNECEDORES
// =====================================================================
export async function fornecedores(el, ctx) {
  const d = await consulta(estado.sb.from('fornecedores').select('*').order('nome'));
  if (!ctx.ativo()) return;
  const podeEditar = pode('estoque.entrada') || pode('financeiro.lancar');
  el.innerHTML = `${cabecalho('Fornecedores')}
    <div class="barra-acoes">${podeEditar ? `<button class="btn btn-primary" id="novo" type="button">${icone('mais')} Novo fornecedor</button>` : ''}</div>
    <div class="card">${d.length ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Nome</th><th>Telefone</th><th class="esconder-cel">Contato</th><th class="esconder-cel">E-mail</th><th></th></tr></thead><tbody>
      ${d.map((f) => `<tr class="${f.ativo ? '' : 'cancelado'}"><td><b>${esc(f.nome)}</b>${f.documento ? `<div class="muted pequeno">${esc(f.documento)}</div>` : ''}</td><td>${f.telefone ? `<a class="zap" target="_blank" rel="noopener" href="https://wa.me/55${f.telefone}">${fmtTelefone(f.telefone)}</a>` : '—'}</td>
        <td class="esconder-cel">${esc(f.contato || '')}</td><td class="esconder-cel">${esc(f.email || '')}</td><td class="num">${podeEditar ? `<button class="link-btn" data-ed="${f.id}" type="button">Editar</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : vazio('Nenhum fornecedor', '')}</div>`;
  $('#novo', el)?.addEventListener('click', async () => { if (await formFornecedor(null)) { limparCache('fornecedores'); fornecedores(el, ctx); } });
  $$('[data-ed]', el).forEach((b) => b.addEventListener('click', async () => { if (await formFornecedor(d.find((x) => x.id === b.dataset.ed))) { limparCache('fornecedores'); fornecedores(el, ctx); } }));
}

export function formFornecedor(f0) {
  return abrirModal({
    titulo: f0 ? 'Editar fornecedor' : 'Novo fornecedor', botao: 'Salvar',
    corpo: `<div class="form-grade"><label class="col-2">Nome *<input name="nome" required value="${esc(f0?.nome)}"></label>
      <label>CNPJ / CPF<input name="documento" value="${esc(f0?.documento)}"></label><label>Telefone<input name="telefone" data-mascara="telefone" value="${esc(fmtTelefone(f0?.telefone))}"></label>
      <label>E-mail<input name="email" type="email" value="${esc(f0?.email)}"></label><label>Pessoa de contato<input name="contato" value="${esc(f0?.contato)}"></label>
      <label class="col-2">Observações<textarea name="observacoes" rows="2">${esc(f0?.observacoes)}</textarea></label>
      ${f0 ? `<label class="check col-2"><input type="checkbox" name="ativo" ${f0.ativo ? 'checked' : ''}> Ativo</label>` : ''}</div>`,
    aoSalvar: async (f) => {
      const d = { nome: f.nome.value.trim(), documento: soDigitos(f.documento.value.toUpperCase()) ? f.documento.value.toUpperCase().replace(/[^0-9A-Z]/g, '') : null,
        telefone: soDigitos(f.telefone.value) || null, email: f.email.value.trim() || null, contato: f.contato.value.trim() || null, observacoes: f.observacoes.value.trim() || null };
      if (f0) d.ativo = f.ativo.checked;
      if (d.nome.length < 2) { f.erro('Informe o nome.'); return false; }
      const r = await consulta(f0 ? estado.sb.from('fornecedores').update(d).eq('id', f0.id).select().single() : estado.sb.from('fornecedores').insert(d).select().single());
      toast('Fornecedor salvo'); return r;
    },
  });
}
