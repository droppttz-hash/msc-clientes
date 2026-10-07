// Aparelhos recebidos de clientes: na troca (venda) ou comprados — lista, detalhe, termo de compra
import {
  estado, pode, $, $$, esc, fmtMoeda, fmtData, fmtDataHora, fmtTelefone, fmtCpf, fmtCnpj, hojeSP, addMeses,
  abrirModal, toast, msgErro, rpc, consulta, buscarTudo, lista as listaCache, cabecalho, vazio, carregando, tag, kpi, icone, textoAparelho, imprimir,
} from '../core.js';

const TIPO = { troca: ['Troca', 'warn'], compra: ['Compra', 'ok'] };
const fmtDoc = (d) => (!d ? '' : d.length === 11 ? `CPF ${fmtCpf(d)}` : `CNPJ ${fmtCnpj(d)}`);

function abas() {
  const itens = [['Em estoque', '#/aparelhos'], pode('vendas.ver_lucro') && ['Vendidos e lucro', '#/aparelhos/vendidos'], ['Compras e trocas', '#/aparelhos/compras']].filter(Boolean);
  return `<nav class="abas-pagina">${itens.map(([r, h]) => `<a href="${h}" class="${h === '#/aparelhos/compras' ? 'ativa' : ''}">${r}</a>`).join('')}</nav>`;
}

// Fluxo completo: escolhe quem vende → avalia → registra
export async function comprarAparelho() {
  if (!pode('aparelhos.comprar')) { toast('Sem permissão para comprar aparelhos.', 'erro'); return null; }
  const { escolherCliente } = await import('./clientes.js');
  const cli = await escolherCliente();
  if (!cli) return null;
  const { avaliarAparelho } = await import('./orcamentos.js');
  const d = await avaliarAparelho('compra', [], { cliente: cli });
  if (!d) return null;
  try {
    const { produto_nome, ...p } = d;
    const r = await rpc('comprar_aparelho_cliente', { p });
    toast(`Compra nº ${r.numero} registrada — aparelho em teste`);
    return r;
  } catch (err) { toast(msgErro(err), 'erro'); return null; }
}

// =====================================================================
// LISTA
// =====================================================================
const f0 = { tipo: '', mes: hojeSP().slice(0, 7), termo: '' };
export async function lista(el, ctx) {
  el.innerHTML = `${abas()}
    ${cabecalho('Compras e trocas', { sub: 'Aparelhos que entraram vindos de clientes: na troca de uma venda ou comprados direto.',
      acoes: pode('aparelhos.comprar') ? '<button class="btn btn-primary" type="button" id="b-comprar">+ Comprar aparelho de cliente</button>' : '' })}
    <div class="kpis" id="kpis"></div>
    <div class="card"><div class="ferramentas">
      <input class="busca" id="f-termo" type="search" placeholder="Cliente, IMEI, modelo…" value="${esc(f0.termo)}">
      <select id="f-tipo"><option value="">Trocas e compras</option><option value="troca" ${f0.tipo === 'troca' ? 'selected' : ''}>Só trocas</option><option value="compra" ${f0.tipo === 'compra' ? 'selected' : ''}>Só compras</option></select>
      <input type="month" id="f-mes" value="${f0.mes}">
    </div><div id="tabela">${carregando()}</div></div>`;
  const carregar = async () => {
    let dados;
    try {
      dados = await buscarTudo(() => {
        let q = estado.sb.from('avaliacoes_lista').select('*');
        if (f0.tipo) q = q.eq('tipo', f0.tipo);
        const t = f0.termo.trim().replace(/[,()"%]/g, ' ');
        if (t) q = q.or(`cliente_nome.ilike."%${t}%",imei.ilike."%${t}%",produto.ilike."%${t}%"`);
        else if (f0.mes) q = q.gte('criado_em', `${f0.mes}-01T00:00:00-03:00`).lt('criado_em', `${addMeses(`${f0.mes}-01`, 1)}T00:00:00-03:00`);
        return q.order('criado_em', { ascending: false });
      });
    } catch (err) { $('#tabela', el).innerHTML = vazio('Erro', esc(msgErro(err))); return; }
    if (!ctx.ativo()) return;
    const at = dados.filter((a) => a.status === 'ativa');
    const soma = (tp) => at.filter((a) => a.tipo === tp).reduce((s, a) => s + a.valor_centavos, 0);
    $('#kpis', el).innerHTML = kpi('Recebidos na troca', String(at.filter((a) => a.tipo === 'troca').length), fmtMoeda(soma('troca')) + ' abatidos em vendas')
      + kpi('Comprados', String(at.filter((a) => a.tipo === 'compra').length), fmtMoeda(soma('compra')) + ' pagos');
    if (!dados.length) { $('#tabela', el).innerHTML = vazio('Nada neste período', ''); return; }
    $('#tabela', el).innerHTML = `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Nº</th><th>Data</th><th>Tipo</th><th>Aparelho</th><th class="esconder-cel">Cliente</th><th class="num">Valor</th><th class="esconder-cel">Situação</th></tr></thead><tbody>
      ${dados.map((a) => `<tr class="clicavel" data-href="#/aparelhos/compras/${a.id}"><td>${a.numero}</td><td>${fmtData(a.criado_em)}</td><td>${tag(...TIPO[a.tipo])}</td>
        <td><b>${esc(a.produto)}</b><div class="muted pequeno">IMEI ${esc(a.imei)}</div></td><td class="esconder-cel">${esc(a.cliente_nome)}</td>
        <td class="num">${fmtMoeda(a.valor_centavos)}</td><td class="esconder-cel">${a.status === 'cancelada' ? tag('Cancelada', 'cinza') : a.venda_numero ? `venda nº ${a.venda_numero}` : ''}</td></tr>`).join('')}
      </tbody></table></div><div class="rodape-tabela"><span>${dados.length} registro(s)</span></div>`;
    $$('tr[data-href]', el).forEach((tr) => tr.addEventListener('click', () => { location.hash = tr.dataset.href; }));
  };
  let tm; $('#f-termo', el).addEventListener('input', (e) => { clearTimeout(tm); tm = setTimeout(() => { f0.termo = e.target.value; carregar(); }, 250); });
  $('#f-tipo', el).addEventListener('change', (e) => { f0.tipo = e.target.value; carregar(); });
  $('#f-mes', el).addEventListener('change', (e) => { f0.mes = e.target.value; carregar(); });
  $('#b-comprar', el)?.addEventListener('click', async () => { const r = await comprarAparelho(); if (r) location.hash = `#/aparelhos/compras/${r.id}`; });
  carregar();
}

// =====================================================================
// TERMO DE COMPRA / RECEBIMENTO
// =====================================================================
export function imprimirTermo(a) {
  const e = estado.empresa || {};
  const d = a.detalhes || {};
  const chk = d.checklist && Object.keys(d.checklist).length ? Object.entries(d.checklist) : [];
  imprimir(`Termo ${a.numero}`, `
    <h2>${a.tipo === 'troca' ? 'Termo de recebimento de aparelho na troca' : 'Termo de compra de aparelho usado'} nº ${a.numero}</h2>
    <p>Data: <b>${fmtDataHora(a.criado_em)}</b>${a.venda_numero ? ` · Referente à venda nº ${a.venda_numero}` : ''}</p>
    <h2>Vendedor (proprietário)</h2>
    <div class="caixa"><b>${esc(a.cliente_nome)}</b><br>${esc(fmtDoc(a.documento || a.cliente_cpf || a.cliente_cnpj))}${a.cliente_telefone ? ` · ${fmtTelefone(a.cliente_telefone)}` : ''}</div>
    <h2>Aparelho</h2>
    <div class="caixa"><b>${esc(a.produto)}</b><br>IMEI: <b>${esc(a.imei)}</b>${d.imei2 ? ` · IMEI 2: ${esc(d.imei2)}` : ''}<br>${esc(textoAparelho({ ...d, imei2: null }))}
      ${chk.length ? `<br><small>Checklist: ${chk.map(([k, v]) => `${esc(k)}: ${v === 'ok' ? 'ok' : 'com problema'}`).join(' · ')}</small>` : ''}
      ${a.observacao ? `<br><small>Obs.: ${esc(a.observacao)}</small>` : ''}</div>
    <table><tbody><tr><td class="total">${a.tipo === 'troca' ? 'Valor abatido na compra' : 'Valor pago'}</td><td class="num total">${fmtMoeda(a.valor_centavos)}</td></tr></tbody></table>
    <p style="text-align:justify">${esc(e.texto_termo_compra || '')}</p>
    <div class="assin"><div>${esc(a.cliente_nome)}<br>${esc(fmtDoc(a.documento || a.cliente_cpf || a.cliente_cnpj))}</div><div>${esc(e.nome_fantasia || '')}</div></div>`);
}

// =====================================================================
// DETALHE
// =====================================================================
export async function detalhe(el, ctx) {
  const id = ctx.params[0];
  const [a] = await consulta(estado.sb.from('avaliacoes_lista').select('*').eq('id', id));
  if (!ctx.ativo()) return;
  if (!a) { el.innerHTML = vazio('Registro não encontrado', '<a href="#/aparelhos/compras">Voltar</a>'); return; }
  const d = a.detalhes || {};
  const podeCanc = a.tipo === 'compra' && a.status === 'ativa' && pode('aparelhos.comprar') && ['em_teste', 'disponivel', 'em_reparo', 'em_garantia'].includes(a.aparelho_status);
  el.innerHTML = `
    <a class="voltar" href="#/aparelhos/compras">${icone('recolher')} Compras e trocas</a>
    ${cabecalho(`${a.tipo === 'troca' ? 'Troca' : 'Compra'} nº ${a.numero}`, { sub: `${fmtDataHora(a.criado_em)} · ${esc(a.usuario || '')}`, resumo: a.status === 'cancelada' ? tag('Cancelada', 'cinza') : tag(...TIPO[a.tipo]) })}
    ${a.status === 'cancelada' ? `<div class="alerta">${icone('alerta')}<span>Cancelada em ${fmtDataHora(a.cancelada_em)}: ${esc(a.motivo_cancelamento || '')}</span></div>` : ''}
    <div class="barra-acoes">
      <button class="btn btn-ghost" type="button" id="b-termo">${icone('impressora')} Termo ${a.tipo === 'troca' ? 'de recebimento' : 'de compra'}</button>
      ${a.serie_id ? `<a class="btn btn-ghost" href="#/aparelhos/${a.serie_id}">Ficha do aparelho</a>` : ''}
      ${a.venda_id ? `<a class="btn btn-ghost" href="#/vendas/${a.venda_id}">Venda nº ${a.venda_numero}</a>` : ''}
      ${podeCanc ? '<button class="btn btn-ghost" type="button" id="b-canc" style="color:var(--danger)">Cancelar compra</button>' : ''}
    </div>
    <div class="card card-pad"><dl class="dl">
      <div><dt>Cliente</dt><dd><a href="#/clientes/${a.cliente_id}">${esc(a.cliente_nome)}</a><br><span class="muted">${esc(fmtDoc(a.documento || a.cliente_cpf || a.cliente_cnpj))}</span></dd></div>
      <div><dt>Aparelho</dt><dd><b>${esc(a.produto)}</b><br><span class="muted">IMEI ${esc(a.imei)}</span></dd></div>
      <div><dt>Estado</dt><dd>${esc(textoAparelho(d)) || '—'}</dd></div>
      <div><dt>${a.tipo === 'troca' ? 'Valor abatido' : 'Valor pago'}</dt><dd style="font-size:20px;font-weight:700">${fmtMoeda(a.valor_centavos)}</dd></div>
      ${d.checklist && Object.keys(d.checklist).length ? `<div><dt>Checklist</dt><dd>${Object.entries(d.checklist).map(([k, v]) => `${esc(k)}: ${v === 'ok' ? '<span class="pos">ok</span>' : '<span class="neg">com problema</span>'}`).join('<br>')}</dd></div>` : ''}
      ${a.observacao ? `<div><dt>Observação</dt><dd>${esc(a.observacao)}</dd></div>` : ''}
    </dl></div>`;
  $('#b-termo', el).addEventListener('click', () => imprimirTermo(a));
  $('#b-canc', el)?.addEventListener('click', async () => {
    const contas = (await listaCache('contas')).filter((c) => c.ativo);
    const ok = await abrirModal({
      titulo: `Cancelar compra nº ${a.numero}`, largura: 'sm', botao: 'Cancelar compra', botaoClasse: 'btn-danger',
      corpo: `<p class="muted">O aparelho sai do estoque e o pagamento ao cliente é estornado nas contas.</p>
        <label>Motivo *<input name="motivo" required placeholder="Ex.: lançado errado, cliente desistiu…"></label>`,
      aoSalvar: async (f) => {
        if (f.motivo.value.trim().length < 3) { f.erro('Escreva o motivo.'); return false; }
        await rpc('cancelar_compra_aparelho', { p_avaliacao: id, p_motivo: f.motivo.value.trim(), p_conta: contas[0]?.id || null });
        return true;
      },
    });
    if (ok) { toast('Compra cancelada'); detalhe(el, ctx); }
  });
}
