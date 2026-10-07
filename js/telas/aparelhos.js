// Aparelhos: cada celular/notebook por IMEI — ficha, fotos, custos de reparo, rastreio e lucro
import {
  estado, pode, $, $$, esc, fmtMoeda, fmtData, fmtDataHora, fmtPct, fmtNum, hojeSP, addMeses, ultimoDiaMes, nomeMes,
  abrirModal, pedirMotivo, toast, msgErro, rpc, consulta, buscarTudo, baixarCsv, csvMoeda, cabecalho, vazio, carregando, tag, kpi, icone,
  valorDinheiro, textoAparelho, CONDICOES_APARELHO,
} from '../core.js';

export const STATUS = {
  disponivel: ['Disponível', 'ok'], reservado: ['Reservado', 'warn'], em_teste: ['Em teste', 'warn'], em_reparo: ['Em reparo', 'warn'],
  em_garantia: ['Em garantia (fornecedor)', 'warn'], vendido: ['Vendido', 'cinza'], em_os: ['Em OS', 'warn'],
  devolvido_fornecedor: ['Devolvido ao fornecedor', 'cinza'], defeito: ['Defeito', 'danger'], baixado: ['Baixado', 'cinza'],
};
const PROCEDENCIA = { fornecedor: 'Fornecedor', compra_cliente: 'Comprado de cliente', trade_in: 'Troca (trade-in)', outro: 'Outro' };
const ATIVOS = ['disponivel', 'reservado', 'em_teste', 'em_reparo', 'em_garantia'];
const MOVEIS = ['disponivel', 'em_teste', 'em_reparo', 'em_garantia'];
const stTag = (s) => tag(...(STATUS[s] || [s, 'cinza']));
const nomeAparelho = (a) => {
  const base = (a.produto || '').toLowerCase().replace(/\s+/g, '');
  return [a.produto, ...[a.capacidade, a.cor].filter((x) => x && !base.includes(x.toLowerCase().replace(/\s+/g, '')))].join(' · ');
};

function abas(atual) {
  const itens = [['lista', 'Em estoque', '#/aparelhos'], pode('vendas.ver_lucro') && ['vendidos', 'Vendidos e lucro', '#/aparelhos/vendidos'], ['compras', 'Compras e trocas', '#/aparelhos/compras']].filter(Boolean);
  return itens.length > 1 ? `<nav class="abas-pagina">${itens.map(([id, r, h]) => `<a href="${h}" class="${id === atual ? 'ativa' : ''}">${r}</a>`).join('')}</nav>` : '';
}

// =====================================================================
// LISTA
// =====================================================================
const f0 = { termo: '', status: 'ativos', grau: '', condicao: '', modo: 'lista' };
export async function lista(el, ctx) {
  const res = await rpc('aparelhos_resumo');
  if (!ctx.ativo()) return;
  const alerta = res.dias_alerta;
  el.innerHTML = `${abas('lista')}
    ${cabecalho('Aparelhos', { sub: 'Cada celular por IMEI: estado, bateria, fotos, custo de reparo e quanto tempo está parado.' })}
    <div class="kpis">
      ${kpi('Disponíveis para venda', fmtNum(res.disponiveis), fmtMoeda(res.valor_venda) + ' em preço de venda')}
      ${kpi('Em teste / reparo', fmtNum(res.em_teste + res.em_reparo), res.em_garantia ? `${res.em_garantia} em garantia no fornecedor` : 'não aparecem no PDV')}
      ${kpi(`Parados há +${alerta} dias`, fmtNum(res.parados), res.parados ? 'vale revisar o preço' : 'nenhum encalhado', res.parados ? 'neg' : '')}
      ${res.valor_custo != null ? kpi('Custo em estoque', fmtMoeda(res.valor_custo), 'aquisição + reparos') : kpi('Reservados', fmtNum(res.reservados))}
    </div>
    <div class="card"><div class="ferramentas">
      <input class="busca" id="f-termo" type="search" placeholder="IMEI, modelo, cor…" value="${esc(f0.termo)}">
      <select id="f-status">${[['ativos', 'No estoque (todos)'], ['disponivel', 'Disponíveis'], ['em_teste', 'Em teste'], ['em_reparo', 'Em reparo'], ['em_garantia', 'Em garantia'], ['parados', `Parados (+${alerta} dias)`], ['vendido', 'Vendidos'], ['todos', 'Todos']].map(([v, r]) => `<option value="${v}" ${f0.status === v ? 'selected' : ''}>${r}</option>`).join('')}</select>
      <select id="f-grau"><option value="">Qualquer grau</option>${['A', 'B', 'C'].map((g) => `<option ${f0.grau === g ? 'selected' : ''}>${g}</option>`).join('')}</select>
      <select id="f-cond"><option value="">Lacrado e seminovo</option>${Object.entries(CONDICOES_APARELHO).map(([k, v]) => `<option value="${k}" ${f0.condicao === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <span style="flex:1"></span>
      <button class="btn btn-ghost btn-sm" type="button" id="b-modo">${f0.modo === 'lista' ? 'Agrupar por modelo' : 'Ver um por um'}</button>
      <button class="btn btn-ghost btn-sm" type="button" id="b-exp">Exportar</button>
    </div><div id="tabela">${carregando()}</div></div>`;
  let dados = [];
  const carregar = async () => {
    try {
      dados = await buscarTudo(() => {
        let q = estado.sb.from('aparelhos').select('*');
        if (f0.status === 'ativos' || f0.status === 'parados') q = q.in('status', ATIVOS);
        else if (f0.status !== 'todos') q = q.eq('status', f0.status);
        if (f0.status === 'parados') q = q.gte('dias_em_estoque', alerta);
        if (f0.grau) q = q.eq('grau', f0.grau);
        if (f0.condicao) q = q.eq('condicao', f0.condicao);
        const t = f0.termo.trim().replace(/[,()"%]/g, ' ');
        if (t) q = q.or(`imei.ilike."%${t}%",imei2.ilike."%${t}%",produto.ilike."%${t}%",cor.ilike."%${t}%",capacidade.ilike."%${t}%",modelo.ilike."%${t}%"`);
        return q.order(f0.status === 'vendido' ? 'venda_data' : 'criado_em', { ascending: f0.status !== 'vendido' });
      });
    } catch (err) { $('#tabela', el).innerHTML = vazio('Erro', esc(msgErro(err))); return; }
    if (!ctx.ativo()) return;
    if (!dados.length) { $('#tabela', el).innerHTML = vazio('Nenhum aparelho aqui', 'Aparelhos entram pelo estoque: Entradas de mercadoria, com o IMEI de cada unidade.'); return; }
    if (f0.modo === 'grupo') {
      const g = new Map();
      dados.forEach((a) => {
        const k = [a.produto, a.capacidade || '', a.cor || '', a.condicao, a.grau || ''].join('|');
        const x = g.get(k) || { ...a, qtd: 0, min: Infinity, max: 0, parado: 0 };
        x.qtd++; x.min = Math.min(x.min, a.preco_venda_centavos); x.max = Math.max(x.max, a.preco_venda_centavos); x.parado = Math.max(x.parado, a.dias_em_estoque || 0);
        g.set(k, x);
      });
      const grupos = [...g.values()].sort((a, b) => a.produto.localeCompare(b.produto) || b.qtd - a.qtd);
      $('#tabela', el).innerHTML = `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Modelo</th><th>Capacidade</th><th>Cor</th><th>Estado</th><th class="num">Qtd</th><th class="num">Preço</th><th class="num esconder-cel">Mais antigo</th></tr></thead><tbody>
        ${grupos.map((x) => `<tr><td><b>${esc(x.produto)}</b></td><td>${esc(x.capacidade || '—')}</td><td>${esc(x.cor || '—')}</td>
          <td>${esc(CONDICOES_APARELHO[x.condicao] || x.condicao)}${x.grau ? ` · grau ${x.grau}` : ''}</td><td class="num"><b>${x.qtd}</b></td>
          <td class="num">${x.min === x.max ? fmtMoeda(x.min) : `${fmtMoeda(x.min)} a ${fmtMoeda(x.max)}`}</td>
          <td class="num esconder-cel ${x.parado >= alerta ? 'neg' : ''}">${x.parado ? `${x.parado} dias` : '—'}</td></tr>`).join('')}
        </tbody></table></div><div class="rodape-tabela"><span>${grupos.length} combinação(ões) · ${dados.length} aparelho(s)</span></div>`;
      return;
    }
    $('#tabela', el).innerHTML = `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Aparelho</th><th class="esconder-cel">Estado</th><th class="num">Preço</th><th class="num esconder-cel">${f0.status === 'vendido' ? 'Vendido em' : 'No estoque'}</th><th>Situação</th></tr></thead><tbody>
      ${dados.map((a) => `<tr class="clicavel" data-id="${a.id}"><td><b>${esc(nomeAparelho(a))}</b><div class="muted pequeno">IMEI ${esc(a.imei)}${a.fotos_qtd ? ` · ${a.fotos_qtd} foto(s)` : ''}</div></td>
        <td class="esconder-cel">${esc(CONDICOES_APARELHO[a.condicao] || a.condicao)}${a.grau ? ` · <b>grau ${a.grau}</b>` : ''}${a.bateria_pct != null ? `<div class="muted pequeno">bateria ${a.bateria_pct}%</div>` : ''}</td>
        <td class="num">${fmtMoeda(a.status === 'vendido' ? a.venda_valor_centavos : a.preco_venda_centavos)}</td>
        <td class="num esconder-cel">${a.status === 'vendido' ? fmtData(a.venda_data) : a.dias_em_estoque != null ? `<span class="${a.dias_em_estoque >= alerta ? 'neg' : ''}">${a.dias_em_estoque} dias</span>` : '—'}</td>
        <td>${stTag(a.status)}</td></tr>`).join('')}
      </tbody></table></div><div class="rodape-tabela"><span>${dados.length} aparelho(s)</span></div>`;
    $$('tr[data-id]', el).forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/aparelhos/${tr.dataset.id}`; }));
  };
  let tm; $('#f-termo', el).addEventListener('input', (e) => { clearTimeout(tm); tm = setTimeout(() => { f0.termo = e.target.value; carregar(); }, 250); });
  $('#f-status', el).addEventListener('change', (e) => { f0.status = e.target.value; carregar(); });
  $('#f-grau', el).addEventListener('change', (e) => { f0.grau = e.target.value; carregar(); });
  $('#f-cond', el).addEventListener('change', (e) => { f0.condicao = e.target.value; carregar(); });
  $('#b-modo', el).addEventListener('click', () => { f0.modo = f0.modo === 'lista' ? 'grupo' : 'lista'; lista(el, ctx); });
  $('#b-exp', el).addEventListener('click', () => baixarCsv(`aparelhos-${hojeSP()}.csv`,
    ['IMEI', 'IMEI 2', 'Aparelho', 'Capacidade', 'Cor', 'Condição', 'Grau', 'Bateria %', 'Situação', 'Preço', 'Custo total', 'Dias no estoque', 'Procedência'],
    dados.map((a) => [a.imei, a.imei2, a.produto, a.capacidade, a.cor, CONDICOES_APARELHO[a.condicao] || a.condicao, a.grau, a.bateria_pct,
      STATUS[a.status]?.[0] || a.status, csvMoeda(a.preco_venda_centavos), a.custo_total_centavos != null ? csvMoeda(a.custo_total_centavos) : '',
      a.dias_em_estoque ?? '', PROCEDENCIA[a.procedencia] || ''])));
  carregar();
}

// =====================================================================
// FICHA
// =====================================================================
export async function ficha(el, ctx) {
  const id = ctx.params[0];
  const verCusto = pode('estoque.ver_custo'); const editar = pode('aparelhos.editar');
  const [rows, eventos, fotos, custos] = await Promise.all([
    consulta(estado.sb.from('aparelhos').select('*').eq('id', id)),
    consulta(estado.sb.from('aparelho_eventos').select('*').eq('serie_id', id).order('id', { ascending: false })),
    consulta(estado.sb.from('aparelho_fotos').select('id,imagem,legenda,criado_em').eq('serie_id', id).order('criado_em')),
    verCusto ? consulta(estado.sb.from('aparelho_custos').select('*').eq('serie_id', id).order('criado_em')) : [],
  ]);
  if (!ctx.ativo()) return;
  const a = rows[0];
  if (!a) { el.innerHTML = vazio('Aparelho não encontrado', ''); return; }
  const itensCheck = Array.isArray(estado.empresa?.checklist_aparelho) ? estado.empresa.checklist_aparelho : [];
  const chk = a.checklist || {};
  const todosItens = [...new Set([...itensCheck, ...Object.keys(chk)])];
  const marcaCheck = (v) => (v === 'ok' ? '<span class="pos">✓ ok</span>' : v === 'falha' ? '<span class="neg">✗ com problema</span>' : '<span class="muted">não testado</span>');
  const linha = (rot, val) => (val ? `<div><dt>${rot}</dt><dd>${val}</dd></div>` : '');
  const vendido = a.status === 'vendido';
  const acoes = [
    editar && '<button class="btn btn-primary" type="button" id="b-edit">Editar ficha</button>',
    editar && MOVEIS.includes(a.status) && '<button class="btn btn-ghost" type="button" id="b-status">Mudar situação</button>',
    a.status === 'em_teste' && pode('estoque.ajustar') && '<button class="btn btn-ghost" type="button" id="b-teste">Concluir teste</button>',
    a.status === 'disponivel' && pode('vendas.criar') && '<button class="btn btn-ghost" type="button" id="b-vender">Vender este aparelho</button>',
    a.status === 'disponivel' && pode('vendas.reservar') && '<button class="btn btn-ghost" type="button" id="b-reservar">Reservar com sinal</button>',
    a.status === 'reservado' && (pode('vendas.reservar') || pode('vendas.ver_todas')) && '<button class="btn btn-ghost" type="button" id="b-ver-res">Ver reserva</button>',
    '<button class="btn btn-ghost" type="button" id="b-nota">Anotar</button>',
    `<a class="btn btn-ghost" href="#/estoque/produto/${a.produto_id}">Ver produto</a>`,
  ].filter(Boolean).join('');
  el.innerHTML = `
    <a class="voltar" href="#/aparelhos">${icone('recolher')} Aparelhos</a>
    ${cabecalho(esc(nomeAparelho(a)), { sub: `IMEI <b>${esc(a.imei)}</b>${a.imei2 ? ` · IMEI 2 ${esc(a.imei2)}` : ''} · ${stTag(a.status)}`, acoes })}
    <div class="kpis">
      ${kpi(vendido ? 'Vendido por' : 'Preço de venda', fmtMoeda(vendido ? a.venda_valor_centavos : a.preco_venda_centavos), a.preco_proprio_centavos != null && !vendido ? 'preço próprio deste aparelho' : vendido ? '' : 'preço do produto')}
      ${verCusto ? kpi('Custo total', fmtMoeda(a.custo_total_centavos), `aquisição ${fmtMoeda(a.custo_aquisicao_centavos)} + reparos ${fmtMoeda(a.custo_recond_centavos)}`) : ''}
      ${vendido && a.lucro_centavos != null ? kpi('Lucro', fmtMoeda(a.lucro_centavos), a.venda_valor_centavos ? `margem ${fmtPct(a.lucro_centavos / a.venda_valor_centavos * 100)} · taxa ${fmtMoeda(a.venda_taxa_centavos)}` : '', a.lucro_centavos < 0 ? 'neg' : 'pos') : ''}
      ${!vendido && verCusto && a.custo_total_centavos != null ? kpi('Lucro previsto', fmtMoeda(a.preco_venda_centavos - a.custo_total_centavos), 'antes da taxa do cartão') : ''}
      ${a.dias_em_estoque != null ? kpi('No estoque há', `${a.dias_em_estoque} dias`, '', a.dias_em_estoque >= (estado.empresa?.dias_alerta_aparelho_parado || 60) ? 'neg' : '') : ''}
    </div>
    <div class="grade-2" style="align-items:start">
      <div>
        <div class="card card-pad"><h3 style="margin-bottom:10px">Ficha</h3><dl class="dl">
          ${linha('Condição', esc(CONDICOES_APARELHO[a.condicao] || a.condicao))}
          ${linha('Grau de conservação', a.grau ? `<b>${a.grau}</b>` : '<span class="muted">não avaliado</span>')}
          ${linha('Saúde da bateria', a.bateria_pct != null ? `${a.bateria_pct}%` : '<span class="muted">—</span>')}
          ${linha('Cor · capacidade', esc([a.cor, a.capacidade].filter(Boolean).join(' · ')) || '<span class="muted">—</span>')}
          ${linha('Peças trocadas', esc(a.pecas_trocadas))}
          ${linha('Garantia na venda', a.garantia_dias != null ? `${a.garantia_dias} dias` : `${estado.empresa?.garantia_padrao_dias ?? 90} dias (padrão)`)}
          ${linha('Procedência', esc([PROCEDENCIA[a.procedencia], a.origem_nome].filter(Boolean).join(' — ')) + (a.entrada_id ? ` · <a href="#/estoque/entradas/${a.entrada_id}">entrada nº ${a.entrada_numero}</a>` : ''))}
          ${linha('Observação', esc(a.observacao))}
        </dl></div>
        <div class="card card-pad" style="margin-top:16px"><h3 style="margin-bottom:10px">Checklist de testes</h3>
          ${todosItens.length ? `<div class="tabela-wrap"><table class="tabela"><tbody>${todosItens.map((i) => `<tr><td>${esc(i)}</td><td class="num">${marcaCheck(chk[i])}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Sem itens de checklist. Configure em Configurações › Empresa.</p>'}
        </div>
        ${vendido ? `<div class="card card-pad" style="margin-top:16px"><h3 style="margin-bottom:10px">Venda</h3><dl class="dl">
          ${linha('Venda', `<a href="#/vendas/${a.venda_id}">nº ${a.venda_numero}</a> em ${fmtData(a.venda_data)}`)}
          ${linha('Cliente', a.venda_cliente_id ? `<a href="#/clientes/${a.venda_cliente_id}">${esc(a.venda_cliente_nome)}</a>` : 'Balcão')}
          ${linha('Vendedor', esc(a.venda_vendedor_nome))}
          ${a.garantia_dias != null || true ? linha('Garantia até', fmtData(new Date(new Date(`${a.venda_data}T12:00:00`).getTime() + (a.garantia_dias ?? estado.empresa?.garantia_padrao_dias ?? 90) * 864e5).toISOString())) : ''}
        </dl></div>` : ''}
      </div>
      <div>
        <div class="card card-pad"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h3>Fotos</h3>
          ${editar ? `<label class="btn btn-ghost btn-sm" style="cursor:pointer">${icone('mais')} Incluir fotos<input type="file" id="f-fotos" accept="image/*" multiple hidden></label>` : ''}</div>
          ${fotos.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px">${fotos.map((fo) => `<button type="button" data-foto="${fo.id}" style="padding:0;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:none;cursor:zoom-in;aspect-ratio:1"><img src="${fo.imagem}" alt="${esc(fo.legenda || 'foto do aparelho')}" style="width:100%;height:100%;object-fit:cover"></button>`).join('')}</div>`
    : '<p class="muted">Nenhuma foto. Tire fotos reais (frente, verso, laterais) para mostrar ao cliente.</p>'}
        </div>
        ${verCusto ? `<div class="card card-pad" style="margin-top:16px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h3>Custos de reparo</h3>
          ${editar && !['vendido', 'devolvido_fornecedor', 'baixado'].includes(a.status) ? `<button class="btn btn-ghost btn-sm" type="button" id="b-custo">${icone('mais')} Lançar custo</button>` : ''}</div>
          ${custos.length ? `<div class="tabela-wrap"><table class="tabela"><tbody>${custos.map((c) => `<tr class="${c.cancelado ? 'muted' : ''}"><td>${esc(c.descricao)}<div class="muted pequeno">${fmtDataHora(c.criado_em)} · ${esc(c.usuario || '')}${c.cancelado ? ` · cancelado: ${esc(c.motivo_cancelamento)}` : ''}</div></td>
            <td class="num">${c.cancelado ? `<s>${fmtMoeda(c.valor_centavos)}</s>` : fmtMoeda(c.valor_centavos)}</td>
            <td class="num">${!c.cancelado && editar && !vendido ? `<button class="link-btn perigo" type="button" data-cancelar="${c.id}">cancelar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">Nenhum custo de reparo. Peças e mão de obra lançadas aqui somam no custo e no lucro do aparelho.</p>'}
        </div>` : (editar && !['vendido', 'devolvido_fornecedor', 'baixado'].includes(a.status) ? `<div class="card card-pad" style="margin-top:16px"><button class="btn btn-ghost btn-sm" type="button" id="b-custo">${icone('mais')} Lançar custo de reparo</button></div>` : '')}
        <div class="card card-pad" style="margin-top:16px"><h3 style="margin-bottom:10px">Linha do tempo</h3>
          ${eventos.length ? `<div class="tabela-wrap"><table class="tabela"><tbody>${eventos.map((e) => `<tr><td style="white-space:nowrap;width:1%">${fmtDataHora(e.criado_em)}</td><td>${esc(e.descricao)}<div class="muted pequeno">${esc(e.usuario || 'sistema')}</div></td></tr>`).join('')}</tbody></table></div>` : vazio('Sem registros', '')}
        </div>
      </div>
    </div>`;

  const recarregar = () => { if (ctx.ativo()) ficha(el, ctx); };
  $('#b-edit', el)?.addEventListener('click', async () => { if (await editarFicha(a, todosItens)) recarregar(); });
  $('#b-status', el)?.addEventListener('click', async () => {
    const ok = await abrirModal({
      titulo: 'Mudar situação', largura: 'sm', botao: 'Salvar',
      corpo: `<label>Nova situação<select name="st">${MOVEIS.filter((s) => s !== a.status).map((s) => `<option value="${s}">${STATUS[s][0]}</option>`).join('')}</select></label>
        <p class="muted pequeno">Em teste, em reparo ou em garantia, o aparelho não aparece no PDV.</p>
        <label>Observação<input name="obs" placeholder="Ex.: trocar a tela / enviado para a assistência do fornecedor"></label>`,
      aoSalvar: async (f) => { await rpc('mudar_status_aparelho', { p_serie: a.id, p_status: f.st.value, p_obs: f.obs.value }); return true; },
    });
    if (ok) { toast('Situação atualizada'); recarregar(); }
  });
  $('#b-teste', el)?.addEventListener('click', async () => {
    const r = await abrirModal({
      titulo: `Teste do IMEI ${esc(a.imei)}`, largura: 'sm', botao: 'Confirmar',
      corpo: `<label class="check"><input type="radio" name="res" value="ok" checked> Aprovado: volta para venda</label>
        <label class="check"><input type="radio" name="res" value="defeito"> Reprovado: vai para defeito e sai do estoque</label>
        <label>Observação / defeito encontrado<input name="m"></label>`,
      aoSalvar: async (f) => {
        const okv = f.res.value === 'ok';
        if (!okv && f.m.value.trim().length < 3) { f.erro('Descreva o defeito.'); return false; }
        await rpc('concluir_teste_serie', { p_serie: a.id, p_aprovado: okv, p_motivo: f.m.value }); return true;
      },
    });
    if (r) { toast('Teste registrado'); recarregar(); }
  });
  $('#b-vender', el)?.addEventListener('click', () => { estado.preAparelho = a.id; location.hash = '#/vendas/nova'; });
  $('#b-reservar', el)?.addEventListener('click', async () => {
    const { novaReserva } = await import('./orcamentos.js');
    const r = await novaReserva({ serieId: a.id }); if (r) location.hash = `#/vendas/reservas/${r.id}`;
  });
  $('#b-ver-res', el)?.addEventListener('click', async () => {
    try {
      const [r] = await consulta(estado.sb.from('reservas').select('id').eq('serie_id', a.id).eq('status', 'ativa'));
      if (r) location.hash = `#/vendas/reservas/${r.id}`; else toast('Reserva ativa não encontrada (pode estar presa a uma venda aguardando aprovação).', 'erro');
    } catch (err) { toast(msgErro(err), 'erro'); }
  });
  $('#b-nota', el).addEventListener('click', async () => {
    const ok = await abrirModal({
      titulo: 'Anotar na linha do tempo', largura: 'sm', botao: 'Anotar',
      corpo: '<label>Anotação<textarea name="t" rows="3" placeholder="Ex.: cliente Fulano reservou por telefone"></textarea></label>',
      aoSalvar: async (f) => { await rpc('anotar_aparelho', { p_serie: a.id, p_texto: f.t.value }); return true; },
    });
    if (ok) recarregar();
  });
  $('#b-custo', el)?.addEventListener('click', async () => {
    const ok = await abrirModal({
      titulo: 'Lançar custo de reparo', largura: 'sm', botao: 'Lançar',
      corpo: `<label>O que foi feito / comprado *<input name="d" placeholder="Ex.: tela original, bateria, mão de obra"></label>
        <label>Valor *<input name="v" data-mascara="dinheiro" inputmode="numeric"></label>
        <p class="muted pequeno">O valor soma no custo do aparelho. Se a peça foi paga à parte, lance também a conta em Finanças.</p>`,
      aoSalvar: async (f) => {
        if (f.d.value.trim().length < 2) { f.erro('Descreva o custo.'); return false; }
        if (!valorDinheiro(f.v)) { f.erro('Informe o valor.'); return false; }
        await rpc('adicionar_custo_aparelho', { p_serie: a.id, p_descricao: f.d.value, p_valor: valorDinheiro(f.v) }); return true;
      },
    });
    if (ok) { toast('Custo lançado'); recarregar(); }
  });
  $$('[data-cancelar]', el).forEach((b) => b.addEventListener('click', async () => {
    const m = await pedirMotivo({ titulo: 'Cancelar este custo?' });
    if (!m) return;
    try { await rpc('cancelar_custo_aparelho', { p_custo: b.dataset.cancelar, p_motivo: m }); toast('Custo cancelado'); recarregar(); } catch (err) { toast(msgErro(err), 'erro'); }
  }));
  $('#f-fotos', el)?.addEventListener('change', async (e) => {
    const arqs = [...e.target.files].slice(0, 8 - fotos.length);
    if (!arqs.length) { toast('Máximo de 8 fotos por aparelho.', 'erro'); return; }
    toast(`Enviando ${arqs.length} foto(s)…`);
    try {
      for (const arq of arqs) await rpc('adicionar_foto_aparelho', { p_serie: a.id, p_imagem: await reduzirFoto(arq), p_legenda: null });
      toast('Fotos incluídas'); recarregar();
    } catch (err) { toast(msgErro(err), 'erro'); recarregar(); }
  });
  $$('[data-foto]', el).forEach((b) => b.addEventListener('click', async () => {
    const fo = fotos.find((x) => x.id === b.dataset.foto);
    const r = await abrirModal({
      titulo: 'Foto do aparelho', largura: 'lg', botao: editar ? 'Remover foto' : null, botaoClasse: 'btn-danger', cancelar: 'Fechar',
      corpo: `<img src="${fo.imagem}" alt="" style="width:100%;max-height:70vh;object-fit:contain;border-radius:10px">`,
    });
    if (r && editar) { try { await rpc('remover_foto_aparelho', { p_foto: fo.id }); toast('Foto removida'); recarregar(); } catch (err) { toast(msgErro(err), 'erro'); } }
  }));
}

async function editarFicha(a, itensCheck) {
  const podePreco = pode('estoque.produtos');
  let origem = a.cliente_origem_id ? { id: a.cliente_origem_id, nome: a.origem_nome } : null;
  return abrirModal({
    titulo: 'Ficha do aparelho', largura: 'lg', botao: 'Salvar ficha',
    corpo: `<div class="form-grade">
      <label>Condição<select name="condicao">${Object.entries(CONDICOES_APARELHO).map(([k, v]) => `<option value="${k}" ${a.condicao === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Grau de conservação<select name="grau"><option value="">Não avaliado</option>${[['A', 'A — sem marcas'], ['B', 'B — marcas leves'], ['C', 'C — marcas visíveis']].map(([k, v]) => `<option value="${k}" ${a.grau === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Saúde da bateria (%)<input name="bateria" type="number" min="0" max="100" value="${a.bateria_pct ?? ''}"></label>
      <label>IMEI 2<input name="imei2" value="${esc(a.imei2)}" inputmode="numeric"></label>
      <label>Cor<input name="cor" value="${esc(a.cor)}" placeholder="Ex.: Azul-sierra"></label>
      <label>Capacidade<input name="capacidade" value="${esc(a.capacidade)}" placeholder="Ex.: 128GB" list="lista-cap"></label>
      <datalist id="lista-cap">${['64GB', '128GB', '256GB', '512GB', '1TB'].map((c) => `<option value="${c}">`).join('')}</datalist>
      <label class="col-2">Peças trocadas<input name="pecas" value="${esc(a.pecas_trocadas)}" placeholder="Ex.: tela original trocada, bateria nova"></label>
      ${podePreco ? `<label>Preço deste aparelho <span class="dica-campo muted">(vazio = preço do produto)</span><input name="preco" data-mascara="dinheiro" inputmode="numeric" value="${a.preco_proprio_centavos != null ? fmtMoeda(a.preco_proprio_centavos) : ''}"></label>` : ''}
      <label>Garantia na venda (dias) <span class="dica-campo muted">(vazio = padrão)</span><input name="garantia" type="number" min="0" max="3650" value="${a.garantia_dias ?? ''}"></label>
      <label>Procedência<select name="proc"><option value="">—</option>${Object.entries(PROCEDENCIA).map(([k, v]) => `<option value="${k}" ${a.procedencia === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label data-orig-wrap>Comprado de (cliente)<div class="linha"><input name="orig" readonly value="${esc(origem?.nome || '')}" placeholder="(opcional)"><button class="btn btn-ghost btn-sm" type="button" data-orig style="flex:0 0 auto">Escolher</button></div></label>
      <label class="col-2">Observação<input name="obs" value="${esc(a.observacao)}"></label>
    </div>
    <h4 style="margin:16px 0 8px">Checklist de testes</h4>
    <div class="tabela-wrap"><table class="tabela"><tbody>${itensCheck.map((i, n) => `<tr><td>${esc(i)}</td><td class="num"><select data-chk="${n}" style="width:auto">
      ${[['', 'Não testado'], ['ok', 'OK'], ['falha', 'Com problema']].map(([v, r]) => `<option value="${v}" ${(a.checklist || {})[i] === v ? 'selected' : ''}>${r}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>`,
    aoAbrir: (f) => {
      const upd = () => { $('[data-orig-wrap]', f).hidden = !['compra_cliente', 'trade_in'].includes(f.proc.value); };
      f.proc.addEventListener('change', upd); upd();
      $('[data-orig]', f).addEventListener('click', async () => { const c = await (await import('./clientes.js')).escolherCliente(); if (c) { origem = c; f.orig.value = c.nome; } });
    },
    aoSalvar: async (f) => {
      const bat = f.bateria.value === '' ? '' : Number(f.bateria.value);
      if (bat !== '' && !(bat >= 0 && bat <= 100)) { f.erro('Bateria entre 0 e 100%.'); return false; }
      const checklist = {};
      $$('[data-chk]', f).forEach((s) => { if (s.value) checklist[itensCheck[Number(s.dataset.chk)]] = s.value; });
      const p = { id: a.id, condicao: f.condicao.value, grau: f.grau.value, bateria_pct: bat, imei2: f.imei2.value, cor: f.cor.value,
        capacidade: f.capacidade.value.toUpperCase().replace(/\s+/g, ''), pecas_trocadas: f.pecas.value, garantia_dias: f.garantia.value,
        procedencia: f.proc.value, cliente_origem_id: ['compra_cliente', 'trade_in'].includes(f.proc.value) ? origem?.id || '' : '', observacao: f.obs.value, checklist };
      if (podePreco) p.preco_venda_centavos = f.preco.value ? valorDinheiro(f.preco) : '';
      await rpc('salvar_aparelho', { p });
      toast('Ficha salva');
      return true;
    },
  });
}

// Foto reduzida (até 1280 px, JPEG) para guardar no banco
function reduzirFoto(arq) {
  return new Promise((ok, falha) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      let q = 0.75; let url = c.toDataURL('image/jpeg', q);
      while (url.length > 650000 && q > 0.3) { q -= 0.1; url = c.toDataURL('image/jpeg', q); }
      ok(url);
    };
    img.onerror = falha;
    img.src = URL.createObjectURL(arq);
  });
}

// =====================================================================
// VENDIDOS E LUCRO
// =====================================================================
const fv = { mes: '' };
export async function vendidos(el, ctx) {
  if (!pode('vendas.ver_lucro')) { el.innerHTML = vazio('Sem acesso', 'Seu usuário não vê lucro.'); return; }
  if (!fv.mes) fv.mes = hojeSP().slice(0, 7);
  const ini = `${fv.mes}-01`; const fim = ultimoDiaMes(ini);
  const dados = await buscarTudo(() => estado.sb.from('aparelhos').select('*').eq('status', 'vendido').gte('venda_data', ini).lte('venda_data', fim).order('venda_data', { ascending: false }));
  if (!ctx.ativo()) return;
  const meses = Array.from({ length: 18 }, (_, i) => addMeses(hojeSP().slice(0, 7) + '-01', -i).slice(0, 7));
  const fat = dados.reduce((s, a) => s + (a.venda_valor_centavos || 0), 0);
  const luc = dados.reduce((s, a) => s + (a.lucro_centavos || 0), 0);
  const porModelo = new Map();
  dados.forEach((a) => { const x = porModelo.get(a.produto) || { qtd: 0, fat: 0, luc: 0 }; x.qtd++; x.fat += a.venda_valor_centavos || 0; x.luc += a.lucro_centavos || 0; porModelo.set(a.produto, x); });
  el.innerHTML = `${abas('vendidos')}${cabecalho('Aparelhos vendidos e lucro', { sub: 'Lucro de cada aparelho = valor da venda − custo de aquisição − reparos − taxa do cartão.' })}
    <div class="ferramentas" style="margin-bottom:12px"><select id="f-mes" style="width:auto">${meses.map((m) => `<option value="${m}" ${m === fv.mes ? 'selected' : ''}>${nomeMes(m)}</option>`).join('')}</select>
      <span style="flex:1"></span><button class="btn btn-ghost btn-sm" id="b-exp" type="button">Exportar</button></div>
    <div class="kpis">${kpi('Aparelhos vendidos', fmtNum(dados.length))}${kpi('Faturamento', fmtMoeda(fat))}
      ${kpi('Lucro', fmtMoeda(luc), fat ? `margem ${fmtPct(luc / fat * 100)}` : '', luc < 0 ? 'neg' : 'pos')}${kpi('Lucro médio por aparelho', fmtMoeda(dados.length ? Math.round(luc / dados.length) : 0))}</div>
    ${porModelo.size > 1 ? `<div class="card" style="margin-bottom:16px"><div class="card-topo"><h3>Por modelo</h3></div><div class="tabela-wrap"><table class="tabela"><thead><tr><th>Modelo</th><th class="num">Qtd</th><th class="num">Faturamento</th><th class="num">Lucro</th><th class="num">Margem</th></tr></thead><tbody>
      ${[...porModelo.entries()].sort((a, b) => b[1].luc - a[1].luc).map(([m, x]) => `<tr><td>${esc(m)}</td><td class="num">${x.qtd}</td><td class="num">${fmtMoeda(x.fat)}</td><td class="num ${x.luc < 0 ? 'neg' : ''}">${fmtMoeda(x.luc)}</td><td class="num">${x.fat ? fmtPct(x.luc / x.fat * 100) : '—'}</td></tr>`).join('')}
    </tbody></table></div></div>` : ''}
    <div class="card">${dados.length ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Data</th><th>Aparelho</th><th class="esconder-cel">Cliente</th><th class="num">Venda</th><th class="num esconder-cel">Custo</th><th class="num esconder-cel">Taxa</th><th class="num">Lucro</th></tr></thead><tbody>
      ${dados.map((a) => `<tr class="clicavel" data-id="${a.id}"><td>${fmtData(a.venda_data)}<div class="muted pequeno">nº ${a.venda_numero}</div></td>
        <td><b>${esc(nomeAparelho(a))}</b><div class="muted pequeno">IMEI ${esc(a.imei)}${a.grau ? ` · grau ${a.grau}` : ''}</div></td>
        <td class="esconder-cel">${esc(a.venda_cliente_nome || '—')}<div class="muted pequeno">${esc(a.venda_vendedor_nome || '')}</div></td>
        <td class="num">${fmtMoeda(a.venda_valor_centavos)}</td><td class="num esconder-cel">${fmtMoeda(a.custo_total_centavos)}</td><td class="num esconder-cel">${fmtMoeda(a.venda_taxa_centavos)}</td>
        <td class="num ${a.lucro_centavos < 0 ? 'neg' : 'pos'}"><b>${fmtMoeda(a.lucro_centavos)}</b><div class="muted pequeno">${a.venda_valor_centavos ? fmtPct(a.lucro_centavos / a.venda_valor_centavos * 100) : ''}</div></td></tr>`).join('')}
    </tbody></table></div>` : vazio('Nenhum aparelho vendido neste mês', '')}</div>`;
  $('#f-mes', el).addEventListener('change', (e) => { fv.mes = e.target.value; vendidos(el, ctx); });
  $$('tr[data-id]', el).forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/aparelhos/${tr.dataset.id}`; }));
  $('#b-exp', el).addEventListener('click', () => baixarCsv(`aparelhos-vendidos-${fv.mes}.csv`, ['Data', 'Venda', 'Aparelho', 'IMEI', 'Grau', 'Cliente', 'Vendedor', 'Valor', 'Custo', 'Taxa', 'Lucro'],
    dados.map((a) => [fmtData(a.venda_data), a.venda_numero, nomeAparelho(a), a.imei, a.grau, a.venda_cliente_nome, a.venda_vendedor_nome,
      csvMoeda(a.venda_valor_centavos), csvMoeda(a.custo_total_centavos), csvMoeda(a.venda_taxa_centavos), csvMoeda(a.lucro_centavos)])));
}
