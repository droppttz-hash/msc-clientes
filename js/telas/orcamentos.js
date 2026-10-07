// Orçamentos, reservas com sinal e avaliação de aparelho do cliente (troca/compra)
import {
  estado, pode, $, $$, esc, fmtMoeda, fmtData, fmtDataHora, fmtTelefone, fmtNum, fmtCpf, fmtCnpj, hojeSP, somarDias, linkZap, soDigitos,
  abrirModal, pedirMotivo, toast, msgErro, rpc, consulta, buscarTudo, lista as listaCache, cabecalho, vazio, carregando, tag, kpi, icone,
  valorDinheiro, setDinheiro, textoAparelho, CONDICOES_APARELHO, FORMAS, imprimir, validarCpf, validarCnpj, limparCnpj,
} from '../core.js';

const ST_ORC = { aberto: ['Em aberto', 'warn'], convertido: ['Virou venda', 'ok'], cancelado: ['Cancelado', 'cinza'] };
const ST_RES = { ativa: ['Ativa', 'warn'], convertida: ['Virou venda', 'ok'], cancelada: ['Cancelada', 'cinza'] };
const tagOrc = (o) => (o.vencido ? tag('Vencido', 'danger') : tag(...(ST_ORC[o.status] || [o.status, 'cinza'])));
const tagRes = (r) => (r.vencida ? tag('Vencida', 'danger') : tag(...(ST_RES[r.status] || [r.status, 'cinza'])));
const nomeAp = (a) => [a.produto, a.capacidade, a.cor].filter(Boolean).join(' · ');

function abas(atual) {
  const itens = [
    pode('vendas.orcamento') && ['orc', 'Orçamentos', '#/vendas/orcamentos'],
    (pode('vendas.reservar') || pode('vendas.ver_todas')) && ['res', 'Reservas', '#/vendas/reservas'],
  ].filter(Boolean);
  return itens.length > 1 ? `<nav class="abas-pagina">${itens.map(([id, r, h]) => `<a href="${h}" class="${id === atual ? 'ativa' : ''}">${r}</a>`).join('')}</nav>` : '';
}

// =====================================================================
// AVALIAÇÃO DE APARELHO (troca no PDV ou compra de cliente)
// tipo: 'troca' | 'compra'; retorna os dados para finalizar_venda/comprar_aparelho_cliente
// =====================================================================
export async function avaliarAparelho(tipo, imeisJaUsados = [], { cliente = null } = {}) {
  const produtos = await buscarTudo(() => estado.sb.from('produtos').select('id,nome,sku').eq('controla_serie', true).eq('ativo', true).order('nome'));
  const dup = new Set(produtos.filter((p, i) => produtos.findIndex((x) => x.nome === p.nome) !== i).map((p) => p.nome));
  produtos.forEach((p) => { p.rotulo = dup.has(p.nome) ? `${p.nome} (${p.sku})` : p.nome; });
  if (!produtos.length) { toast('Cadastre antes o modelo do aparelho em Estoque › Produtos (com “controla IMEI”).', 'erro'); return null; }
  const itensCheck = Array.isArray(estado.empresa?.checklist_aparelho) ? estado.empresa.checklist_aparelho : [];
  const contas = tipo === 'compra' ? (await listaCache('contas')).filter((c) => c.ativo) : [];
  const compra = tipo === 'compra';
  return abrirModal({
    titulo: compra ? 'Comprar aparelho de cliente' : 'Aparelho do cliente na troca', largura: 'lg', botao: compra ? 'Registrar compra' : 'Usar na troca',
    corpo: `
      ${compra ? `<p class="muted">Vendedor: <b>${esc(cliente?.nome || '')}</b>. O aparelho entra no estoque <b>em teste</b> e o pagamento sai da conta escolhida.</p>`
        : '<p class="muted">O aparelho entra no estoque <b>em teste</b> quando a venda for finalizada. O valor abate do total da compra.</p>'}
      <label>Modelo *<input name="prod" list="lst-prod-av" placeholder="Digite para buscar (ex.: iPhone 13)" autocomplete="off" required></label>
      <datalist id="lst-prod-av">${produtos.map((p) => `<option value="${esc(p.rotulo)}"></option>`).join('')}</datalist>
      <div class="form-grade">
        <label>IMEI *<input name="imei" required inputmode="numeric" autocomplete="off"></label>
        <label>IMEI 2<input name="imei2" inputmode="numeric" autocomplete="off"></label>
        <label>Capacidade<input name="capacidade" placeholder="128GB"></label>
        <label>Cor<input name="cor"></label>
        <label>Condição<select name="condicao">${Object.entries(CONDICOES_APARELHO).map(([k, v]) => `<option value="${k}" ${k === 'seminovo' ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Grau<select name="grau"><option value="">—</option><option>A</option><option>B</option><option>C</option></select></label>
        <label>Bateria (%)<input name="bateria" inputmode="numeric" placeholder="ex.: 87"></label>
        <label>Peças já trocadas<input name="pecas" placeholder="ex.: tela, bateria"></label>
      </div>
      ${itensCheck.length ? `<fieldset><legend>Checklist de avaliação</legend><div class="form-grade">
        ${itensCheck.map((it, k) => `<label class="pequeno">${esc(it)}<select name="chk_${k}"><option value="">não testado</option><option value="ok">ok</option><option value="falha">com problema</option></select></label>`).join('')}
      </div></fieldset>` : ''}
      <div class="form-grade">
        <label>${compra ? 'Valor pago ao cliente' : 'Valor da avaliação (abate na compra)'} *<input name="valor" data-mascara="dinheiro" inputmode="numeric" required></label>
        ${compra ? `<label>CPF/CNPJ de quem vende *<input name="doc" value="${esc(cliente?.doc ? (cliente.doc.length === 11 ? fmtCpf(cliente.doc) : fmtCnpj(cliente.doc)) : '')}"></label>
          <label>Pagar com a conta *<select name="conta"><option value="">Escolha…</option>${contas.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select></label>` : ''}
      </div>
      <label>Observação<input name="obs" placeholder="Ex.: riscos na lateral, sem caixa…"></label>`,
    aoSalvar: (f) => {
      const txt = f.prod.value.trim().toLowerCase();
      const p = produtos.find((x) => x.rotulo.toLowerCase() === txt) || produtos.find((x) => x.nome.toLowerCase() === txt);
      if (!p) { f.erro('Escolha o modelo na lista (cadastre em Estoque se não existir).'); return false; }
      const imei = f.imei.value.trim().toUpperCase();
      if (imei.length < 5) { f.erro('Informe o IMEI.'); return false; }
      if (imeisJaUsados.includes(imei)) { f.erro('Esse IMEI já está nesta venda.'); return false; }
      const bat = f.bateria.value.trim();
      if (bat && !(Number(bat) >= 0 && Number(bat) <= 100)) { f.erro('Bateria entre 0 e 100.'); return false; }
      const valor = valorDinheiro(f.valor);
      if (valor <= 0) { f.erro('Informe o valor.'); return false; }
      const checklist = {};
      itensCheck.forEach((it, k) => { const v = f[`chk_${k}`].value; if (v) checklist[it] = v; });
      const r = {
        produto_id: p.id, produto_nome: p.nome, imei, imei2: f.imei2.value.trim().toUpperCase() || null, capacidade: f.capacidade.value.trim() || null,
        cor: f.cor.value.trim() || null, condicao: f.condicao.value, grau: f.grau.value || null, bateria_pct: bat ? Number(bat) : null,
        pecas_trocadas: f.pecas.value.trim() || null, checklist, valor_centavos: valor, observacao: f.obs.value.trim() || null,
      };
      if (compra) {
        const doc = limparCnpj(f.doc.value);
        if (!(doc.length === 11 ? validarCpf(doc) : validarCnpj(doc))) { f.erro('CPF ou CNPJ inválido.'); return false; }
        if (!f.conta.value) { f.erro('Escolha de qual conta sai o pagamento.'); return false; }
        Object.assign(r, { documento: doc, conta_id: f.conta.value, cliente_id: cliente.id });
      }
      return r;
    },
  });
}

// =====================================================================
// SALVAR CARRINHO DO PDV COMO ORÇAMENTO
// =====================================================================
export async function salvarOrcamentoDoCarrinho(carrinho) {
  let cli = carrinho.cliente || null;
  const validadePadrao = somarDias(hojeSP(), Number(estado.empresa?.orcamento_validade_dias || 7));
  return abrirModal({
    titulo: carrinho.orcamento ? `Atualizar orçamento nº ${carrinho.orcamento.numero}` : 'Salvar como orçamento', largura: 'md', botao: 'Salvar orçamento',
    corpo: `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div><div class="muted pequeno">Cliente</div><b data-cli>${cli ? esc(cli.nome) : 'Sem cadastro — informe nome e telefone abaixo'}</b></div>
        <button class="btn btn-ghost btn-sm" type="button" data-esc>Escolher cadastro</button></div>
      <div class="form-grade" data-avulso ${cli ? 'hidden' : ''}>
        <label>Nome<input name="nome"></label><label>Telefone (WhatsApp)<input name="tel" inputmode="tel" placeholder="(11) 99999-9999"></label></div>
      <div class="form-grade"><label>Válido até<input type="date" name="validade" value="${validadePadrao}"></label>
        <label>Total<input value="${fmtMoeda(carrinho.itens.reduce((s, i) => s + Math.round(i.qtd * i.preco) - (i.desconto || 0), 0) - carrinho.descontoGeral)}" disabled></label></div>
      <label>Condições (pagamento, prazo de entrega…)<textarea name="cond" rows="2" placeholder="Ex.: à vista no PIX ou em até 12x no cartão"></textarea></label>
      <label>Observação<input name="obs" value="${esc(carrinho.observacao || '')}"></label>
      <p class="muted pequeno">Aparelhos com IMEI não ficam reservados pelo orçamento. Para segurar o aparelho, use “Reservar com sinal”.</p>`,
    aoAbrir: (f) => {
      $('[data-esc]', f).addEventListener('click', async () => {
        const { escolherCliente } = await import('./clientes.js');
        const c = await escolherCliente(); if (!c) return;
        cli = c; $('[data-cli]', f).textContent = c.nome; $('[data-avulso]', f).hidden = true;
      });
    },
    aoSalvar: async (f) => {
      if (!cli && f.nome.value.trim().length < 2) { f.erro('Escolha o cliente ou informe o nome.'); return false; }
      const tel = soDigitos(f.tel.value);
      if (!cli && tel && !/^\d{10,11}$/.test(tel)) { f.erro('Telefone com DDD (10 ou 11 dígitos).'); return false; }
      const r = await rpc('salvar_orcamento', { p: {
        id: carrinho.orcamento?.id || null, cliente_id: cli?.id || null, cliente_nome: cli ? null : f.nome.value.trim(), cliente_telefone: cli ? null : tel || null,
        validade: f.validade.value || null, condicoes: f.cond.value, observacao: f.obs.value, desconto_centavos: carrinho.descontoGeral,
        itens: carrinho.itens.map((i) => ({ produto_id: i.produtoId || null, serie_id: i.serieId || null, serie: i.serie || null, descricao: i.descricao,
          categoria_id: i.categoriaId || null, quantidade: i.qtd, preco_unitario_centavos: i.preco, detalhes: i.detalhes ? detalhesLimpos(i.detalhes) : null,
          garantia_dias: i.garantia ?? null })),
      } });
      toast(`Orçamento nº ${r.numero} salvo`);
      return r;
    },
  });
}
const detalhesLimpos = (d) => Object.fromEntries(['condicao', 'grau', 'bateria_pct', 'cor', 'capacidade', 'imei2'].filter((k) => d[k] != null).map((k) => [k, d[k]]));

// =====================================================================
// ORÇAMENTOS — LISTA
// =====================================================================
const fo = { status: 'aberto', termo: '' };
export async function orcamentos(el, ctx) {
  if (!pode('vendas.orcamento') && !pode('vendas.ver_todas')) { el.innerHTML = vazio('Sem permissão', ''); return; }
  el.innerHTML = `${abas('orc')}
    ${cabecalho('Orçamentos', { sub: 'Monte o orçamento no PDV (botão “Salvar como orçamento”) e converta em venda quando o cliente fechar.',
      acoes: pode('vendas.criar') ? '<a class="btn btn-primary" href="#/vendas/nova">+ Novo orçamento (no PDV)</a>' : '' })}
    <div class="card"><div class="ferramentas">
      <input class="busca" id="f-termo" type="search" placeholder="Cliente, telefone ou nº…" value="${esc(fo.termo)}">
      <select id="f-st">${[['aberto', 'Em aberto'], ['vencido', 'Vencidos'], ['convertido', 'Viraram venda'], ['cancelado', 'Cancelados'], ['', 'Todos']].map(([v, r]) => `<option value="${v}" ${fo.status === v ? 'selected' : ''}>${r}</option>`).join('')}</select>
    </div><div id="tabela">${carregando()}</div></div>`;
  const carregar = async () => {
    let dados;
    try {
      dados = await buscarTudo(() => {
        let q = estado.sb.from('orcamentos_lista').select('*');
        if (fo.status === 'vencido') q = q.eq('vencido', true);
        else if (fo.status) q = q.eq('status', fo.status);
        const t = fo.termo.trim().replace(/[,()"%]/g, ' ');
        if (/^\d{1,9}$/.test(t)) q = q.eq('numero', Number(t));
        else if (t) q = q.or(`nome_cliente.ilike."%${t}%",telefone_cliente.ilike."%${soDigitos(t) || t}%"`);
        return q.order('criado_em', { ascending: false });
      });
    } catch (err) { $('#tabela', el).innerHTML = vazio('Erro', esc(msgErro(err))); return; }
    if (!ctx.ativo()) return;
    if (!dados.length) { $('#tabela', el).innerHTML = vazio('Nenhum orçamento aqui', ''); return; }
    $('#tabela', el).innerHTML = `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Nº</th><th>Cliente</th><th class="esconder-cel">Itens</th><th class="num">Total</th><th class="esconder-cel">Válido até</th><th>Situação</th></tr></thead><tbody>
      ${dados.map((o) => `<tr class="clicavel" data-href="#/vendas/orcamentos/${o.id}"><td>${o.numero}</td><td><b>${esc(o.nome_cliente || '')}</b><div class="muted pequeno">${fmtData(o.criado_em)} · ${esc(o.vendedor_nome || '')}</div></td>
        <td class="esconder-cel pequeno">${esc(o.itens.map((i) => i.descricao).join(', ')).slice(0, 90)}</td><td class="num">${fmtMoeda(o.total_centavos)}</td>
        <td class="esconder-cel">${fmtData(o.validade)}</td><td>${tagOrc(o)}</td></tr>`).join('')}
      </tbody></table></div><div class="rodape-tabela"><span>${dados.length} orçamento(s) · ${fmtMoeda(dados.reduce((s, o) => s + o.total_centavos, 0))}</span></div>`;
    $$('tr[data-href]', el).forEach((tr) => tr.addEventListener('click', () => { location.hash = tr.dataset.href; }));
  };
  let tm; $('#f-termo', el).addEventListener('input', (e) => { clearTimeout(tm); tm = setTimeout(() => { fo.termo = e.target.value; carregar(); }, 250); });
  $('#f-st', el).addEventListener('change', (e) => { fo.status = e.target.value; carregar(); });
  carregar();
}

// =====================================================================
// ORÇAMENTO — DETALHE
// =====================================================================
function textoWhatsOrc(o) {
  const loja = estado.empresa?.nome_fantasia || '';
  return [`*${loja}* — Orçamento nº ${o.numero}`, `Olá, ${(o.nome_cliente || '').split(' ')[0]}! Segue o orçamento:`, '',
    ...o.itens.map((i) => `• ${fmtNum(i.quantidade)}x ${i.descricao}${i.detalhes ? ` (${textoAparelho(i.detalhes)})` : ''} — ${fmtMoeda(Math.round(i.quantidade * i.preco_unitario_centavos))}`),
    o.desconto_centavos ? `Desconto: ${fmtMoeda(o.desconto_centavos)}` : null,
    `*Total: ${fmtMoeda(o.total_centavos)}*`,
    o.condicoes ? `Condições: ${o.condicoes}` : null,
    `Válido até ${fmtData(o.validade)}.`].filter((x) => x !== null).join('\n');
}
function imprimirOrcamento(o) {
  const e = estado.empresa || {};
  imprimir(`Orçamento ${o.numero}`, `
    <h2>Orçamento nº ${o.numero}</h2>
    <p>Data: <b>${fmtData(o.criado_em)}</b> · Válido até <b>${fmtData(o.validade)}</b> · Atendente: ${esc(o.vendedor_nome || '')}<br>
      Cliente: <b>${esc(o.nome_cliente || '')}</b>${o.telefone_cliente ? ` · ${fmtTelefone(o.telefone_cliente)}` : ''}</p>
    <table><thead><tr><th>Item</th><th class="num">Qtd</th><th class="num">Unit.</th><th class="num">Total</th></tr></thead><tbody>
      ${o.itens.map((i) => `<tr><td>${esc(i.descricao)}${i.detalhes ? `<br><small>${esc(textoAparelho(i.detalhes))}</small>` : ''}${i.garantia_dias ? `<br><small>Garantia ${i.garantia_dias} dias</small>` : ''}</td>
        <td class="num">${fmtNum(i.quantidade)}</td><td class="num">${fmtMoeda(i.preco_unitario_centavos)}</td><td class="num">${fmtMoeda(Math.round(i.quantidade * i.preco_unitario_centavos))}</td></tr>`).join('')}
    </tbody></table>
    <table><tbody>
      <tr><td>Subtotal</td><td class="num">${fmtMoeda(o.subtotal_centavos)}</td></tr>
      ${o.desconto_centavos ? `<tr><td>Desconto</td><td class="num">− ${fmtMoeda(o.desconto_centavos)}</td></tr>` : ''}
      <tr><td class="total">Total</td><td class="num total">${fmtMoeda(o.total_centavos)}</td></tr>
    </tbody></table>
    ${o.condicoes ? `<div class="caixa"><b>Condições:</b> ${esc(o.condicoes)}</div>` : ''}
    ${o.observacao ? `<p>Obs.: ${esc(o.observacao)}</p>` : ''}
    <p class="muted">Orçamento sem reserva de estoque. Preços e disponibilidade válidos até ${fmtData(o.validade)}.${e.telefone ? ` Dúvidas: ${fmtTelefone(e.telefone)}.` : ''}</p>`);
}

export async function orcamento(el, ctx) {
  const id = ctx.params[0];
  const [o] = await consulta(estado.sb.from('orcamentos_lista').select('*').eq('id', id));
  if (!ctx.ativo()) return;
  if (!o) { el.innerHTML = vazio('Orçamento não encontrado', '<a href="#/vendas/orcamentos">Voltar</a>'); return; }
  const aberto = o.status === 'aberto';
  el.innerHTML = `
    <a class="voltar" href="#/vendas/orcamentos">${icone('recolher')} Orçamentos</a>
    ${cabecalho(`Orçamento nº ${o.numero}`, { sub: `${fmtDataHora(o.criado_em)} · ${esc(o.vendedor_nome || '')}`, resumo: tagOrc(o) })}
    ${o.status === 'cancelado' ? `<div class="alerta">${icone('alerta')}<span>Cancelado: ${esc(o.motivo_cancelamento || '')}</span></div>` : ''}
    ${o.status === 'convertido' ? `<div class="alerta info">${icone('alerta')}<span>Virou a <a href="#/vendas/${o.venda_id}">venda nº ${o.venda_numero}</a>.</span></div>` : ''}
    <div class="barra-acoes">
      ${aberto && pode('vendas.criar') ? '<button class="btn btn-primary" type="button" id="b-conv">Converter em venda</button>' : ''}
      <button class="btn btn-ghost" type="button" id="b-pdf">${icone('impressora')} Imprimir / PDF</button>
      ${o.telefone_cliente ? `<a class="btn btn-ghost" target="_blank" rel="noopener" href="${linkZap(o.telefone_cliente, textoWhatsOrc(o))}">${icone('zap')} Enviar no WhatsApp</a>` : ''}
      ${aberto ? '<button class="btn btn-ghost" type="button" id="b-canc" style="color:var(--danger)">Cancelar orçamento</button>' : ''}
    </div>
    <div class="lado-a-lado">
      <div class="card card-pad"><dl class="dl">
        <div><dt>Cliente</dt><dd>${o.cliente_id ? `<a href="#/clientes/${o.cliente_id}">${esc(o.nome_cliente)}</a>` : esc(o.nome_cliente || '')}${o.telefone_cliente ? `<br><span class="muted">${fmtTelefone(o.telefone_cliente)}</span>` : ''}</dd></div>
        <div><dt>Válido até</dt><dd>${fmtData(o.validade)}</dd></div>
        <div><dt>Subtotal</dt><dd>${fmtMoeda(o.subtotal_centavos)}</dd></div>
        ${o.desconto_centavos ? `<div><dt>Desconto</dt><dd>− ${fmtMoeda(o.desconto_centavos)}</dd></div>` : ''}
        <div><dt>Total</dt><dd style="font-size:22px;font-weight:700">${fmtMoeda(o.total_centavos)}</dd></div>
        ${o.condicoes ? `<div><dt>Condições</dt><dd>${esc(o.condicoes)}</dd></div>` : ''}
        ${o.observacao ? `<div><dt>Observação</dt><dd>${esc(o.observacao)}</dd></div>` : ''}
      </dl></div>
      <div class="card"><div class="card-topo"><h3>Itens</h3></div><div class="tabela-wrap"><table class="tabela"><thead><tr><th>Item</th><th class="num">Qtd</th><th class="num">Unit.</th><th class="num">Total</th></tr></thead><tbody>
        ${o.itens.map((i) => `<tr><td><b>${esc(i.descricao)}</b><div class="muted pequeno">${[i.serie && `IMEI ${i.serie}`, textoAparelho(i.detalhes)].filter(Boolean).map(esc).join(' · ')}</div></td>
          <td class="num">${fmtNum(i.quantidade)}</td><td class="num">${fmtMoeda(i.preco_unitario_centavos)}</td><td class="num">${fmtMoeda(Math.round(i.quantidade * i.preco_unitario_centavos))}</td></tr>`).join('')}
      </tbody></table></div></div>
    </div>`;
  $('#b-pdf', el).addEventListener('click', () => imprimirOrcamento(o));
  $('#b-conv', el)?.addEventListener('click', () => { estado.preOrcamento = o; location.hash = '#/vendas/nova'; });
  $('#b-canc', el)?.addEventListener('click', async () => {
    const m = await pedirMotivo({ titulo: `Cancelar orçamento nº ${o.numero}`, botao: 'Cancelar orçamento', placeholder: 'Ex.: cliente desistiu, achou mais barato…' });
    if (!m) return;
    try { await rpc('cancelar_orcamento', { p_orcamento: id, p_motivo: m }); toast('Orçamento cancelado'); orcamento(el, ctx); } catch (err) { toast(msgErro(err), 'erro'); }
  });
}

// =====================================================================
// RESERVAS — NOVA
// =====================================================================
export async function novaReserva({ cliente = null, serieId = null } = {}) {
  if (!pode('vendas.reservar')) { toast('Sem permissão para reservar.', 'erro'); return null; }
  const [formas, aps] = await Promise.all([
    listaCache('formas'),
    consulta(estado.sb.from('aparelhos').select('id,produto,imei,cor,capacidade,grau,condicao,bateria_pct,preco_venda_centavos').eq('status', 'disponivel').order('produto')),
  ]);
  const fs = formas.filter((f) => f.ativo && !f.interna && !['crediario', 'boleto'].includes(f.forma));
  if (!aps.length) { toast('Nenhum aparelho disponível para reservar.', 'erro'); return null; }
  let cli = cliente;
  const dias = Number(estado.empresa?.reserva_dias_padrao || 7);
  const r = await abrirModal({
    titulo: 'Reservar aparelho com sinal', largura: 'md', botao: 'Reservar e receber sinal',
    corpo: `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div><div class="muted pequeno">Cliente *</div><b data-cli>${cli ? esc(cli.nome) : '<span class="neg">Escolha o cliente</span>'}</b></div>
        <button class="btn btn-ghost btn-sm" type="button" data-esc>Escolher</button></div>
      <label>Aparelho *<select name="serie"><option value="">Escolha…</option>${aps.map((a) => `<option value="${a.id}" ${a.id === serieId ? 'selected' : ''}>${esc(nomeAp(a))} — IMEI ${esc(a.imei)}${a.grau ? ` · grau ${a.grau}` : ''} — ${fmtMoeda(a.preco_venda_centavos)}</option>`).join('')}</select></label>
      <div class="form-grade">
        <label>Valor do sinal *<input name="valor" data-mascara="dinheiro" inputmode="numeric" required></label>
        <label>Forma do sinal *<select name="forma">${fs.map((f) => `<option value="${f.forma}">${esc(f.nome)}</option>`).join('')}</select></label>
        <label>Segurar até<input type="date" name="validade" value="${somarDias(hojeSP(), dias)}" min="${hojeSP()}"></label>
      </div>
      <label>Observação<input name="obs" placeholder="Ex.: cliente volta sábado para pagar o restante"></label>
      <p class="muted pequeno">O aparelho sai do PDV até a venda ou o cancelamento. O sinal entra no caixa agora e abate no total da venda.</p>`,
    aoAbrir: (f) => {
      $('[data-esc]', f).addEventListener('click', async () => {
        const { escolherCliente } = await import('./clientes.js');
        const c = await escolherCliente(); if (!c) return;
        cli = c; $('[data-cli]', f).textContent = c.nome;
      });
    },
    aoSalvar: async (f) => {
      if (!cli) { f.erro('Escolha o cliente.'); return false; }
      if (!f.serie.value) { f.erro('Escolha o aparelho.'); return false; }
      const v = valorDinheiro(f.valor);
      if (v <= 0) { f.erro('Informe o valor do sinal.'); return false; }
      const ap = aps.find((a) => a.id === f.serie.value);
      if (v > ap.preco_venda_centavos) { f.erro('O sinal não pode passar do preço do aparelho.'); return false; }
      const res = await rpc('criar_reserva', { p: { cliente_id: cli.id, serie_id: f.serie.value, valor_sinal_centavos: v, forma: f.forma.value, validade: f.validade.value || null, observacao: f.obs.value } });
      toast(`Reserva nº ${res.numero} criada`);
      return res;
    },
  });
  return r;
}

// =====================================================================
// RESERVAS — LISTA
// =====================================================================
const fr = { status: 'ativa', termo: '' };
export async function reservas(el, ctx) {
  el.innerHTML = `${abas('res')}
    ${cabecalho('Reservas', { sub: 'Aparelho separado para o cliente com sinal pago. Converta em venda quando ele voltar.',
      acoes: pode('vendas.reservar') ? '<button class="btn btn-primary" type="button" id="b-nova">+ Nova reserva</button>' : '' })}
    <div class="kpis" id="kpis"></div>
    <div class="card"><div class="ferramentas">
      <input class="busca" id="f-termo" type="search" placeholder="Cliente, IMEI, modelo…" value="${esc(fr.termo)}">
      <select id="f-st">${[['ativa', 'Ativas'], ['vencida', 'Vencidas'], ['convertida', 'Viraram venda'], ['cancelada', 'Canceladas'], ['', 'Todas']].map(([v, r]) => `<option value="${v}" ${fr.status === v ? 'selected' : ''}>${r}</option>`).join('')}</select>
    </div><div id="tabela">${carregando()}</div></div>`;
  const carregar = async () => {
    let dados, ativas;
    try {
      [dados, ativas] = await Promise.all([buscarTudo(() => {
        let q = estado.sb.from('reservas_lista').select('*');
        if (fr.status === 'vencida') q = q.eq('vencida', true);
        else if (fr.status) q = q.eq('status', fr.status);
        const t = fr.termo.trim().replace(/[,()"%]/g, ' ');
        if (/^\d{1,6}$/.test(t)) q = q.eq('numero', Number(t));
        else if (t) q = q.or(`cliente_nome.ilike."%${t}%",imei.ilike."%${t}%",produto.ilike."%${t}%"`);
        return q.order('criado_em', { ascending: false });
      }), consulta(estado.sb.from('reservas_lista').select('valor_sinal_centavos,vencida').eq('status', 'ativa'))]);
    } catch (err) { $('#tabela', el).innerHTML = vazio('Erro', esc(msgErro(err))); return; }
    if (!ctx.ativo()) return;
    const venc = ativas.filter((x) => x.vencida).length;
    $('#kpis', el).innerHTML = kpi('Reservas ativas', fmtNum(ativas.length), `${fmtMoeda(ativas.reduce((s, x) => s + x.valor_sinal_centavos, 0))} em sinais`)
      + kpi('Vencidas', fmtNum(venc), venc ? 'ligue para o cliente ou cancele' : 'nenhuma', venc ? 'neg' : '');
    if (!dados.length) { $('#tabela', el).innerHTML = vazio('Nenhuma reserva aqui', ''); return; }
    $('#tabela', el).innerHTML = `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Nº</th><th>Cliente</th><th>Aparelho</th><th class="num">Sinal</th><th class="num esconder-cel">Preço</th><th class="esconder-cel">Até</th><th>Situação</th></tr></thead><tbody>
      ${dados.map((r) => `<tr class="clicavel" data-href="#/vendas/reservas/${r.id}"><td>${r.numero}</td><td><b>${esc(r.cliente_nome)}</b><div class="muted pequeno">${fmtTelefone(r.cliente_telefone) || ''}</div></td>
        <td>${esc(nomeAp(r))}<div class="muted pequeno">IMEI ${esc(r.imei)}</div></td><td class="num">${fmtMoeda(r.valor_sinal_centavos)}</td>
        <td class="num esconder-cel">${fmtMoeda(r.preco_venda_centavos)}</td><td class="esconder-cel">${fmtData(r.validade)}</td><td>${tagRes(r)}</td></tr>`).join('')}
      </tbody></table></div><div class="rodape-tabela"><span>${dados.length} reserva(s)</span></div>`;
    $$('tr[data-href]', el).forEach((tr) => tr.addEventListener('click', () => { location.hash = tr.dataset.href; }));
  };
  let tm; $('#f-termo', el).addEventListener('input', (e) => { clearTimeout(tm); tm = setTimeout(() => { fr.termo = e.target.value; carregar(); }, 250); });
  $('#f-st', el).addEventListener('change', (e) => { fr.status = e.target.value; carregar(); });
  $('#b-nova', el)?.addEventListener('click', async () => { const r = await novaReserva(); if (r) location.hash = `#/vendas/reservas/${r.id}`; });
  carregar();
}

// =====================================================================
// RESERVA — DETALHE
// =====================================================================
function imprimirComprovanteReserva(r) {
  imprimir(`Reserva ${r.numero}`, `
    <h2>Comprovante de reserva nº ${r.numero}</h2>
    <p>Data: <b>${fmtData(r.criado_em)}</b> · Atendente: ${esc(r.vendedor_nome || '')}<br>Cliente: <b>${esc(r.cliente_nome)}</b>${r.cliente_telefone ? ` · ${fmtTelefone(r.cliente_telefone)}` : ''}</p>
    <div class="caixa"><b>${esc(nomeAp(r))}</b><br>IMEI ${esc(r.imei)}${r.grau ? ` · grau ${r.grau}` : ''}</div>
    <table><tbody>
      <tr><td>Preço do aparelho</td><td class="num">${fmtMoeda(r.preco_venda_centavos)}</td></tr>
      <tr><td>Sinal pago (${esc(r.forma_nome || FORMAS[r.forma] || r.forma)})</td><td class="num">${fmtMoeda(r.valor_sinal_centavos)}</td></tr>
      <tr><td class="total">Restante</td><td class="num total">${fmtMoeda(Math.max(0, r.preco_venda_centavos - r.valor_sinal_centavos))}</td></tr>
    </tbody></table>
    <p>O aparelho fica reservado até <b>${fmtData(r.validade)}</b>. Depois dessa data a loja pode liberar o aparelho para venda.</p>
    ${r.observacao ? `<p>Obs.: ${esc(r.observacao)}</p>` : ''}
    <div class="assin"><div>${esc(estado.empresa?.nome_fantasia || '')}</div><div>Cliente</div></div>`);
}

export async function reserva(el, ctx) {
  const id = ctx.params[0];
  const [r] = await consulta(estado.sb.from('reservas_lista').select('*').eq('id', id));
  if (!ctx.ativo()) return;
  if (!r) { el.innerHTML = vazio('Reserva não encontrada', '<a href="#/vendas/reservas">Voltar</a>'); return; }
  const ativa = r.status === 'ativa';
  const zap = `Olá, ${r.cliente_nome.split(' ')[0]}! Seu ${nomeAp(r)} está reservado aqui na ${estado.empresa?.nome_fantasia || 'loja'} até ${fmtData(r.validade)}. Sinal recebido: ${fmtMoeda(r.valor_sinal_centavos)}. Restante: ${fmtMoeda(Math.max(0, r.preco_venda_centavos - r.valor_sinal_centavos))}.`;
  el.innerHTML = `
    <a class="voltar" href="#/vendas/reservas">${icone('recolher')} Reservas</a>
    ${cabecalho(`Reserva nº ${r.numero}`, { sub: `${fmtDataHora(r.criado_em)} · ${esc(r.vendedor_nome || '')}`, resumo: tagRes(r) })}
    ${r.vencida ? `<div class="alerta">${icone('alerta')}<span>Passou da data combinada (${fmtData(r.validade)}). Fale com o cliente: converta em venda ou cancele a reserva.</span></div>` : ''}
    ${r.status === 'cancelada' ? `<div class="alerta">${icone('alerta')}<span>Cancelada em ${fmtDataHora(r.cancelada_em)}: ${esc(r.motivo_cancelamento || '')}. Sinal ${r.sinal_devolvido ? 'devolvido' : 'retido'}.</span></div>` : ''}
    ${r.status === 'convertida' ? `<div class="alerta info">${icone('alerta')}<span>Virou a <a href="#/vendas/${r.venda_id}">venda nº ${r.venda_numero}</a>.</span></div>` : ''}
    <div class="barra-acoes">
      ${ativa && pode('vendas.criar') ? '<button class="btn btn-primary" type="button" id="b-conv">Converter em venda</button>' : ''}
      <button class="btn btn-ghost" type="button" id="b-pdf">${icone('impressora')} Comprovante</button>
      ${r.cliente_telefone ? `<a class="btn btn-ghost" target="_blank" rel="noopener" href="${linkZap(r.cliente_telefone, zap)}">${icone('zap')} WhatsApp</a>` : ''}
      ${ativa && pode('vendas.reservar') ? '<button class="btn btn-ghost" type="button" id="b-canc" style="color:var(--danger)">Cancelar reserva</button>' : ''}
    </div>
    <div class="card card-pad"><dl class="dl">
      <div><dt>Cliente</dt><dd><a href="#/clientes/${r.cliente_id}">${esc(r.cliente_nome)}</a>${r.cliente_telefone ? `<br><span class="muted">${fmtTelefone(r.cliente_telefone)}</span>` : ''}</dd></div>
      <div><dt>Aparelho</dt><dd><a href="#/aparelhos/${r.serie_id}">${esc(nomeAp(r))}</a><br><span class="muted">IMEI ${esc(r.imei)}${r.grau ? ` · grau ${r.grau}` : ''}</span></dd></div>
      <div><dt>Preço</dt><dd>${fmtMoeda(r.preco_venda_centavos)}</dd></div>
      <div><dt>Sinal</dt><dd><b>${fmtMoeda(r.valor_sinal_centavos)}</b> · ${esc(r.forma_nome || r.forma)}</dd></div>
      <div><dt>Restante</dt><dd style="font-size:20px;font-weight:700">${fmtMoeda(Math.max(0, r.preco_venda_centavos - r.valor_sinal_centavos))}</dd></div>
      <div><dt>Reservado até</dt><dd>${fmtData(r.validade)}</dd></div>
      ${r.observacao ? `<div><dt>Observação</dt><dd>${esc(r.observacao)}</dd></div>` : ''}
    </dl></div>`;
  $('#b-pdf', el).addEventListener('click', () => imprimirComprovanteReserva(r));
  $('#b-conv', el)?.addEventListener('click', () => { estado.preReserva = r; location.hash = '#/vendas/nova'; });
  $('#b-canc', el)?.addEventListener('click', async () => {
    const contas = (await listaCache('contas')).filter((c) => c.ativo);
    const ok = await abrirModal({
      titulo: `Cancelar reserva nº ${r.numero}`, largura: 'sm', botao: 'Cancelar reserva', botaoClasse: 'btn-danger',
      corpo: `<label>Motivo *<input name="motivo" required placeholder="Ex.: cliente desistiu, não voltou no prazo…"></label>
        <fieldset><legend>Sinal de ${fmtMoeda(r.valor_sinal_centavos)}</legend>
          <label class="check"><input type="radio" name="dev" value="1" checked> Devolver ao cliente, saindo de:</label>
          <select name="conta" style="margin:6px 0 10px">${contas.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select>
          <label class="check"><input type="radio" name="dev" value="0"> Não devolver (sinal fica com a loja)</label></fieldset>
        <p class="muted pequeno">O aparelho volta a ficar disponível para venda.</p>`,
      aoSalvar: async (f) => {
        if (f.motivo.value.trim().length < 3) { f.erro('Escreva o motivo.'); return false; }
        const dev = f.querySelector('input[name=dev]:checked').value === '1';
        await rpc('cancelar_reserva', { p_reserva: id, p_devolver: dev, p_motivo: f.motivo.value.trim(), p_conta: dev ? f.conta.value : null });
        return true;
      },
    });
    if (ok) { toast('Reserva cancelada'); reserva(el, ctx); }
  });
}
