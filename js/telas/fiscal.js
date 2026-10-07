// Fiscal: notas das vendas (NFC-e / NF-e) e das OS (NFS-e), configuração fiscal e pacote do contador.
// Enquanto a loja não contrata um emissor, o sistema prepara a nota, mostra o que falta e registra a nota emitida.
import {
  estado, pode, $, $$, esc, fmtMoeda, fmtData, fmtDataHora, hojeSP, addMeses, nomeMes, ultimoDiaMes, somarDias,
  abrirModal, pedirMotivo, toast, msgErro, rpc, consulta, buscarTudo, lista as listaCache, limparCache, cabecalho, vazio, carregando, tag, kpi, icone, csvMoeda,
} from '../core.js';

export const TIPOS = { nfce: 'NFC-e', nfe: 'NF-e', nfse: 'NFS-e' };
const EMISSORES = { nenhum: 'Ainda não contratado', focus: 'Focus NFe', plugnotas: 'PlugNotas', nfeio: 'NFE.io', enotas: 'eNotas', outro: 'Outro / portal do governo' };
const ORIGENS = { 0: '0 — Nacional', 1: '1 — Importado direto', 2: '2 — Importado no mercado interno', 3: '3 — Nacional com mais de 40% importado',
  5: '5 — Nacional com até 40% importado', 8: '8 — Nacional com mais de 70% importado' };

function abas(atual) {
  const itens = [['notas', 'Notas fiscais', '#/fiscal', pode('fiscal.notas') || pode('fiscal.config')], ['config', 'Configuração fiscal', '#/fiscal/config', pode('fiscal.config')],
    ['contador', 'Pacote do contador', '#/fiscal/contador', pode('fiscal.config')]].filter((x) => x[3]);
  return `<nav class="abas-pagina">${itens.map(([id, r, h]) => `<a href="${h}" class="${id === atual ? 'ativa' : ''}">${r}</a>`).join('')}</nav>`;
}
const avisoEmissor = (st) => (st.emissor === 'nenhum' ? `<div class="alerta" style="cursor:default">${icone('alerta')}<span>A loja ainda não tem emissor fiscal ligado ao sistema. Por enquanto: prepare a nota aqui, emita no emissor/portal que vocês usam e registre o número. Quando contratarem um emissor (ex.: Focus NFe), o envio passa a ser direto daqui.</span></div>` : '');

// =====================================================================
// NOTA DE UMA VENDA OU OS (modal)
// =====================================================================
export async function abrirNota({ venda = null, os = null, tipo = null } = {}) {
  let t = tipo || (os ? 'nfse' : 'nfce');
  let mudou = false;
  const render = async (f) => {
    const corpo = $('[data-nota-corpo]', f);
    corpo.innerHTML = carregando();
    let d;
    try { d = await rpc('fiscal_preparar', { p_tipo: t, p_venda: venda, p_os: os }); } catch (err) { corpo.innerHTML = vazio('Não deu para preparar', esc(msgErro(err))); return; }
    const ja = d.ja_emitida;
    const prod = t !== 'nfse';
    corpo.innerHTML = `
      ${ja ? `<div class="alerta" style="cursor:default;border-color:var(--ok)">${icone('alerta')}<span><b>${TIPOS[t]} nº ${ja.numero}</b> já registrada${ja.chave ? ` · chave ${esc(ja.chave)}` : ''}.</span></div>`
        : d.pronta ? `<p>${tag('Pronta para emitir', 'ok')} <span class="muted pequeno">Ambiente: ${d.ambiente === 'producao' ? 'produção' : 'homologação (teste)'}</span></p>`
          : `<div class="alerta" style="cursor:default">${icone('alerta')}<span><b>Falta acertar antes de emitir:</b><br>${d.problemas.map(esc).join('<br>')}</span></div>`}
      ${d.avisos.length ? `<p class="muted pequeno">${d.avisos.map((a) => `• ${esc(a)}`).join('<br>')}</p>` : ''}
      <p class="pequeno"><b>Destinatário:</b> ${d.destinatario ? `${esc(d.destinatario.nome)}${d.destinatario.cpf ? ` · CPF ${esc(d.destinatario.cpf)}` : ''}${d.destinatario.cnpj ? ` · CNPJ ${esc(d.destinatario.cnpj)}` : ''}` : 'consumidor não identificado'}${d.interestadual ? ' · ' + tag('interestadual', 'warn') : ''}</p>
      <div class="tabela-wrap"><table class="tabela"><thead><tr><th>Item</th>${prod ? '<th>NCM</th><th>CFOP</th><th>CSOSN</th>' : '<th>Serviço</th><th class="num">ISS</th>'}<th class="num">Qtd</th><th class="num">Valor</th></tr></thead><tbody>
        ${d.itens.map((i) => `<tr><td>${esc(i.descricao)}${i.imei ? `<div class="muted pequeno">IMEI ${esc(i.imei)}</div>` : ''}${i.desconto_centavos ? `<div class="muted pequeno">desconto ${fmtMoeda(i.desconto_centavos)}</div>` : ''}</td>
          ${prod ? `<td>${i.ncm ? esc(i.ncm) : '<span class="neg">falta</span>'}</td><td>${esc(i.cfop || '—')}</td><td>${esc(i.csosn || i.cst_icms || '—')}</td>` : `<td>${esc(i.codigo_servico || '—')}</td><td class="num">${i.aliquota_iss != null ? `${String(i.aliquota_iss).replace('.', ',')}%` : '<span class="neg">falta</span>'}</td>`}
          <td class="num">${String(i.quantidade).replace('.', ',')}</td><td class="num">${fmtMoeda(i.valor_total_centavos)}</td></tr>`).join('') || `<tr><td colspan="6" class="muted">Sem itens para esta nota.</td></tr>`}
      </tbody></table></div>
      <p style="text-align:right"><b>Total da nota: ${fmtMoeda(d.totais.valor_total_centavos)}</b></p>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        <button class="btn btn-ghost btn-sm" type="button" data-copiar>Copiar dados para o emissor</button>
        ${!ja && pode('fiscal.notas') ? '<button class="btn btn-primary btn-sm" type="button" data-registrar>Registrar nota emitida</button>' : ''}
        ${ja && pode('fiscal.notas') ? '<button class="btn btn-ghost btn-sm" type="button" data-cancelar style="color:var(--danger)">Registrar cancelamento</button>' : ''}
      </div>`;
    $('[data-copiar]', corpo).addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(JSON.stringify(d, null, 2)); toast('Dados copiados'); } catch { toast('Não deu para copiar', 'erro'); }
    });
    $('[data-registrar]', corpo)?.addEventListener('click', async () => {
      if (!d.pronta && !(await confirmarPendencias())) return;
      const r = await abrirModal({
        titulo: `Registrar ${TIPOS[t]} emitida`, largura: 'sm', botao: 'Registrar',
        corpo: `<p class="muted pequeno">Copie do emissor/portal os dados da nota que você acabou de emitir.</p>
          <div class="form-grade"><label>Número *<input name="num" inputmode="numeric" autofocus></label><label>Série<input name="serie" value="${esc(d.serie ?? '')}"></label></div>
          ${prod ? '<label>Chave de acesso (44 números) *<input name="chave" inputmode="numeric" maxlength="60"></label>' : '<label>Código de verificação<input name="prot"></label>'}
          <label>Link da nota (PDF/consulta)<input name="url" type="url" placeholder="https://"></label>`,
        aoSalvar: async (ff) => {
          const num = Number(ff.num.value.replace(/\D/g, ''));
          if (!num) { ff.erro('Informe o número.'); return false; }
          return rpc('fiscal_registrar', { p_tipo: t, p_venda: prod ? venda : null, p_os: prod ? null : os, p_numero: num, p_serie: ff.serie.value,
            p_chave: ff.chave?.value || null, p_url: ff.url.value || null, p_protocolo: ff.prot?.value || null });
        },
      });
      if (r) { toast('Nota registrada'); mudou = true; render(f); }
    });
    $('[data-cancelar]', corpo)?.addEventListener('click', async () => {
      const m = await pedirMotivo({ titulo: `Cancelar ${TIPOS[t]} nº ${ja.numero}`, texto: 'Registre aqui depois de cancelar no emissor/portal. Justificativa com pelo menos 15 caracteres.', botao: 'Registrar cancelamento' });
      if (!m) return;
      try { await rpc('fiscal_cancelar', { p_nota: ja.id, p_motivo: m }); toast('Cancelamento registrado'); mudou = true; render(f); } catch (err) { toast(msgErro(err), 'erro'); }
    });
  };
  const opcoes = os ? ['nfse'] : ['nfce', 'nfe'];
  await abrirModal({
    titulo: os ? 'Nota fiscal de serviço da OS' : 'Nota fiscal da venda', largura: 'lg', botao: null, cancelar: 'Fechar',
    corpo: `${opcoes.length > 1 ? `<div class="abas-pagina" style="margin-bottom:10px">${opcoes.map((o) => `<button type="button" data-tipo="${o}" class="${o === t ? 'ativa' : ''}">${TIPOS[o]}${o === 'nfce' ? ' (consumidor)' : ' (empresa / outro estado)'}</button>`).join('')}</div>` : ''}
      <div data-nota-corpo></div>`,
    aoAbrir: (f) => {
      $$('[data-tipo]', f).forEach((b) => b.addEventListener('click', () => { t = b.dataset.tipo; $$('[data-tipo]', f).forEach((x) => x.classList.toggle('ativa', x === b)); render(f); }));
      render(f);
    },
  });
  return mudou;
}
function confirmarPendencias() {
  return abrirModal({ titulo: 'A nota tem pendências', largura: 'sm', botao: 'Registrar mesmo assim',
    corpo: '<p>O sistema encontrou dados faltando. Se a nota já foi emitida pelo emissor/portal mesmo assim, você pode registrar, mas acerte os cadastros para as próximas.</p>' });
}

// =====================================================================
// NOTAS FISCAIS: pendentes e emitidas
// =====================================================================
const n0 = { aba: 'pendentes', mes: '' };
export async function notas(el, ctx) {
  if (!n0.mes) n0.mes = hojeSP().slice(0, 7);
  const ini = `${n0.mes}-01`; const fim = ultimoDiaMes(ini);
  const [st, pend, emit] = await Promise.all([
    rpc('fiscal_status'),
    rpc('fiscal_pendentes', { p_inicio: ini, p_fim: fim }),
    consulta(estado.sb.from('notas_fiscais').select('id,tipo,numero,serie,chave,status,valor_centavos,emitida_em,venda_id,os_id,url,motivo_cancelamento')
      .gte('emitida_em', `${ini}T00:00:00-03:00`).lte('emitida_em', `${fim}T23:59:59-03:00`).order('emitida_em', { ascending: false })),
  ]);
  if (!ctx.ativo()) return;
  const meses = Array.from({ length: 13 }, (_, i) => addMeses(hojeSP().slice(0, 7) + '-01', -i).slice(0, 7));
  const ativas = emit.filter((n) => n.status === 'emitida');
  el.innerHTML = `${abas('notas')}${cabecalho('Notas fiscais', { sub: 'Vendas e OS do mês ainda sem nota, e as notas já emitidas.' })}
    ${avisoEmissor(st)}
    <div class="kpis">
      ${kpi('Vendas sem nota', pend.vendas.length, fmtMoeda(pend.vendas.reduce((s, x) => s + x.total, 0)), pend.vendas.length ? 'neg' : '')}
      ${kpi('OS sem NFS-e', pend.os.length, `mão de obra ${fmtMoeda(pend.os.reduce((s, x) => s + x.mao_obra, 0))}`, pend.os.length ? 'neg' : '')}
      ${kpi('Notas emitidas', ativas.length, fmtMoeda(ativas.reduce((s, n) => s + Number(n.valor_centavos), 0)))}
      ${st.produtos_sem_ncm ? kpi('Produtos sem NCM', st.produtos_sem_ncm, '<a href="#/fiscal/config">acertar</a>', 'neg') : ''}
    </div>
    <div class="card"><div class="ferramentas">
      <select id="f-mes" style="width:auto">${meses.map((m) => `<option value="${m}" ${m === n0.mes ? 'selected' : ''}>${nomeMes(m)}</option>`).join('')}</select>
      <nav class="abas-pagina" style="margin:0;border:0">${[['pendentes', 'Sem nota'], ['emitidas', 'Emitidas']].map(([k, r]) => `<button type="button" data-aba="${k}" class="${n0.aba === k ? 'ativa' : ''}">${r}</button>`).join('')}</nav>
    </div>
    ${n0.aba === 'pendentes' ? `${pend.vendas.length || pend.os.length ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Origem</th><th>Cliente</th><th class="esconder-cel">Data</th><th class="num">Valor</th><th></th></tr></thead><tbody>
        ${pend.vendas.map((x) => `<tr><td><a href="#/vendas/${x.id}">Venda nº ${x.numero}</a></td><td>${esc(x.cliente || 'Consumidor')}${x.cliente && !x.tem_doc ? ' <span class="muted pequeno">(sem CPF/CNPJ)</span>' : ''}</td>
          <td class="esconder-cel">${fmtData(x.data)}</td><td class="num">${fmtMoeda(x.total)}</td><td class="num"><button class="btn btn-ghost btn-sm" type="button" data-venda="${x.id}">Nota</button></td></tr>`).join('')}
        ${pend.os.map((x) => `<tr><td><a href="#/os/${x.id}">OS nº ${x.numero}</a><div class="muted pequeno">${esc(x.aparelho)}</div></td><td>${esc(x.cliente || '')}</td>
          <td class="esconder-cel">${fmtData(x.data)}</td><td class="num">${fmtMoeda(x.mao_obra)}<div class="muted pequeno">mão de obra</div></td><td class="num"><button class="btn btn-ghost btn-sm" type="button" data-os="${x.id}">NFS-e</button></td></tr>`).join('')}
      </tbody></table></div>` : vazio('Tudo com nota neste mês', '')}`
      : `${emit.length ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Nota</th><th>Origem</th><th class="esconder-cel">Emitida</th><th class="num">Valor</th><th>Situação</th></tr></thead><tbody>
        ${emit.map((n) => `<tr><td><b>${TIPOS[n.tipo]} nº ${n.numero}</b>${n.serie ? ` <span class="muted pequeno">série ${esc(n.serie)}</span>` : ''}${n.url ? ` · <a href="${esc(n.url)}" target="_blank" rel="noopener">ver</a>` : ''}</td>
          <td>${n.venda_id ? `<button class="link-btn" data-venda="${n.venda_id}" data-tipo-nota="${n.tipo}">venda</button>` : `<button class="link-btn" data-os="${n.os_id}">OS</button>`}</td>
          <td class="esconder-cel">${fmtDataHora(n.emitida_em)}</td><td class="num">${fmtMoeda(n.valor_centavos)}</td>
          <td>${n.status === 'emitida' ? tag('Emitida', 'ok') : `${tag('Cancelada', 'cinza')}<div class="muted pequeno">${esc(n.motivo_cancelamento || '')}</div>`}</td></tr>`).join('')}
      </tbody></table></div>` : vazio('Nenhuma nota registrada neste mês', '')}`}
    </div>`;
  const recarregar = () => { if (ctx.ativo()) notas(el, ctx); };
  $('#f-mes', el).addEventListener('change', (e) => { n0.mes = e.target.value; recarregar(); });
  $$('[data-aba]', el).forEach((b) => b.addEventListener('click', () => { n0.aba = b.dataset.aba; recarregar(); }));
  $$('[data-venda]', el).forEach((b) => b.addEventListener('click', async () => { if (await abrirNota({ venda: b.dataset.venda, tipo: b.dataset.tipoNota })) recarregar(); }));
  $$('[data-os]', el).forEach((b) => b.addEventListener('click', async () => { if (await abrirNota({ os: b.dataset.os })) recarregar(); }));
}

// =====================================================================
// CONFIGURAÇÃO FISCAL
// =====================================================================
export async function config(el, ctx) {
  const [st, e, regras, cats, prods] = await Promise.all([
    rpc('fiscal_status'),
    consulta(estado.sb.from('empresa').select('*').eq('id', 1).single()),
    consulta(estado.sb.from('regras_fiscais').select('*').order('tipo').order('nome')),
    consulta(estado.sb.from('categorias').select('id,nome,tipo,ncm_padrao,regra_fiscal_id,ativo').eq('tipo', 'venda').order('ordem').order('nome')),
    buscarTudo(() => estado.sb.from('produtos').select('id,nome,sku,categoria_id,categoria,tipo,ncm,cest,origem_fiscal,regra_fiscal_id').eq('ativo', true).neq('tipo', 'servico').order('nome')),
  ]);
  if (!ctx.ativo()) return;
  const regrasProd = regras.filter((r) => r.tipo === 'produto' && r.ativo);
  const catNcm = Object.fromEntries(cats.map((c) => [c.id, c.ncm_padrao]));
  const semNcm = prods.filter((p) => !p.ncm && !catNcm[p.categoria_id]);
  const optRegra = (sel, vazioTxt = 'Da categoria / padrão') => `<option value="">${vazioTxt}</option>${regrasProd.map((r) => `<option value="${r.id}" ${sel === r.id ? 'selected' : ''}>${esc(r.nome)}</option>`).join('')}`;
  const ok = (b, txt) => `<li>${b ? '<span class="pos">✓</span>' : '<span class="neg">✗</span>'} ${txt}</li>`;
  const certDias = e.certificado_validade ? Math.round((new Date(`${e.certificado_validade}T12:00:00`) - new Date()) / 86400000) : null;
  el.innerHTML = `${abas('config')}${cabecalho('Configuração fiscal', { sub: 'Regras de imposto, NCM dos produtos e dados do emissor. Use o padrão do Simples Nacional como ponto de partida e peça ao contador para conferir.' })}
    <div class="grade-2" style="align-items:start">
      <div class="card card-pad"><h3 style="margin-bottom:8px">O que falta para emitir</h3><ul style="list-style:none;padding:0;display:grid;gap:6px">
        ${ok(st.empresa_ok, 'Dados da loja: CNPJ, razão social, inscrição estadual, regime e endereço com CEP consultado <a href="#/config/empresa">(Empresa)</a>')}
        ${ok(!st.regras_incompletas, 'Regras de produto com CFOP e CSOSN')}
        ${ok(!st.servico_sem_iss, 'Regra de serviço com código LC 116 e alíquota de ISS')}
        ${ok(!st.produtos_sem_ncm, `NCM em todos os produtos${st.produtos_sem_ncm ? ` (${st.produtos_sem_ncm} sem NCM)` : ''}`)}
        ${ok(st.emissor !== 'nenhum', 'Emissor fiscal contratado')}
        ${ok(certDias !== null && certDias > 0, `Certificado digital A1${certDias !== null ? ` (vence em ${fmtData(e.certificado_validade)}${certDias <= 30 ? `, <b class="neg">${certDias} dias</b>` : ''})` : ''}`)}
      </ul></div>
      <div class="card card-pad"><form id="f-emissor"><h3 style="margin-bottom:8px">Emissor e numeração</h3><div class="form-grade">
        <label>Emissor<select name="emissor">${Object.entries(EMISSORES).map(([k, v]) => `<option value="${k}" ${e.fiscal_emissor === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Ambiente<select name="amb"><option value="homologacao" ${e.fiscal_ambiente === 'homologacao' ? 'selected' : ''}>Homologação (teste)</option><option value="producao" ${e.fiscal_ambiente === 'producao' ? 'selected' : ''}>Produção</option></select></label>
        <label>Série da NFC-e<input name="snfce" type="number" min="0" max="999" value="${e.nfce_serie ?? 1}"></label>
        <label>Série da NF-e<input name="snfe" type="number" min="0" max="999" value="${e.nfe_serie ?? 1}"></label>
        <label>CNAE principal<input name="cnae" value="${esc(e.cnae || '')}" placeholder="ex.: 4752100"></label>
        <label>Certificado A1 vence em<input name="cert" type="date" value="${esc(e.certificado_validade || '')}"></label>
        <label class="col-2">Informações complementares padrão<textarea name="obs" rows="2" placeholder="ex.: Documento emitido por ME ou EPP optante pelo Simples Nacional.">${esc(e.fiscal_obs_padrao || '')}</textarea></label>
      </div><button class="btn btn-primary btn-sm" type="submit">Salvar</button></form></div>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-topo"><h3>Regras de tributação</h3><button class="btn btn-ghost btn-sm" type="button" id="b-regra">+ Nova regra</button></div>
      <div class="tabela-wrap"><table class="tabela"><thead><tr><th>Regra</th><th>CFOP (no estado / fora)</th><th>CSOSN/CST</th><th class="esconder-cel">Serviço / ISS</th><th></th></tr></thead><tbody>
      ${regras.map((r) => `<tr class="clicavel ${r.ativo ? '' : 'cancelado'}" data-regra="${r.id}"><td><b>${esc(r.nome)}</b> ${r.padrao ? tag('padrão', 'ok') : ''} ${tag(r.tipo === 'servico' ? 'serviço' : 'produto', 'cinza')}${r.observacao ? `<div class="muted pequeno">${esc(r.observacao)}</div>` : ''}</td>
        <td>${r.tipo === 'produto' ? `${esc(r.cfop_interno || '—')} / ${esc(r.cfop_interestadual || '—')}` : '—'}</td><td>${esc(r.csosn || r.cst_icms || '—')}</td>
        <td class="esconder-cel">${r.tipo === 'servico' ? `${esc(r.codigo_servico || '—')} · ${r.aliquota_iss != null ? String(r.aliquota_iss).replace('.', ',') + '%' : '<span class="neg">sem ISS</span>'}` : '—'}</td><td class="num">${r.ativo ? '' : tag('inativa', 'cinza')}</td></tr>`).join('')}
      </tbody></table></div></div>
    <div class="card" style="margin-top:16px"><div class="card-topo"><h3>NCM e regra por categoria</h3><button class="btn btn-ghost btn-sm" type="button" id="b-cats">Salvar categorias</button></div>
      <p class="muted pequeno card-pad" style="margin:0">O produto sem NCM próprio usa o da categoria. Já deixamos sugestões comuns para loja de celular: confira com o contador.</p>
      <div class="tabela-wrap"><table class="tabela"><thead><tr><th>Categoria</th><th>NCM padrão</th><th>Regra</th></tr></thead><tbody>
      ${cats.map((c) => `<tr><td>${esc(c.nome)}</td><td><input data-cat-ncm="${c.id}" value="${esc(c.ncm_padrao || '')}" inputmode="numeric" maxlength="8" style="margin:0;width:120px"></td>
        <td><select data-cat-regra="${c.id}" style="margin:0">${optRegra(c.regra_fiscal_id, 'Regra padrão')}</select></td></tr>`).join('')}
      </tbody></table></div></div>
    <div class="card" style="margin-top:16px"><div class="card-topo"><h3>Produtos ${semNcm.length ? `sem NCM (${semNcm.length})` : ''}</h3>
      <div style="display:flex;gap:6px;align-items:center"><label class="check pequeno" style="margin:0"><input type="checkbox" id="c-todos" ${semNcm.length ? '' : 'checked'}> mostrar todos</label><button class="btn btn-ghost btn-sm" type="button" id="b-prods">Salvar produtos</button></div></div>
      <div id="tab-prods"></div></div>`;

  const pintarProds = () => {
    const lista = $('#c-todos', el).checked ? prods : semNcm;
    $('#tab-prods', el).innerHTML = lista.length ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Produto</th><th>NCM</th><th class="esconder-cel">CEST</th><th class="esconder-cel">Origem</th><th>Regra</th></tr></thead><tbody>
      ${lista.slice(0, 300).map((p) => `<tr data-prod="${p.id}"><td>${esc(p.nome)}<div class="muted pequeno">${esc(p.categoria || '')}${!p.ncm && catNcm[p.categoria_id] ? ` · usa ${catNcm[p.categoria_id]} da categoria` : ''}</div></td>
        <td><input data-f="ncm" value="${esc(p.ncm || '')}" inputmode="numeric" maxlength="8" style="margin:0;width:110px" placeholder="${esc(catNcm[p.categoria_id] || '')}"></td>
        <td class="esconder-cel"><input data-f="cest" value="${esc(p.cest || '')}" style="margin:0;width:100px"></td>
        <td class="esconder-cel"><select data-f="origem" style="margin:0">${Object.entries(ORIGENS).map(([k, v]) => `<option value="${k}" ${Number(p.origem_fiscal || 0) === Number(k) ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
        <td><select data-f="regra" style="margin:0">${optRegra(p.regra_fiscal_id)}</select></td></tr>`).join('')}
      </tbody></table></div>${lista.length > 300 ? '<p class="muted pequeno card-pad">Mostrando os 300 primeiros.</p>' : ''}` : vazio('Todos os produtos têm NCM', 'Marque “mostrar todos” para revisar.');
  };
  pintarProds();
  const recarregar = () => { if (ctx.ativo()) config(el, ctx); };
  $('#c-todos', el).addEventListener('change', pintarProds);
  $('#b-prods', el).addEventListener('click', async () => {
    const itens = $$('tr[data-prod]', el).map((tr) => ({ id: tr.dataset.prod, ncm: $('[data-f=ncm]', tr).value.replace(/\D/g, ''), cest: $('[data-f=cest]', tr).value.trim(),
      origem_fiscal: $('[data-f=origem]', tr).value, regra_fiscal_id: $('[data-f=regra]', tr).value }));
    const ruim = itens.find((i) => i.ncm && i.ncm.length !== 8);
    if (ruim) { toast('NCM tem 8 números. Confira os destacados.', 'erro'); $(`tr[data-prod="${ruim.id}"] [data-f=ncm]`, el).focus(); return; }
    try { const n = await rpc('salvar_fiscal_produtos', { p_itens: itens }); toast(`${n} produto(s) atualizado(s)`); recarregar(); } catch (err) { toast(msgErro(err), 'erro'); }
  });
  $('#b-cats', el).addEventListener('click', async () => {
    try {
      for (const c of cats) {
        const ncm = $(`[data-cat-ncm="${c.id}"]`, el).value.replace(/\D/g, '') || null;
        const regra = $(`[data-cat-regra="${c.id}"]`, el).value || null;
        if (ncm && ncm.length !== 8) { toast(`NCM da categoria ${c.nome} precisa ter 8 números.`, 'erro'); return; }
        if (ncm !== (c.ncm_padrao || null) || regra !== (c.regra_fiscal_id || null)) await consulta(estado.sb.from('categorias').update({ ncm_padrao: ncm, regra_fiscal_id: regra }).eq('id', c.id).select('id'));
      }
      limparCache('categorias'); toast('Categorias salvas'); recarregar();
    } catch (err) { toast(msgErro(err), 'erro'); }
  });
  $('#f-emissor', el).addEventListener('submit', async (ev) => {
    ev.preventDefault(); const f = ev.target;
    const dados = { fiscal_emissor: f.emissor.value, fiscal_ambiente: f.amb.value, nfce_serie: Number(f.snfce.value) || 0, nfe_serie: Number(f.snfe.value) || 0,
      cnae: f.cnae.value.replace(/\D/g, '') || null, certificado_validade: f.cert.value || null, fiscal_obs_padrao: f.obs.value.trim() || null };
    try { estado.empresa = await consulta(estado.sb.from('empresa').update(dados).eq('id', 1).select().single()); toast('Dados fiscais salvos'); recarregar(); } catch (err) { toast(msgErro(err), 'erro'); }
  });
  const editarRegra = async (r) => {
    const res = await abrirModal({
      titulo: r ? `Regra: ${esc(r.nome)}` : 'Nova regra fiscal', largura: 'md', botao: 'Salvar',
      corpo: `<div class="form-grade">
        <label class="col-2">Nome *<input name="nome" value="${esc(r?.nome || '')}"></label>
        <label>Tipo<select name="tipo" ${r ? 'disabled' : ''}><option value="produto" ${r?.tipo !== 'servico' ? 'selected' : ''}>Produto</option><option value="servico" ${r?.tipo === 'servico' ? 'selected' : ''}>Serviço</option></select></label>
        <label class="check" style="align-self:end"><input type="checkbox" name="padrao" ${r?.padrao ? 'checked' : ''}> Regra padrão deste tipo</label>
        <label data-p>CFOP dentro do estado<input name="cfi" value="${esc(r?.cfop_interno || '')}" maxlength="4" inputmode="numeric"></label>
        <label data-p>CFOP para outro estado<input name="cfe" value="${esc(r?.cfop_interestadual || '')}" maxlength="4" inputmode="numeric"></label>
        <label data-p>CSOSN (Simples)<input name="csosn" value="${esc(r?.csosn || '')}" maxlength="3" inputmode="numeric"></label>
        <label data-p>CST ICMS (fora do Simples)<input name="cst" value="${esc(r?.cst_icms || '')}" maxlength="2" inputmode="numeric"></label>
        <label data-p>Alíquota ICMS (%)<input name="aicms" inputmode="decimal" value="${r?.aliquota_icms != null ? String(r.aliquota_icms).replace('.', ',') : ''}"></label>
        <label data-p>CST PIS/COFINS<input name="pis" value="${esc(r?.cst_pis_cofins || '')}" maxlength="2" inputmode="numeric"></label>
        <label data-s>Código do serviço (LC 116)<input name="cod" value="${esc(r?.codigo_servico || '')}" placeholder="14.01"></label>
        <label data-s>Alíquota ISS (%)<input name="iss" inputmode="decimal" value="${r?.aliquota_iss != null ? String(r.aliquota_iss).replace('.', ',') : ''}"></label>
        <label data-s class="check"><input type="checkbox" name="ret" ${r?.iss_retido ? 'checked' : ''}> ISS retido pelo tomador</label>
        <label class="col-2">Observação<input name="obs" value="${esc(r?.observacao || '')}"></label>
        ${r ? `<label class="check col-2"><input type="checkbox" name="ativo" ${r.ativo ? 'checked' : ''}> Regra ativa</label>` : ''}</div>`,
      aoAbrir: (f) => { const upd = () => { const s = f.tipo.value === 'servico'; $$('[data-p]', f).forEach((x) => { x.hidden = s; }); $$('[data-s]', f).forEach((x) => { x.hidden = !s; }); }; f.tipo.addEventListener('change', upd); upd(); },
      aoSalvar: async (f) => {
        const num = (v) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
        const d = { nome: f.nome.value.trim(), padrao: f.padrao.checked, cfop_interno: f.cfi.value || null, cfop_interestadual: f.cfe.value || null, csosn: f.csosn.value || null,
          cst_icms: f.cst.value || null, aliquota_icms: num(f.aicms.value), cst_pis_cofins: f.pis.value || null, codigo_servico: f.cod.value.trim() || null,
          aliquota_iss: num(f.iss.value), iss_retido: f.ret.checked, observacao: f.obs.value.trim() || null, ativo: r ? f.ativo.checked : true };
        if (!r) d.tipo = f.tipo.value;
        if (d.nome.length < 2) { f.erro('Informe o nome.'); return false; }
        const tipo = r?.tipo || d.tipo;
        if (d.padrao) await consulta(estado.sb.from('regras_fiscais').update({ padrao: false }).eq('tipo', tipo).neq('id', r?.id || '00000000-0000-0000-0000-000000000000').select('id'));
        if (r) await consulta(estado.sb.from('regras_fiscais').update(d).eq('id', r.id).select('id'));
        else await consulta(estado.sb.from('regras_fiscais').insert(d).select('id'));
        return true;
      },
    });
    if (res) { toast('Regra salva'); recarregar(); }
  };
  $('#b-regra', el).addEventListener('click', () => editarRegra(null));
  $$('tr[data-regra]', el).forEach((tr) => tr.addEventListener('click', () => editarRegra(regras.find((r) => r.id === tr.dataset.regra))));
}

// =====================================================================
// PACOTE DO CONTADOR
// =====================================================================
const c0 = { mes: '' };
export async function contador(el, ctx) {
  if (!c0.mes) c0.mes = addMeses(hojeSP().slice(0, 7) + '-01', -1).slice(0, 7);
  const p = await rpc('pacote_contador', { p_mes: `${c0.mes}-01` });
  if (!ctx.ativo()) return;
  const meses = Array.from({ length: 13 }, (_, i) => addMeses(hojeSP().slice(0, 7) + '-01', -i).slice(0, 7));
  const r = p.resumo;
  const ativas = p.notas.filter((n) => n.status === 'emitida');
  el.innerHTML = `${abas('contador')}${cabecalho('Pacote do contador', { sub: 'Tudo o que o contador costuma pedir no fechamento do mês, em planilhas (CSV) dentro de um arquivo .zip.' })}
    <div class="ferramentas" style="margin-bottom:12px"><select id="f-mes" style="width:auto">${meses.map((m) => `<option value="${m}" ${m === c0.mes ? 'selected' : ''}>${nomeMes(m)}</option>`).join('')}</select>
      <span style="flex:1"></span><button class="btn btn-primary" type="button" id="b-zip">${icone('baixo')} Baixar pacote (.zip)</button></div>
    <div class="kpis">${kpi('Vendas', fmtMoeda(r.vendas_centavos), `devoluções ${fmtMoeda(r.devolucoes_centavos)}`)}${kpi('Notas emitidas', fmtMoeda(r.notas_emitidas_centavos), `${ativas.length} nota(s)`)}
      ${kpi('Serviços (mão de obra)', fmtMoeda(r.servicos_centavos), `${p.servicos_os.length} OS`)}${kpi('Compras', fmtMoeda(p.compras_mercadoria.reduce((s, x) => s + Number(x.total_centavos), 0)), `${p.compras_mercadoria.length} entrada(s)`)}</div>
    <div class="card card-pad"><b>O que vai no pacote</b><ul class="pequeno" style="margin:8px 0 0 18px">
      <li>itens-vendidos.csv — ${p.itens_vendidos.length} linha(s) com NCM, CFOP e CSOSN</li><li>resumo-por-cfop.csv</li><li>notas-fiscais.csv — ${p.notas.length} nota(s), com canceladas</li>
      <li>servicos-os.csv — ${p.servicos_os.length} OS entregues</li><li>devolucoes.csv — ${p.devolucoes.length}</li><li>compras-mercadoria.csv — ${p.compras_mercadoria.length}</li>
      <li>aparelhos-comprados-de-pessoas.csv — ${p.aparelhos_comprados_de_pessoas.length}</li><li>resumo.csv e pacote.json (tudo junto)</li></ul></div>`;
  $('#f-mes', el).addEventListener('change', (e) => { c0.mes = e.target.value; contador(el, ctx); });
  $('#b-zip', el).addEventListener('click', () => baixarPacote(p));
}

const csv = (cab, linhas) => '﻿' + [cab, ...linhas].map((l) => l.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
export function arquivosPacote(p) {
  const porCfop = {};
  p.itens_vendidos.forEach((i) => { const k = `${i.cfop || '?'}|${i.csosn || '?'}`; porCfop[k] = porCfop[k] || { qtd: 0, valor: 0 }; porCfop[k].qtd += Number(i.quantidade); porCfop[k].valor += Number(i.valor_centavos); });
  const nomeLoja = (p.empresa.razao_social || '').trim();
  return {
    'itens-vendidos.csv': csv(['Data', 'Venda', 'Nota', 'Produto', 'NCM', 'CFOP', 'CSOSN', 'Quantidade', 'Valor'],
      p.itens_vendidos.map((i) => [fmtData(i.data), i.venda, i.nota || '', i.produto, i.ncm || '', i.cfop || '', i.csosn || '', String(i.quantidade).replace('.', ','), csvMoeda(i.valor_centavos)])),
    'resumo-por-cfop.csv': csv(['CFOP', 'CSOSN', 'Quantidade', 'Valor'], Object.entries(porCfop).map(([k, v]) => [...k.split('|'), String(v.qtd).replace('.', ','), csvMoeda(v.valor)])),
    'notas-fiscais.csv': csv(['Tipo', 'Número', 'Série', 'Chave', 'Situação', 'Emitida em', 'Valor', 'Cancelada em', 'Motivo do cancelamento'],
      p.notas.map((n) => [TIPOS[n.tipo], n.numero, n.serie || '', n.chave || '', n.status, fmtDataHora(n.emitida_em), csvMoeda(n.valor_centavos), n.cancelada_em ? fmtDataHora(n.cancelada_em) : '', n.motivo_cancelamento || ''])),
    'servicos-os.csv': csv(['OS', 'Entregue', 'Cliente', 'Total cobrado', 'Mão de obra', 'NFS-e'],
      p.servicos_os.map((o) => [o.os, fmtData(o.entregue), o.cliente || '', csvMoeda(o.total_centavos), csvMoeda(o.mao_de_obra_centavos), o.nfse || ''])),
    'devolucoes.csv': csv(['Data', 'Devolução', 'Venda', 'Valor', 'Motivo'], p.devolucoes.map((d) => [fmtData(d.data), d.numero, d.venda, csvMoeda(d.valor_centavos), d.motivo || ''])),
    'compras-mercadoria.csv': csv(['Data', 'Entrada', 'Fornecedor', 'NF do fornecedor', 'Total'], p.compras_mercadoria.map((c) => [fmtData(c.data), c.numero, c.fornecedor || '', c.nf || '', csvMoeda(c.total_centavos)])),
    'aparelhos-comprados-de-pessoas.csv': csv(['Data', 'Número', 'Tipo', 'IMEI', 'Valor', 'Vendedor (pessoa)', 'Documento'],
      p.aparelhos_comprados_de_pessoas.map((a) => [fmtData(a.data), a.numero, a.tipo === 'troca' ? 'Troca' : 'Compra', a.imei || '', csvMoeda(a.valor_centavos), a.vendedor || '', a.documento || ''])),
    'resumo.csv': csv(['Item', 'Valor'], [['Empresa', nomeLoja], ['CNPJ', p.empresa.cnpj || ''], ['Mês', p.mes], ['Vendas', csvMoeda(p.resumo.vendas_centavos)],
      ['Devoluções', csvMoeda(p.resumo.devolucoes_centavos)], ['Notas emitidas', csvMoeda(p.resumo.notas_emitidas_centavos)], ['Serviços (mão de obra)', csvMoeda(p.resumo.servicos_centavos)]]),
    'pacote.json': JSON.stringify(p, null, 2),
  };
}
function baixarPacote(p) {
  const blob = zipar(arquivosPacote(p));
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `contador-${(estado.empresa?.nome_fantasia || 'loja').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')}-${p.mes}.zip`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Pacote baixado');
}

// ZIP simples (sem compressão) feito no navegador
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i += 1) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function zipar(arquivos) {
  const enc = new TextEncoder(); const partes = []; const central = []; let off = 0;
  const d = new Date(); const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1); const dia = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    const n = enc.encode(nome); const dados = enc.encode(conteudo); const crc = crc32(dados);
    const loc = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, hora, 2], [12, dia, 2], [14, crc, 4], [18, dados.length, 4], [22, dados.length, 4], [26, n.length, 2], [28, 0, 2]]
      .forEach(([o, v, s]) => (s === 4 ? loc.setUint32(o, v, true) : loc.setUint16(o, v, true)));
    const cen = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, hora, 2], [14, dia, 2], [16, crc, 4], [20, dados.length, 4], [24, dados.length, 4],
      [28, n.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, off, 4]].forEach(([o, v, s]) => (s === 4 ? cen.setUint32(o, v, true) : cen.setUint16(o, v, true)));
    partes.push(new Uint8Array(loc.buffer), n, dados); central.push(new Uint8Array(cen.buffer), n);
    off += 30 + n.length + dados.length;
  }
  const tamCentral = central.reduce((s, x) => s + x.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  const qtd = Object.keys(arquivos).length;
  [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, qtd, 2], [10, qtd, 2], [12, tamCentral, 4], [16, off, 4], [20, 0, 2]].forEach(([o, v, s]) => (s === 4 ? fim.setUint32(o, v, true) : fim.setUint16(o, v, true)));
  return new Blob([...partes, ...central, new Uint8Array(fim.buffer)], { type: 'application/zip' });
}
