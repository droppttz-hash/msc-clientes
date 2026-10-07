// Finanças: visão geral, caixa do dia, contas a receber/pagar, extrato, despesas fixas, fluxo de caixa e DRE
import {
  estado, pode, podeAlgum, $, $$, esc, fmtMoeda, fmtMoedaSinal, fmtData, fmtDataHora, fmtPct, hojeSP, somarDias, addMeses, ultimoDiaMes, nomeMes, MESES,
  abrirModal, pedirMotivo, confirmar, toast, msgErro, rpc, consulta, buscarTudo, lista as listaCache, baixarCsv, csvMoeda,
  cabecalho, vazio, carregando, tag, kpi, icone, valorDinheiro, setDinheiro, FORMAS,
} from '../core.js';
import { atualizarAvisos } from '../main.js';

const ST_TIT = { aberto: ['Em aberto', 'warn'], parcial: ['Pago em parte', 'warn'], pago: ['Pago', 'ok'], cancelado: ['Cancelado', 'cinza'] };
const TIPO_CONTA = { caixa: 'Caixa (gaveta)', banco: 'Banco', maquininha: 'Maquininha', carteira: 'Carteira digital', outro: 'Outro' };
const ORIGEM_MOV = { baixa: 'Pagamento/recebimento', taxa: 'Taxa de cartão', estorno_baixa: 'Estorno', estorno_taxa: 'Estorno de taxa', transferencia: 'Transferência', ajuste: 'Ajuste', quebra_caixa: 'Quebra/sobra de caixa' };
const FREQ = { semanal: 'Semanal', mensal: 'Mensal', anual: 'Anual' };

function abas(atual) {
  const itens = [
    ['visao', 'Visão geral', '#/financas', ['financeiro.ver']],
    ['caixa', 'Caixa do dia', '#/financas/caixa', ['financeiro.caixa', 'financeiro.ver']],
    ['receber', 'A receber', '#/financas/receber', ['financeiro.ver']],
    ['pagar', 'A pagar', '#/financas/pagar', ['financeiro.ver']],
    ['extrato', 'Extrato', '#/financas/extrato', ['financeiro.ver']],
    ['fixas', 'Despesas fixas', '#/financas/fixas', ['financeiro.ver']],
    ['fluxo', 'Fluxo de caixa', '#/financas/fluxo', ['financeiro.relatorios']],
    ['dre', 'DRE', '#/financas/dre', ['financeiro.relatorios']],
  ].filter(([, , , p]) => podeAlgum(...p));
  if (itens.length < 2) return '';
  return `<nav class="abas-pagina">${itens.map(([id, r, h]) => `<a href="${h}" class="${id === atual ? 'ativa' : ''}">${r}</a>`).join('')}</nav>`;
}

const opcoes = (arr, sel, vazioTxt = '') => `${vazioTxt !== null && vazioTxt !== undefined && vazioTxt !== false ? `<option value="">${vazioTxt}</option>` : ''}${arr.map((o) => `<option value="${o.id}" ${o.id === sel ? 'selected' : ''}>${esc(o.nome)}</option>`).join('')}`;
const statusTag = (t) => {
  const vencido = ['aberto', 'parcial'].includes(t.status) && t.vencimento < hojeSP();
  const [r, c] = ST_TIT[t.status] || [t.status, ''];
  return vencido ? tag('Vencido', 'danger') : tag(r, c);
};
const restante = (t) => Math.max(0, t.valor_centavos - t.pago_centavos);
async function contasAtivas() { return (await listaCache('contas')).filter((c) => c.ativo); }
const recarregar = (el, ctx, fn) => { if (ctx.ativo()) fn(el, ctx); };

// =====================================================================
// VISÃO GERAL
// =====================================================================
export async function visao(el, ctx) {
  const hoje = hojeSP(); const sem = somarDias(hoje, 7);
  const [saldos, abertos] = await Promise.all([
    consulta(estado.sb.from('saldos_contas').select('*').eq('ativo', true).order('ordem')),
    buscarTudo(() => estado.sb.from('titulos').select('id,tipo,descricao,vencimento,valor_centavos,pago_centavos,status,parcela,parcelas,clientes(nome),fornecedores(nome)')
      .in('status', ['aberto', 'parcial']).lte('vencimento', somarDias(hoje, 30)).order('vencimento')),
  ]);
  if (!ctx.ativo()) return;
  const soma = (tipo, f) => abertos.filter((t) => t.tipo === tipo && f(t)).reduce((s, t) => s + restante(t), 0);
  const total = saldos.reduce((s, c) => s + Number(c.saldo_centavos), 0);
  const recVenc = soma('receber', (t) => t.vencimento < hoje); const pagVenc = soma('pagar', (t) => t.vencimento < hoje);
  const acoes = [
    pode('financeiro.lancar') && `<button class="btn btn-primary" data-novo="pagar" type="button">${icone('mais')} Conta a pagar</button>`,
    pode('financeiro.lancar') && `<button class="btn btn-ghost" data-novo="receber" type="button">${icone('mais')} Conta a receber</button>`,
    pode('financeiro.baixar') && '<button class="btn btn-ghost" id="b-transf" type="button">Transferir entre contas</button>',
  ].filter(Boolean).join('');
  const linhaTit = (t) => `<tr class="clicavel" data-tit="${t.id}"><td>${fmtData(t.vencimento)}</td><td>${esc(t.descricao)}${t.parcelas > 1 ? ` <small class="muted">${t.parcela}/${t.parcelas}</small>` : ''}
    <div class="muted pequeno">${esc(t.clientes?.nome || t.fornecedores?.nome || '')}</div></td><td class="num">${fmtMoeda(restante(t))}</td><td>${statusTag(t)}</td></tr>`;
  const tabelaTit = (tipo) => {
    const l = abertos.filter((t) => t.tipo === tipo && t.vencimento <= sem);
    return l.length ? `<div class="tabela-wrap"><table class="tabela"><tbody>${l.slice(0, 12).map(linhaTit).join('')}</tbody></table></div>${l.length > 12 ? `<div class="rodape-tabela"><a href="#/financas/${tipo}">Ver todas (${l.length})</a></div>` : ''}`
      : vazio('Nada para os próximos 7 dias', '');
  };
  el.innerHTML = `${abas('visao')}
    ${cabecalho('Finanças', { sub: 'Quanto a loja tem, o que vai entrar e o que precisa pagar.', acoes })}
    <div class="kpis">
      ${kpi('Saldo total', fmtMoeda(total), 'somando todas as contas', total < 0 ? 'neg' : '')}
      ${kpi('A receber (7 dias)', fmtMoeda(soma('receber', (t) => t.vencimento >= hoje && t.vencimento <= sem)), recVenc ? `<span class="neg">${fmtMoeda(recVenc)} em atraso</span>` : 'nada em atraso')}
      ${kpi('A pagar (7 dias)', fmtMoeda(soma('pagar', (t) => t.vencimento >= hoje && t.vencimento <= sem)), pagVenc ? `<span class="neg">${fmtMoeda(pagVenc)} vencido</span>` : 'nada vencido')}
      ${kpi('Previsão em 30 dias', fmtMoeda(total + soma('receber', () => true) - soma('pagar', () => true)), 'saldo + a receber − a pagar')}
    </div>
    <div class="card"><div class="card-topo"><h3>Saldo por conta</h3><a class="pequeno" href="#/financas/extrato">Ver extrato</a></div>
      <div class="tabela-wrap"><table class="tabela"><tbody>${saldos.map((c) => `<tr class="clicavel" data-conta="${c.id}"><td><b>${esc(c.nome)}</b> <small class="muted">${TIPO_CONTA[c.tipo] || ''}</small>
        ${c.tipo === 'caixa' ? (c.sessao_aberta_id ? ' ' + tag('aberto', 'ok') : ' ' + tag('fechado', 'cinza')) : ''}</td>
        <td class="num ${Number(c.saldo_centavos) < 0 ? 'neg' : ''}"><b>${fmtMoeda(c.saldo_centavos)}</b></td></tr>`).join('')}</tbody></table></div></div>
    <div class="grade-2" style="margin-top:16px">
      <div class="card"><div class="card-topo"><h3>A receber — próximos 7 dias</h3><a class="pequeno" href="#/financas/receber">Ver todas</a></div>${tabelaTit('receber')}</div>
      <div class="card"><div class="card-topo"><h3>A pagar — próximos 7 dias</h3><a class="pequeno" href="#/financas/pagar">Ver todas</a></div>${tabelaTit('pagar')}</div>
    </div>`;
  $$('[data-novo]', el).forEach((b) => b.addEventListener('click', async () => { if (await novoTitulo(b.dataset.novo)) recarregar(el, ctx, visao); }));
  $('#b-transf', el)?.addEventListener('click', async () => { if (await transferencia()) recarregar(el, ctx, visao); });
  $$('tr[data-tit]', el).forEach((tr) => tr.addEventListener('click', async () => { if (await detalheTitulo(tr.dataset.tit)) recarregar(el, ctx, visao); }));
  $$('tr[data-conta]', el).forEach((tr) => tr.addEventListener('click', () => { extFiltro.conta = tr.dataset.conta; location.hash = '#/financas/extrato'; }));
}

// =====================================================================
// CAIXA DO DIA
// =====================================================================
export async function caixa(el, ctx) {
  const st = await rpc('caixa_status');
  if (!ctx.ativo()) return;
  const opera = pode('financeiro.caixa');
  const bancos = st.bancos || [];
  const blocos = (st.caixas || []).map((c) => {
    const aberto = !!c.sessao;
    return `<div class="card" data-cx="${c.conta_id}">
      <div class="card-topo"><h3>${esc(c.nome)} ${aberto ? tag('Aberto', 'ok') : tag('Fechado', 'cinza')}</h3>
        <span class="muted pequeno">${aberto ? `aberto por ${esc(c.sessao.aberta_por || '—')} em ${fmtDataHora(c.sessao.aberta_em)}` : ''}</span></div>
      <div class="card-pad">
        <div class="kpis" style="margin:0 0 12px">
          ${kpi('Dinheiro na gaveta (sistema)', fmtMoeda(c.saldo), aberto ? `abertura: ${fmtMoeda(c.sessao.valor_abertura)}` : '')}
          ${kpi('Entradas hoje', `<span class="pos">${fmtMoeda(c.entradas_hoje)}</span>`)}
          ${kpi('Saídas hoje', `<span class="neg">${fmtMoeda(c.saidas_hoje)}</span>`)}
        </div>
        ${opera ? `<div class="barra-acoes" style="margin:0 0 12px">${aberto
    ? `<button class="btn btn-ghost" data-acao="sangria" type="button">Sangria (retirar)</button>
             <button class="btn btn-ghost" data-acao="suprimento" type="button">Suprimento (colocar troco)</button>
             <button class="btn btn-primary" data-acao="fechar" type="button">Fechar o caixa</button>`
    : '<button class="btn btn-primary" data-acao="abrir" type="button">Abrir o caixa</button>'}</div>` : ''}
        <h4 style="margin:6px 0">Movimentos de hoje</h4>
        ${c.movimentos_hoje.length ? `<div class="tabela-wrap"><table class="tabela"><tbody>${c.movimentos_hoje.map((m) => `<tr><td class="muted" style="width:60px">${m.hora}</td><td>${esc(m.descricao)}</td>
          <td class="num ${m.tipo === 'entrada' ? 'pos' : 'neg'}">${m.tipo === 'entrada' ? '+' : '−'} ${fmtMoeda(m.valor)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted pequeno">Nenhum movimento hoje.</p>'}
        ${c.ultimos_fechamentos.length ? `<h4 style="margin:16px 0 6px">Últimos fechamentos</h4><div class="tabela-wrap"><table class="tabela"><thead><tr><th>Quando</th><th class="esconder-cel">Por</th><th class="num esconder-cel">Esperado</th><th class="num">Contado</th><th class="num">Diferença</th></tr></thead><tbody>
          ${c.ultimos_fechamentos.map((f) => `<tr><td>${fmtDataHora(f.fechada_em)}</td><td class="esconder-cel">${esc(f.por || '')}</td><td class="num esconder-cel">${fmtMoeda(f.esperado)}</td><td class="num">${fmtMoeda(f.contado)}</td>
            <td class="num ${f.diferenca < 0 ? 'neg' : f.diferenca > 0 ? 'pos' : ''}">${f.diferenca ? fmtMoedaSinal(f.diferenca) : 'certinho'}</td></tr>`).join('')}</tbody></table></div>` : ''}
      </div></div>`;
  });
  el.innerHTML = `${abas('caixa')}${cabecalho('Caixa do dia', { sub: 'Abra o caixa de manhã, registre sangrias e suprimentos e feche contando o dinheiro da gaveta.' })}
    ${blocos.length ? blocos.join('') : vazio('Nenhuma conta do tipo caixa', pode('config.gerenciar') ? 'Cadastre em Configurações › Pagamentos e contas.' : '')}`;

  $$('[data-cx]', el).forEach((card) => {
    const conta = card.dataset.cx;
    const c = st.caixas.find((x) => x.conta_id === conta);
    $$('[data-acao]', card).forEach((b) => b.addEventListener('click', async () => {
      const a = b.dataset.acao;
      let ok;
      if (a === 'abrir') {
        ok = await abrirModal({
          titulo: `Abrir ${esc(c.nome)}`, largura: 'sm', botao: 'Abrir caixa',
          corpo: `<p class="muted">Conte o dinheiro que está na gaveta agora. O sistema espera <b>${fmtMoeda(c.saldo)}</b>.</p>
            <label>Valor contado na gaveta *<input name="valor" data-mascara="dinheiro" inputmode="numeric" value="${fmtMoeda(Math.max(0, c.saldo))}" autofocus></label>
            <label>Observação<input name="obs"></label>`,
          aoSalvar: async (f) => { await rpc('abrir_caixa', { p_conta: conta, p_valor: valorDinheiro(f.valor), p_obs: f.obs.value }); return true; },
        });
        if (ok) toast('Caixa aberto');
      } else if (a === 'fechar') {
        ok = await abrirModal({
          titulo: `Fechar ${esc(c.nome)}`, largura: 'sm', botao: 'Fechar caixa',
          corpo: `<p class="muted">Conte todo o dinheiro da gaveta e digite abaixo. A diferença (sobra ou falta) fica registrada.</p>
            <label>Valor contado na gaveta *<input name="valor" data-mascara="dinheiro" inputmode="numeric" autofocus></label>
            <p class="pequeno" data-dif></p>
            <label>Observação<input name="obs" placeholder="Ex.: deixei R$ 100 de troco"></label>`,
          aoAbrir: (f) => f.valor.addEventListener('input', () => {
            const d = valorDinheiro(f.valor) - c.saldo;
            $('[data-dif]', f).innerHTML = f.valor.value ? (d === 0 ? '<span class="pos">Bateu certinho com o sistema.</span>' : `<span class="neg">${d > 0 ? 'Sobra' : 'Falta'} de ${fmtMoeda(Math.abs(d))}</span> em relação ao sistema.`) : '';
          }),
          aoSalvar: async (f) => {
            if (!f.valor.value) { f.erro('Digite o valor contado.'); return false; }
            return rpc('fechar_caixa', { p_conta: conta, p_contado: valorDinheiro(f.valor), p_obs: f.obs.value });
          },
        });
        if (ok) toast(ok.diferenca ? `Caixa fechado com ${ok.diferenca > 0 ? 'sobra' : 'falta'} de ${fmtMoeda(Math.abs(ok.diferenca))}` : 'Caixa fechado. Bateu certinho!');
      } else {
        const sang = a === 'sangria';
        ok = await abrirModal({
          titulo: sang ? 'Sangria — retirar dinheiro do caixa' : 'Suprimento — colocar dinheiro no caixa', largura: 'sm', botao: 'Registrar',
          corpo: `<label>Valor *<input name="valor" data-mascara="dinheiro" inputmode="numeric" autofocus></label>
            <label>${sang ? 'Para onde vai o dinheiro' : 'De onde vem o dinheiro'} *<select name="outra">${opcoes(bancos, '', null)}</select></label>
            <label>Descrição<input name="desc" placeholder="${sang ? 'Ex.: depósito no banco' : 'Ex.: troco do dia'}"></label>`,
          aoSalvar: async (f) => {
            const v = valorDinheiro(f.valor);
            if (!v) { f.erro('Informe o valor.'); return false; }
            if (!f.outra.value) { f.erro('Escolha a outra conta.'); return false; }
            await rpc('transferir', { p_tipo: a, p_data: hojeSP(), p_origem: sang ? conta : f.outra.value, p_destino: sang ? f.outra.value : conta, p_valor: v,
              p_descricao: f.desc.value || null });
            return true;
          },
        });
        if (ok) toast(sang ? 'Sangria registrada' : 'Suprimento registrado');
      }
      if (ok) recarregar(el, ctx, caixa);
    }));
  });
}

// =====================================================================
// CONTAS A RECEBER / A PAGAR
// =====================================================================
const filtros = { receber: { status: 'abertos', mes: '', termo: '' }, pagar: { status: 'abertos', mes: '', termo: '' } };
export const receber = (el, ctx) => listaTitulos(el, ctx, 'receber');
export const pagar = (el, ctx) => listaTitulos(el, ctx, 'pagar');

async function listaTitulos(el, ctx, tipo) {
  const f = filtros[tipo];
  const rec = tipo === 'receber';
  const meses = Array.from({ length: 18 }, (_, i) => addMeses(hojeSP().slice(0, 7) + '-01', 3 - i).slice(0, 7));
  el.innerHTML = `${abas(tipo)}
    ${cabecalho(rec ? 'Contas a receber' : 'Contas a pagar', { sub: rec ? 'Crediário, cartão a cair na conta, boletos e outros valores que a loja vai receber.' : 'Fornecedores, aluguel, contas fixas e tudo que a loja precisa pagar.',
    acoes: pode('financeiro.lancar') ? `<button class="btn btn-primary" id="b-novo" type="button">${icone('mais')} ${rec ? 'Nova conta a receber' : 'Nova conta a pagar'}</button>` : '' })}
    <div id="kpis"></div>
    <div class="card"><div class="ferramentas">
      <input class="busca" id="f-termo" type="search" placeholder="Descrição, ${rec ? 'cliente' : 'fornecedor'}…" value="${esc(f.termo)}">
      <select id="f-status">${[['abertos', 'Em aberto'], ['vencidos', 'Vencidos'], ['pagos', rec ? 'Recebidos' : 'Pagos'], ['cancelados', 'Cancelados'], ['todos', 'Todos']].map(([v, r]) => `<option value="${v}" ${f.status === v ? 'selected' : ''}>${r}</option>`).join('')}</select>
      <select id="f-mes"><option value="">Qualquer vencimento</option>${meses.map((m) => `<option value="${m}" ${f.mes === m ? 'selected' : ''}>${nomeMes(m)}</option>`).join('')}</select>
      <span style="flex:1"></span><button class="btn btn-ghost btn-sm" id="b-exp" type="button">Exportar</button>
    </div><div id="tabela">${carregando()}</div></div>`;
  let dados = [];
  const carregar = async () => {
    try {
      dados = await buscarTudo(() => {
        let q = estado.sb.from('titulos').select('*, categorias(nome), clientes(nome), fornecedores(nome)').eq('tipo', tipo);
        if (f.status === 'abertos') q = q.in('status', ['aberto', 'parcial']);
        if (f.status === 'vencidos') q = q.in('status', ['aberto', 'parcial']).lt('vencimento', hojeSP());
        if (f.status === 'pagos') q = q.eq('status', 'pago');
        if (f.status === 'cancelados') q = q.eq('status', 'cancelado');
        if (f.mes) q = q.gte('vencimento', `${f.mes}-01`).lte('vencimento', ultimoDiaMes(`${f.mes}-01`));
        return q.order('vencimento', { ascending: f.status !== 'pagos' }).order('numero');
      });
    } catch (err) { $('#tabela', el).innerHTML = vazio('Erro', esc(msgErro(err))); return; }
    if (!ctx.ativo()) return;
    const t = f.termo.trim().toLowerCase();
    if (t) dados = dados.filter((x) => [x.descricao, x.clientes?.nome, x.fornecedores?.nome, x.categorias?.nome, String(x.numero)].some((s) => (s || '').toLowerCase().includes(t)));
    const hoje = hojeSP();
    const ab = dados.filter((x) => ['aberto', 'parcial'].includes(x.status));
    $('#kpis', el).innerHTML = `<div class="kpis">
      ${kpi('Total em aberto', fmtMoeda(ab.reduce((s, x) => s + restante(x), 0)), `${ab.length} conta(s)`)}
      ${kpi('Vencido', fmtMoeda(ab.filter((x) => x.vencimento < hoje).reduce((s, x) => s + restante(x), 0)), '', ab.some((x) => x.vencimento < hoje) ? 'neg' : '')}
      ${kpi('Vence hoje', fmtMoeda(ab.filter((x) => x.vencimento === hoje).reduce((s, x) => s + restante(x), 0)))}
      ${kpi(rec ? 'Já recebido (lista)' : 'Já pago (lista)', fmtMoeda(dados.filter((x) => x.status !== 'cancelado').reduce((s, x) => s + x.pago_centavos, 0)))}</div>`;
    $('#tabela', el).innerHTML = dados.length ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Vencimento</th><th>Descrição</th><th class="esconder-cel">Categoria</th><th class="num">Valor</th><th class="num esconder-cel">Falta</th><th>Situação</th>${pode('financeiro.baixar') ? '<th></th>' : ''}</tr></thead><tbody>
      ${dados.map((x) => `<tr class="clicavel" data-id="${x.id}"><td>${fmtData(x.vencimento)}</td>
        <td><b>${esc(x.descricao)}</b>${x.parcelas > 1 ? ` <small class="muted">${x.parcela}/${x.parcelas}</small>` : ''}<div class="muted pequeno">${esc([x.clientes?.nome || x.fornecedores?.nome, x.forma_pagamento && FORMAS[x.forma_pagamento]].filter(Boolean).join(' · '))}</div></td>
        <td class="esconder-cel">${esc(x.categorias?.nome || '—')}</td><td class="num">${fmtMoeda(x.valor_centavos)}</td>
        <td class="num esconder-cel">${x.status === 'cancelado' ? '—' : fmtMoeda(restante(x))}</td><td>${statusTag(x)}</td>
        ${pode('financeiro.baixar') ? `<td class="num">${['aberto', 'parcial'].includes(x.status) ? `<button class="btn btn-ok btn-sm" type="button" data-baixar="${x.id}">${rec ? 'Receber' : 'Pagar'}</button>` : ''}</td>` : ''}</tr>`).join('')}
      </tbody></table></div><div class="rodape-tabela"><span>${dados.length} conta(s)</span></div>` : vazio('Nenhuma conta aqui', f.status === 'abertos' ? 'Tudo em dia.' : '');
    $$('tr[data-id]', el).forEach((tr) => tr.addEventListener('click', async (e) => {
      if (e.target.closest('[data-baixar]')) return;
      if (await detalheTitulo(tr.dataset.id)) carregar();
    }));
    $$('[data-baixar]', el).forEach((b) => b.addEventListener('click', async () => {
      if (await baixar(dados.find((x) => x.id === b.dataset.baixar))) { carregar(); atualizarAvisos(); }
    }));
  };
  let tm; $('#f-termo', el).addEventListener('input', (e) => { clearTimeout(tm); tm = setTimeout(() => { f.termo = e.target.value; carregar(); }, 250); });
  $('#f-status', el).addEventListener('change', (e) => { f.status = e.target.value; carregar(); });
  $('#f-mes', el).addEventListener('change', (e) => { f.mes = e.target.value; carregar(); });
  $('#b-novo', el)?.addEventListener('click', async () => { if (await novoTitulo(tipo)) carregar(); });
  $('#b-exp', el).addEventListener('click', () => baixarCsv(`contas-a-${tipo}-${hojeSP()}.csv`,
    ['Nº', 'Vencimento', 'Competência', 'Descrição', 'Parcela', rec ? 'Cliente' : 'Fornecedor', 'Categoria', 'Forma', 'Valor', 'Pago', 'Situação'],
    dados.map((x) => [x.numero, fmtData(x.vencimento), fmtData(x.competencia), x.descricao, `${x.parcela}/${x.parcelas}`, x.clientes?.nome || x.fornecedores?.nome || '',
      x.categorias?.nome || '', FORMAS[x.forma_pagamento] || '', csvMoeda(x.valor_centavos), csvMoeda(x.pago_centavos), ST_TIT[x.status]?.[0] || x.status])));
  carregar();
}

// Novo título (com parcelamento) — também usado no "+ Novo"
export async function novoTitulo(tipo = 'pagar') {
  const rec = tipo === 'receber';
  const [cats, contas, formas, forns] = await Promise.all([listaCache('categorias'), contasAtivas(), listaCache('formas'), rec ? [] : listaCache('fornecedores')]);
  const catsT = cats.filter((c) => c.tipo === (rec ? 'receita' : 'despesa') && c.ativo !== false && !['taxa_cartao', 'devolucao', 'quebra_caixa', 'vendas'].includes(c.sistema));
  let cliente = null;
  const r = await abrirModal({
    titulo: rec ? 'Nova conta a receber' : 'Nova conta a pagar', largura: 'lg', botao: 'Salvar',
    corpo: `<div class="form-grade">
      <label class="col-2">Descrição *<input name="descricao" required placeholder="${rec ? 'Ex.: Conserto pago em 2x, venda no crediário…' : 'Ex.: Aluguel, conta de luz, fornecedor X…'}"></label>
      <label>Categoria *<select name="categoria_id"><option value="">Escolha…</option>${opcoes(catsT, '', null)}</select></label>
      ${rec ? `<label>Cliente<div class="linha"><input name="cliente_nome" readonly placeholder="(opcional)"><button class="btn btn-ghost btn-sm estreito" type="button" data-cli style="flex:0 0 auto">Escolher</button></div></label>`
    : `<label>Fornecedor<select name="fornecedor_id"><option value="">(nenhum)</option>${opcoes(forns.filter((x) => x.ativo !== false), '', null)}</select></label>`}
      <label>Valor total *<input name="valor" data-mascara="dinheiro" inputmode="numeric"></label>
      <label>Forma de pagamento<select name="forma"><option value="">—</option>${formas.filter((x) => x.ativo && !x.interna).map((x) => `<option value="${x.forma}">${esc(x.nome)}</option>`).join('')}</select></label>
      <label>Primeiro vencimento *<input name="venc" type="date" value="${hojeSP()}"></label>
      <label>Parcelas<select name="nparc">${Array.from({ length: 24 }, (_, i) => `<option value="${i + 1}">${i + 1}x${i ? ' (mensal)' : ''}</option>`).join('')}</select></label>
      <label>Competência <span class="dica-campo muted">(mês a que a despesa se refere — usado no DRE)</span><input name="competencia" type="month" value="${hojeSP().slice(0, 7)}"></label>
      <label>Conta prevista<select name="conta"><option value="">—</option>${opcoes(contas, '', null)}</select></label>
      <div class="col-2" data-prev></div>
      ${pode('financeiro.baixar') ? `<label class="check col-2"><input type="checkbox" name="pago"> ${rec ? 'Já recebi' : 'Já paguei'} (dá baixa agora na conta escolhida acima)</label>` : ''}
      <label class="col-2">Observação<textarea name="obs" rows="2"></textarea></label>
    </div>`,
    aoAbrir: (f) => {
      const prev = () => {
        const n = Number(f.nparc.value); const v = valorDinheiro(f.valor);
        if (n < 2 || !v || !f.venc.value) { $('[data-prev]', f).innerHTML = ''; return; }
        const base = Math.floor(v / n);
        $('[data-prev]', f).innerHTML = `<p class="muted pequeno">${Array.from({ length: n }, (_, i) => `${i + 1}ª ${fmtData(addVenc(f.venc.value, i))}: ${fmtMoeda(i === n - 1 ? v - base * (n - 1) : base)}`).join(' · ')}</p>`;
      };
      ['input', 'change'].forEach((ev) => f.addEventListener(ev, prev));
      $('[data-cli]', f)?.addEventListener('click', async () => {
        const c = await (await import('./clientes.js')).escolherCliente();
        if (c) { cliente = c; f.cliente_nome.value = c.nome; }
      });
      if (f.pago) f.pago.addEventListener('change', () => { if (f.pago.checked && !f.conta.value) f.conta.value = contas[0]?.id || ''; });
    },
    aoSalvar: async (f) => {
      const v = valorDinheiro(f.valor); const n = Number(f.nparc.value);
      if (f.descricao.value.trim().length < 2) { f.erro('Escreva a descrição.'); return false; }
      if (!f.categoria_id.value) { f.erro('Escolha a categoria.'); return false; }
      if (!v) { f.erro('Informe o valor.'); return false; }
      if (!f.venc.value) { f.erro('Informe o vencimento.'); return false; }
      if (f.pago?.checked && !f.conta.value) { f.erro('Escolha a conta onde o dinheiro entrou/saiu.'); return false; }
      if (f.pago?.checked && f.venc.value > hojeSP() && n === 1) { f.erro('Se já foi pago, o vencimento não pode ser no futuro.'); return false; }
      const base = Math.floor(v / n);
      const parcelas = Array.from({ length: n }, (_, i) => ({ vencimento: addVenc(f.venc.value, i), valor_centavos: i === n - 1 ? v - base * (n - 1) : base }));
      const ids = await rpc('salvar_titulo', { p: {
        tipo, descricao: f.descricao.value.trim(), categoria_id: f.categoria_id.value, cliente_id: cliente?.id || null, fornecedor_id: f.fornecedor_id?.value || null,
        forma_pagamento: f.forma.value || null, conta_prevista_id: f.conta.value || null, competencia: n === 1 && f.competencia.value ? `${f.competencia.value}-01` : null,
        observacao: f.obs.value, parcelas, pago: f.pago?.checked ? { conta_id: f.conta.value, data: hojeSP() } : null,
      } });
      return ids?.length ? ids : true;
    },
  });
  if (r) { toast(rec ? 'Conta a receber lançada' : 'Conta a pagar lançada'); atualizarAvisos(); }
  return r;
}
// mesmo dia nos meses seguintes (31 → último dia do mês)
function addVenc(iso, meses) {
  if (!meses) return iso;
  const dia = Number(iso.slice(8, 10));
  const primeiro = addMeses(iso.slice(0, 7) + '-01', meses);
  const ult = ultimoDiaMes(primeiro);
  return `${primeiro.slice(0, 8)}${String(Math.min(dia, Number(ult.slice(8, 10)))).padStart(2, '0')}`;
}

// Detalhe do título com baixas, estorno, edição e cancelamento
async function detalheTitulo(id) {
  const [t, baixas, contas] = await Promise.all([
    consulta(estado.sb.from('titulos').select('*, categorias(nome), clientes(nome), fornecedores(nome)').eq('id', id).single()),
    consulta(estado.sb.from('baixas').select('*').eq('titulo_id', id).order('criado_em')),
    listaCache('contas'),
  ]);
  const nomeConta = (cid) => contas.find((c) => c.id === cid)?.nome || '—';
  const rec = t.tipo === 'receber';
  const aberto = ['aberto', 'parcial'].includes(t.status);
  const origem = t.venda_id ? `<a href="#/vendas/${t.venda_id}">Ver a venda</a>` : t.entrada_id ? `<a href="#/estoque/entradas/${t.entrada_id}">Ver a entrada de mercadoria</a>` : t.recorrencia_id ? 'Despesa fixa' : '';
  const manual = !t.venda_id && !t.entrada_id && !t.os_id;
  let mudou = false;
  await abrirModal({
    titulo: `${rec ? 'Conta a receber' : 'Conta a pagar'} nº ${t.numero}`, largura: 'lg', botao: null, cancelar: 'Fechar',
    corpo: `<div class="grade-2" style="gap:12px"><dl class="dl">
        <div><dt>Descrição</dt><dd><b>${esc(t.descricao)}</b>${t.parcelas > 1 ? ` — parcela ${t.parcela} de ${t.parcelas}` : ''}</dd></div>
        <div><dt>${rec ? 'Cliente' : 'Fornecedor'}</dt><dd>${esc(t.clientes?.nome || t.fornecedores?.nome || '—')}</dd></div>
        <div><dt>Categoria</dt><dd>${esc(t.categorias?.nome || '—')}</dd></div>
        ${origem ? `<div><dt>Origem</dt><dd>${origem}</dd></div>` : ''}
        ${t.observacao ? `<div><dt>Observação</dt><dd>${esc(t.observacao)}</dd></div>` : ''}
      </dl><dl class="dl">
        <div><dt>Situação</dt><dd>${statusTag(t)}${t.motivo_cancelamento ? ` <small class="muted">${esc(t.motivo_cancelamento)}</small>` : ''}</dd></div>
        <div><dt>Vencimento · competência</dt><dd>${fmtData(t.vencimento)} · ${nomeMes(t.competencia.slice(0, 7))}</dd></div>
        <div><dt>Valor · pago · falta</dt><dd>${fmtMoeda(t.valor_centavos)} · ${fmtMoeda(t.pago_centavos)} · <b>${fmtMoeda(t.status === 'cancelado' ? 0 : restante(t))}</b></dd></div>
        <div><dt>Forma · conta prevista</dt><dd>${esc(FORMAS[t.forma_pagamento] || '—')} · ${esc(nomeConta(t.conta_prevista_id))}${t.taxa_prevista_centavos ? ` <small class="muted">(taxa prevista ${fmtMoeda(t.taxa_prevista_centavos)})</small>` : ''}</dd></div>
      </dl></div>
      <h4 style="margin:16px 0 6px">${rec ? 'Recebimentos' : 'Pagamentos'}</h4>
      ${baixas.length ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Data</th><th>Conta</th><th class="num">Valor</th><th class="num esconder-cel">Juros/multa</th><th class="num esconder-cel">Desc./taxa</th><th></th></tr></thead><tbody>
        ${baixas.map((b) => `<tr class="${b.estornada ? 'muted' : ''}"><td>${fmtData(b.data)}${b.automatica ? ' <small class="muted">auto</small>' : ''}</td><td>${esc(nomeConta(b.conta_id))}</td>
          <td class="num">${b.estornada ? `<s>${fmtMoeda(b.valor_centavos)}</s>` : fmtMoeda(b.valor_centavos)}</td>
          <td class="num esconder-cel">${fmtMoeda(b.juros_centavos + b.multa_centavos)}</td><td class="num esconder-cel">${fmtMoeda(b.desconto_centavos)} / ${fmtMoeda(b.taxa_centavos)}</td>
          <td class="num">${b.estornada ? tag('Estornado', 'cinza') : (pode('financeiro.baixar') && t.status !== 'cancelado' ? `<button class="btn btn-ghost btn-sm" type="button" data-estornar="${b.id}">Estornar</button>` : '')}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted pequeno">Nenhum ainda.</p>'}
      <div class="barra-acoes" style="margin-top:16px">
        ${aberto && pode('financeiro.baixar') ? `<button class="btn btn-ok" type="button" data-a="baixar">${rec ? 'Registrar recebimento' : 'Registrar pagamento'}</button>` : ''}
        ${t.status === 'aberto' && !t.pago_centavos && manual && pode('financeiro.lancar') ? '<button class="btn btn-ghost" type="button" data-a="editar">Editar</button>' : ''}
        ${aberto && manual && pode('financeiro.lancar') ? '<button class="btn btn-ghost" type="button" data-a="cancelar" style="color:var(--danger)">Cancelar conta</button>' : ''}
      </div>`,
    aoAbrir: (f) => {
      $$('[data-a]', f).forEach((b) => b.addEventListener('click', async () => {
        const a = b.dataset.a; let ok = false;
        try {
          if (a === 'baixar') ok = await baixar(t);
          if (a === 'editar') ok = await editarTitulo(t);
          if (a === 'cancelar') {
            const m = await pedirMotivo({ titulo: 'Cancelar esta conta?', texto: t.pago_centavos ? 'Os pagamentos já feitos serão estornados.' : '' });
            if (m) { await rpc('cancelar_titulo', { p_titulo: t.id, p_motivo: m }); toast('Conta cancelada'); ok = true; }
          }
        } catch (err) { toast(msgErro(err), 'erro'); }
        if (ok) { mudou = true; atualizarAvisos(); f.fechar(true); }
      }));
      $$('[data-estornar]', f).forEach((b) => b.addEventListener('click', async () => {
        const m = await pedirMotivo({ titulo: 'Estornar este pagamento?', texto: 'O valor volta a ficar em aberto e o dinheiro sai/volta da conta no extrato.', botao: 'Estornar' });
        if (!m) return;
        try { await rpc('estornar_baixa', { p_baixa: b.dataset.estornar, p_motivo: m }); toast('Estornado'); mudou = true; atualizarAvisos(); f.fechar(true); } catch (err) { toast(msgErro(err), 'erro'); }
      }));
    },
  });
  return mudou;
}

async function baixar(t) {
  const rec = t.tipo === 'receber';
  const contas = await contasAtivas();
  const falta = restante(t);
  const contaPadrao = t.conta_prevista_id || contas.find((c) => c.tipo === (rec ? 'caixa' : 'banco'))?.id || contas[0]?.id;
  const r = await abrirModal({
    titulo: rec ? 'Registrar recebimento' : 'Registrar pagamento', largura: 'md', botao: rec ? 'Confirmar recebimento' : 'Confirmar pagamento', botaoClasse: 'btn-ok',
    corpo: `<p><b>${esc(t.descricao)}</b>${t.parcelas > 1 ? ` (${t.parcela}/${t.parcelas})` : ''} — falta <b>${fmtMoeda(falta)}</b></p>
      <div class="form-grade">
        <label>Data *<input name="data" type="date" value="${hojeSP()}" max="${hojeSP()}"></label>
        <label>${rec ? 'Entrou na conta' : 'Saiu da conta'} *<select name="conta">${opcoes(contas, contaPadrao, null)}</select></label>
        <label>Valor ${rec ? 'recebido' : 'pago'} (principal) *<input name="valor" data-mascara="dinheiro" inputmode="numeric" value="${fmtMoeda(falta)}"></label>
        <label>Desconto concedido<input name="desconto" data-mascara="dinheiro" inputmode="numeric"></label>
        <label>Juros<input name="juros" data-mascara="dinheiro" inputmode="numeric"></label>
        <label>Multa<input name="multa" data-mascara="dinheiro" inputmode="numeric"></label>
        ${rec ? '<label>Taxa descontada (cartão/banco)<input name="taxa" data-mascara="dinheiro" inputmode="numeric"></label>' : ''}
      </div><p class="muted pequeno" data-tot></p>`,
    aoAbrir: (f) => {
      const upd = () => {
        const v = valorDinheiro(f.valor); const d = valorDinheiro(f.desconto);
        const mov = v + valorDinheiro(f.juros) + valorDinheiro(f.multa) - (f.taxa ? valorDinheiro(f.taxa) : 0);
        const resta = falta - v - d;
        $('[data-tot]', f).innerHTML = `Movimenta <b>${fmtMoeda(mov)}</b> na conta. ${resta > 0 ? `Continua faltando ${fmtMoeda(resta)} (pagamento parcial).` : resta < 0 ? '<span class="neg">Valor + desconto passa do que falta.</span>' : 'A conta fica quitada.'}`;
      };
      f.addEventListener('input', upd); upd();
    },
    aoSalvar: async (f) => {
      const v = valorDinheiro(f.valor); const d = valorDinheiro(f.desconto);
      if (!v && !d) { f.erro('Informe o valor.'); return false; }
      if (v + d > falta) { f.erro('Valor + desconto passa do que falta.'); return false; }
      if (!f.data.value || f.data.value > hojeSP()) { f.erro('A data não pode ser no futuro.'); return false; }
      await rpc('baixar_titulo', { p_titulo: t.id, p_data: f.data.value, p_conta: f.conta.value, p_valor: v, p_juros: valorDinheiro(f.juros), p_multa: valorDinheiro(f.multa),
        p_desconto: d, p_taxa: f.taxa ? valorDinheiro(f.taxa) : 0 });
      return true;
    },
  });
  if (r) toast(rec ? 'Recebimento registrado' : 'Pagamento registrado');
  return r;
}

async function editarTitulo(t) {
  const rec = t.tipo === 'receber';
  const [cats, forns, formas] = await Promise.all([listaCache('categorias'), rec ? [] : listaCache('fornecedores'), listaCache('formas')]);
  const catsT = cats.filter((c) => c.tipo === (rec ? 'receita' : 'despesa') && (c.ativo !== false || c.id === t.categoria_id));
  return abrirModal({
    titulo: 'Editar conta', largura: 'md',
    corpo: `<div class="form-grade">
      <label class="col-2">Descrição *<input name="descricao" value="${esc(t.descricao)}"></label>
      <label>Categoria<select name="categoria_id">${opcoes(catsT, t.categoria_id, null)}</select></label>
      ${rec ? '' : `<label>Fornecedor<select name="fornecedor_id"><option value="">(nenhum)</option>${opcoes(forns, t.fornecedor_id, null)}</select></label>`}
      <label>Valor *<input name="valor" data-mascara="dinheiro" inputmode="numeric" value="${fmtMoeda(t.valor_centavos)}"></label>
      <label>Vencimento *<input name="venc" type="date" value="${t.vencimento}"></label>
      <label>Competência<input name="competencia" type="month" value="${t.competencia.slice(0, 7)}"></label>
      <label>Forma<select name="forma"><option value="">—</option>${formas.filter((x) => !x.interna || x.forma === t.forma_pagamento).map((x) => `<option value="${x.forma}" ${x.forma === t.forma_pagamento ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select></label>
      <label class="col-2">Observação<textarea name="obs" rows="2">${esc(t.observacao)}</textarea></label></div>`,
    aoSalvar: async (f) => {
      if (!valorDinheiro(f.valor)) { f.erro('Informe o valor.'); return false; }
      const p = { descricao: f.descricao.value, categoria_id: f.categoria_id.value, valor_centavos: valorDinheiro(f.valor), vencimento: f.venc.value,
        competencia: f.competencia.value ? `${f.competencia.value}-01` : '', forma_pagamento: f.forma.value, observacao: f.obs.value };
      if (!rec) p.fornecedor_id = f.fornecedor_id.value;
      await rpc('editar_titulo', { p_id: t.id, p });
      toast('Conta atualizada');
      return true;
    },
  });
}

async function transferencia() {
  const contas = await contasAtivas();
  return abrirModal({
    titulo: 'Transferir entre contas', largura: 'sm', botao: 'Transferir',
    corpo: `<label>De *<select name="origem">${opcoes(contas, contas[0]?.id, null)}</select></label>
      <label>Para *<select name="destino">${opcoes(contas, contas[1]?.id, null)}</select></label>
      <label>Valor *<input name="valor" data-mascara="dinheiro" inputmode="numeric"></label>
      <label>Data *<input name="data" type="date" value="${hojeSP()}" max="${hojeSP()}"></label>
      <label>Descrição<input name="desc" placeholder="Ex.: depósito do dinheiro do caixa"></label>`,
    aoSalvar: async (f) => {
      if (f.origem.value === f.destino.value) { f.erro('Escolha contas diferentes.'); return false; }
      if (!valorDinheiro(f.valor)) { f.erro('Informe o valor.'); return false; }
      await rpc('transferir', { p_tipo: 'transferencia', p_data: f.data.value, p_origem: f.origem.value, p_destino: f.destino.value, p_valor: valorDinheiro(f.valor), p_descricao: f.desc.value || null });
      toast('Transferência registrada');
      return true;
    },
  });
}

// =====================================================================
// EXTRATO
// =====================================================================
const extFiltro = { conta: '', mes: '' };
export async function extrato(el, ctx) {
  const contas = await listaCache('contas');
  if (!ctx.ativo()) return;
  if (!extFiltro.conta || !contas.some((c) => c.id === extFiltro.conta)) extFiltro.conta = contas[0]?.id || '';
  if (!extFiltro.mes) extFiltro.mes = hojeSP().slice(0, 7);
  const meses = Array.from({ length: 24 }, (_, i) => addMeses(hojeSP().slice(0, 7) + '-01', -i).slice(0, 7));
  el.innerHTML = `${abas('extrato')}${cabecalho('Extrato das contas', { sub: 'Tudo o que entrou e saiu de cada conta, com o saldo dia a dia.',
    acoes: pode('financeiro.baixar') ? '<button class="btn btn-ghost" id="b-transf" type="button">Transferir entre contas</button>' : '' })}
    <div class="card"><div class="ferramentas">
      <select id="f-conta">${opcoes(contas, extFiltro.conta, null)}</select>
      <select id="f-mes">${meses.map((m) => `<option value="${m}" ${m === extFiltro.mes ? 'selected' : ''}>${nomeMes(m)}</option>`).join('')}</select>
      <span style="flex:1"></span><button class="btn btn-ghost btn-sm" id="b-exp" type="button">Exportar</button>
    </div><div id="kpis"></div><div id="tabela">${carregando()}</div></div>`;
  let linhas = [];
  const carregar = async () => {
    const conta = contas.find((c) => c.id === extFiltro.conta);
    if (!conta) { $('#tabela', el).innerHTML = vazio('Nenhuma conta cadastrada'); return; }
    const ini = `${extFiltro.mes}-01`; const fim = ultimoDiaMes(ini);
    let movs; let antes;
    try {
      [movs, antes] = await Promise.all([
        buscarTudo(() => estado.sb.from('movimentos_financeiros').select('*, categorias(nome)').eq('conta_id', conta.id).gte('data', ini).lte('data', fim).order('data').order('id')),
        buscarTudo(() => estado.sb.from('movimentos_financeiros').select('tipo,valor_centavos').eq('conta_id', conta.id).lt('data', ini)),
      ]);
    } catch (err) { $('#tabela', el).innerHTML = vazio('Erro', esc(msgErro(err))); return; }
    if (!ctx.ativo()) return;
    const sinal = (m) => (m.tipo === 'entrada' ? 1 : -1) * Number(m.valor_centavos);
    const saldoIni = Number(conta.saldo_inicial_centavos) + antes.reduce((s, m) => s + sinal(m), 0);
    let saldo = saldoIni;
    linhas = movs.map((m) => { saldo += sinal(m); return { ...m, saldo }; });
    const ent = movs.filter((m) => m.tipo === 'entrada').reduce((s, m) => s + Number(m.valor_centavos), 0);
    const sai = movs.filter((m) => m.tipo === 'saida').reduce((s, m) => s + Number(m.valor_centavos), 0);
    $('#kpis', el).innerHTML = `<div class="kpis" style="padding:0 14px">${kpi('Saldo no início do mês', fmtMoeda(saldoIni))}${kpi('Entradas', `<span class="pos">${fmtMoeda(ent)}</span>`)}
      ${kpi('Saídas', `<span class="neg">${fmtMoeda(sai)}</span>`)}${kpi('Saldo no fim do período', fmtMoeda(saldo), '', saldo < 0 ? 'neg' : '')}</div>`;
    $('#tabela', el).innerHTML = linhas.length ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Data</th><th>Descrição</th><th class="esconder-cel">Categoria</th><th class="num">Valor</th><th class="num">Saldo</th></tr></thead><tbody>
      ${linhas.map((m) => `<tr><td>${fmtData(m.data)}</td><td>${esc(m.descricao)}<div class="muted pequeno">${ORIGEM_MOV[m.origem] || ''}</div></td><td class="esconder-cel">${esc(m.categorias?.nome || '—')}</td>
        <td class="num ${m.tipo === 'entrada' ? 'pos' : 'neg'}">${m.tipo === 'entrada' ? '+' : '−'} ${fmtMoeda(m.valor_centavos)}</td><td class="num ${m.saldo < 0 ? 'neg' : ''}">${fmtMoeda(m.saldo)}</td></tr>`).join('')}
      </tbody></table></div>` : vazio('Nenhum movimento neste mês', '');
  };
  $('#f-conta', el).addEventListener('change', (e) => { extFiltro.conta = e.target.value; carregar(); });
  $('#f-mes', el).addEventListener('change', (e) => { extFiltro.mes = e.target.value; carregar(); });
  $('#b-transf', el)?.addEventListener('click', async () => { if (await transferencia()) carregar(); });
  $('#b-exp', el).addEventListener('click', () => baixarCsv(`extrato-${extFiltro.mes}.csv`, ['Data', 'Descrição', 'Categoria', 'Tipo', 'Valor', 'Saldo'],
    linhas.map((m) => [fmtData(m.data), m.descricao, m.categorias?.nome || '', m.tipo === 'entrada' ? 'Entrada' : 'Saída', csvMoeda(m.valor_centavos), csvMoeda(m.saldo)])));
  carregar();
}

// =====================================================================
// DESPESAS FIXAS (recorrências)
// =====================================================================
export async function fixas(el, ctx) {
  const [rec, cats, forns] = await Promise.all([
    consulta(estado.sb.from('recorrencias').select('*, categorias(nome), fornecedores(nome)').order('ativo', { ascending: false }).order('dia_vencimento')),
    listaCache('categorias'), listaCache('fornecedores'),
  ]);
  if (!ctx.ativo()) return;
  const ativas = rec.filter((r) => r.ativo && (!r.fim || r.fim >= hojeSP()));
  const mensal = (r) => (r.frequencia === 'semanal' ? Math.round(r.valor_centavos * 52 / 12) : r.frequencia === 'anual' ? Math.round(r.valor_centavos / 12) : r.valor_centavos);
  el.innerHTML = `${abas('fixas')}${cabecalho('Despesas fixas', { sub: 'Aluguel, internet, salários… Cadastre uma vez e o sistema cria as contas a pagar sozinho (até 60 dias à frente).',
    acoes: pode('financeiro.lancar') ? `<button class="btn btn-primary" id="b-novo" type="button">${icone('mais')} Nova despesa fixa</button>` : '' })}
    <div class="kpis">${kpi('Despesas fixas ativas', ativas.filter((r) => r.tipo === 'pagar').length)}${kpi('Custo fixo por mês', fmtMoeda(ativas.filter((r) => r.tipo === 'pagar').reduce((s, r) => s + mensal(r), 0)), 'média mensal')}</div>
    <div class="card">${rec.length ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Descrição</th><th class="esconder-cel">Categoria</th><th>Quando</th><th class="num">Valor</th><th></th></tr></thead><tbody>
      ${rec.map((r) => `<tr class="clicavel" data-id="${r.id}"><td><b>${esc(r.descricao)}</b>${r.tipo === 'receber' ? ' ' + tag('a receber') : ''}<div class="muted pequeno">${esc(r.fornecedores?.nome || '')}</div></td>
        <td class="esconder-cel">${esc(r.categorias?.nome || '')}</td><td>${FREQ[r.frequencia]}${r.frequencia !== 'semanal' ? `, dia ${r.dia_vencimento}` : ''}<div class="muted pequeno">desde ${fmtData(r.inicio)}${r.fim ? ` até ${fmtData(r.fim)}` : ''}</div></td>
        <td class="num">${fmtMoeda(r.valor_centavos)}</td><td>${r.ativo && (!r.fim || r.fim >= hojeSP()) ? tag('Ativa', 'ok') : tag('Encerrada', 'cinza')}</td></tr>`).join('')}
      </tbody></table></div>` : vazio('Nenhuma despesa fixa', 'Cadastre aluguel, luz, internet, salários…')}</div>`;
  const form = async (r) => {
    const tipoSel = r?.tipo || 'pagar';
    const ok = await abrirModal({
      titulo: r ? 'Editar despesa fixa' : 'Nova despesa fixa', largura: 'md',
      corpo: `<div class="form-grade">
        <label class="col-2">Descrição *<input name="descricao" value="${esc(r?.descricao)}" placeholder="Ex.: Aluguel da loja"></label>
        ${r ? '' : '<label>Tipo<select name="tipo"><option value="pagar">A pagar (despesa)</option><option value="receber">A receber (receita)</option></select></label>'}
        <label>Categoria *<select name="categoria_id"></select></label>
        <label>Fornecedor<select name="fornecedor_id"><option value="">(nenhum)</option>${opcoes(forns, r?.fornecedor_id, null)}</select></label>
        <label>Valor *<input name="valor" data-mascara="dinheiro" inputmode="numeric" value="${r ? fmtMoeda(r.valor_centavos) : ''}"></label>
        <label>Frequência<select name="frequencia">${Object.entries(FREQ).map(([k, v]) => `<option value="${k}" ${(r?.frequencia || 'mensal') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Dia do vencimento<input name="dia" type="number" min="1" max="31" value="${r?.dia_vencimento || 10}"></label>
        <label>Começa em *<input name="inicio" type="date" value="${r?.inicio || hojeSP()}" ${r ? 'disabled' : ''}></label>
        <label>Termina em <span class="dica-campo muted">(vazio = sem fim)</span><input name="fim" type="date" value="${r?.fim || ''}"></label>
        ${r ? `<label class="check col-2"><input type="checkbox" name="ativo" ${r.ativo ? 'checked' : ''}> Ativa (desmarque para encerrar — as próximas contas em aberto são canceladas)</label>` : ''}
      </div>`,
      aoAbrir: (f) => {
        const upd = () => {
          const tp = f.tipo ? f.tipo.value : tipoSel;
          f.categoria_id.innerHTML = opcoes(cats.filter((c) => c.tipo === (tp === 'receber' ? 'receita' : 'despesa') && (c.ativo !== false || c.id === r?.categoria_id)), r?.categoria_id, 'Escolha…');
        };
        f.tipo?.addEventListener('change', upd); upd();
      },
      aoSalvar: async (f) => {
        if (f.descricao.value.trim().length < 2) { f.erro('Escreva a descrição.'); return false; }
        if (!f.categoria_id.value) { f.erro('Escolha a categoria.'); return false; }
        if (!valorDinheiro(f.valor)) { f.erro('Informe o valor.'); return false; }
        const d = Number(f.dia.value); if (!(d >= 1 && d <= 31)) { f.erro('Dia do vencimento entre 1 e 31.'); return false; }
        await rpc('salvar_recorrencia', { p: { id: r?.id || null, tipo: f.tipo ? f.tipo.value : tipoSel, descricao: f.descricao.value.trim(), categoria_id: f.categoria_id.value,
          fornecedor_id: f.fornecedor_id.value || null, valor_centavos: valorDinheiro(f.valor), frequencia: f.frequencia.value, dia_vencimento: d,
          inicio: r?.inicio || f.inicio.value, fim: f.fim.value || null, ativo: f.ativo ? f.ativo.checked : true } });
        return true;
      },
    });
    if (ok) { toast('Despesa fixa salva — as próximas contas já estão em Contas a pagar'); recarregar(el, ctx, fixas); }
  };
  $('#b-novo', el)?.addEventListener('click', () => form(null));
  $$('tr[data-id]', el).forEach((tr) => tr.addEventListener('click', () => { if (pode('financeiro.lancar')) form(rec.find((r) => r.id === tr.dataset.id)); }));
}

// =====================================================================
// FLUXO DE CAIXA
// =====================================================================
let fluxoDias = 30;
export async function fluxo(el, ctx) {
  const dados = await rpc('fluxo_caixa', { p_dias: fluxoDias });
  if (!ctx.ativo()) return;
  const saldoHoje = dados.length ? dados[0].saldo - dados[0].entradas + dados[0].saidas : 0;
  const minimo = dados.reduce((m, d) => (d.saldo < m.saldo ? d : m), dados[0] || { saldo: 0 });
  const totE = dados.reduce((s, d) => s + d.entradas, 0); const totS = dados.reduce((s, d) => s + d.saidas, 0);
  const maxAbs = Math.max(1, ...dados.map((d) => Math.abs(d.saldo)));
  const temNeg = dados.some((d) => d.saldo < 0);
  const final = dados[dados.length - 1]?.saldo || 0;
  el.innerHTML = `${abas('fluxo')}${cabecalho('Fluxo de caixa', { sub: 'Saldo de hoje + o que está previsto para entrar e sair. Contas atrasadas aparecem no dia de hoje.' })}
    <div class="ferramentas" style="margin-bottom:12px"><select id="f-dias" style="width:auto">${[15, 30, 60, 90].map((d) => `<option value="${d}" ${d === fluxoDias ? 'selected' : ''}>Próximos ${d} dias</option>`).join('')}</select></div>
    <div class="kpis">${kpi('Saldo hoje', fmtMoeda(saldoHoje))}${kpi('Vai entrar', `<span class="pos">${fmtMoeda(totE)}</span>`, 'já descontando taxas de cartão')}
      ${kpi('Vai sair', `<span class="neg">${fmtMoeda(totS)}</span>`)}${kpi(`Saldo previsto em ${fluxoDias} dias`, fmtMoeda(final), '', final < 0 ? 'neg' : '')}</div>
    ${minimo && minimo.saldo < 0 ? `<div class="alerta">${icone('alerta')}<span><b>Atenção:</b> o saldo fica negativo em ${fmtData(minimo.dia)} (${fmtMoeda(minimo.saldo)}). Antecipe recebimentos ou renegocie pagamentos.</span></div>` : ''}
    <div class="card grafico" style="margin:16px 0">
      <div class="grafico-legenda"><span><i style="background:var(--primary)"></i>Saldo previsto</span>${temNeg ? '<span><i style="background:var(--danger)"></i>Negativo</span>' : ''}</div>
      <div class="grafico-area" role="img" aria-label="Saldo previsto por dia">${dados.map((d) => `<div class="grafico-col" data-i="${d.dia}" data-e="${d.entradas}" data-s="${d.saidas}" data-sal="${d.saldo}">
        <div class="b" style="height:${Math.max(1, (Math.abs(d.saldo) / maxAbs) * 100)}%;background:${d.saldo < 0 ? 'var(--danger)' : 'var(--primary)'}"></div></div>`).join('')}</div>
      <div class="grafico-rotulos">${dados.map((d, i) => `<span>${(i % Math.ceil(dados.length / 10) === 0) ? fmtData(d.dia).slice(0, 5) : ''}</span>`).join('')}</div>
    </div>
    <div class="card"><div class="card-topo"><h3>Dias com movimento previsto</h3></div>
      ${dados.some((d) => d.entradas || d.saidas) ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Dia</th><th class="num">Entradas</th><th class="num">Saídas</th><th class="num">Saldo</th></tr></thead><tbody>
      ${dados.filter((d) => d.entradas || d.saidas).map((d) => `<tr><td>${fmtData(d.dia)}${d.dia === hojeSP() ? ' <small class="muted">(hoje + atrasados)</small>' : ''}</td><td class="num pos">${d.entradas ? fmtMoeda(d.entradas) : ''}</td>
        <td class="num neg">${d.saidas ? fmtMoeda(d.saidas) : ''}</td><td class="num ${d.saldo < 0 ? 'neg' : ''}"><b>${fmtMoeda(d.saldo)}</b></td></tr>`).join('')}</tbody></table></div>` : vazio('Nada previsto', 'Nenhuma conta a pagar ou receber no período.')}</div>`;
  $('#f-dias', el).addEventListener('change', (e) => { fluxoDias = Number(e.target.value); fluxo(el, ctx); });
  const { dicaGrafico } = await import('./inicio.js');
  dicaGrafico(el, (c) => `<b>${fmtData(c.dataset.i)}</b><div class="linha-d"><span>Entra</span><span>${fmtMoeda(Number(c.dataset.e))}</span></div>
    <div class="linha-d"><span>Sai</span><span>${fmtMoeda(Number(c.dataset.s))}</span></div><div class="linha-d"><span>Saldo</span><span>${fmtMoeda(Number(c.dataset.sal))}</span></div>`);
}

// =====================================================================
// DRE (resultado do mês)
// =====================================================================
const dreF = { mes: '' };
export async function dre(el, ctx) {
  if (!dreF.mes) dreF.mes = hojeSP().slice(0, 7);
  const ini = `${dreF.mes}-01`; const fim = ultimoDiaMes(ini);
  const iniAnt = addMeses(ini, -1);
  const [d, ant] = await Promise.all([rpc('dre', { p_inicio: ini, p_fim: fim }), rpc('dre', { p_inicio: iniAnt, p_fim: ultimoDiaMes(iniAnt) })]);
  if (!ctx.ativo()) return;
  const meses = Array.from({ length: 24 }, (_, i) => addMeses(hojeSP().slice(0, 7) + '-01', -i).slice(0, 7));
  const pct = (v) => (d.receita_liquida ? fmtPct((v / d.receita_liquida) * 100) : '');
  const linha = (rot, v, vAnt, cls = '', neg = false) => `<tr class="${cls}"><td>${rot}</td><td class="num">${neg && v ? '− ' : ''}${fmtMoeda(Math.abs(v))}</td>
    <td class="num muted esconder-cel">${pct(Math.abs(v))}</td><td class="num muted esconder-cel">${vAnt === undefined ? '' : `${neg && vAnt ? '− ' : ''}${fmtMoeda(Math.abs(vAnt))}`}</td></tr>`;
  const antCat = (lista, nome) => lista.find((x) => x.categoria === nome)?.valor || 0;
  el.innerHTML = `${abas('dre')}${cabecalho('DRE — resultado do mês', { sub: 'Quanto a loja lucrou de verdade: vendas menos custo das mercadorias, taxas e despesas (pelo mês de competência).' })}
    <div class="ferramentas" style="margin-bottom:12px"><select id="f-mes" style="width:auto">${meses.map((m) => `<option value="${m}" ${m === dreF.mes ? 'selected' : ''}>${nomeMes(m)}</option>`).join('')}</select>
      <span style="flex:1"></span><button class="btn btn-ghost btn-sm" id="b-imp" type="button">Imprimir</button></div>
    <div class="kpis">${kpi('Receita líquida', fmtMoeda(d.receita_liquida))}${kpi('Lucro bruto', fmtMoeda(d.lucro_bruto), d.margem_bruta_pct !== null ? `margem ${fmtPct(d.margem_bruta_pct)}` : '')}
      ${kpi('Despesas', fmtMoeda(d.total_despesas))}${kpi('Resultado do mês', fmtMoeda(d.resultado), d.resultado >= 0 ? 'lucro' : 'prejuízo', d.resultado < 0 ? 'neg' : 'pos')}</div>
    <div class="grade-2" style="margin-top:16px;align-items:start">
    <div class="card" id="dre-tab"><div class="tabela-wrap"><table class="tabela"><thead><tr><th>${nomeMes(dreF.mes)}</th><th class="num">Valor</th><th class="num esconder-cel">%</th><th class="num esconder-cel">Mês anterior</th></tr></thead><tbody>
      ${d.receita_servicos || ant.receita_servicos ? `${linha('Receita de vendas', d.receita_vendas, ant.receita_vendas)}${linha('Receita de assistência técnica (OS)', d.receita_servicos, ant.receita_servicos)}` : linha('Receita bruta de vendas', d.receita_bruta, ant.receita_bruta)}
      ${linha('(−) Devoluções', d.devolucoes, ant.devolucoes, '', true)}
      ${linha('<b>= Receita líquida</b>', d.receita_liquida, ant.receita_liquida, 'forte')}
      ${linha('(−) Custo das mercadorias vendidas', d.cmv, ant.cmv, '', true)}
      ${d.custo_pecas_os || ant.custo_pecas_os ? linha('(−) Peças usadas nas OS', d.custo_pecas_os, ant.custo_pecas_os, '', true) : ''}
      ${linha('(−) Taxas de cartão', d.taxas_cartao, ant.taxas_cartao, '', true)}
      ${linha('<b>= Lucro bruto</b>', d.lucro_bruto, ant.lucro_bruto, 'forte')}
      ${d.outras_receitas.map((x) => linha(`(+) ${esc(x.categoria)}`, x.valor, antCat(ant.outras_receitas, x.categoria))).join('')}
      ${d.despesas.map((x) => linha(`(−) ${esc(x.categoria)}`, x.valor, antCat(ant.despesas, x.categoria), '', true)).join('')}
      ${d.quebra_caixa ? linha(d.quebra_caixa < 0 ? '(−) Quebra de caixa' : '(+) Sobra de caixa', d.quebra_caixa, ant.quebra_caixa, '', d.quebra_caixa < 0) : ''}
      <tr class="forte"><td><b>= Resultado (lucro ou prejuízo)</b></td><td class="num ${d.resultado < 0 ? 'neg' : 'pos'}"><b>${fmtMoedaSinal(d.resultado)}</b></td><td class="num esconder-cel">${pct(d.resultado)}</td><td class="num muted esconder-cel">${fmtMoedaSinal(ant.resultado)}</td></tr>
    </tbody></table></div>
    <p class="muted pequeno" style="padding:0 14px 14px">Compras de mercadoria (${fmtMoeda(d.compras_mercadoria)} no mês) não entram como despesa: o custo aparece quando o produto é vendido (CMV).</p></div>
    <div class="card"><div class="card-topo"><h3>Pelo caixa (dinheiro que entrou e saiu)</h3></div><div class="card-pad">
      <div class="kpis" style="margin:0 0 10px">${kpi('Entrou', `<span class="pos">${fmtMoeda(d.caixa.entradas)}</span>`)}${kpi('Saiu', `<span class="neg">${fmtMoeda(d.caixa.saidas)}</span>`)}</div>
      ${d.caixa.por_categoria.length ? `<div class="tabela-wrap"><table class="tabela"><tbody>${d.caixa.por_categoria.map((x) => `<tr><td>${esc(x.categoria)}</td><td class="num ${x.tipo === 'entrada' ? 'pos' : 'neg'}">${x.tipo === 'entrada' ? '+' : '−'} ${fmtMoeda(x.valor)}</td></tr>`).join('')}</tbody></table></div>` : vazio('Sem movimento', '')}
    </div></div></div>`;
  $('#f-mes', el).addEventListener('change', (e) => { dreF.mes = e.target.value; dre(el, ctx); });
  $('#b-imp', el).addEventListener('click', async () => { const { imprimir } = await import('../core.js'); imprimir(`DRE — ${nomeMes(dreF.mes)}`, $('#dre-tab', el).innerHTML); });
}
