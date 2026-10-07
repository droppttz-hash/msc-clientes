// CRM: tarefas do dia, funil de interessados, lista de espera de aparelho, campanhas no WhatsApp e modelos de mensagem
import {
  estado, pode, $, $$, esc, soDigitos, fmtMoeda, fmtData, fmtDataHora, fmtTelefone, linkZap, hojeSP, somarDias, COMO_CONHECEU,
  abrirModal, pedirMotivo, toast, msgErro, rpc, consulta, buscarTudo, lista as listaCache, cabecalho, vazio, carregando, tag, kpi, icone,
  valorDinheiro, baixarCsv,
} from '../core.js';
import { escolherCliente } from './clientes.js';

export const ETAPAS = { novo: 'Novo', em_contato: 'Em contato', proposta: 'Proposta enviada', ganho: 'Ganho', perdido: 'Perdido' };
const ETAPA_COR = { novo: '', em_contato: 'warn', proposta: 'warn', ganho: 'ok', perdido: 'cinza' };
const ORIGENS = { loja: 'Na loja', ...COMO_CONHECEU };
const ESPERA_ST = { aguardando: ['Aguardando', 'warn'], avisado: ['Cliente avisado', 'ok'], atendido: ['Atendido', 'ok'], cancelado: ['Cancelado', 'cinza'] };
const CONDICAO_ESP = { qualquer: 'Tanto faz', lacrado: 'Lacrado (novo)', seminovo: 'Seminovo / usado' };
export const VARIAVEIS = { '{nome}': 'primeiro nome do cliente', '{loja}': 'nome da loja', '{aparelho}': 'aparelho (upgrade / lista de espera)',
  '{meses}': 'meses de uso (upgrade)', '{preco}': 'preço do aparelho (lista de espera)', '{interesse}': 'o que o interessado procura',
  '{os}': 'nº da OS', '{valor}': 'valor da OS', '{dias}': 'dias esperando retirada', '{limite}': 'dias até considerar abandonado' };

// ---------------------------------------------------------------------
// Modelos de mensagem
// ---------------------------------------------------------------------
let modelosCache = null;
export async function modelos(recarregar = false) {
  if (!modelosCache || recarregar) modelosCache = await consulta(estado.sb.from('mensagens_modelos').select('*').order('ordem'));
  return modelosCache;
}
export function montarTexto(modelo, vars = {}) {
  if (!modelo) return '';
  const v = { nome: (vars.nome || '').trim().split(/\s+/)[0] || '', loja: estado.empresa?.nome_fantasia || 'loja', ...vars };
  if (vars.nome) v.nome = vars.nome.trim().split(/\s+/)[0];
  let t = modelo.texto.replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined && v[k] !== null && v[k] !== '' ? String(v[k]) : m));
  if (modelo.marketing && estado.empresa?.texto_optout) t += `\n\n${estado.empresa.texto_optout}`;
  return t;
}
const linkWhats = (tel, texto, attrs = '', rotulo = 'WhatsApp') => (tel ? `<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${linkZap(tel, texto)}" ${attrs}>${icone('zap')} ${rotulo}</a>` : '<span class="muted pequeno">sem telefone</span>');

// =====================================================================
// HOJE: o que fazer no dia
// =====================================================================
export async function hoje(el, ctx) {
  const camp = pode('crm.campanhas');
  const [res, leads, esperas, aniv, ms] = await Promise.all([
    rpc('crm_resumo'),
    consulta(estado.sb.from('leads_lista').select('*').not('etapa', 'in', '(ganho,perdido)').lte('proximo_contato', hojeSP()).order('proximo_contato').limit(100)),
    consulta(estado.sb.from('lista_espera_lista').select('*').eq('status', 'aguardando').gt('compativeis', 0).gte('validade', hojeSP()).order('criado_em').limit(100)),
    camp ? rpc('crm_segmento', { p_segmento: 'aniversario', p_param: 0 }) : null,
    modelos(),
  ]);
  if (!ctx.ativo()) return;
  const mod = Object.fromEntries(ms.map((m) => [m.codigo, m]));
  const anivs = (aniv?.clientes || []).filter((c) => c.aceita_marketing && !c.recente && c.telefone);
  el.innerHTML = `
    ${cabecalho('CRM — o que fazer hoje', { sub: 'Retornos de interessados, clientes da lista de espera com aparelho disponível e aniversariantes. Cada botão abre o WhatsApp com a mensagem pronta.',
      acoes: `<button class="btn btn-primary" type="button" id="b-novo-lead">${icone('mais')} Novo interessado</button>` })}
    <div class="kpis">
      ${kpi('Interessados em aberto', res.leads_abertos ?? 0, `${res.leads_retorno || 0} para retornar até hoje`, res.leads_retorno ? 'neg' : '')}
      ${kpi('Lista de espera', res.espera_aguardando ?? 0, res.espera_chegou ? `<b>${res.espera_chegou} com aparelho disponível</b>` : 'nenhum aparelho chegou')}
      ${kpi('Vendas ganhas no mês', res.ganhos_mes ?? 0, `${res.perdidos_mes || 0} perdido(s)`)}
      ${camp ? kpi('Autorizaram ofertas', `${res.consentimento?.sim || 0} de ${res.consentimento?.total || 0}`, 'clientes ativos (LGPD)') : ''}
    </div>
    <div class="card"><div class="card-topo"><h3>Retornar hoje</h3><a class="pequeno" href="#/crm/funil">Ver o funil</a></div>
      ${leads.length ? `<div class="tabela-wrap"><table class="tabela"><tbody>
        ${leads.map((l) => `<tr><td><button class="link-btn" data-lead="${l.id}"><b>${esc(l.nome)}</b></button><div class="muted pequeno">${esc(l.interesse)}${l.responsavel_nome ? ` · ${esc(l.responsavel_nome)}` : ''}</div></td>
          <td>${l.atrasado ? tag(`Atrasado desde ${fmtData(l.proximo_contato)}`, 'danger') : tag('Hoje', 'warn')} ${tag(ETAPAS[l.etapa], ETAPA_COR[l.etapa])}</td>
          <td class="num">${linkWhats(l.telefone, montarTexto(mod.lead, { nome: l.nome, interesse: l.interesse }), `data-zap-lead="${l.id}"`)}</td></tr>`).join('')}
      </tbody></table></div>` : vazio('Nenhum retorno pendente', 'Os interessados com data de retorno até hoje aparecem aqui.')}</div>
    <div class="card" style="margin-top:16px"><div class="card-topo"><h3>Chegou o aparelho que o cliente esperava</h3><a class="pequeno" href="#/crm/espera">Lista de espera</a></div>
      ${esperas.length ? `<div class="tabela-wrap"><table class="tabela"><tbody>
        ${esperas.map((e) => `<tr><td><b>${esc(e.cliente_nome)}</b><div class="muted pequeno">procura ${esc(textoPedido(e))}</div></td>
          <td>${tag(`${e.compativeis} aparelho(s) compatível(is)`, 'ok')}</td>
          <td class="num"><button class="btn btn-ghost btn-sm" type="button" data-ver-espera="${e.id}">Ver e avisar</button></td></tr>`).join('')}
      </tbody></table></div>` : vazio('Nada por enquanto', 'Quando entrar no estoque um aparelho que bate com um pedido da lista, ele aparece aqui.')}</div>
    ${camp ? `<div class="card" style="margin-top:16px"><div class="card-topo"><h3>Aniversariantes de hoje</h3><a class="pequeno" href="#/crm/campanhas">Campanhas</a></div>
      ${anivs.length ? `<div class="tabela-wrap"><table class="tabela"><tbody>
        ${anivs.map((c) => `<tr><td><a href="#/clientes/${c.cliente_id}"><b>${esc(c.nome)}</b></a><div class="muted pequeno">${c.idade} anos</div></td>
          <td class="num">${linkWhats(c.telefone, montarTexto(mod.aniversario, { nome: c.nome }), `data-zap-seg="aniversario" data-cli="${c.cliente_id}"`, 'Mandar parabéns')}</td></tr>`).join('')}
      </tbody></table></div>` : vazio('Ninguém para parabenizar', 'Só aparecem clientes que autorizaram receber mensagens e ainda não receberam o parabéns.')}</div>` : ''}`;

  const recarregar = () => { if (ctx.ativo()) hoje(el, ctx); };
  $('#b-novo-lead', el).addEventListener('click', async () => { if (await formLead()) recarregar(); });
  $$('[data-lead]', el).forEach((b) => b.addEventListener('click', async () => { await detalheLead(b.dataset.lead); recarregar(); }));
  $$('[data-zap-lead]', el).forEach((a) => a.addEventListener('click', () => registrar({ p_segmento: 'lead', p_lead: a.dataset.zapLead }, a)));
  $$('[data-zap-seg]', el).forEach((a) => a.addEventListener('click', () => registrar({ p_segmento: a.dataset.zapSeg, p_cliente: a.dataset.cli }, a)));
  $$('[data-ver-espera]', el).forEach((b) => b.addEventListener('click', async () => { await verEspera(esperas.find((e) => e.id === b.dataset.verEspera)); recarregar(); }));
}

async function registrar(args, a) {
  try {
    await rpc('registrar_contato', args);
    if (a) { a.classList.add('feito'); a.insertAdjacentHTML('afterend', ' <span class="tag ok">enviado</span>'); }
  } catch (err) { toast(msgErro(err), 'erro'); }
}

// =====================================================================
// FUNIL DE INTERESSADOS
// =====================================================================
const f0 = { resp: '', termo: '', encerrados: false };
export async function funil(el, ctx) {
  const todos = pode('crm.ver_todos');
  const perfis = todos ? (await listaCache('perfis')).filter((p) => p.ativo) : [];
  if (!ctx.ativo()) return;
  el.innerHTML = `
    ${cabecalho('Funil de interessados', { sub: 'Quem procurou a loja e ainda não comprou. Anote cada contato, marque a data de retorno e mova até “ganho” ou “perdido”.',
      acoes: `<button class="btn btn-primary" type="button" id="b-novo">${icone('mais')} Novo interessado</button>` })}
    <div class="card"><div class="ferramentas">
      <input class="busca" id="f-termo" type="search" placeholder="Nome, telefone ou interesse…" value="${esc(f0.termo)}">
      ${todos ? `<select id="f-resp" style="width:auto"><option value="">Todos os vendedores</option>${perfis.map((p) => `<option value="${p.user_id}" ${f0.resp === p.user_id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select>` : ''}
      <label class="check pequeno"><input type="checkbox" id="f-enc" ${f0.encerrados ? 'checked' : ''}> Mostrar ganhos e perdidos (90 dias)</label>
      <span style="flex:1"></span><button class="btn btn-ghost btn-sm" type="button" id="b-exp">Exportar</button>
    </div><div id="quadro">${carregando()}</div></div>`;
  let dados = [];
  const carregar = async () => {
    try {
      dados = await buscarTudo(() => {
        let q = estado.sb.from('leads_lista').select('*');
        if (f0.encerrados) q = q.or(`etapa.not.in.(ganho,perdido),fechado_em.gte.${somarDias(hojeSP(), -90)}`);
        else q = q.not('etapa', 'in', '(ganho,perdido)');
        if (f0.resp) q = q.eq('responsavel_id', f0.resp);
        const t = f0.termo.trim().replace(/[,()"%*\\]/g, ' ');
        if (t) { const d = soDigitos(t); q = q.or(`nome.ilike."%${t}%",interesse.ilike."%${t}%"${d.length >= 4 ? `,telefone.ilike."%${d}%"` : ''}`); }
        return q.order('proximo_contato', { ascending: true, nullsFirst: false }).order('criado_em');
      });
    } catch (err) { $('#quadro', el).innerHTML = vazio('Erro', esc(msgErro(err))); return; }
    if (!ctx.ativo()) return;
    const cols = f0.encerrados ? Object.keys(ETAPAS) : ['novo', 'em_contato', 'proposta'];
    $('#quadro', el).innerHTML = `<div class="quadro-os">${cols.map((et) => {
      const xs = dados.filter((l) => l.etapa === et);
      const soma = xs.reduce((s, l) => s + Number(l.valor_estimado_centavos || 0), 0);
      return `<div class="quadro-col" data-col="${et}"><div class="quadro-topo"><b>${ETAPAS[et]}</b><span class="muted">${xs.length}${soma ? ` · ${fmtMoeda(soma)}` : ''}</span></div>
        ${xs.map((l) => `<button class="quadro-card" type="button" data-lead="${l.id}" style="text-align:left;cursor:pointer;font:inherit">
          <b>${esc(l.nome)}</b><span class="pequeno">${esc(l.interesse)}</span>
          <span class="muted pequeno">${l.valor_estimado_centavos ? fmtMoeda(l.valor_estimado_centavos) + ' · ' : ''}${todos && l.responsavel_nome ? esc(l.responsavel_nome) : ORIGENS[l.origem] || ''}</span>
          <span>${l.atrasado ? tag(`Retorno ${fmtData(l.proximo_contato)}`, 'danger') : l.proximo_contato ? tag(`Retorno ${fmtData(l.proximo_contato)}`, l.proximo_contato === hojeSP() ? 'warn' : '') : ''}
            ${l.etapa === 'perdido' && l.motivo_perda ? `<span class="muted pequeno">${esc(l.motivo_perda)}</span>` : ''}${l.venda_numero ? tag(`venda nº ${l.venda_numero}`, 'ok') : ''}</span></button>`).join('') || '<p class="muted pequeno" style="padding:6px">—</p>'}</div>`;
    }).join('')}</div>`;
    $$('[data-lead]', el).forEach((b) => b.addEventListener('click', async () => { await detalheLead(b.dataset.lead); carregar(); }));
  };
  let tm; $('#f-termo', el).addEventListener('input', (e) => { clearTimeout(tm); tm = setTimeout(() => { f0.termo = e.target.value; carregar(); }, 250); });
  $('#f-resp', el)?.addEventListener('change', (e) => { f0.resp = e.target.value; carregar(); });
  $('#f-enc', el).addEventListener('change', (e) => { f0.encerrados = e.target.checked; carregar(); });
  $('#b-novo', el).addEventListener('click', async () => { if (await formLead()) carregar(); });
  $('#b-exp', el).addEventListener('click', () => baixarCsv(`interessados-${hojeSP()}.csv`,
    ['Nº', 'Nome', 'Telefone', 'Interesse', 'Origem', 'Etapa', 'Valor estimado', 'Responsável', 'Próximo retorno', 'Motivo da perda', 'Cadastrado em'],
    dados.map((l) => [l.numero, l.nome, fmtTelefone(l.telefone), l.interesse, ORIGENS[l.origem] || '', ETAPAS[l.etapa], l.valor_estimado_centavos ? (l.valor_estimado_centavos / 100).toFixed(2).replace('.', ',') : '',
      l.responsavel_nome || '', fmtData(l.proximo_contato), l.motivo_perda || '', fmtData(l.criado_em)])));
  carregar();
}

// Cadastro/edição de interessado. cli: {id, nome} para já vir ligado a um cliente
export async function formLead(lead = null, cli = null) {
  const todos = pode('crm.ver_todos');
  const perfis = todos ? (await listaCache('perfis')).filter((p) => p.ativo && p.cargo !== 'tecnico') : [];
  let cliente = lead?.cliente_id ? { id: lead.cliente_id, nome: lead.nome } : cli;
  return abrirModal({
    titulo: lead ? `Interessado nº ${lead.numero}` : 'Novo interessado', largura: 'md', botao: 'Salvar',
    corpo: `<div class="form-grade">
      <div class="col-2"><span class="pequeno muted">Cliente cadastrado (opcional)</span><div style="display:flex;gap:8px;align-items:center;margin-top:4px">
        <b data-cli-nome>${cliente ? esc(cliente.nome) : '<span class="muted">Ainda não é cliente</span>'}</b>
        <button class="btn btn-ghost btn-sm" type="button" data-escolher>${cliente ? 'Trocar' : 'Escolher cliente'}</button>
        <button class="btn btn-ghost btn-sm" type="button" data-tirar ${cliente ? '' : 'hidden'}>Tirar</button></div></div>
      <label data-sem-cli>Nome *<input name="nome" value="${esc(lead && !lead.cliente_id ? lead.nome : '')}" autocomplete="off"></label>
      <label data-sem-cli>Telefone / WhatsApp<input name="telefone" inputmode="tel" data-mascara="telefone" value="${esc(fmtTelefone(lead && !lead.cliente_id ? lead.telefone : ''))}"></label>
      <label class="col-2">O que procura *<input name="interesse" value="${esc(lead?.interesse)}" placeholder="Ex.: iPhone 15 Pro 256GB, conserto de tela, notebook para estudo…"></label>
      <label>Valor estimado<input name="valor" data-mascara="dinheiro" inputmode="numeric" value="${lead?.valor_estimado_centavos ? fmtMoeda(lead.valor_estimado_centavos) : ''}"></label>
      <label>Como chegou<select name="origem"><option value="">—</option>${Object.entries(ORIGENS).map(([k, v]) => `<option value="${k}" ${lead?.origem === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Próximo retorno<input type="date" name="proximo" value="${esc(lead ? lead.proximo_contato || '' : somarDias(hojeSP(), 1))}"></label>
      ${todos ? `<label>Responsável<select name="resp">${perfis.map((p) => `<option value="${p.user_id}" ${(lead?.responsavel_id || estado.perfil.user_id) === p.user_id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select></label>` : ''}
      <label class="col-2">Observações<textarea name="obs" rows="2">${esc(lead?.observacao)}</textarea></label></div>`,
    aoAbrir: (f) => {
      const ver = () => {
        $('[data-cli-nome]', f).innerHTML = cliente ? esc(cliente.nome) : '<span class="muted">Ainda não é cliente</span>';
        $$('[data-sem-cli]', f).forEach((x) => { x.hidden = !!cliente; });
        $('[data-tirar]', f).hidden = !cliente; $('[data-escolher]', f).textContent = cliente ? 'Trocar' : 'Escolher cliente';
      };
      ver();
      $('[data-escolher]', f).addEventListener('click', async () => { const c = await escolherCliente(); if (c) { cliente = c; ver(); } });
      $('[data-tirar]', f).addEventListener('click', () => { cliente = null; ver(); });
    },
    aoSalvar: async (f) => {
      const d = { cliente_id: cliente?.id || null, nome: cliente ? null : f.nome.value.trim(), telefone: cliente ? null : soDigitos(f.telefone.value) || null,
        interesse: f.interesse.value.trim(), origem: f.origem.value || null, valor_estimado_centavos: valorDinheiro(f.valor) || null,
        proximo_contato: f.proximo.value || null, responsavel_id: f.resp?.value || null, observacao: f.obs.value };
      if (!cliente && d.nome.length < 2) { f.erro('Informe o nome ou escolha um cliente.'); return false; }
      const id = await rpc('salvar_lead', { p_id: lead?.id || null, p_dados: d });
      toast(lead ? 'Interessado atualizado' : 'Interessado cadastrado');
      return id;
    },
  });
}

export async function detalheLead(id) {
  const [d, ms] = await Promise.all([rpc('lead_detalhe', { p_id: id }), modelos()]);
  const l = d.lead; const aberto = !['ganho', 'perdido'].includes(l.etapa);
  const mod = ms.find((m) => m.codigo === 'lead');
  const TIPO = { criado: 'Cadastro', nota: 'Anotação', whatsapp: 'WhatsApp', ligacao: 'Ligação', etapa: 'Etapa', edicao: 'Alteração' };
  let mudou = false;
  await abrirModal({
    titulo: `${l.nome} · interessado nº ${l.numero}`, largura: 'lg', botao: null, cancelar: 'Fechar',
    corpo: `<div class="form-grade">
      <div><dl class="dl">
        <div><dt>Procura</dt><dd><b>${esc(l.interesse)}</b>${l.valor_estimado_centavos ? ` · ${fmtMoeda(l.valor_estimado_centavos)}` : ''}</dd></div>
        <div><dt>Telefone</dt><dd>${l.telefone ? fmtTelefone(l.telefone) : '—'}${l.cliente_id ? ` · <a href="#/clientes/${l.cliente_id}" data-fechar>ficha do cliente</a>` : ''}</dd></div>
        <div><dt>Etapa</dt><dd>${tag(ETAPAS[l.etapa], ETAPA_COR[l.etapa])}${l.motivo_perda ? ` <span class="muted">${esc(l.motivo_perda)}</span>` : ''}${l.venda_numero ? ` <a href="#/vendas/${l.venda_id}" data-fechar>venda nº ${l.venda_numero}</a>` : ''}</dd></div>
        <div><dt>Retorno</dt><dd>${l.proximo_contato ? fmtData(l.proximo_contato) : '—'}${l.atrasado ? ' ' + tag('atrasado', 'danger') : ''}</dd></div>
        <div><dt>Responsável</dt><dd>${esc(l.responsavel_nome || '—')} · ${ORIGENS[l.origem] || 'origem não informada'}</dd></div>
        ${l.observacao ? `<div><dt>Obs.</dt><dd>${esc(l.observacao)}</dd></div>` : ''}
      </dl>
      <div class="acoes-linha" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">
        ${aberto && l.telefone ? linkWhats(l.telefone, montarTexto(mod, { nome: l.nome, interesse: l.interesse }), 'data-zap') : ''}
        ${aberto ? '<button class="btn btn-ghost btn-sm" type="button" data-acao="ligacao">Registrar ligação</button><button class="btn btn-ghost btn-sm" type="button" data-acao="editar">Editar</button>' : ''}
      </div>
      ${aberto ? `<fieldset style="margin-top:12px"><legend>Mover para</legend><div style="display:flex;flex-wrap:wrap;gap:6px">
        ${['novo', 'em_contato', 'proposta'].filter((e) => e !== l.etapa).map((e) => `<button class="btn btn-ghost btn-sm" type="button" data-mover="${e}">${ETAPAS[e]}</button>`).join('')}
        <button class="btn btn-primary btn-sm" type="button" data-mover="ganho">Ganho (comprou)</button>
        <button class="btn btn-ghost btn-sm" type="button" data-mover="perdido" style="color:var(--danger)">Perdido</button></div></fieldset>`
        : '<button class="btn btn-ghost btn-sm" type="button" data-mover="em_contato" style="margin-top:10px">Reabrir</button>'}
      </div>
      <div><b>Histórico</b>
        ${aberto ? `<div style="display:grid;gap:6px;margin:8px 0"><textarea data-nota rows="2" placeholder="Anotação: o que conversaram, objeções, combinado…"></textarea>
          <div style="display:flex;gap:6px;align-items:center"><label class="pequeno" style="margin:0">Novo retorno<input type="date" data-prox value="${esc(l.proximo_contato || '')}" style="margin:0"></label>
          <button class="btn btn-ghost btn-sm" type="button" data-anotar>Anotar</button></div></div>` : ''}
        <ul class="linha-tempo" style="list-style:none;padding:0;margin:8px 0;display:grid;gap:8px;max-height:45vh;overflow:auto">
          ${d.eventos.map((e) => `<li><span class="muted pequeno">${fmtDataHora(e.em)} · ${esc(e.por || '')}</span><br><b>${TIPO[e.tipo] || e.tipo}</b>${e.texto ? `: ${esc(e.texto)}` : ''}</li>`).join('')}
        </ul></div></div>`,
    aoAbrir: (f) => {
      const fechar = () => { mudou = true; f.fechar(true); };
      $$('[data-fechar]', f).forEach((a) => a.addEventListener('click', () => f.fechar(true)));
      $('[data-zap]', f)?.addEventListener('click', async () => { await registrar({ p_segmento: 'lead', p_lead: l.id }); mudou = true; });
      $('[data-anotar]', f)?.addEventListener('click', async () => {
        try { await rpc('anotar_lead', { p_id: l.id, p_tipo: 'nota', p_texto: $('[data-nota]', f).value, p_proximo: $('[data-prox]', f).value || null }); toast('Anotado'); fechar(); detalheLead(l.id); } catch (err) { toast(msgErro(err), 'erro'); }
      });
      $('[data-acao=ligacao]', f)?.addEventListener('click', async () => {
        try { await rpc('anotar_lead', { p_id: l.id, p_tipo: 'ligacao', p_texto: $('[data-nota]', f).value || null, p_proximo: $('[data-prox]', f).value || null }); toast('Ligação registrada'); fechar(); detalheLead(l.id); } catch (err) { toast(msgErro(err), 'erro'); }
      });
      $('[data-acao=editar]', f)?.addEventListener('click', async () => { f.fechar(true); mudou = true; if (await formLead(l)) await detalheLead(l.id); });
      $$('[data-mover]', f).forEach((b) => b.addEventListener('click', async () => {
        const et = b.dataset.mover;
        try {
          if (et === 'perdido') {
            const m = await pedirMotivo({ titulo: 'Marcar como perdido', texto: 'Por que não comprou? Isso ajuda a entender o que melhorar.', botao: 'Marcar perdido', placeholder: 'Ex.: achou mais barato, desistiu, sem estoque…' });
            if (!m) return;
            await rpc('mover_lead', { p_id: l.id, p_etapa: 'perdido', p_motivo: m });
          } else if (et === 'ganho') {
            const r = await abrirModal({
              titulo: 'Ganho: o interessado comprou', largura: 'sm', botao: 'Confirmar',
              corpo: d.vendas.length ? `<label>Venda<select name="v"><option value="">Não ligar a uma venda</option>${d.vendas.map((v) => `<option value="${v.id}">nº ${v.numero} · ${fmtData(v.data)} · ${fmtMoeda(v.total)}</option>`).join('')}</select></label>`
                : `<p class="muted">${l.cliente_id ? 'Não achamos vendas deste cliente desde o cadastro do interessado.' : 'Dica: ligue o interessado a um cliente (Editar) para vincular a venda.'}</p>`,
              aoSalvar: async (ff) => { await rpc('mover_lead', { p_id: l.id, p_etapa: 'ganho', p_venda: ff.v?.value || null }); return true; },
            });
            if (!r) return;
          } else {
            await rpc('mover_lead', { p_id: l.id, p_etapa: et });
          }
          toast(`Movido para “${ETAPAS[et]}”`); fechar();
        } catch (err) { toast(msgErro(err), 'erro'); }
      }));
    },
  });
  return mudou;
}

// =====================================================================
// LISTA DE ESPERA
// =====================================================================
const textoPedido = (e) => [e.modelo, e.capacidade, e.cor, e.condicao !== 'qualquer' ? CONDICAO_ESP[e.condicao].toLowerCase() : '', e.preco_max_centavos ? `até ${fmtMoeda(e.preco_max_centavos)}` : ''].filter(Boolean).join(' · ');
const e0 = { status: 'abertos' };
export async function espera(el, ctx) {
  el.innerHTML = `
    ${cabecalho('Lista de espera de aparelho', { sub: 'Cliente quer um modelo que não tem no estoque? Anote aqui. Quando entrar um aparelho compatível, o sistema avisa e você manda a mensagem pronta.',
      acoes: `<button class="btn btn-primary" type="button" id="b-novo">${icone('mais')} Novo pedido</button>` })}
    <div class="card"><div class="ferramentas">
      <select id="f-st" style="width:auto">${[['abertos', 'Em aberto'], ['chegou', 'Com aparelho disponível'], ['atendido', 'Atendidos'], ['cancelado', 'Cancelados'], ['todos', 'Todos']].map(([v, r]) => `<option value="${v}" ${e0.status === v ? 'selected' : ''}>${r}</option>`).join('')}</select>
    </div><div id="tabela">${carregando()}</div></div>`;
  let dados = [];
  const carregar = async () => {
    try {
      dados = await buscarTudo(() => {
        let q = estado.sb.from('lista_espera_lista').select('*');
        if (e0.status === 'abertos') q = q.in('status', ['aguardando', 'avisado']);
        else if (e0.status === 'chegou') q = q.in('status', ['aguardando', 'avisado']).gt('compativeis', 0);
        else if (e0.status !== 'todos') q = q.eq('status', e0.status);
        return q.order('criado_em', { ascending: e0.status === 'abertos' || e0.status === 'chegou' });
      });
    } catch (err) { $('#tabela', el).innerHTML = vazio('Erro', esc(msgErro(err))); return; }
    if (!ctx.ativo()) return;
    if (!dados.length) { $('#tabela', el).innerHTML = vazio('Nenhum pedido aqui', 'Use “Novo pedido” quando o cliente procurar um aparelho que você não tem.'); return; }
    $('#tabela', el).innerHTML = `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Cliente</th><th>Procura</th><th class="esconder-cel">Desde</th><th>Situação</th><th></th></tr></thead><tbody>
      ${dados.map((e) => `<tr><td><a href="#/clientes/${e.cliente_id}"><b>${esc(e.cliente_nome)}</b></a><div class="muted pequeno">${fmtTelefone(e.cliente_telefone) || ''}</div></td>
        <td>${esc(textoPedido(e))}${e.observacao ? `<div class="muted pequeno">${esc(e.observacao)}</div>` : ''}</td>
        <td class="esconder-cel">${fmtData(e.criado_em)}<div class="muted pequeno">até ${fmtData(e.validade)}</div></td>
        <td>${tag(...ESPERA_ST[e.status])}${e.vencido ? ' ' + tag('Venceu', 'danger') : ''}${e.compativeis ? ' ' + tag(`${e.compativeis} disponível(is)`, 'ok') : ''}${e.avisado_em ? `<div class="muted pequeno">avisado ${fmtDataHora(e.avisado_em)}</div>` : ''}</td>
        <td class="num"><button class="btn btn-ghost btn-sm" type="button" data-ver="${e.id}">Abrir</button></td></tr>`).join('')}
      </tbody></table></div><div class="rodape-tabela"><span>${dados.length} pedido(s)</span></div>`;
    $$('[data-ver]', el).forEach((b) => b.addEventListener('click', async () => { if (await verEspera(dados.find((x) => x.id === b.dataset.ver))) carregar(); }));
  };
  $('#f-st', el).addEventListener('change', (ev) => { e0.status = ev.target.value; carregar(); });
  $('#b-novo', el).addEventListener('click', async () => { if (await formEspera()) carregar(); });
  carregar();
}

export async function formEspera(esp = null, cli = null) {
  let cliente = esp ? { id: esp.cliente_id, nome: esp.cliente_nome } : cli;
  const dias = estado.empresa?.crm_dias_espera || 60;
  return abrirModal({
    titulo: esp ? `Pedido nº ${esp.numero}` : 'Novo pedido na lista de espera', largura: 'md', botao: 'Salvar',
    corpo: `<div class="form-grade">
      <div class="col-2"><span class="pequeno muted">Cliente *</span><div style="display:flex;gap:8px;align-items:center;margin-top:4px">
        <b data-cli-nome>${cliente ? esc(cliente.nome) : '<span class="muted">Escolha o cliente</span>'}</b><button class="btn btn-ghost btn-sm" type="button" data-escolher>${cliente ? 'Trocar' : 'Escolher cliente'}</button></div></div>
      <label class="col-2">Modelo procurado *<input name="modelo" value="${esc(esp?.modelo)}" placeholder="Ex.: iPhone 14 Pro, Galaxy S24" autocomplete="off"></label>
      <label>Capacidade<input name="cap" value="${esc(esp?.capacidade)}" placeholder="Ex.: 256GB"></label>
      <label>Cor<input name="cor" value="${esc(esp?.cor)}" placeholder="Tanto faz"></label>
      <label>Condição<select name="cond">${Object.entries(CONDICAO_ESP).map(([k, v]) => `<option value="${k}" ${(esp?.condicao || 'qualquer') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Paga até<input name="max" data-mascara="dinheiro" inputmode="numeric" value="${esp?.preco_max_centavos ? fmtMoeda(esp.preco_max_centavos) : ''}"></label>
      <label>Válido até<input type="date" name="val" value="${esc(esp?.validade || somarDias(hojeSP(), dias))}"></label>
      <label class="col-2">Observações<textarea name="obs" rows="2">${esc(esp?.observacao)}</textarea></label></div>
      <p class="muted pequeno">O sistema compara as palavras do modelo com o nome dos aparelhos que entram no estoque (e a capacidade, a condição e o preço, se preenchidos). A cor não bloqueia: ela aparece para você conferir.</p>`,
    aoAbrir: (f) => {
      $('[data-escolher]', f).addEventListener('click', async () => {
        const c = await escolherCliente();
        if (c) { cliente = c; $('[data-cli-nome]', f).textContent = c.nome; $('[data-escolher]', f).textContent = 'Trocar'; }
      });
    },
    aoSalvar: async (f) => {
      if (!cliente) { f.erro('Escolha o cliente (cadastre se for novo).'); return false; }
      const id = await rpc('salvar_espera', { p_id: esp?.id || null, p_dados: { cliente_id: cliente.id, modelo: f.modelo.value, capacidade: f.cap.value, cor: f.cor.value,
        condicao: f.cond.value, preco_max_centavos: valorDinheiro(f.max) || null, validade: f.val.value || null, observacao: f.obs.value } });
      toast(esp ? 'Pedido atualizado' : 'Cliente na lista de espera');
      return id;
    },
  });
}

async function verEspera(e) {
  const aberto = ['aguardando', 'avisado'].includes(e.status);
  const [aps, ms] = await Promise.all([aberto ? rpc('espera_aparelhos', { p_id: e.id }) : [], modelos()]);
  const mod = ms.find((m) => m.codigo === 'espera');
  let mudou = false;
  await abrirModal({
    titulo: `${e.cliente_nome} · pedido nº ${e.numero}`, largura: 'md', botao: null, cancelar: 'Fechar',
    corpo: `<p>Procura <b>${esc(textoPedido(e))}</b><br><span class="muted pequeno">Desde ${fmtData(e.criado_em)} · válido até ${fmtData(e.validade)} · ${tag(...ESPERA_ST[e.status])}</span>
        ${e.motivo_cancelamento ? `<br><span class="muted pequeno">Cancelado: ${esc(e.motivo_cancelamento)}</span>` : ''}</p>
      ${aberto ? (aps.length ? `<b>Aparelhos disponíveis que batem com o pedido</b><div class="tabela-wrap"><table class="tabela"><tbody>
        ${aps.map((a) => `<tr><td><a href="#/aparelhos/${a.serie_id}" data-fechar><b>${esc(a.descricao)}</b></a><div class="muted pequeno">${esc(a.condicao || '')}</div></td><td class="num">${fmtMoeda(a.preco_centavos)}</td>
          <td class="num">${linkWhats(e.cliente_telefone, montarTexto(mod, { nome: e.cliente_nome, aparelho: a.descricao, preco: fmtMoeda(a.preco_centavos) }), `data-avisar="${a.serie_id}"`, 'Avisar')}</td></tr>`).join('')}
        </tbody></table></div>` : vazio('Nenhum aparelho compatível no estoque agora', 'Assim que entrar, ele aparece aqui e na tela “Hoje” do CRM.')) : ''}
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:12px">
        ${aberto ? '<button class="btn btn-ghost btn-sm" type="button" data-acao="editar">Editar</button><button class="btn btn-ghost btn-sm" type="button" data-acao="atendido">Marcar atendido</button><button class="btn btn-ghost btn-sm" type="button" data-acao="cancelar" style="color:var(--danger)">Cancelar pedido</button>'
          : '<button class="btn btn-ghost btn-sm" type="button" data-acao="reabrir">Reabrir</button>'}</div>`,
    aoAbrir: (f) => {
      $$('[data-fechar]', f).forEach((a) => a.addEventListener('click', () => f.fechar(true)));
      $$('[data-avisar]', f).forEach((a) => a.addEventListener('click', async () => { await registrar({ p_segmento: 'espera', p_espera: e.id, p_serie: a.dataset.avisar }, a); mudou = true; }));
      const acao = async (fn) => { try { if (await fn()) { mudou = true; f.fechar(true); } } catch (err) { toast(msgErro(err), 'erro'); } };
      $('[data-acao=editar]', f)?.addEventListener('click', () => acao(async () => { f.fechar(true); return formEspera(e); }));
      $('[data-acao=atendido]', f)?.addEventListener('click', () => acao(async () => { await rpc('mudar_espera', { p_id: e.id, p_status: 'atendido' }); toast('Pedido atendido'); return true; }));
      $('[data-acao=reabrir]', f)?.addEventListener('click', () => acao(async () => { await rpc('mudar_espera', { p_id: e.id, p_status: 'aguardando' }); toast('Pedido reaberto'); return true; }));
      $('[data-acao=cancelar]', f)?.addEventListener('click', () => acao(async () => {
        const m = await pedirMotivo({ titulo: 'Cancelar pedido', botao: 'Cancelar pedido', placeholder: 'Ex.: comprou em outro lugar, desistiu…' });
        if (!m) return false;
        await rpc('mudar_espera', { p_id: e.id, p_status: 'cancelado', p_motivo: m }); toast('Pedido cancelado'); return true;
      }));
    },
  });
  return mudou;
}

// =====================================================================
// CAMPANHAS (segmentos)
// =====================================================================
const SEGMENTOS = {
  aniversario: { rotulo: 'Aniversariantes', param: 'Próximos', unidade: 'dias', padrao: 7, sub: 'Quem faz aniversário hoje ou nos próximos dias.' },
  upgrade: { rotulo: 'Hora de trocar', param: 'Comprou há', unidade: 'meses ou mais', padrao: () => estado.empresa?.crm_meses_upgrade || 12, sub: 'Clientes cujo último aparelho comprado na loja já tem esse tempo de uso.' },
  sumido: { rotulo: 'Sumidos', param: 'Sem vir há', unidade: 'dias ou mais', padrao: () => estado.empresa?.dias_alerta_sem_compra || 90, sub: 'Clientes que já compraram, mas não voltam (nem compra, nem assistência) há esse tempo.' },
};
const c0 = { seg: 'aniversario', param: {}, filtro: 'iphone', ocultarRecentes: true };
export async function campanhas(el, ctx) {
  const S = SEGMENTOS[c0.seg];
  const padrao = typeof S.padrao === 'function' ? S.padrao() : S.padrao;
  if (c0.param[c0.seg] == null) c0.param[c0.seg] = padrao;
  el.innerHTML = `
    ${cabecalho('Campanhas no WhatsApp', { sub: 'Escolha um grupo de clientes e mande a mensagem pronta, um por um. Só recebe oferta quem autorizou (LGPD); o sistema anota cada envio.' })}
    <nav class="abas-pagina">${Object.entries(SEGMENTOS).map(([k, s]) => `<button type="button" class="${k === c0.seg ? 'ativa' : ''}" data-seg="${k}">${s.rotulo}</button>`).join('')}</nav>
    <div class="card"><div class="ferramentas">
      <label class="pequeno" style="display:flex;gap:6px;align-items:center;margin:0">${S.param}<input id="f-param" type="number" min="0" max="1095" value="${c0.param[c0.seg]}" style="width:80px;margin:0"> ${S.unidade}</label>
      ${c0.seg === 'upgrade' ? `<label class="check pequeno"><input type="checkbox" id="f-iph" ${c0.filtro ? 'checked' : ''}> Só iPhone</label>` : ''}
      <label class="check pequeno"><input type="checkbox" id="f-rec" ${c0.ocultarRecentes ? 'checked' : ''}> Esconder quem já recebeu há pouco</label>
      <span style="flex:1"></span><span class="muted pequeno">${esc(S.sub)}</span>
    </div><div id="tabela">${carregando()}</div></div>`;
  $$('[data-seg]', el).forEach((b) => b.addEventListener('click', () => { c0.seg = b.dataset.seg; campanhas(el, ctx); }));
  const carregar = async () => {
    let r; let ms;
    try {
      [r, ms] = await Promise.all([rpc('crm_segmento', { p_segmento: c0.seg, p_param: Number(c0.param[c0.seg]), p_filtro: c0.seg === 'upgrade' ? c0.filtro || null : null }), modelos()]);
    } catch (err) { $('#tabela', el).innerHTML = vazio('Erro', esc(msgErro(err))); return; }
    if (!ctx.ativo()) return;
    const mod = ms.find((m) => m.codigo === c0.seg);
    const todos = r.clientes;
    const xs = c0.ocultarRecentes ? todos.filter((c) => !c.recente) : todos;
    const aut = xs.filter((c) => c.aceita_marketing && c.telefone);
    if (!xs.length) { $('#tabela', el).innerHTML = vazio('Ninguém neste grupo', todos.length ? `${todos.length} cliente(s) já receberam mensagem nos últimos ${r.dias_recontato} dias.` : ''); return; }
    $('#tabela', el).innerHTML = `<p class="pequeno card-pad" style="margin:0"><b>${aut.length}</b> de ${xs.length} cliente(s) podem receber a mensagem${xs.length - aut.length ? ` · ${xs.length - aut.length} sem autorização ou sem telefone` : ''}.</p>
      <div class="tabela-wrap"><table class="tabela"><thead><tr><th>Cliente</th><th>Detalhe</th><th class="esconder-cel">Último envio</th><th></th></tr></thead><tbody>
      ${xs.map((c) => `<tr><td><a href="#/clientes/${c.cliente_id}"><b>${esc(c.nome)}</b></a><div class="muted pequeno">${fmtTelefone(c.telefone) || 'sem telefone'}</div></td>
        <td>${esc(c.detalhe)}${c.idade ? ` <span class="muted pequeno">(${c.idade} anos)</span>` : ''}</td>
        <td class="esconder-cel">${c.ultimo_contato ? fmtDataHora(c.ultimo_contato) : '<span class="muted">nunca</span>'}</td>
        <td class="num">${!c.aceita_marketing ? '<span class="tag cinza" title="O cliente não autorizou receber ofertas. Marque no cadastro se ele autorizar.">Não autorizou</span>'
          : linkWhats(c.telefone, montarTexto(mod, { nome: c.nome, aparelho: c.aparelho, meses: c.meses }), `data-zap="${c.cliente_id}"`)}</td></tr>`).join('')}
      </tbody></table></div>`;
    $$('[data-zap]', el).forEach((a) => a.addEventListener('click', () => registrar({ p_segmento: c0.seg, p_cliente: a.dataset.zap }, a)));
  };
  $('#f-param', el).addEventListener('change', (e) => { c0.param[c0.seg] = Math.max(0, Number(e.target.value) || 0); carregar(); });
  $('#f-iph', el)?.addEventListener('change', (e) => { c0.filtro = e.target.checked ? 'iphone' : ''; carregar(); });
  $('#f-rec', el).addEventListener('change', (e) => { c0.ocultarRecentes = e.target.checked; carregar(); });
  carregar();
}

// =====================================================================
// MODELOS DE MENSAGEM + ajustes do CRM
// =====================================================================
export async function telaModelos(el, ctx) {
  const ms = await modelos(true);
  if (!ctx.ativo()) return;
  const cfg = pode('config.gerenciar');
  const editar = pode('crm.modelos');
  const e = estado.empresa || {};
  const exemplo = { nome: 'Maria Souza', aparelho: 'iPhone 13 128GB', meses: 14, preco: fmtMoeda(289990), interesse: 'iPhone 15 Pro', os: 152, valor: fmtMoeda(35000), dias: 20, limite: e.dias_abandono_os || 90 };
  el.innerHTML = `
    ${cabecalho('Modelos de mensagem', { sub: 'Textos que o sistema usa para montar as mensagens do WhatsApp. Use as variáveis entre chaves: elas viram o nome do cliente, o aparelho etc.' })}
    <div class="card card-pad"><b>Variáveis</b><div class="pequeno" style="display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:6px">${Object.entries(VARIAVEIS).map(([k, v]) => `<span><code>${k}</code> ${v}</span>`).join('')}</div></div>
    ${ms.map((m) => `<div class="card card-pad" style="margin-top:12px"><form data-modelo="${m.codigo}">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b>${esc(m.nome)}</b>${m.marketing ? tag('Oferta: só para quem autorizou', 'warn') : tag('Atendimento', '')}</div>
      <textarea name="texto" rows="3" style="margin-top:8px" ${editar ? '' : 'readonly'}>${esc(m.texto)}</textarea>
      <div class="muted pequeno" data-prev style="white-space:pre-wrap;margin:6px 0">${esc(montarTexto(m, exemplo))}</div>
      ${editar ? '<button class="btn btn-ghost btn-sm" type="submit">Salvar</button>' : ''}</form></div>`).join('')}
    ${cfg ? `<div class="card card-pad" style="margin-top:16px"><form id="f-cfg"><b>Ajustes do CRM</b><div class="form-grade" style="margin-top:8px">
      <label class="col-2">Frase no fim das mensagens de oferta (LGPD)<input name="optout" value="${esc(e.texto_optout)}"></label>
      <label>“Hora de trocar”: aparelho com quantos meses<input name="meses" type="number" min="1" max="60" value="${e.crm_meses_upgrade ?? 12}"></label>
      <label>Não repetir a mesma campanha por (dias)<input name="recont" type="number" min="1" max="365" value="${e.crm_dias_recontato ?? 30}"></label>
      <label>Validade padrão da lista de espera (dias)<input name="esp" type="number" min="1" max="365" value="${e.crm_dias_espera ?? 60}"></label>
      <label>“Sumidos”: sem comprar há (dias)<input name="sum" type="number" min="15" max="1095" value="${e.dias_alerta_sem_compra ?? 90}"></label>
      </div><button class="btn btn-primary" type="submit">Salvar ajustes</button></form></div>` : ''}`;
  $$('form[data-modelo]', el).forEach((f) => {
    const m = ms.find((x) => x.codigo === f.dataset.modelo);
    f.texto.addEventListener('input', () => { $('[data-prev]', f).textContent = montarTexto({ ...m, texto: f.texto.value }, exemplo); });
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!pode('crm.modelos')) { toast('Sem permissão para editar modelos.', 'erro'); return; }
      try { await rpc('salvar_modelo_mensagem', { p_codigo: m.codigo, p_texto: f.texto.value }); await modelos(true); toast('Modelo salvo'); } catch (err) { toast(msgErro(err), 'erro'); }
    });
  });
  $('#f-cfg', el)?.addEventListener('submit', async (ev) => {
    ev.preventDefault(); const f = ev.target;
    const dados = { texto_optout: f.optout.value.trim(), crm_meses_upgrade: Number(f.meses.value), crm_dias_recontato: Number(f.recont.value), crm_dias_espera: Number(f.esp.value), dias_alerta_sem_compra: Number(f.sum.value) };
    try { estado.empresa = await consulta(estado.sb.from('empresa').update(dados).eq('id', 1).select().single()); toast('Ajustes salvos'); telaModelos(el, ctx); } catch (err) { toast(msgErro(err), 'erro'); }
  });
}
