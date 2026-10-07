// Vendas: PDV (nova venda), lista, aprovações, detalhe, recibo, devolução
import {
  estado, pode, $, $$, esc, textoAparelho, uid, fmtMoeda, fmtData, fmtDataHora, fmtTelefone, fmtNum, fmtPct, hojeSP, somarDias, addMeses, ultimoDiaMes,
  linkZap, abrirModal, pedirMotivo, toast, msgErro, rpc, consulta, buscarTudo, lista as listaCache, baixarCsv, csvMoeda, cabecalho, vazio, carregando,
  tag, kpi, icone, valorDinheiro, setDinheiro, FORMAS, CONDICOES, imprimir, diaSP, lerNumero,
} from '../core.js';
import { atualizarAvisos } from '../main.js';

const STATUS = { concluida: ['Concluída', 'ok'], cancelada: ['Cancelada', 'danger'], devolvida: ['Devolvida', 'warn'], aguardando_aprovacao: ['Aguardando aprovação', 'warn'] };
const tagStatus = (s) => tag(STATUS[s]?.[0] || s, STATUS[s]?.[1] || '');
const PARCELAVEL = ['credito', 'crediario', 'boleto'];

// =====================================================================
// PDV — NOVA VENDA
// =====================================================================
let carrinho = null;
function novoCarrinho() {
  carrinho = { chave: uid(), cliente: estado.preCliente || null, itens: [], descontoGeral: 0, pagamentos: [], observacao: '' };
  estado.preCliente = null;
}

export async function nova(el, ctx) {
  if (!pode('vendas.criar')) { el.innerHTML = vazio('Sem permissão', 'Seu usuário não pode fazer vendas.'); return; }
  if (!carrinho || estado.preCliente) novoCarrinho();
  const [formas, categorias] = await Promise.all([listaCache('formas'), listaCache('categorias')]);
  if (!ctx.ativo()) return;
  const formasAtivas = formas.filter((f) => f.ativo);
  const catsVenda = categorias.filter((c) => c.tipo === 'venda' && c.ativo);
  const limiteDesc = Number(estado.empresa?.desconto_max_pct ?? 100);

  el.innerHTML = `
    ${cabecalho('Nova venda', { sub: 'Busque pelo nome, código de barras, SKU ou IMEI. Leitor de código de barras funciona direto.' })}
    <div class="pdv">
      <div>
        <div class="card card-pad" style="margin-bottom:16px">
          <div class="pdv-busca">${icone('busca')}<input id="pdv-busca" type="search" placeholder="Buscar produto… (F2)" autocomplete="off" autofocus>
            <div class="pdv-sugestoes" id="pdv-sug" hidden></div></div>
          <div class="atalhos"><span><kbd>F2</kbd> buscar</span><span><kbd>F4</kbd> pagamento</span><span><kbd>F8</kbd> finalizar</span>
            <button class="link-btn" type="button" id="btn-avulso">+ Item avulso / serviço</button></div>
        </div>
        <div class="card">
          <div class="tabela-wrap"><table class="tabela pdv-carrinho">
            <thead><tr><th>Item</th><th class="num">Qtd</th><th class="num">Preço</th><th class="num">Total</th><th></th></tr></thead>
            <tbody id="itens"></tbody></table></div>
          <div id="itens-vazio">${vazio('Nenhum item ainda', 'Busque um produto acima para começar.')}</div>
        </div>
      </div>
      <div class="card card-pad pdv-resumo">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <div style="min-width:0"><div class="muted pequeno">Cliente</div><b id="cli-nome" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></b></div>
          <div style="display:flex;gap:6px"><button class="btn btn-ghost btn-sm" type="button" id="btn-cli">Escolher</button><button class="link-btn perigo" type="button" id="btn-cli-x" hidden>remover</button></div>
        </div>
        <div class="separador"></div>
        <div class="pdv-linha"><span>Subtotal</span><span id="r-sub"></span></div>
        <div class="pdv-linha" style="align-items:center"><span>Desconto geral</span>
          <span style="display:flex;gap:6px;align-items:center"><input id="desc-pct" inputmode="decimal" placeholder="%" style="width:64px;margin:0;padding:6px 8px"><input id="desc-geral" data-mascara="dinheiro" inputmode="numeric" placeholder="R$ 0,00" style="width:110px;margin:0;padding:6px 8px"></span></div>
        <div id="aviso-desc" class="alerta" style="margin:8px 0 0" hidden></div>
        <div class="pdv-linha" style="margin-top:8px"><span class="forte">Total</span><span class="pdv-total" id="r-total"></span></div>
        <div class="separador"></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><b>Pagamento</b><button class="link-btn" type="button" id="btn-pag">+ outra forma</button></div>
        <div id="pags"></div>
        <div class="pdv-linha"><span id="r-falta-rot">Falta</span><b id="r-falta"></b></div>
        <label style="margin-top:8px">Observação<input id="obs" placeholder="Ex.: garantia, IMEI, cor…" value="${esc(carrinho.observacao)}"></label>
        <p class="erro" id="pdv-erro" hidden style="margin-top:10px"></p>
        <button class="btn btn-primary btn-lg btn-block" type="button" id="btn-finalizar" style="margin-top:12px">Finalizar venda (F8)</button>
        <button class="btn btn-ghost btn-block" type="button" id="btn-limpar" style="margin-top:8px">Limpar</button>
      </div>
    </div>`;

  const busca = $('#pdv-busca', el); const sug = $('#pdv-sug', el);
  let resultados = []; let sel = 0; let tBusca;

  // ---- cálculo ----
  const totalItem = (i) => Math.round(i.qtd * i.preco) - (i.desconto || 0);
  const subtotal = () => carrinho.itens.reduce((s, i) => s + totalItem(i), 0);
  const total = () => Math.max(0, subtotal() - carrinho.descontoGeral);
  const tabela = () => carrinho.itens.reduce((s, i) => s + Math.round(i.qtd * i.precoTabela), 0);
  const descPct = () => { const t = tabela(); return t ? Math.max(0, (t - total()) / t * 100) : 0; };
  const pagos = () => carrinho.pagamentos.reduce((s, p) => s + (p.valor || 0), 0);

  function desenhar() {
    const corpo = $('#itens', el);
    corpo.innerHTML = carrinho.itens.map((i, k) => `<tr>
      <td><b>${esc(i.descricao)}</b><div class="muted pequeno">${i.serie ? `IMEI ${esc(i.serie)}${i.detalhes ? ' · ' + esc(textoAparelho(i.detalhes)) : ''}` : esc(i.sku || i.categoria || '')}${i.estoque !== undefined && i.controlaEstoque && !i.serie ? ` · estoque ${fmtNum(i.estoque)}` : ''}</div></td>
      <td class="num">${i.serie ? '1' : `<input class="qtd" data-k="${k}" data-campo="qtd" inputmode="decimal" value="${fmtNum(i.qtd)}">`}</td>
      <td class="num"><input data-k="${k}" data-campo="preco" data-mascara="dinheiro" inputmode="numeric" value="${fmtMoeda(i.preco)}">
        ${i.preco < i.precoTabela ? `<div class="muted pequeno">tabela ${fmtMoeda(i.precoTabela)}</div>` : ''}</td>
      <td class="num">${fmtMoeda(totalItem(i))}</td>
      <td class="num"><button class="link-btn perigo" type="button" data-rem="${k}" aria-label="Remover">✕</button></td></tr>`).join('');
    $('#itens-vazio', el).hidden = carrinho.itens.length > 0;
    $$('input[data-k]', corpo).forEach((inp) => inp.addEventListener('change', () => {
      const i = carrinho.itens[Number(inp.dataset.k)];
      if (inp.dataset.campo === 'qtd') { const q = lerNumero(inp.value); i.qtd = q > 0 ? q : 1; }
      else i.preco = valorDinheiro(inp);
      ajustarPagamentoUnico(); desenhar();
    }));
    $$('[data-rem]', corpo).forEach((b) => b.addEventListener('click', () => { carrinho.itens.splice(Number(b.dataset.rem), 1); ajustarPagamentoUnico(); desenhar(); }));
    resumo();
  }

  function resumo() {
    const temImei = carrinho.itens.some((i) => i.serieId);
    $('#cli-nome', el).innerHTML = carrinho.cliente ? esc(carrinho.cliente.nome)
      : temImei ? '<span class="neg">Obrigatório: venda com IMEI</span>' : 'Venda balcão (sem cliente)';
    $('#btn-cli-x', el).hidden = !carrinho.cliente;
    $('#r-sub', el).textContent = fmtMoeda(subtotal());
    const dg = $('#desc-geral', el); if (document.activeElement !== dg) setDinheiro(dg, carrinho.descontoGeral);
    $('#r-total', el).textContent = fmtMoeda(total());
    const pct = descPct();
    const av = $('#aviso-desc', el);
    if (pct > 0.004) {
      const precisa = pct > limiteDesc && !pode('vendas.desconto_livre');
      av.hidden = false; av.className = precisa ? 'alerta' : 'alerta info';
      av.innerHTML = `Desconto total de <b>&nbsp;${fmtPct(pct)}&nbsp;</b>${precisa ? `— acima do limite de ${fmtPct(limiteDesc)}: a venda vai para aprovação do gerente.` : ''}`;
    } else av.hidden = true;
    desenharPagamentos();
  }

  function ajustarPagamentoUnico() {
    if (carrinho.pagamentos.length === 1 && !carrinho.pagamentos[0].editado) carrinho.pagamentos[0].valor = total();
  }

  function desenharPagamentos() {
    if (!carrinho.pagamentos.length) carrinho.pagamentos.push({ forma: formasAtivas[0]?.forma || 'dinheiro', valor: total(), parcelas: 1 });
    const box = $('#pags', el);
    box.innerHTML = carrinho.pagamentos.map((p, k) => `<div class="pag-linha">
      <select data-pk="${k}" data-campo="forma">${formasAtivas.map((f) => `<option value="${f.forma}" ${f.forma === p.forma ? 'selected' : ''}>${esc(f.nome)}</option>`).join('')}</select>
      <input data-pk="${k}" data-campo="valor" data-mascara="dinheiro" inputmode="numeric" value="${fmtMoeda(p.valor)}">
      ${PARCELAVEL.includes(p.forma) ? `<select data-pk="${k}" data-campo="parcelas">${Array.from({ length: 12 }, (_, n) => `<option value="${n + 1}" ${p.parcelas === n + 1 ? 'selected' : ''}>${n + 1}x</option>`).join('')}</select>` : '<span></span>'}
      ${carrinho.pagamentos.length > 1 ? `<button class="link-btn perigo" type="button" data-prem="${k}">✕</button>` : '<span></span>'}
    </div>
    ${['crediario', 'boleto'].includes(p.forma) ? `<label class="pequeno" style="margin:-2px 0 8px">1º vencimento<input type="date" data-pk="${k}" data-campo="venc" value="${p.venc || somarDias(hojeSP(), 30)}" style="margin-top:2px;padding:6px 8px"></label>` : ''}
    ${p.forma === 'credito' && p.parcelas > 1 ? `<div class="muted pequeno" style="margin:-2px 0 8px">${p.parcelas}x de ${fmtMoeda(Math.floor(p.valor / p.parcelas))}</div>` : ''}`).join('');
    $$('[data-pk]', box).forEach((inp) => inp.addEventListener('change', () => {
      const p = carrinho.pagamentos[Number(inp.dataset.pk)];
      if (inp.dataset.campo === 'forma') { p.forma = inp.value; if (!PARCELAVEL.includes(p.forma)) p.parcelas = 1; }
      if (inp.dataset.campo === 'valor') { p.valor = valorDinheiro(inp); p.editado = true; }
      if (inp.dataset.campo === 'parcelas') p.parcelas = Number(inp.value);
      if (inp.dataset.campo === 'venc') p.venc = inp.value;
      resumo();
    }));
    $$('[data-prem]', box).forEach((b) => b.addEventListener('click', () => { carrinho.pagamentos.splice(Number(b.dataset.prem), 1); resumo(); }));
    const falta = total() - pagos();
    const dinheiro = carrinho.pagamentos.find((p) => p.forma === 'dinheiro');
    if (falta < 0 && dinheiro && -falta <= dinheiro.valor) {
      $('#r-falta-rot', el).textContent = 'Troco'; $('#r-falta', el).textContent = fmtMoeda(-falta); $('#r-falta', el).className = 'pos';
    } else {
      $('#r-falta-rot', el).textContent = falta >= 0 ? 'Falta' : 'Passou'; $('#r-falta', el).textContent = fmtMoeda(Math.abs(falta));
      $('#r-falta', el).className = falta === 0 ? 'pos' : 'neg';
    }
  }

  // ---- adicionar itens ----
  async function adicionar(r) {
    sug.hidden = true; busca.value = '';
    if (r.controla_serie && !r.serie_id) {
      const series = (await consulta(estado.sb.from('aparelhos').select('id,imei,condicao,grau,bateria_pct,cor,capacidade,preco_venda_centavos,dias_em_estoque')
        .eq('produto_id', r.produto_id).eq('status', 'disponivel').order('criado_em'))).map((x) => ({ ...x, serie: x.imei }));
      const usados = new Set(carrinho.itens.map((i) => i.serieId));
      const livres = series.filter((s) => !usados.has(s.id));
      if (!livres.length) { toast(`Nenhum IMEI disponível de ${r.nome}.`, 'erro'); return; }
      const s = await abrirModal({
        titulo: `Qual unidade de ${esc(r.nome)}?`, largura: 'sm', botao: null, cancelar: 'Cancelar',
        corpo: `<p class="muted">Escolha o IMEI / nº de série que está saindo:</p><div class="busca-resultados" style="padding:0">${livres.map((x) => `<a href="#" data-id="${x.id}" data-serie="${esc(x.serie)}"><span><b>${esc(x.serie)}</b><small>${esc(textoAparelho(x))}${x.dias_em_estoque > 0 ? ` · ${x.dias_em_estoque} dias no estoque` : ''}</small></span><b>${fmtMoeda(x.preco_venda_centavos)}</b></a>`).join('')}</div>`,
        aoAbrir: (f) => f.addEventListener('click', (e) => { const a = e.target.closest('a[data-id]'); if (a) { e.preventDefault(); f.fechar(livres.find((x) => x.id === a.dataset.id)); } }),
      });
      if (!s) return;
      r = { ...r, serie_id: s.id, serie: s.serie, preco_venda_centavos: s.preco_venda_centavos, detalhes: s };
    } else if (r.serie_id) {
      const [a] = await consulta(estado.sb.from('aparelhos').select('id,condicao,grau,bateria_pct,cor,capacidade,preco_venda_centavos').eq('id', r.serie_id));
      if (a) r = { ...r, preco_venda_centavos: a.preco_venda_centavos, detalhes: a };
    }
    if (r.serie_id && carrinho.itens.some((i) => i.serieId === r.serie_id)) { toast('Este IMEI já está na venda.', 'erro'); return; }
    const existente = !r.serie_id && carrinho.itens.find((i) => i.produtoId === r.produto_id && !i.serieId);
    if (existente) existente.qtd += 1;
    else carrinho.itens.push({
      produtoId: r.produto_id, serieId: r.serie_id || null, serie: r.serie || null, sku: r.sku, categoria: r.categoria,
      descricao: r.nome + (r.condicao && r.condicao !== 'novo' ? ` (${CONDICOES[r.condicao].toLowerCase()})` : ''),
      qtd: 1, preco: r.preco_venda_centavos, precoTabela: r.preco_venda_centavos, estoque: Number(r.estoque_atual), controlaEstoque: r.controla_estoque,
      detalhes: r.detalhes || null,
    });
    if (r.controla_estoque && !r.serie_id && Number(r.estoque_atual) <= 0) toast(`Atenção: ${r.nome} está sem estoque no sistema.`, 'erro');
    ajustarPagamentoUnico(); desenhar(); busca.focus();
  }

  async function procurar(enter = false) {
    const termo = busca.value.trim();
    if (termo.length < 2) { sug.hidden = true; return; }
    let r;
    try { r = await rpc('buscar_produto', { p_termo: termo, p_limite: 12 }); } catch (err) { toast(msgErro(err), 'erro'); return; }
    if (termo !== busca.value.trim()) return;
    resultados = r; sel = 0;
    // leitor de código de barras / IMEI exato → adiciona direto
    const exato = r.filter((x) => x.serie === termo.toUpperCase() || x.codigo_barras === termo || x.sku === termo.toUpperCase());
    if (enter && exato.length === 1) { adicionar(exato[0]); return; }
    if (enter && r.length === 1) { adicionar(r[0]); return; }
    sug.innerHTML = r.length ? r.map((x, i) => `<button type="button" data-i="${i}" class="${i === 0 ? 'sel' : ''}"><span><b>${esc(x.nome)}</b>
        <small>${x.serie ? `IMEI ${esc(x.serie)}` : esc(x.sku)}${x.condicao !== 'novo' ? ' · ' + CONDICOES[x.condicao] : ''}${x.controla_estoque ? ` · estoque ${fmtNum(x.estoque_atual)}` : ' · serviço'}</small></span>
        <b>${fmtMoeda(x.preco_venda_centavos)}</b></button>`).join('')
      : `<p class="muted pequeno" style="padding:10px">Nada encontrado. ${pode('estoque.produtos') ? 'Cadastre o produto em Estoque ou ' : ''}use “Item avulso”.</p>`;
    sug.hidden = false;
    if (enter && r.length) adicionar(r[0]);
  }
  busca.addEventListener('input', () => { clearTimeout(tBusca); tBusca = setTimeout(() => procurar(false), 200); });
  busca.addEventListener('keydown', (e) => {
    const bts = $$('button[data-i]', sug);
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(tBusca); if (!sug.hidden && bts.length) adicionar(resultados[sel]); else procurar(true); }
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && bts.length) {
      e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + bts.length) % bts.length;
      bts.forEach((b, i) => b.classList.toggle('sel', i === sel)); bts[sel].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Escape') sug.hidden = true;
  });
  sug.addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) adicionar(resultados[Number(b.dataset.i)]); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.pdv-busca')) sug.hidden = true; }, { signal: ctxSinal(ctx) });

  $('#btn-avulso', el).addEventListener('click', async () => {
    const r = await abrirModal({
      titulo: 'Item avulso / serviço', largura: 'sm', botao: 'Adicionar',
      corpo: `<label>Descrição *<input name="d" required placeholder="Ex.: Troca de tela iPhone 11"></label>
        <label>Categoria *<select name="c" required><option value="">Escolha…</option>${catsVenda.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select></label>
        <div class="form-grade"><label>Valor *<input name="v" data-mascara="dinheiro" inputmode="numeric" required></label><label>Quantidade<input name="q" inputmode="decimal" value="1"></label></div>
        <label>Garantia (dias)<input name="g" inputmode="numeric" placeholder="${estado.empresa?.garantia_padrao_dias ?? ''}"></label>`,
      aoSalvar: (f) => {
        if (f.d.value.trim().length < 2) { f.erro('Descreva o item.'); return false; }
        if (!f.c.value) { f.erro('Escolha a categoria.'); return false; }
        if (valorDinheiro(f.v) <= 0) { f.erro('Informe o valor.'); return false; }
        return { descricao: f.d.value.trim(), categoriaId: f.c.value, categoria: f.c.selectedOptions[0].textContent, preco: valorDinheiro(f.v), precoTabela: valorDinheiro(f.v), qtd: lerNumero(f.q.value) || 1, garantia: f.g.value ? Number(f.g.value) : null };
      },
    });
    if (r) { carrinho.itens.push(r); ajustarPagamentoUnico(); desenhar(); }
  });

  // ---- cliente ----
  // aparelho escolhido na ficha (botão "Vender este aparelho")
  if (estado.preAparelho) {
    const idAp = estado.preAparelho; estado.preAparelho = null;
    consulta(estado.sb.from('aparelhos').select('id,produto_id,imei,status').eq('id', idAp)).then(async ([a]) => {
      if (!a || a.status !== 'disponivel') { toast('Este aparelho não está disponível.', 'erro'); return; }
      const [r] = (await rpc('buscar_produto', { p_termo: a.imei, p_limite: 5 })).filter((x) => x.serie_id === a.id);
      if (r) adicionar(r);
    }).catch((err) => toast(msgErro(err), 'erro'));
  }

  $('#btn-cli', el).addEventListener('click', async () => {
    const { escolherCliente } = await import('./clientes.js');
    const c = await escolherCliente(); if (c) { carrinho.cliente = c; resumo(); }
  });
  $('#btn-cli-x', el).addEventListener('click', () => { carrinho.cliente = null; resumo(); });

  // ---- desconto ----
  $('#desc-geral', el).addEventListener('change', (e) => { carrinho.descontoGeral = Math.min(subtotal(), valorDinheiro(e.target)); $('#desc-pct', el).value = ''; ajustarPagamentoUnico(); resumo(); });
  $('#desc-pct', el).addEventListener('change', (e) => { const p = Math.min(100, lerNumero(e.target.value)); carrinho.descontoGeral = Math.round(subtotal() * p / 100); ajustarPagamentoUnico(); resumo(); });
  $('#btn-pag', el).addEventListener('click', () => { const falta = Math.max(0, total() - pagos()); carrinho.pagamentos.push({ forma: 'pix', valor: falta, parcelas: 1, editado: true }); resumo(); });
  $('#obs', el).addEventListener('input', (e) => { carrinho.observacao = e.target.value; });
  $('#btn-limpar', el).addEventListener('click', () => { novoCarrinho(); nova(el, ctx); });

  // ---- finalizar ----
  async function finalizar() {
    const erroEl = $('#pdv-erro', el); erroEl.hidden = true;
    if (!carrinho.itens.length) { erroEl.textContent = 'Adicione pelo menos um item.'; erroEl.hidden = false; return; }
    if (!carrinho.cliente && carrinho.itens.some((i) => i.serieId)) {
      erroEl.textContent = 'Venda de aparelho (com IMEI) precisa de cliente: clique em “Escolher” no campo Cliente.'; erroEl.hidden = false; return;
    }
    let pags = carrinho.pagamentos.filter((p) => p.valor > 0).map((p) => ({ ...p }));
    let falta = total() - pags.reduce((s, p) => s + p.valor, 0);
    const din = pags.find((p) => p.forma === 'dinheiro');
    if (falta < 0 && din && -falta <= din.valor) { din.valor += falta; falta = 0; pags = pags.filter((p) => p.valor > 0); }
    if (falta !== 0) { erroEl.textContent = falta > 0 ? `Faltam ${fmtMoeda(falta)} no pagamento.` : `Os pagamentos passaram ${fmtMoeda(-falta)} do total.`; erroEl.hidden = false; return; }
    const btn = $('#btn-finalizar', el); btn.disabled = true;
    try {
      const r = await rpc('finalizar_venda', { p: {
        chave: carrinho.chave, cliente_id: carrinho.cliente?.id || null, observacao: carrinho.observacao, desconto_centavos: carrinho.descontoGeral,
        itens: carrinho.itens.map((i) => ({ produto_id: i.produtoId || null, serie_id: i.serieId || null, descricao: i.descricao, categoria_id: i.categoriaId || null,
          quantidade: i.qtd, preco_unitario_centavos: i.preco, garantia_dias: i.garantia ?? null })),
        pagamentos: pags.map((p) => ({ forma: p.forma, valor_centavos: p.valor, parcelas: p.parcelas || 1, primeiro_vencimento: ['crediario', 'boleto'].includes(p.forma) ? (p.venc || somarDias(hojeSP(), 30)) : null })),
      } });
      const troco = -(total() - carrinho.pagamentos.reduce((s, p) => s + p.valor, 0));
      novoCarrinho();
      atualizarAvisos();
      await posVenda(r, troco > 0 ? troco : 0);
      if (ctx.ativo()) nova(el, ctx);
    } catch (err) { erroEl.textContent = msgErro(err); erroEl.hidden = false; }
    finally { btn.disabled = false; }
  }
  $('#btn-finalizar', el).addEventListener('click', finalizar);
  document.addEventListener('keydown', (e) => {
    if (!ctx.ativo() || document.querySelector('dialog[open]')) return;
    if (e.key === 'F2') { e.preventDefault(); busca.focus(); }
    if (e.key === 'F4') { e.preventDefault(); $('#pags select', el)?.focus(); }
    if (e.key === 'F8') { e.preventDefault(); finalizar(); }
  }, { signal: ctxSinal(ctx) });

  desenhar();
}

// AbortSignal que dispara quando o usuário sai da tela (para soltar listeners globais)
function ctxSinal(ctx) {
  const ac = new AbortController();
  const ver = () => { if (!ctx.ativo()) ac.abort(); else setTimeout(ver, 1000); };
  setTimeout(ver, 1000);
  return ac.signal;
}

async function posVenda(r, troco) {
  if (r.status === 'aguardando_aprovacao') {
    await abrirModal({ titulo: `Venda nº ${r.numero} aguardando aprovação`, largura: 'sm', botao: 'OK', cancelar: null,
      corpo: `<p>O desconto de <b>${fmtPct(r.desconto_pct)}</b> passou do limite. O gerente precisa aprovar em <b>Vendas › Aprovações</b>.</p><p class="muted">O IMEI (se houver) fica reservado até a aprovação.</p>` });
    return;
  }
  const v = await carregarVenda(r.id);
  const acao = await abrirModal({
    titulo: `Venda nº ${r.numero} concluída ✓`, largura: 'sm', botao: 'Nova venda', cancelar: null,
    corpo: `<div style="text-align:center"><div class="pdv-total">${fmtMoeda(r.total_centavos)}</div>
      ${troco ? `<p style="font-size:18px;margin:8px 0">Troco: <b class="pos">${fmtMoeda(troco)}</b></p>` : ''}</div>
      <div style="display:grid;gap:8px">
        <button class="btn btn-ghost" type="button" data-acao="recibo">${icone('impressora')} Imprimir recibo</button>
        ${v.venda.cliente_telefone ? `<a class="btn btn-ghost" target="_blank" rel="noopener" href="${linkZap(v.venda.cliente_telefone, textoWhats(v))}">${icone('zap')} Enviar recibo no WhatsApp</a>` : ''}
        <a class="btn btn-ghost" href="#/vendas/${r.id}" data-fechar>Ver a venda</a>
      </div>`,
    aoAbrir: (f) => { $('[data-acao=recibo]', f).addEventListener('click', () => imprimirRecibo(v)); $('a[href^="#/vendas/"]', f).addEventListener('click', () => f.fechar('ver')); },
  });
  return acao;
}

// =====================================================================
// DADOS DE UMA VENDA
// =====================================================================
async function carregarVenda(id) {
  const [venda, itens, pags, devs] = await Promise.all([
    consulta(estado.sb.from('vendas_lista').select('*').eq('id', id).maybeSingle()),
    consulta(estado.sb.from('venda_itens').select('*').eq('venda_id', id).order('ordem')),
    consulta(estado.sb.from('venda_pagamentos').select('*').eq('venda_id', id)),
    consulta(estado.sb.from('devolucoes').select('*').eq('venda_id', id).order('criado_em')),
  ]);
  return { venda, itens, pags, devs };
}

function textoWhats({ venda, itens, pags }) {
  const loja = estado.empresa?.nome_fantasia || '';
  return [`*${loja}* — Recibo da venda nº ${venda.numero} (${fmtData(venda.data)})`, '',
    ...itens.map((i) => `• ${fmtNum(i.quantidade)}x ${i.descricao}${i.serie ? ` (IMEI ${i.serie}${i.detalhes ? ' · ' + textoAparelho(i.detalhes) : ''})` : ''} — ${fmtMoeda(i.total_centavos)}${i.garantia_dias ? ` · garantia até ${fmtData(somarDias(venda.data, i.garantia_dias))}` : ''}`),
    venda.desconto_centavos ? `Desconto: ${fmtMoeda(venda.desconto_centavos)}` : null,
    `*Total: ${fmtMoeda(venda.total_centavos)}*`,
    `Pagamento: ${pags.map((p) => `${FORMAS[p.forma]}${p.parcelas > 1 ? ` ${p.parcelas}x` : ''} ${fmtMoeda(p.valor_centavos)}`).join(' + ')}`,
    '', 'Obrigado pela preferência!'].filter((x) => x !== null).join('\n');
}

export function imprimirRecibo({ venda, itens, pags }) {
  const e = estado.empresa || {};
  const garantias = itens.filter((i) => i.garantia_dias);
  imprimir(`Recibo venda ${venda.numero}`, `
    <h2>Recibo de venda nº ${venda.numero}</h2>
    <p>Data: <b>${fmtData(venda.data)}</b> · Atendente: ${esc(venda.vendedor_nome || '')}<br>Cliente: <b>${esc(venda.cliente_nome || 'Consumidor')}</b>${venda.cliente_telefone ? ` · ${fmtTelefone(venda.cliente_telefone)}` : ''}</p>
    <table><thead><tr><th>Item</th><th class="num">Qtd</th><th class="num">Unit.</th><th class="num">Total</th></tr></thead><tbody>
      ${itens.map((i) => `<tr><td>${esc(i.descricao)}${i.serie ? `<br><small>IMEI/Série: ${esc(i.serie)}${i.detalhes ? '<br>' + esc(textoAparelho(i.detalhes)) : ''}</small>` : ''}${i.devolvido_qtd > 0 ? '<br><small>(devolvido)</small>' : ''}</td><td class="num">${fmtNum(i.quantidade)}</td><td class="num">${fmtMoeda(i.preco_unitario_centavos)}</td><td class="num">${fmtMoeda(i.total_centavos)}</td></tr>`).join('')}
    </tbody></table>
    <table><tbody>
      <tr><td>Subtotal</td><td class="num">${fmtMoeda(venda.subtotal_centavos)}</td></tr>
      ${venda.desconto_centavos ? `<tr><td>Desconto</td><td class="num">− ${fmtMoeda(venda.desconto_centavos)}</td></tr>` : ''}
      <tr><td class="total">Total</td><td class="num total">${fmtMoeda(venda.total_centavos)}</td></tr>
      ${pags.map((p) => `<tr><td>${FORMAS[p.forma]}${p.parcelas > 1 ? ` em ${p.parcelas}x` : ''}</td><td class="num">${fmtMoeda(p.valor_centavos)}</td></tr>`).join('')}
    </tbody></table>
    ${garantias.length ? `<h2>Garantia</h2><div class="caixa">${garantias.map((i) => `${esc(i.descricao)}${i.serie ? ` (${esc(i.serie)})` : ''}: <b>${i.garantia_dias} dias</b>, até ${fmtData(somarDias(venda.data, i.garantia_dias))}`).join('<br>')}
      ${e.texto_garantia ? `<p class="muted" style="margin:8px 0 0">${esc(e.texto_garantia)}</p>` : ''}</div>` : ''}
    ${venda.observacao ? `<p>Obs.: ${esc(venda.observacao)}</p>` : ''}
    ${e.texto_recibo ? `<p class="muted">${esc(e.texto_recibo)}</p>` : ''}
    <div class="assin"><div>${esc(e.nome_fantasia || '')}</div><div>Cliente</div></div>`);
}

// =====================================================================
// LISTA DE VENDAS
// =====================================================================
const estLista = { de: null, ate: null, status: '', vendedor: '', termo: '' };
export async function lista(el, ctx) {
  const hoje = hojeSP();
  if (!estLista.de) { estLista.de = hoje.slice(0, 8) + '01'; estLista.ate = hoje; }
  const todas = pode('vendas.ver_todas'); const lucro = pode('vendas.ver_lucro');
  const perfis = todas ? await lista_perfis() : [];
  if (!ctx.ativo()) return;
  el.innerHTML = `
    ${cabecalho(todas ? 'Vendas' : 'Minhas vendas', { sub: todas ? 'Todas as vendas da loja no período.' : 'Vendas que você lançou.' })}
    <div class="barra-acoes">
      ${pode('vendas.criar') ? `<a class="btn btn-primary" href="#/vendas/nova">${icone('mais')} Nova venda</a>` : ''}
      <button class="btn btn-ghost btn-sm" data-per="hoje" type="button">Hoje</button>
      <button class="btn btn-ghost btn-sm" data-per="mes" type="button">Este mês</button>
      <button class="btn btn-ghost btn-sm" data-per="passado" type="button">Mês passado</button>
    </div>
    <div id="kpis"></div>
    <div class="card">
      <div class="ferramentas">
        <input class="busca" id="f-termo" type="search" placeholder="Nº da venda ou cliente…" value="${esc(estLista.termo)}">
        <input type="date" id="f-de" value="${estLista.de}"> <input type="date" id="f-ate" value="${estLista.ate}">
        <select id="f-status"><option value="">Todas as situações</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${estLista.status === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select>
        ${todas ? `<select id="f-vend"><option value="">Todos os vendedores</option>${perfis.map((p) => `<option value="${p.user_id}" ${estLista.vendedor === p.user_id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select>` : ''}
        <span style="flex:1"></span><button class="btn btn-ghost btn-sm" type="button" id="btn-exp">Exportar</button>
      </div>
      <div id="tabela">${carregando()}</div>
    </div>`;
  let dados = [];
  const carregar = async () => {
    $('#tabela', el).innerHTML = carregando();
    try {
      dados = await buscarTudo(() => {
        let q = estado.sb.from('vendas_lista').select('*').gte('data', estLista.de).lte('data', estLista.ate);
        if (!todas) q = q.eq('criado_por', estado.perfil.user_id);
        if (estLista.status) q = q.eq('status', estLista.status);
        if (estLista.vendedor) q = q.eq('criado_por', estLista.vendedor);
        const t = estLista.termo.trim();
        if (/^\d+$/.test(t)) q = q.eq('numero', Number(t)); else if (t) q = q.ilike('cliente_nome', `%${t.replace(/[%,()]/g, '')}%`);
        return q.order('data', { ascending: false }).order('numero', { ascending: false });
      });
    } catch (err) { $('#tabela', el).innerHTML = vazio('Erro', esc(msgErro(err))); return; }
    if (!ctx.ativo()) return;
    const ok = dados.filter((v) => ['concluida', 'devolvida'].includes(v.status));
    const tot = ok.reduce((s, v) => s + v.total_centavos - v.devolvido_centavos, 0);
    const cus = ok.reduce((s, v) => s + (v.custo_centavos || 0), 0);
    $('#kpis', el).innerHTML = `<div class="kpis">${kpi('Total vendido', fmtMoeda(tot))}${kpi('Vendas', ok.length)}${kpi('Ticket médio', fmtMoeda(ok.length ? Math.round(tot / ok.length) : 0))}
      ${lucro ? kpi('Lucro bruto', fmtMoeda(tot - cus), tot ? `margem ${fmtPct((tot - cus) / tot * 100)} (antes das taxas)` : '') : ''}</div>`;
    $('#tabela', el).innerHTML = dados.length ? `<div class="tabela-wrap"><table class="tabela"><thead><tr>
        <th>Venda</th><th>Cliente</th><th class="esconder-cel">Itens</th>${todas ? '<th class="esconder-cel">Vendedor</th>' : ''}<th class="esconder-cel">Pagamento</th>
        <th class="num">Total</th>${lucro ? '<th class="num esconder-cel">Lucro</th>' : ''}<th></th></tr></thead><tbody>
      ${dados.map((v) => `<tr class="clicavel ${v.status === 'cancelada' ? 'cancelado' : ''}" data-id="${v.id}">
        <td><b>nº ${v.numero}</b><div class="muted pequeno">${fmtData(v.data)}</div></td>
        <td>${esc(v.cliente_nome || 'Venda balcão')}</td>
        <td class="esconder-cel"><span class="riscado pequeno">${esc((v.itens_resumo || '').slice(0, 70))}${(v.itens_resumo || '').length > 70 ? '…' : ''}</span></td>
        ${todas ? `<td class="esconder-cel">${esc(v.vendedor_nome || '')}</td>` : ''}
        <td class="esconder-cel pequeno muted">${esc(v.pagamentos_resumo || '')}</td>
        <td class="num"><b>${fmtMoeda(v.total_centavos)}</b>${v.devolvido_centavos ? `<div class="pequeno neg">− ${fmtMoeda(v.devolvido_centavos)}</div>` : ''}</td>
        ${lucro ? `<td class="num esconder-cel">${v.status === 'cancelada' ? '' : fmtMoeda(v.total_centavos - v.devolvido_centavos - (v.custo_centavos || 0))}</td>` : ''}
        <td class="num">${v.status !== 'concluida' ? tagStatus(v.status) : ''}</td></tr>`).join('')}
      </tbody></table></div><div class="rodape-tabela"><span>${dados.length} venda(s) no valor total de ${fmtMoeda(dados.filter((v) => v.status !== 'cancelada').reduce((s, v) => s + v.total_centavos, 0))}</span></div>`
      : vazio('Nenhuma venda no período', '');
    $$('tr[data-id]', el).forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/vendas/${tr.dataset.id}`; }));
  };
  const aplicar = () => { estLista.de = $('#f-de', el).value; estLista.ate = $('#f-ate', el).value; estLista.status = $('#f-status', el).value; estLista.vendedor = $('#f-vend', el)?.value || ''; carregar(); };
  ['#f-de', '#f-ate', '#f-status', '#f-vend'].forEach((s) => $(s, el)?.addEventListener('change', aplicar));
  let t; $('#f-termo', el).addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { estLista.termo = e.target.value; carregar(); }, 300); });
  $$('[data-per]', el).forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.per === 'hoje') { estLista.de = hoje; estLista.ate = hoje; }
    if (b.dataset.per === 'mes') { estLista.de = hoje.slice(0, 8) + '01'; estLista.ate = hoje; }
    if (b.dataset.per === 'passado') { const i = addMeses(hoje, -1); estLista.de = i; estLista.ate = ultimoDiaMes(i); }
    $('#f-de', el).value = estLista.de; $('#f-ate', el).value = estLista.ate; carregar();
  }));
  $('#btn-exp', el).addEventListener('click', () => baixarCsv(`vendas-${estLista.de}-a-${estLista.ate}.csv`,
    ['Nº', 'Data', 'Cliente', 'Vendedor', 'Itens', 'Pagamento', 'Subtotal', 'Desconto', 'Total', 'Devolvido', ...(lucro ? ['Custo', 'Lucro'] : []), 'Situação'],
    dados.map((v) => [v.numero, fmtData(v.data), v.cliente_nome || 'Venda balcão', v.vendedor_nome, v.itens_resumo, v.pagamentos_resumo, csvMoeda(v.subtotal_centavos),
      csvMoeda(v.desconto_centavos), csvMoeda(v.total_centavos), csvMoeda(v.devolvido_centavos),
      ...(lucro ? [csvMoeda(v.custo_centavos), csvMoeda(v.total_centavos - v.devolvido_centavos - (v.custo_centavos || 0))] : []), STATUS[v.status]?.[0]])));
  carregar();
}
const lista_perfis = () => listaCache('perfis');

// =====================================================================
// APROVAÇÕES
// =====================================================================
export async function aprovacoes(el, ctx) {
  if (!pode('vendas.aprovar')) { el.innerHTML = vazio('Sem permissão', ''); return; }
  const dados = await consulta(estado.sb.from('vendas_lista').select('*').eq('status', 'aguardando_aprovacao').order('criado_em'));
  if (!ctx.ativo()) return;
  el.innerHTML = `${cabecalho('Aprovações', { sub: `Vendas com desconto acima do limite (${fmtPct(estado.empresa?.desconto_max_pct)}).` })}
    <div class="card">${dados.length ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Venda</th><th>Vendedor</th><th>Itens</th><th class="num">Tabela</th><th class="num">Total</th><th class="num">Desconto</th><th></th></tr></thead><tbody>
      ${dados.map((v) => `<tr><td><a href="#/vendas/${v.id}"><b>nº ${v.numero}</b></a><div class="muted pequeno">${fmtDataHora(v.criado_em)}</div></td><td>${esc(v.vendedor_nome || '')}</td>
        <td class="pequeno">${esc(v.itens_resumo || '')}</td><td class="num">${fmtMoeda(v.valor_tabela_centavos)}</td><td class="num"><b>${fmtMoeda(v.total_centavos)}</b></td>
        <td class="num">${tag(fmtPct(v.desconto_pct), 'warn')}</td>
        <td><div class="acoes"><button class="btn btn-ok btn-sm" data-ap="${v.id}" type="button">Aprovar</button><button class="btn btn-ghost btn-sm" data-rep="${v.id}" type="button">Reprovar</button></div></td></tr>`).join('')}
      </tbody></table></div>` : vazio('Nada para aprovar', 'Quando um vendedor der desconto acima do limite, a venda aparece aqui.')}</div>`;
  $$('[data-ap]', el).forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await rpc('aprovar_venda', { p_venda: b.dataset.ap, p_aprovar: true }); toast('Venda aprovada e concluída'); atualizarAvisos(); aprovacoes(el, ctx); }
    catch (err) { toast(msgErro(err), 'erro'); b.disabled = false; }
  }));
  $$('[data-rep]', el).forEach((b) => b.addEventListener('click', async () => {
    const m = await pedirMotivo({ titulo: 'Reprovar venda', botao: 'Reprovar' }); if (!m) return;
    try { await rpc('aprovar_venda', { p_venda: b.dataset.rep, p_aprovar: false, p_motivo: m }); toast('Venda reprovada'); atualizarAvisos(); aprovacoes(el, ctx); }
    catch (err) { toast(msgErro(err), 'erro'); }
  }));
}

// =====================================================================
// DETALHE
// =====================================================================
export async function detalhe(el, ctx) {
  const id = ctx.params[0];
  const d = await carregarVenda(id);
  const titulos = pode('financeiro.ver') ? await consulta(estado.sb.from('titulos').select('*').eq('venda_id', id).order('vencimento')) : null;
  if (!ctx.ativo()) return;
  const { venda: v, itens, pags, devs } = d;
  if (!v) { el.innerHTML = vazio('Venda não encontrada', '<a href="#/vendas">Voltar</a>'); return; }
  const lucro = pode('vendas.ver_lucro');
  const podeCancelar = ['concluida', 'aguardando_aprovacao'].includes(v.status) && !devs.length && (pode('vendas.cancelar_todas')
    || (pode('vendas.cancelar_proprias') && v.criado_por === estado.perfil.user_id && diaSP(v.criado_em) === hojeSP()));
  const STT = { aberto: ['Em aberto', 'warn'], parcial: ['Parcial', 'warn'], pago: ['Recebido', 'ok'], cancelado: ['Cancelado', 'cinza'] };

  el.innerHTML = `
    <a class="voltar" href="#/vendas">← Vendas</a>
    ${cabecalho(`Venda nº ${v.numero}`, { sub: `${fmtData(v.data)} · ${esc(v.vendedor_nome || '')} · ${fmtDataHora(v.criado_em)}`, resumo: `${tagStatus(v.status)}` })}
    ${v.status === 'cancelada' ? `<div class="alerta">${icone('alerta')}<span>Cancelada em ${fmtDataHora(v.cancelada_em)}: ${esc(v.motivo_cancelamento)}</span></div>` : ''}
    ${v.status === 'aguardando_aprovacao' ? `<div class="alerta">${icone('alerta')}<span>Desconto de ${fmtPct(v.desconto_pct)} aguardando aprovação do gerente.</span></div>` : ''}
    <div class="barra-acoes">
      ${v.status !== 'cancelada' ? `<button class="btn btn-ghost" id="b-recibo" type="button">${icone('impressora')} Recibo</button>` : ''}
      ${v.cliente_telefone && v.status !== 'cancelada' ? `<a class="btn btn-ghost" target="_blank" rel="noopener" href="${linkZap(v.cliente_telefone, textoWhats(d))}">${icone('zap')} WhatsApp</a>` : ''}
      ${!v.cliente_id && v.status !== 'cancelada' && (pode('vendas.ver_todas') || v.criado_por === estado.perfil.user_id) ? '<button class="btn btn-ghost" id="b-cli" type="button">Vincular cliente</button>' : ''}
      ${v.status === 'aguardando_aprovacao' && pode('vendas.aprovar') ? '<button class="btn btn-ok" id="b-aprovar" type="button">Aprovar desconto</button>' : ''}
      ${v.status === 'concluida' && pode('vendas.devolver') ? '<button class="btn btn-ghost" id="b-dev" type="button">Devolução / troca</button>' : ''}
      ${podeCancelar ? '<button class="btn btn-ghost" id="b-cancelar" type="button" style="color:var(--danger)">Cancelar venda</button>' : ''}
    </div>
    <div class="lado-a-lado">
      <div class="card card-pad">
        <dl class="dl">
          <div><dt>Cliente</dt><dd>${v.cliente_id ? `<a href="#/clientes/${v.cliente_id}">${esc(v.cliente_nome)}</a>${v.cliente_telefone ? `<br><span class="muted">${fmtTelefone(v.cliente_telefone)}</span>` : ''}` : 'Venda balcão'}</dd></div>
          <div><dt>Subtotal</dt><dd>${fmtMoeda(v.subtotal_centavos)}</dd></div>
          ${v.desconto_centavos ? `<div><dt>Desconto geral</dt><dd>− ${fmtMoeda(v.desconto_centavos)}</dd></div>` : ''}
          ${v.desconto_pct > 0 ? `<div><dt>Desconto sobre a tabela</dt><dd>${fmtPct(v.desconto_pct)} (tabela ${fmtMoeda(v.valor_tabela_centavos)})</dd></div>` : ''}
          <div><dt>Total</dt><dd style="font-size:22px;font-weight:700">${fmtMoeda(v.total_centavos)}</dd></div>
          ${v.devolvido_centavos ? `<div><dt>Devolvido</dt><dd class="neg">− ${fmtMoeda(v.devolvido_centavos)}</dd></div>` : ''}
          ${lucro && v.custo_centavos !== null && v.status !== 'cancelada' ? `<div><dt>Custo / lucro bruto</dt><dd>${fmtMoeda(v.custo_centavos)} / <b>${fmtMoeda(v.total_centavos - v.devolvido_centavos - v.custo_centavos)}</b></dd></div>` : ''}
          <div><dt>Pagamento</dt><dd>${pags.map((p) => `${FORMAS[p.forma]}${p.parcelas > 1 ? ` ${p.parcelas}x` : ''}: ${fmtMoeda(p.valor_centavos)}${p.taxa_centavos ? ` <span class="muted pequeno">(taxa ${fmtMoeda(p.taxa_centavos)})</span>` : ''}`).join('<br>')}</dd></div>
          ${v.observacao ? `<div><dt>Observação</dt><dd>${esc(v.observacao)}</dd></div>` : ''}
        </dl>
      </div>
      <div>
        <div class="card"><div class="card-topo"><h3>Itens</h3></div><div class="tabela-wrap"><table class="tabela"><thead><tr><th>Item</th><th class="num">Qtd</th><th class="num">Unit.</th><th class="num">Total</th>${lucro ? '<th class="num esconder-cel">Custo un.</th>' : ''}</tr></thead><tbody>
          ${itens.map((i) => `<tr><td><b>${esc(i.descricao)}</b><div class="muted pequeno">${[i.categoria, i.serie ? `IMEI ${i.serie}` : '', textoAparelho(i.detalhes), i.garantia_dias ? `garantia ${i.garantia_dias} dias (até ${fmtData(somarDias(v.data, i.garantia_dias))})` : ''].filter(Boolean).map(esc).join(' · ')}</div>
            ${i.devolvido_qtd > 0 ? `<div>${tag(`${fmtNum(i.devolvido_qtd)} devolvido(s)`, 'warn')}</div>` : ''}</td>
            <td class="num">${fmtNum(i.quantidade)}</td><td class="num">${fmtMoeda(i.preco_unitario_centavos)}${i.preco_unitario_centavos < i.preco_tabela_centavos ? `<div class="muted pequeno">tab. ${fmtMoeda(i.preco_tabela_centavos)}</div>` : ''}</td>
            <td class="num">${fmtMoeda(i.total_centavos)}</td>${lucro ? `<td class="num esconder-cel">${i.custo_unitario_centavos == null ? '' : fmtMoeda(i.custo_unitario_centavos)}</td>` : ''}</tr>`).join('')}
        </tbody></table></div></div>
        ${devs.length ? `<div class="card"><div class="card-topo"><h3>Devoluções</h3></div><div class="tabela-wrap"><table class="tabela"><tbody>
          ${devs.map((x) => `<tr><td>${fmtData(x.data)}</td><td>${esc(x.motivo)}</td><td class="num">${fmtMoeda(x.valor_centavos)}</td><td class="pequeno muted">${x.reembolso === 'conta' ? 'dinheiro devolvido' : 'sem reembolso (troca)'}</td></tr>`).join('')}
        </tbody></table></div></div>` : ''}
        ${titulos?.length ? `<div class="card"><div class="card-topo"><h3>Recebimentos</h3><a class="pequeno" href="#/financas/receber">Contas a receber</a></div><div class="tabela-wrap"><table class="tabela"><tbody>
          ${titulos.map((t) => `<tr><td>${FORMAS[t.forma_pagamento] || ''}${t.parcelas > 1 ? ` ${t.parcela}/${t.parcelas}` : ''}</td><td>${fmtData(t.vencimento)}</td><td class="num">${fmtMoeda(t.valor_centavos)}${t.taxa_prevista_centavos ? `<div class="muted pequeno">taxa ${fmtMoeda(t.taxa_prevista_centavos)}</div>` : ''}</td><td class="num">${tag(STT[t.status][0], STT[t.status][1])}</td></tr>`).join('')}
        </tbody></table></div></div>` : ''}
      </div>
    </div>`;

  $('#b-recibo', el)?.addEventListener('click', () => imprimirRecibo(d));
  $('#b-cli', el)?.addEventListener('click', async () => {
    const { escolherCliente } = await import('./clientes.js');
    const c = await escolherCliente(); if (!c) return;
    try { await rpc('vincular_cliente_venda', { p_venda: id, p_cliente: c.id }); toast('Cliente vinculado'); detalhe(el, ctx); } catch (err) { toast(msgErro(err), 'erro'); }
  });
  $('#b-aprovar', el)?.addEventListener('click', async () => {
    try { await rpc('aprovar_venda', { p_venda: id, p_aprovar: true }); toast('Venda aprovada'); atualizarAvisos(); detalhe(el, ctx); } catch (err) { toast(msgErro(err), 'erro'); }
  });
  $('#b-cancelar', el)?.addEventListener('click', async () => {
    const m = await pedirMotivo({ titulo: `Cancelar venda nº ${v.numero}`, texto: 'O estoque volta, o IMEI fica disponível e o dinheiro recebido é estornado das contas.', botao: 'Cancelar venda' });
    if (!m) return;
    try { await rpc('cancelar_venda', { p_venda: id, p_motivo: m }); toast('Venda cancelada'); detalhe(el, ctx); } catch (err) { toast(msgErro(err), 'erro'); }
  });
  $('#b-dev', el)?.addEventListener('click', async () => { if (await devolver(d)) detalhe(el, ctx); });
}

async function devolver({ venda: v, itens }) {
  const contas = (await listaCache('contas')).filter((c) => c.ativo);
  const abertos = itens.filter((i) => i.quantidade - i.devolvido_qtd > 0);
  return abrirModal({
    titulo: `Devolução da venda nº ${v.numero}`, largura: 'lg', botao: 'Registrar devolução',
    corpo: `<p class="muted">Marque o que voltou. O produto retorna ao estoque e o valor é calculado proporcionalmente (já com o desconto da venda).</p>
      <div class="tabela-wrap"><table class="tabela"><thead><tr><th>Item</th><th class="num">Vendido</th><th class="num">Devolver</th></tr></thead><tbody>
      ${abertos.map((i) => `<tr><td>${esc(i.descricao)}${i.serie ? `<div class="muted pequeno">IMEI ${esc(i.serie)}</div>` : ''}</td><td class="num">${fmtNum(i.quantidade - i.devolvido_qtd)}</td>
        <td class="num"><input name="q_${i.id}" inputmode="decimal" value="0" style="width:70px;margin:0" data-max="${i.quantidade - i.devolvido_qtd}"></td></tr>`).join('')}
      </tbody></table></div>
      <label>Motivo *<input name="motivo" required placeholder="Ex.: defeito, troca por outro modelo…"></label>
      <fieldset><legend>Dinheiro</legend>
        <label class="check"><input type="radio" name="reemb" value="conta" checked> Devolver o dinheiro ao cliente, saindo de:</label>
        <select name="conta" style="margin:6px 0 10px">${contas.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select>
        <label class="check"><input type="radio" name="reemb" value="nenhum"> Não devolver dinheiro (troca: o valor vira desconto numa nova venda)</label>
      </fieldset>`,
    aoSalvar: async (f) => {
      const itensDev = abertos.map((i) => ({ venda_item_id: i.id, quantidade: lerNumero(f[`q_${i.id}`].value) })).filter((x) => x.quantidade > 0);
      if (!itensDev.length) { f.erro('Informe a quantidade devolvida de pelo menos um item.'); return false; }
      const reemb = f.querySelector('input[name=reemb]:checked').value;
      await rpc('devolver_venda', { p: { venda_id: v.id, motivo: f.motivo.value.trim(), itens: itensDev, reembolso: reemb, conta_id: reemb === 'conta' ? f.conta.value : null } });
      toast('Devolução registrada');
      return true;
    },
  });
}
