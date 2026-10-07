// Assistência técnica: ordens de serviço — fila, abertura, orçamento, aprovação, bancada, entrega e garantia
import {
  estado, pode, $, $$, esc, fmtMoeda, fmtData, fmtDataHora, fmtTelefone, fmtNum, fmtCpf, fmtCnpj, hojeSP, somarDias, linkZap, lerNumero,
  abrirModal, pedirMotivo, confirmar, toast, msgErro, rpc, consulta, buscarTudo, lista as listaCache, cabecalho, vazio, carregando, tag, kpi, icone,
  valorDinheiro, setDinheiro, FORMAS, imprimir,
} from '../core.js';

export const STATUS = {
  aberta: ['Aberta', 'warn'], diagnostico: ['Em diagnóstico', 'warn'], aguardando_aprovacao: ['Aguardando aprovação', 'warn'], aprovada: ['Aprovada', 'warn'],
  em_execucao: ['Em execução', 'warn'], aguardando_peca: ['Aguardando peça', 'warn'], pronta: ['Pronta para retirada', 'ok'], entregue: ['Entregue', 'cinza'],
  reprovada: ['Orçamento recusado', 'danger'], cancelada: ['Cancelada', 'cinza'], abandonada: ['Abandonada', 'danger'],
};
const ABERTOS = ['aberta', 'diagnostico', 'aguardando_aprovacao', 'aprovada', 'em_execucao', 'aguardando_peca', 'pronta', 'reprovada'];
const BANCADA = ['aberta', 'diagnostico', 'aprovada', 'em_execucao', 'aguardando_peca'];
const MEIOS = { presencial: 'Presencial (assinou/confirmou na loja)', whatsapp: 'WhatsApp', telefone: 'Telefone', outro: 'Outro' };
const stTag = (s) => tag(...(STATUS[s] || [s, 'cinza']));
const PARCELAVEL = ['credito', 'crediario', 'boleto'];
const docCli = (o) => (o.cliente_cpf ? `CPF ${fmtCpf(o.cliente_cpf)}` : o.cliente_cnpj ? `CNPJ ${fmtCnpj(o.cliente_cnpj)}` : '');

// =====================================================================
// LISTA / FILA
// =====================================================================
const f0 = { filtro: 'andamento', termo: '', modo: 'lista' };
export async function lista(el, ctx) {
  if (!pode('os.ver')) { el.innerHTML = vazio('Sem permissão', ''); return; }
  const res = await rpc('os_resumo');
  if (!ctx.ativo()) return;
  const souTecnico = estado.perfil?.cargo === 'tecnico';
  if (souTecnico && f0.filtro === 'andamento' && !f0.mexeu) f0.filtro = 'minhas';
  const FILTROS = [['andamento', 'Em andamento'], ['minhas', 'Minha bancada'], ['bancada', 'Na bancada (todos)'], ['aguardando_aprovacao', 'Aguardando aprovação'],
    ['pronta', 'Prontas p/ retirada'], ['atrasadas', 'Atrasadas'], ['abandono', `Sem retirada há +${res.dias_abandono} dias`], ['entregue', 'Entregues'], ['todas', 'Todas']];
  el.innerHTML = `
    ${cabecalho('Ordens de serviço', { sub: 'Assistência técnica: entrada do aparelho, orçamento, aprovação do cliente, reparo e entrega.',
      acoes: pode('os.criar') ? `<a class="btn btn-primary" href="#/os/nova">${icone('mais')} Nova OS</a>` : '' })}
    <div class="kpis">
      ${kpi('Na bancada', fmtNum(res.na_bancada), res.aguardando_peca ? `${res.aguardando_peca} esperando peça` : 'diagnóstico e reparo')}
      ${kpi('Aguardando o cliente', fmtNum(res.aguardando_aprovacao), 'orçamento enviado')}
      ${kpi('Prontas para retirada', fmtNum(res.prontas), res.para_abandono ? `<span class="neg">${res.para_abandono} há mais de ${res.dias_abandono} dias</span>` : 'avise o cliente')}
      ${res.faturado_mes != null ? kpi('Faturado no mês', fmtMoeda(res.faturado_mes), `${res.entregues_mes} OS entregue(s)`) : kpi('Atrasadas', fmtNum(res.atrasadas), 'passaram da previsão', res.atrasadas ? 'neg' : '')}
    </div>
    <div class="card"><div class="ferramentas">
      <input class="busca" id="f-termo" type="search" placeholder="Nº da OS, cliente, aparelho, IMEI…" value="${esc(f0.termo)}">
      <select id="f-filtro">${FILTROS.map(([v, r]) => `<option value="${v}" ${f0.filtro === v ? 'selected' : ''}>${r}</option>`).join('')}</select>
      <span style="flex:1"></span>
      <button class="btn btn-ghost btn-sm" type="button" id="b-modo">${f0.modo === 'lista' ? 'Ver em quadro' : 'Ver em lista'}</button>
    </div><div id="tabela">${carregando()}</div></div>`;

  const carregar = async () => {
    let dados;
    try {
      dados = await buscarTudo(() => {
        let q = estado.sb.from('os_lista').select('id,numero,interna,cliente_nome,cliente_telefone,aparelho,imei,defeito,status,prioridade,previsao,tecnico_nome,tecnico_id,total_centavos,criado_em,atrasada,dias_aguardando_retirada,pode_abandonar,retorno_garantia,garantia_ate,entregue_em');
        const fl = f0.filtro;
        if (fl === 'andamento') q = q.in('status', ABERTOS);
        else if (fl === 'minhas') q = q.eq('tecnico_id', estado.perfil.user_id).in('status', BANCADA);
        else if (fl === 'bancada') q = q.in('status', BANCADA);
        else if (fl === 'atrasadas') q = q.eq('atrasada', true);
        else if (fl === 'abandono') q = q.eq('pode_abandonar', true);
        else if (fl !== 'todas') q = q.eq('status', fl);
        const t = f0.termo.trim().replace(/[,()"%]/g, ' ');
        if (/^\d{1,7}$/.test(t)) q = q.eq('numero', Number(t));
        else if (t) q = q.or(`cliente_nome.ilike."%${t}%",aparelho.ilike."%${t}%",imei.ilike."%${t}%",defeito.ilike."%${t}%"`);
        return q.order(fl === 'entregue' ? 'entregue_em' : 'criado_em', { ascending: !['entregue', 'todas'].includes(fl) });
      });
    } catch (err) { $('#tabela', el).innerHTML = vazio('Erro', esc(msgErro(err))); return; }
    if (!ctx.ativo()) return;
    if (!dados.length) { $('#tabela', el).innerHTML = vazio('Nenhuma OS aqui', f0.filtro === 'minhas' ? 'Nada na sua bancada. Veja “Na bancada (todos)”.' : ''); return; }
    const sub = (o) => `${o.interna ? 'Interna (estoque)' : esc(o.cliente_nome || '')}${o.tecnico_nome ? ` · ${esc(o.tecnico_nome)}` : ''}`;
    const marcas = (o) => [o.prioridade === 'urgente' ? tag('Urgente', 'danger') : '', o.retorno_garantia ? tag('Garantia', 'warn') : '', o.atrasada ? tag('Atrasada', 'danger') : '',
      o.pode_abandonar ? tag(`${o.dias_aguardando_retirada} dias sem retirar`, 'danger') : ''].join(' ');
    if (f0.modo === 'quadro') {
      const cols = [['Entrada', ['aberta', 'diagnostico']], ['Aguardando cliente', ['aguardando_aprovacao']], ['Aprovadas', ['aprovada']], ['Em reparo', ['em_execucao']],
        ['Esperando peça', ['aguardando_peca']], ['Prontas', ['pronta', 'reprovada']]];
      $('#tabela', el).innerHTML = `<div class="quadro-os">${cols.map(([rot, sts]) => {
        const xs = dados.filter((o) => sts.includes(o.status));
        return `<div class="quadro-col"><div class="quadro-topo"><b>${rot}</b><span class="muted">${xs.length}</span></div>
          ${xs.map((o) => `<a class="quadro-card" href="#/os/${o.id}"><b>nº ${o.numero} · ${esc(o.aparelho)}</b><span class="muted pequeno">${sub(o)}</span>
            <span class="pequeno">${esc(o.defeito).slice(0, 70)}</span><span>${marcas(o)}</span></a>`).join('') || '<p class="muted pequeno" style="padding:6px">—</p>'}</div>`;
      }).join('')}</div>`;
      return;
    }
    $('#tabela', el).innerHTML = `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Nº</th><th>Aparelho</th><th class="esconder-cel">Defeito</th><th class="esconder-cel">Entrada</th><th class="num">Valor</th><th>Situação</th></tr></thead><tbody>
      ${dados.map((o) => `<tr class="clicavel" data-id="${o.id}"><td><b>${o.numero}</b></td><td><b>${esc(o.aparelho)}</b><div class="muted pequeno">${sub(o)}</div><div>${marcas(o)}</div></td>
        <td class="esconder-cel pequeno">${esc(o.defeito).slice(0, 80)}</td><td class="esconder-cel">${fmtData(o.criado_em)}${o.previsao ? `<div class="muted pequeno">previsão ${fmtData(o.previsao)}</div>` : ''}</td>
        <td class="num">${o.total_centavos ? fmtMoeda(o.total_centavos) : '—'}</td><td>${stTag(o.status)}</td></tr>`).join('')}
      </tbody></table></div><div class="rodape-tabela"><span>${dados.length} OS</span></div>`;
    $$('tr[data-id]', el).forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/os/${tr.dataset.id}`; }));
  };
  let tm; $('#f-termo', el).addEventListener('input', (e) => { clearTimeout(tm); tm = setTimeout(() => { f0.termo = e.target.value; carregar(); }, 250); });
  $('#f-filtro', el).addEventListener('change', (e) => { f0.filtro = e.target.value; f0.mexeu = true; carregar(); });
  $('#b-modo', el).addEventListener('click', () => { f0.modo = f0.modo === 'lista' ? 'quadro' : 'lista'; if (f0.modo === 'quadro' && !['andamento', 'bancada', 'minhas'].includes(f0.filtro)) f0.filtro = 'andamento'; lista(el, ctx); });
  carregar();
}

// =====================================================================
// Componentes: checklist, senha/padrão, técnicos
// =====================================================================
const itensChecklist = () => (Array.isArray(estado.empresa?.checklist_os) ? estado.empresa.checklist_os : []);
function checklistHtml(valores = {}) {
  const itens = [...new Set([...itensChecklist(), ...Object.keys(valores)])];
  if (!itens.length) return '';
  return `<fieldset><legend>Checklist de entrada (como o aparelho chegou)</legend><div class="form-grade">
    ${itens.map((it, k) => `<label class="pequeno">${esc(it)}<select data-chk="${k}" data-item="${esc(it)}">
      <option value="">não testado</option><option value="ok" ${valores[it] === 'ok' ? 'selected' : ''}>funciona</option><option value="falha" ${valores[it] === 'falha' ? 'selected' : ''}>com problema</option>
      <option value="na" ${valores[it] === 'na' ? 'selected' : ''}>não liga / não deu para testar</option></select></label>`).join('')}</div></fieldset>`;
}
const lerChecklist = (f) => Object.fromEntries($$('select[data-chk]', f).filter((s) => s.value).map((s) => [s.dataset.item, s.value]));

function senhaHtml() {
  return `<fieldset><legend>Senha do aparelho (guardada protegida e apagada na entrega)</legend>
    <div class="radios" style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:8px">
      <label class="check"><input type="radio" name="stipo" value="" checked> Sem senha / cliente não informou</label>
      <label class="check"><input type="radio" name="stipo" value="senha"> Senha / PIN</label>
      <label class="check"><input type="radio" name="stipo" value="padrao"> Desenho (padrão)</label></div>
    <div data-sbox="senha" hidden><input name="senha" autocomplete="off" placeholder="Ex.: 1234"></div>
    <div data-sbox="padrao" hidden><div class="padrao" data-padrao>${Array.from({ length: 9 }, (_, i) => `<button type="button" data-n="${i + 1}"><span></span></button>`).join('')}</div>
      <p class="pequeno">Sequência: <b data-seq>—</b> <button type="button" class="link-btn" data-limpar>limpar</button></p></div>
  </fieldset>`;
}
function ligarSenha(f) {
  let seq = [];
  const mostrar = () => { $('[data-seq]', f).textContent = seq.length ? seq.join(' → ') : '—'; $$('[data-n]', f).forEach((b) => b.classList.toggle('on', seq.includes(Number(b.dataset.n)))); };
  $$('input[name=stipo]', f).forEach((r) => r.addEventListener('change', () => {
    $$('[data-sbox]', f).forEach((b) => { b.hidden = b.dataset.sbox !== r.value || !r.checked; });
  }));
  $$('[data-n]', f).forEach((b) => b.addEventListener('click', () => { const n = Number(b.dataset.n); if (!seq.includes(n)) seq.push(n); mostrar(); }));
  $('[data-limpar]', f)?.addEventListener('click', () => { seq = []; mostrar(); });
  return () => {
    const tipo = f.querySelector('input[name=stipo]:checked')?.value || '';
    if (tipo === 'senha') return { senha_tipo: 'senha', senha: f.senha.value.trim() || null };
    if (tipo === 'padrao') return { senha_tipo: 'padrao', senha: seq.length >= 3 ? seq.join('-') : null };
    return { senha: null };
  };
}
async function tecnicos() {
  return (await listaCache('perfis')).filter((p) => p.ativo && ['tecnico', 'gerente'].includes(p.cargo));
}

// =====================================================================
// NOVA OS
// =====================================================================
export async function nova(el, ctx) {
  if (!pode('os.criar')) { el.innerHTML = vazio('Sem permissão', 'Seu usuário não pode abrir OS.'); return; }
  const [tecs, modelos] = await Promise.all([tecnicos(), consulta(estado.sb.from('produtos').select('id,nome').eq('controla_serie', true).eq('ativo', true).order('nome'))]);
  if (!ctx.ativo()) return;
  let cli = estado.preClienteOs || null; estado.preClienteOs = null;
  const fotos = [];
  el.innerHTML = `
    <a class="voltar" href="#/os">${icone('recolher')} Ordens de serviço</a>
    ${cabecalho('Nova OS', { sub: 'Entrada do aparelho do cliente. Dá para preencher pelo celular e tirar as fotos na hora.' })}
    <form id="f-os" class="card card-pad form-os" novalidate>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px">
        <div style="min-width:0"><div class="muted pequeno">Cliente *</div><b data-cli>${cli ? esc(cli.nome) : '<span class="neg">Escolha o cliente</span>'}</b></div>
        <button class="btn btn-ghost btn-sm" type="button" data-esc>Escolher</button></div>
      <div class="form-grade">
        <label>Aparelho (marca e modelo) *<input name="aparelho" list="lst-modelos" placeholder="Ex.: iPhone 12 128GB" autocomplete="off" required></label>
        <datalist id="lst-modelos">${modelos.map((m) => `<option value="${esc(m.nome)}"></option>`).join('')}</datalist>
        <label>IMEI / nº de série<input name="imei" inputmode="numeric" autocomplete="off"></label>
        <label>Cor<input name="cor"></label>
        <label>Acessórios deixados<input name="acessorios" placeholder="Ex.: capinha, chip, carregador"></label>
      </div>
      <label>Defeito relatado pelo cliente *<textarea name="defeito" rows="2" required placeholder="Ex.: caiu, tela trincada e touch falhando"></textarea></label>
      <label>Estado do aparelho na entrada<input name="estado" placeholder="Ex.: riscos na tampa, amassado no canto inferior"></label>
      ${checklistHtml()}
      ${senhaHtml()}
      <div class="form-grade">
        <label>Técnico<select name="tecnico"><option value="">Definir depois</option>${tecs.map((t) => `<option value="${t.user_id}" ${estado.perfil.user_id === t.user_id ? 'selected' : ''}>${esc(t.nome)}</option>`).join('')}</select></label>
        <label>Previsão de entrega<input type="date" name="previsao" min="${hojeSP()}" value="${somarDias(hojeSP(), 3)}"></label>
        <label>Prioridade<select name="prioridade"><option value="normal">Normal</option><option value="urgente">Urgente</option></select></label>
      </div>
      <label>Observação interna<input name="obs"></label>
      <div class="card-pad" style="padding-left:0;padding-right:0">
        <label class="btn btn-ghost" style="cursor:pointer">${icone('mais')} Fotos do aparelho (câmera)<input type="file" id="f-fotos" accept="image/*" capture="environment" multiple hidden></label>
        <div id="fotos-prev" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"></div>
      </div>
      <p class="erro" id="erro" hidden></p>
      <button class="btn btn-primary btn-lg" type="submit">Abrir OS</button>
    </form>`;
  const f = $('#f-os', el);
  const lerSenha = ligarSenha(f);
  $('[data-esc]', f).addEventListener('click', async () => {
    const { escolherCliente } = await import('./clientes.js');
    const c = await escolherCliente(); if (c) { cli = c; $('[data-cli]', f).textContent = c.nome; }
  });
  $('#f-fotos', f).addEventListener('change', async (e) => {
    const { reduzirFoto } = await import('./aparelhos.js');
    for (const arq of [...e.target.files].slice(0, 10 - fotos.length)) fotos.push(await reduzirFoto(arq));
    $('#fotos-prev', f).innerHTML = fotos.map((u) => `<img src="${u}" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--line)">`).join('');
    e.target.value = '';
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const erro = $('#erro', f); erro.hidden = true;
    const falha = (m) => { erro.textContent = m; erro.hidden = false; };
    if (!cli) return falha('Escolha o cliente dono do aparelho.');
    if (f.aparelho.value.trim().length < 2) return falha('Informe o aparelho.');
    if (f.defeito.value.trim().length < 3) return falha('Descreva o defeito relatado.');
    const sen = lerSenha();
    if (f.querySelector('input[name=stipo]:checked')?.value && !sen.senha) return falha('Digite a senha ou desenhe o padrão (mínimo 3 pontos), ou marque "sem senha".');
    const prod = modelos.find((m) => m.nome.toLowerCase() === f.aparelho.value.trim().toLowerCase());
    const btn = $('button[type=submit]', f); btn.disabled = true;
    try {
      const r = await rpc('abrir_os', { p: {
        cliente_id: cli.id, aparelho: f.aparelho.value.trim(), produto_id: prod?.id || null, imei: f.imei.value, cor: f.cor.value, acessorios: f.acessorios.value,
        defeito: f.defeito.value, estado_entrada: f.estado.value, checklist: lerChecklist(f), tecnico_id: f.tecnico.value || null, previsao: f.previsao.value || null,
        prioridade: f.prioridade.value, observacao: f.obs.value, ...sen,
      } });
      for (const u of fotos) { try { await rpc('adicionar_foto_os', { p_os: r.id, p_imagem: u, p_legenda: 'Entrada' }); } catch (err) { toast(msgErro(err), 'erro'); } }
      toast(`OS nº ${r.numero} aberta`);
      estado.osImprimirEntrada = r.id;
      location.hash = `#/os/${r.id}`;
    } catch (err) { falha(msgErro(err)); } finally { btn.disabled = false; }
  });
}

// OS interna: mandar aparelho do estoque para reparo (chamado pela ficha do aparelho)
export async function abrirInterna(a) {
  const tecs = await tecnicos();
  return abrirModal({
    titulo: `Mandar para reparo: ${esc(a.produto)}`, largura: 'sm', botao: 'Abrir OS interna',
    corpo: `<p class="muted">IMEI ${esc(a.imei)}. O aparelho sai do PDV ("em reparo"). As peças usadas viram custo de recondicionamento dele.</p>
      <label>O que precisa ser feito *<textarea name="defeito" rows="2" required placeholder="Ex.: trocar bateria (saúde 72%)"></textarea></label>
      <label>Técnico<select name="tecnico"><option value="">Definir depois</option>${tecs.map((t) => `<option value="${t.user_id}">${esc(t.nome)}</option>`).join('')}</select></label>`,
    aoSalvar: async (f) => {
      if (f.defeito.value.trim().length < 3) { f.erro('Descreva o serviço.'); return false; }
      return rpc('abrir_os', { p: { interna: true, serie_id: a.id, defeito: f.defeito.value, tecnico_id: f.tecnico.value || null } });
    },
  });
}

// =====================================================================
// Impressões e WhatsApp
// =====================================================================
const linhaItens = (itens) => `<table><thead><tr><th>Item</th><th class="num">Qtd</th><th class="num">Unit.</th><th class="num">Total</th></tr></thead><tbody>
  ${itens.map((i) => `<tr><td>${esc(i.descricao)}</td><td class="num">${fmtNum(i.quantidade)}</td><td class="num">${fmtMoeda(i.preco_unitario_centavos)}</td><td class="num">${fmtMoeda(i.total_centavos)}</td></tr>`).join('')}</tbody></table>`;
const cabOs = (o) => `<p>Cliente: <b>${esc(o.cliente_nome || 'Interna')}</b> ${docCli(o) ? `· ${docCli(o)}` : ''}${o.cliente_telefone ? ` · ${fmtTelefone(o.cliente_telefone)}` : ''}<br>
  Aparelho: <b>${esc(o.aparelho)}</b>${o.imei ? ` · IMEI/série ${esc(o.imei)}` : ''}${o.cor ? ` · ${esc(o.cor)}` : ''}</p>`;

function imprimirEntrada(o) {
  const e = estado.empresa || {};
  const chk = Object.entries(o.checklist || {});
  const rot = { ok: 'funciona', falha: 'com problema', na: 'não testado' };
  imprimir(`OS ${o.numero}`, `
    <h2>Ordem de serviço nº ${o.numero} — comprovante de entrada</h2>
    <p>Entrada: <b>${fmtDataHora(o.criado_em)}</b> · Atendente: ${esc(o.atendente_nome || '')}${o.previsao ? ` · Previsão: <b>${fmtData(o.previsao)}</b>` : ''}</p>
    ${cabOs(o)}
    <div class="caixa"><b>Defeito relatado:</b> ${esc(o.defeito)}${o.acessorios ? `<br><b>Acessórios deixados:</b> ${esc(o.acessorios)}` : '<br>Nenhum acessório deixado.'}
      ${o.estado_entrada ? `<br><b>Estado na entrada:</b> ${esc(o.estado_entrada)}` : ''}${o.tem_senha ? '<br>Senha do aparelho informada (guardada com segurança e apagada na entrega).' : ''}</div>
    ${chk.length ? `<h2>Checklist de entrada</h2><table><tbody>${chk.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${rot[v] || v}</td></tr>`).join('')}</tbody></table>` : ''}
    <p style="text-align:justify" class="muted">${esc(e.texto_os_entrada || '')}</p>
    <p>Acompanhe pelo WhatsApp ${e.whatsapp || e.telefone ? fmtTelefone(e.whatsapp || e.telefone) : 'da loja'} informando o nº <b>${o.numero}</b>.</p>
    <div class="assin"><div>${esc(o.cliente_nome || '')}<br>Cliente</div><div>${esc(e.nome_fantasia || '')}</div></div>`);
}
function imprimirOrcamento(o, itens) {
  imprimir(`Orçamento OS ${o.numero}`, `
    <h2>Orçamento — OS nº ${o.numero}</h2>
    <p>Data: <b>${fmtData(o.orcamento_enviado_em || new Date().toISOString())}</b></p>
    ${cabOs(o)}
    ${o.diagnostico ? `<div class="caixa"><b>Diagnóstico:</b> ${esc(o.diagnostico)}</div>` : ''}
    ${linhaItens(itens)}
    <table><tbody>${o.desconto_centavos ? `<tr><td>Desconto</td><td class="num">− ${fmtMoeda(o.desconto_centavos)}</td></tr>` : ''}
      <tr><td class="total">Total</td><td class="num total">${fmtMoeda(o.total_centavos)}</td></tr></tbody></table>
    <p>Garantia do serviço: <b>${o.garantia_dias ?? estado.empresa?.garantia_os_dias ?? 90} dias</b> após a entrega.${o.taxa_diagnostico_centavos ? ` Se o orçamento for recusado, é cobrada a taxa de diagnóstico de ${fmtMoeda(o.taxa_diagnostico_centavos)}.` : ''}</p>
    <div class="assin"><div>${esc(o.cliente_nome || '')}<br>Aprovo o orçamento</div><div>${esc(estado.empresa?.nome_fantasia || '')}</div></div>`);
}
function imprimirEntrega(o, itens, pags) {
  const e = estado.empresa || {};
  imprimir(`Entrega OS ${o.numero}`, `
    <h2>OS nº ${o.numero} — termo de entrega${o.garantia_ate ? ' e garantia' : ''}</h2>
    <p>Entregue em <b>${fmtDataHora(o.entregue_em)}</b></p>
    ${cabOs(o)}
    ${o.aprovado === false ? '<div class="caixa">Aparelho devolvido <b>sem reparo</b> (orçamento recusado pelo cliente).</div>' : `${o.diagnostico ? `<div class="caixa"><b>Serviço:</b> ${esc(o.diagnostico)}</div>` : ''}${linhaItens(itens)}`}
    <table><tbody><tr><td class="total">Total pago</td><td class="num total">${fmtMoeda(o.total_centavos)}</td></tr>
      ${pags.map((p) => `<tr><td>${FORMAS[p.forma] || p.forma}${p.parcelas > 1 ? ` em ${p.parcelas}x` : ''}</td><td class="num">${fmtMoeda(p.valor_centavos)}</td></tr>`).join('')}</tbody></table>
    ${o.garantia_ate ? `<div class="caixa"><b>Garantia do serviço até ${fmtData(o.garantia_ate)}</b> (${o.garantia_dias} dias). Cobre o serviço e as peças trocadas. Não cobre queda, contato com líquido, mau uso ou violação por terceiros.${e.texto_garantia ? `<br>${esc(e.texto_garantia)}` : ''}</div>` : ''}
    <p>Declaro que recebi o aparelho acima${o.aprovado === false ? '' : ' funcionando'} e conferi os acessórios deixados${o.acessorios ? ` (${esc(o.acessorios)})` : ''}.</p>
    <div class="assin"><div>${esc(o.cliente_nome || '')}<br>Cliente</div><div>${esc(e.nome_fantasia || '')}</div></div>`);
}
function zapOrcamento(o, itens) {
  const nome = (o.cliente_nome || '').split(' ')[0];
  return [`Olá, ${nome}! Aqui é da ${estado.empresa?.nome_fantasia || 'loja'}. Segue o orçamento do seu ${o.aparelho} (OS nº ${o.numero}):`, '',
    o.diagnostico ? `Diagnóstico: ${o.diagnostico}` : null,
    ...itens.map((i) => `• ${fmtNum(i.quantidade) !== '1' ? fmtNum(i.quantidade) + 'x ' : ''}${i.descricao} — ${fmtMoeda(i.total_centavos)}`),
    o.desconto_centavos ? `Desconto: ${fmtMoeda(o.desconto_centavos)}` : null,
    `*Total: ${fmtMoeda(o.total_centavos)}*`, `Garantia: ${o.garantia_dias ?? estado.empresa?.garantia_os_dias ?? 90} dias.`, '',
    'Posso seguir com o reparo? Responda *SIM* para aprovar.'].filter((x) => x !== null).join('\n');
}
const zapPronta = (o) => `Olá, ${(o.cliente_nome || '').split(' ')[0]}! Seu ${o.aparelho} (OS nº ${o.numero}) está pronto para retirada na ${estado.empresa?.nome_fantasia || 'loja'}. Valor: ${fmtMoeda(o.total_centavos)}. Te esperamos!`;
const zapAbandono = (o) => `Olá, ${(o.cliente_nome || '').split(' ')[0]}! Seu ${o.aparelho} (OS nº ${o.numero}) está na ${estado.empresa?.nome_fantasia || 'loja'} aguardando retirada há ${o.dias_aguardando_retirada} dias. Por favor, venha buscar. Após ${estado.empresa?.dias_abandono_os || 90} dias o aparelho pode ser considerado abandonado.`;

// =====================================================================
// DETALHE
// =====================================================================
export async function detalhe(el, ctx) {
  const id = ctx.params[0];
  const [rows, itens, eventos, fotos, pags] = await Promise.all([
    consulta(estado.sb.from('os_lista').select('*').eq('id', id)),
    consulta(estado.sb.from('os_itens').select('*').eq('os_id', id).order('criado_em')),
    consulta(estado.sb.from('os_eventos').select('*').eq('os_id', id).order('id', { ascending: false })),
    consulta(estado.sb.from('os_fotos').select('id,imagem,legenda,criado_em').eq('os_id', id).order('criado_em')),
    consulta(estado.sb.from('os_pagamentos').select('*').eq('os_id', id)),
  ]);
  if (!ctx.ativo()) return;
  const o = rows[0];
  if (!o) { el.innerHTML = vazio('OS não encontrada', '<a href="#/os">Voltar</a>'); return; }
  const encerrada = ['entregue', 'cancelada', 'abandonada'].includes(o.status);
  const editar = pode('os.editar');
  const verCusto = itens.some((i) => i.custo_unitario_centavos != null);
  const subtotal = itens.reduce((s, i) => s + i.total_centavos, 0);
  const prox = {
    aberta: [['diagnostico', 'Começar diagnóstico']], aprovada: [['em_execucao', 'Iniciar reparo'], ['pronta', 'Concluir reparo']],
    em_execucao: [['pronta', 'Concluir reparo'], ['aguardando_peca', 'Aguardando peça']], aguardando_peca: [['em_execucao', 'Peça chegou: retomar'], ['pronta', 'Concluir reparo']],
    pronta: o.interna ? [] : [['em_execucao', 'Reabrir reparo']],
  }[o.status] || [];
  const hoje = hojeSP();
  const acoes = [
    editar && prox.length ? prox.map(([s, r], k) => `<button class="btn ${k === 0 ? 'btn-primary' : 'btn-ghost'}" type="button" data-st="${s}">${r}</button>`).join('') : '',
    editar && !encerrada && !['pronta', 'reprovada'].includes(o.status) ? `<button class="btn ${['aberta', 'diagnostico'].includes(o.status) ? 'btn-primary' : 'btn-ghost'}" type="button" id="b-orc">${itens.length ? 'Editar orçamento' : 'Fazer orçamento'}</button>` : '',
    (pode('os.editar') || pode('os.criar')) && ['aguardando_aprovacao', 'diagnostico'].includes(o.status) && itens.length ? '<button class="btn btn-primary" type="button" id="b-aprov">Registrar resposta do cliente</button>' : '',
    pode('os.entregar') && ['pronta', 'reprovada'].includes(o.status) && !o.interna ? `<button class="btn btn-ok" type="button" id="b-entregar">${o.status === 'pronta' ? 'Entregar e receber' : 'Devolver ao cliente'}</button>` : '',
    o.tem_senha && pode('os.ver_senha') ? '<button class="btn btn-ghost" type="button" id="b-senha">Ver senha</button>' : '',
    !encerrada && (pode('os.editar') || pode('os.criar')) ? '<button class="btn btn-ghost" type="button" id="b-edit">Editar dados</button>' : '',
    o.status === 'entregue' && o.garantia_ate && o.garantia_ate >= hoje && pode('os.criar') ? '<button class="btn btn-ghost" type="button" id="b-garantia">Retorno em garantia</button>' : '',
    '<button class="btn btn-ghost" type="button" id="b-nota">Anotar</button>',
    pode('os.cancelar') && o.pode_abandonar ? '<button class="btn btn-ghost" type="button" id="b-abandono" style="color:var(--danger)">Marcar abandonado</button>' : '',
    pode('os.cancelar') && !encerrada ? '<button class="btn btn-ghost" type="button" id="b-cancelar" style="color:var(--danger)">Cancelar OS</button>' : '',
  ].filter(Boolean).join('');
  const linha = (rot, val) => (val ? `<div><dt>${rot}</dt><dd>${val}</dd></div>` : '');
  const rotChk = { ok: '<span class="pos">funciona</span>', falha: '<span class="neg">com problema</span>', na: '<span class="muted">não testado</span>' };
  const zapLinks = [
    !o.interna && o.cliente_telefone && o.status === 'aguardando_aprovacao' && itens.length ? `<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${linkZap(o.cliente_telefone, zapOrcamento(o, itens))}">${icone('zap')} Enviar orçamento</a>` : '',
    !o.interna && o.cliente_telefone && o.status === 'pronta' ? `<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${linkZap(o.cliente_telefone, o.dias_aguardando_retirada >= 15 ? zapAbandono(o) : zapPronta(o))}">${icone('zap')} ${o.dias_aguardando_retirada >= 15 ? 'Cobrar retirada' : 'Avisar que está pronto'}</a>` : '',
  ].join('');

  el.innerHTML = `
    <a class="voltar" href="#/os">${icone('recolher')} Ordens de serviço</a>
    ${cabecalho(`OS nº ${o.numero} · ${esc(o.aparelho)}`, { sub: `${o.interna ? 'OS interna (recondicionamento do estoque)' : esc(o.cliente_nome)} · aberta em ${fmtDataHora(o.criado_em)}${o.atendente_nome ? ` por ${esc(o.atendente_nome)}` : ''}`,
      resumo: `${stTag(o.status)} ${o.prioridade === 'urgente' ? tag('Urgente', 'danger') : ''} ${o.retorno_garantia ? tag(`Garantia da OS nº ${o.os_origem_numero}`, 'warn') : ''}` })}
    ${o.status === 'cancelada' ? `<div class="alerta">${icone('alerta')}<span>Cancelada em ${fmtDataHora(o.cancelada_em)}: ${esc(o.motivo_cancelamento || '')}</span></div>` : ''}
    ${o.status === 'abandonada' ? `<div class="alerta">${icone('alerta')}<span>Marcada como abandonada em ${fmtDataHora(o.abandonada_em)}.</span></div>` : ''}
    ${o.pode_abandonar ? `<div class="alerta">${icone('alerta')}<span>Aguardando retirada há <b>${o.dias_aguardando_retirada} dias</b> (prazo: ${estado.empresa?.dias_abandono_os || 90}). Registre os avisos ao cliente antes de marcar como abandonado.</span></div>` : ''}
    ${o.atrasada ? `<div class="alerta">${icone('alerta')}<span>Passou da previsão de entrega (${fmtData(o.previsao)}).</span></div>` : ''}
    <div class="barra-acoes">${acoes}</div>
    <div class="barra-acoes" style="margin-top:-6px">
      <button class="btn btn-ghost btn-sm" type="button" id="p-entrada">${icone('impressora')} Comprovante de entrada</button>
      ${itens.length ? `<button class="btn btn-ghost btn-sm" type="button" id="p-orc">${icone('impressora')} Orçamento</button>` : ''}
      ${o.status === 'entregue' && !o.interna ? `<button class="btn btn-ghost btn-sm" type="button" id="p-entrega">${icone('impressora')} Termo de entrega${o.garantia_ate ? ' e garantia' : ''}</button>` : ''}
      ${zapLinks}
    </div>
    <div class="lado-a-lado">
      <div>
        <div class="card card-pad"><dl class="dl">
          ${o.interna ? linha('Aparelho do estoque', `<a href="#/aparelhos/${o.serie_id}">${esc(o.aparelho)}</a>`) : linha('Cliente', `<a href="#/clientes/${o.cliente_id}">${esc(o.cliente_nome)}</a>${o.cliente_telefone ? `<br><a class="zap" target="_blank" rel="noopener" href="${linkZap(o.cliente_telefone)}">${fmtTelefone(o.cliente_telefone)}</a>` : ''}`)}
          ${linha('Aparelho', `${esc(o.aparelho)}${o.cor ? ` · ${esc(o.cor)}` : ''}${o.imei ? `<br><span class="muted">IMEI/série ${esc(o.imei)}</span>` : ''}`)}
          ${linha('Defeito relatado', esc(o.defeito))}
          ${linha('Acessórios deixados', esc(o.acessorios || 'nenhum'))}
          ${linha('Estado na entrada', esc(o.estado_entrada))}
          ${linha('Senha', o.tem_senha ? 'guardada (protegida)' : (o.status === 'entregue' ? 'apagada na entrega' : ''))}
          ${linha('Técnico', esc(o.tecnico_nome || 'não definido'))}
          ${linha('Previsão', o.previsao ? fmtData(o.previsao) : '')}
          ${linha('Garantia', o.garantia_ate ? `até <b>${fmtData(o.garantia_ate)}</b>${o.garantia_ate < hoje ? ' (vencida)' : ''}` : (!o.interna ? `${o.garantia_dias ?? '—'} dias após a entrega` : ''))}
          ${linha('Observação', esc(o.observacao))}
        </dl></div>
        ${Object.keys(o.checklist || {}).length ? `<div class="card card-pad" style="margin-top:16px"><h3 style="margin-bottom:10px">Checklist de entrada</h3><div class="tabela-wrap"><table class="tabela"><tbody>
          ${Object.entries(o.checklist).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${rotChk[v] || esc(v)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
        <div class="card card-pad" style="margin-top:16px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h3>Fotos</h3>
          ${(pode('os.criar') || editar) && !encerrada ? `<label class="btn btn-ghost btn-sm" style="cursor:pointer">${icone('mais')} Incluir<input type="file" id="f-fotos" accept="image/*" capture="environment" multiple hidden></label>` : ''}</div>
          ${fotos.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px">${fotos.map((fo) => `<button type="button" data-foto="${fo.id}" style="padding:0;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:none;cursor:zoom-in;aspect-ratio:1"><img src="${fo.imagem}" alt="${esc(fo.legenda || 'foto')}" style="width:100%;height:100%;object-fit:cover"></button>`).join('')}</div>`
    : '<p class="muted">Nenhuma foto. Fotografe o aparelho na entrada (frente, verso, laterais) para evitar discussão depois.</p>'}</div>
      </div>
      <div>
        <div class="card"><div class="card-topo"><h3>Orçamento</h3>${o.orcamento_enviado_em ? `<span class="muted pequeno">enviado ${fmtDataHora(o.orcamento_enviado_em)}</span>` : ''}</div>
          ${o.diagnostico ? `<p class="card-pad" style="padding-bottom:0"><b>Diagnóstico:</b> ${esc(o.diagnostico)}</p>` : ''}
          ${itens.length ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Item</th><th class="num">Qtd</th><th class="num">Valor</th>${verCusto ? '<th class="num esconder-cel">Custo</th>' : ''}</tr></thead><tbody>
            ${itens.map((i) => `<tr><td>${esc(i.descricao)}<div class="muted pequeno">${i.tipo === 'peca' ? `peça do estoque${i.aplicado ? ' · <b>baixada</b>' : i.estoque_atual != null ? ` · estoque ${fmtNum(i.estoque_atual)}` : ''}` : 'serviço'}</div></td>
              <td class="num">${fmtNum(i.quantidade)}</td><td class="num">${fmtMoeda(i.total_centavos)}</td>${verCusto ? `<td class="num esconder-cel muted">${i.custo_unitario_centavos != null ? fmtMoeda(Math.round(i.custo_unitario_centavos * i.quantidade)) : ''}</td>` : ''}</tr>`).join('')}
            ${o.desconto_centavos ? `<tr><td colspan="2">Desconto</td><td class="num">− ${fmtMoeda(o.desconto_centavos)}</td>${verCusto ? '<td></td>' : ''}</tr>` : ''}
            <tr class="forte"><td colspan="2"><b>Total</b></td><td class="num"><b>${fmtMoeda(o.total_centavos)}</b></td>${verCusto ? `<td class="num esconder-cel muted">lucro ${fmtMoeda(o.total_centavos - itens.reduce((s, i) => s + Math.round((i.custo_unitario_centavos || 0) * i.quantidade), 0))}</td>` : ''}</tr>
          </tbody></table></div>` : vazio('Sem orçamento ainda', editar ? 'Clique em “Fazer orçamento” depois do diagnóstico.' : 'O técnico monta o orçamento depois do diagnóstico.')}
          ${o.taxa_diagnostico_centavos ? `<p class="muted pequeno card-pad">Taxa de diagnóstico se recusar: ${fmtMoeda(o.taxa_diagnostico_centavos)}</p>` : ''}
          ${o.aprovacao_em ? `<p class="card-pad pequeno" style="border-top:1px solid var(--line)">${o.aprovado ? '<span class="pos">✓ Aprovado</span>' : '<span class="neg">✗ Recusado</span>'} pelo cliente em ${fmtDataHora(o.aprovacao_em)} · ${esc(MEIOS[o.aprovacao_meio] || o.aprovacao_meio)}${o.aprovacao_nome ? ` · ${esc(o.aprovacao_nome)}` : ''}${o.aprovacao_obs ? `<br>${esc(o.aprovacao_obs)}` : ''}${o.aprovado ? ` · valor ${fmtMoeda(o.valor_aprovado_centavos)}` : ''}</p>` : ''}
        </div>
        ${pags.length ? `<div class="card" style="margin-top:16px"><div class="card-topo"><h3>Pagamento</h3></div><div class="tabela-wrap"><table class="tabela"><tbody>
          ${pags.map((p) => `<tr><td>${FORMAS[p.forma] || p.forma}${p.parcelas > 1 ? ` ${p.parcelas}x` : ''}</td><td class="num">${fmtMoeda(p.valor_centavos)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
        <div class="card card-pad" style="margin-top:16px"><h3 style="margin-bottom:10px">Linha do tempo</h3>
          ${eventos.length ? `<div class="tabela-wrap"><table class="tabela"><tbody>${eventos.map((e) => `<tr><td style="white-space:nowrap;width:1%">${fmtDataHora(e.criado_em)}</td><td>${esc(e.descricao)}<div class="muted pequeno">${esc(e.usuario || 'sistema')}</div></td></tr>`).join('')}</tbody></table></div>` : vazio('Sem registros', '')}
        </div>
      </div>
    </div>`;

  const recarregar = () => { if (ctx.ativo()) detalhe(el, ctx); };
  const tentar = async (fn, msg) => { try { await fn(); if (msg) toast(msg); recarregar(); } catch (err) { toast(msgErro(err), 'erro'); } };
  if (estado.osImprimirEntrada === id) { estado.osImprimirEntrada = null; if (await confirmar({ titulo: `OS nº ${o.numero} aberta`, texto: 'Imprimir o comprovante de entrada para o cliente assinar?', botao: 'Imprimir' })) imprimirEntrada(o); }
  $('#p-entrada', el).addEventListener('click', () => imprimirEntrada(o));
  $('#p-orc', el)?.addEventListener('click', () => imprimirOrcamento(o, itens));
  $('#p-entrega', el)?.addEventListener('click', () => imprimirEntrega(o, itens, pags));
  $$('[data-st]', el).forEach((b) => b.addEventListener('click', async () => {
    const s = b.dataset.st;
    let obs = null;
    if (s === 'pronta') {
      const pecas = itens.filter((i) => i.tipo === 'peca' && !i.aplicado);
      const r = await abrirModal({ titulo: 'Concluir reparo', largura: 'sm', botao: 'Concluir',
        corpo: `${pecas.length ? `<p>Estas peças vão sair do estoque agora:</p><ul>${pecas.map((i) => `<li>${fmtNum(i.quantidade)}x ${esc(i.descricao)}</li>`).join('')}</ul>` : '<p class="muted">Nenhuma peça do estoque nesta OS.</p>'}
          ${o.interna ? '<p>O aparelho volta para o estoque <b>em teste</b> e esta OS se encerra.</p>' : '<p>Depois avise o cliente pelo WhatsApp que está pronto.</p>'}
          <label>Observação<input name="obs" placeholder="Ex.: testado, tudo ok"></label>`,
        aoSalvar: (f) => f.obs.value || '' });
      if (r === null) return; obs = r;
    } else if (s === 'aguardando_peca') {
      obs = await pedirMotivo({ titulo: 'Aguardando peça', texto: 'Qual peça e previsão de chegada?', botao: 'Salvar', placeholder: 'Ex.: tela OLED, chega quinta' });
      if (!obs) return;
    }
    tentar(() => rpc('mudar_status_os', { p_os: id, p_status: s, p_obs: obs }), 'Situação atualizada');
  }));
  $('#b-orc', el)?.addEventListener('click', async () => { if (await editarOrcamento(o, itens)) recarregar(); });
  $('#b-aprov', el)?.addEventListener('click', async () => {
    const r = await abrirModal({
      titulo: `Resposta do cliente — ${fmtMoeda(o.total_centavos)}`, largura: 'sm', botao: 'Registrar',
      corpo: `<div style="display:grid;gap:6px;margin-bottom:10px"><label class="check"><input type="radio" name="ap" value="1" checked> <b>Aprovou</b> o orçamento</label>
          <label class="check"><input type="radio" name="ap" value="0"> <b>Recusou</b>: devolver o aparelho${o.taxa_diagnostico_centavos ? ` (taxa de ${fmtMoeda(o.taxa_diagnostico_centavos)})` : ' sem cobrar'}</label></div>
        <label>Como respondeu<select name="meio">${Object.entries(MEIOS).map(([k, v]) => `<option value="${k}" ${k === 'whatsapp' ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Quem respondeu<input name="nome" value="${esc(o.cliente_nome || '')}"></label>
        <label>Observação<input name="obs" placeholder="Ex.: respondeu SIM às 14h30 / print salvo"></label>`,
      aoSalvar: async (f) => {
        await rpc('registrar_aprovacao_os', { p_os: id, p_aprovado: f.querySelector('input[name=ap]:checked').value === '1', p_meio: f.meio.value, p_nome: f.nome.value, p_obs: f.obs.value });
        return true;
      },
    });
    if (r) { toast('Resposta registrada'); recarregar(); }
  });
  $('#b-entregar', el)?.addEventListener('click', async () => { if (await entregar(o)) recarregar(); });
  $('#b-senha', el)?.addEventListener('click', async () => {
    try {
      const s = await rpc('ver_senha_os', { p_os: id });
      await abrirModal({ titulo: 'Senha do aparelho', largura: 'sm', botao: null, cancelar: 'Fechar',
        corpo: `${s.tipo === 'padrao' ? `<div class="padrao mostrar">${Array.from({ length: 9 }, (_, i) => { const ord = s.valor.split('-').map(Number).indexOf(i + 1); return `<button type="button" class="${ord >= 0 ? 'on' : ''}" disabled><span>${ord >= 0 ? ord + 1 : ''}</span></button>`; }).join('')}</div><p>Sequência: <b>${esc(s.valor.split('-').join(' → '))}</b></p>`
          : `<p style="font-size:28px;font-weight:700;letter-spacing:4px;text-align:center">${esc(s.valor)}</p>`}
          <p class="muted pequeno">Sua visualização ficou registrada na linha do tempo. A senha é apagada na entrega.</p>` });
      recarregar();
    } catch (err) { toast(msgErro(err), 'erro'); }
  });
  $('#b-edit', el)?.addEventListener('click', async () => { if (await editarDados(o)) recarregar(); });
  $('#b-garantia', el)?.addEventListener('click', async () => {
    const d = await pedirMotivo({ titulo: 'Retorno em garantia', texto: `Garantia até ${fmtData(o.garantia_ate)}. Abre uma OS nova ligada a esta, sem cobrança.`, botao: 'Abrir OS de garantia', placeholder: 'O que voltou a acontecer?' });
    if (!d) return;
    try { const r = await rpc('abrir_retorno_garantia', { p_os: id, p_defeito: d }); toast(`OS nº ${r.numero} aberta`); location.hash = `#/os/${r.id}`; } catch (err) { toast(msgErro(err), 'erro'); }
  });
  $('#b-nota', el).addEventListener('click', async () => {
    const t = await abrirModal({ titulo: 'Anotar na OS', largura: 'sm', botao: 'Salvar', corpo: '<label>Anotação<textarea name="t" rows="3" placeholder="Ex.: cliente ligou perguntando; liguei avisando que está pronto"></textarea></label>',
      aoSalvar: (f) => { if (f.t.value.trim().length < 2) { f.erro('Escreva a anotação.'); return false; } return f.t.value; } });
    if (t) tentar(() => rpc('anotar_os', { p_os: id, p_texto: t }), 'Anotado');
  });
  $('#b-abandono', el)?.addEventListener('click', async () => {
    const m = await pedirMotivo({ titulo: 'Marcar como abandonado', texto: `Sem retirada há ${o.dias_aguardando_retirada} dias. Registre como e quando o cliente foi avisado.`, botao: 'Marcar abandonado', placeholder: 'Ex.: WhatsApp em 10/01 e 25/01, ligação em 02/02' });
    if (m) tentar(() => rpc('marcar_os_abandonada', { p_os: id, p_obs: m }), 'OS marcada como abandonada');
  });
  $('#b-cancelar', el)?.addEventListener('click', async () => {
    const m = await pedirMotivo({ titulo: `Cancelar OS nº ${o.numero}`, texto: 'Peças já baixadas voltam ao estoque e a senha é apagada.', botao: 'Cancelar OS' });
    if (m) tentar(() => rpc('cancelar_os', { p_os: id, p_motivo: m }), 'OS cancelada');
  });
  $('#f-fotos', el)?.addEventListener('change', async (e) => {
    const { reduzirFoto } = await import('./aparelhos.js');
    const arqs = [...e.target.files].slice(0, 10 - fotos.length);
    if (!arqs.length) { toast('Máximo de 10 fotos por OS.', 'erro'); return; }
    toast(`Enviando ${arqs.length} foto(s)…`);
    try { for (const arq of arqs) await rpc('adicionar_foto_os', { p_os: id, p_imagem: await reduzirFoto(arq), p_legenda: null }); toast('Fotos incluídas'); } catch (err) { toast(msgErro(err), 'erro'); }
    recarregar();
  });
  $$('[data-foto]', el).forEach((b) => b.addEventListener('click', async () => {
    const fo = fotos.find((x) => x.id === b.dataset.foto);
    const r = await abrirModal({ titulo: fo.legenda || 'Foto', largura: 'lg', botao: editar && !encerrada ? 'Remover foto' : null, botaoClasse: 'btn-danger', cancelar: 'Fechar',
      corpo: `<img src="${fo.imagem}" alt="" style="width:100%;max-height:70vh;object-fit:contain;border-radius:10px">` });
    if (r && editar) tentar(() => rpc('remover_foto_os', { p_foto: fo.id }), 'Foto removida');
  }));
}

// ---------------------------------------------------------------------
// Editar dados da OS
// ---------------------------------------------------------------------
async function editarDados(o) {
  const tecs = await tecnicos();
  return abrirModal({
    titulo: `Editar OS nº ${o.numero}`, largura: 'lg', botao: 'Salvar',
    corpo: `<div class="form-grade">
        <label>Aparelho<input name="aparelho" value="${esc(o.aparelho)}" ${o.interna ? 'disabled' : ''}></label>
        <label>IMEI / série<input name="imei" value="${esc(o.imei || '')}" ${o.interna ? 'disabled' : ''}></label>
        <label>Cor<input name="cor" value="${esc(o.cor || '')}"></label>
        <label>Acessórios<input name="acessorios" value="${esc(o.acessorios || '')}"></label></div>
      <label>Defeito relatado<textarea name="defeito" rows="2">${esc(o.defeito)}</textarea></label>
      <label>Estado na entrada<input name="estado" value="${esc(o.estado_entrada || '')}"></label>
      ${checklistHtml(o.checklist || {})}
      <div class="form-grade">
        <label>Técnico<select name="tecnico"><option value="">Não definido</option>${tecs.map((t) => `<option value="${t.user_id}" ${t.user_id === o.tecnico_id ? 'selected' : ''}>${esc(t.nome)}</option>`).join('')}</select></label>
        <label>Previsão<input type="date" name="previsao" value="${o.previsao || ''}"></label>
        <label>Prioridade<select name="prioridade"><option value="normal">Normal</option><option value="urgente" ${o.prioridade === 'urgente' ? 'selected' : ''}>Urgente</option></select></label></div>
      <label>Observação interna<input name="obs" value="${esc(o.observacao || '')}"></label>
      <details><summary class="pequeno">Trocar a senha do aparelho</summary>${senhaHtml()}</details>`,
    aoAbrir: (f) => { f.lerSenha = ligarSenha(f); },
    aoSalvar: async (f) => {
      const p = { id: o.id, aparelho: f.aparelho.value, imei: f.imei.value, cor: f.cor.value, acessorios: f.acessorios.value, defeito: f.defeito.value,
        estado_entrada: f.estado.value, checklist: lerChecklist(f), tecnico_id: f.tecnico.value || null, previsao: f.previsao.value || null, prioridade: f.prioridade.value, observacao: f.obs.value };
      const tipo = f.querySelector('input[name=stipo]:checked')?.value;
      if (tipo) { const s = f.lerSenha(); if (!s.senha) { f.erro('Digite a senha ou desenhe o padrão.'); return false; } Object.assign(p, s); }
      await rpc('editar_os', { p });
      toast('OS atualizada');
      return true;
    },
  });
}

// ---------------------------------------------------------------------
// Orçamento: diagnóstico + peças do estoque + serviços
// ---------------------------------------------------------------------
async function editarOrcamento(o, itensAtuais) {
  const itens = itensAtuais.map((i) => ({ id: i.id, tipo: i.tipo, produto_id: i.produto_id, descricao: i.descricao, quantidade: Number(i.quantidade), preco: i.preco_unitario_centavos, aplicado: i.aplicado, estoque: i.estoque_atual }));
  const semAprov = o.interna || o.retorno_garantia;
  return abrirModal({
    titulo: `Orçamento — OS nº ${o.numero}`, largura: 'lg', botao: semAprov ? 'Salvar' : 'Salvar orçamento',
    corpo: `<label>Diagnóstico (o que o técnico encontrou)<textarea name="diag" rows="2" placeholder="Ex.: display trincado e flex do touch rompido">${esc(o.diagnostico || '')}</textarea></label>
      <div class="pdv-busca" style="margin:8px 0">${icone('busca')}<input data-busca type="search" placeholder="Buscar peça ou serviço cadastrado (nome ou SKU)…" autocomplete="off">
        <div class="pdv-sugestoes" data-sug hidden></div></div>
      <button type="button" class="link-btn" data-avulso>+ Serviço / mão de obra avulso</button>
      <div class="tabela-wrap" style="margin-top:8px"><table class="tabela"><thead><tr><th>Item</th><th class="num">Qtd</th><th class="num">Valor un.</th><th></th></tr></thead><tbody data-itens></tbody></table></div>
      <div class="form-grade" style="margin-top:10px">
        <label>Desconto<input name="desc" data-mascara="dinheiro" inputmode="numeric" value="${o.desconto_centavos ? fmtMoeda(o.desconto_centavos) : ''}"></label>
        ${semAprov ? '' : `<label>Taxa de diagnóstico se recusar<input name="taxa" data-mascara="dinheiro" inputmode="numeric" value="${o.taxa_diagnostico_centavos ? fmtMoeda(o.taxa_diagnostico_centavos) : ''}"></label>`}
        <label>Garantia (dias)<input name="gar" type="number" min="0" max="3650" value="${o.garantia_dias ?? estado.empresa?.garantia_os_dias ?? 90}"></label>
        <label>Total<input data-total disabled></label></div>
      ${semAprov ? `<p class="muted pequeno">${o.interna ? 'OS interna' : 'Retorno em garantia'}: não precisa de aprovação do cliente.</p>`
        : `<label class="check"><input type="checkbox" name="enviar" ${['aberta', 'diagnostico'].includes(o.status) ? 'checked' : ''}> Enviar para aprovação do cliente agora</label>
          <p class="muted pequeno">Se o valor subir depois de aprovado, a OS volta para “aguardando aprovação”.</p>`}`,
    aoAbrir: (f) => {
      const corpo = $('[data-itens]', f);
      const total = () => { const s = itens.reduce((a, i) => a + Math.round(i.quantidade * i.preco), 0); $('[data-total]', f).value = fmtMoeda(Math.max(0, s - valorDinheiro(f.desc))); };
      const desenhar = () => {
        corpo.innerHTML = itens.length ? itens.map((i, k) => `<tr><td>${esc(i.descricao)}<div class="muted pequeno">${i.tipo === 'peca' ? `peça do estoque${i.estoque != null ? ` · tem ${fmtNum(i.estoque)}` : ''}` : 'serviço'}${i.aplicado ? ' · já baixada' : ''}</div></td>
          <td class="num">${i.aplicado ? fmtNum(i.quantidade) : `<input class="qtd" data-k="${k}" data-c="q" inputmode="decimal" value="${fmtNum(i.quantidade)}" style="width:60px;margin:0">`}</td>
          <td class="num">${i.aplicado ? fmtMoeda(i.preco) : `<input data-k="${k}" data-c="p" data-mascara="dinheiro" inputmode="numeric" value="${fmtMoeda(i.preco)}" style="width:110px;margin:0">`}</td>
          <td class="num">${i.aplicado ? '' : `<button type="button" class="link-btn perigo" data-rem="${k}">✕</button>`}</td></tr>`).join('')
          : '<tr><td colspan="4" class="muted">Busque a peça ou adicione o serviço.</td></tr>';
        $$('input[data-k]', corpo).forEach((inp) => inp.addEventListener('change', () => {
          const i = itens[Number(inp.dataset.k)];
          if (inp.dataset.c === 'q') i.quantidade = Math.max(0.001, lerNumero(inp.value) || 1); else i.preco = valorDinheiro(inp);
          total();
        }));
        $$('[data-rem]', corpo).forEach((b) => b.addEventListener('click', () => { itens.splice(Number(b.dataset.rem), 1); desenhar(); }));
        total();
      };
      f.desc.addEventListener('input', total);
      const busca = $('[data-busca]', f); const sug = $('[data-sug]', f); let tm; let res = [];
      busca.addEventListener('input', () => {
        clearTimeout(tm);
        tm = setTimeout(async () => {
          const t = busca.value.trim().replace(/[,()"%]/g, ' ');
          if (t.length < 2) { sug.hidden = true; return; }
          res = await consulta(estado.sb.from('produtos').select('id,nome,sku,preco_venda_centavos,controla_estoque,estoque_atual').eq('ativo', true).eq('controla_serie', false)
            .or(`nome.ilike."%${t}%",sku.ilike."%${t}%"`).order('nome').limit(10)).catch(() => []);
          sug.innerHTML = res.length ? res.map((x, k) => `<button type="button" data-i="${k}"><span><b>${esc(x.nome)}</b><small>${esc(x.sku)} · ${x.controla_estoque ? `peça · estoque ${fmtNum(x.estoque_atual)}` : 'serviço'}</small></span><b>${fmtMoeda(x.preco_venda_centavos)}</b></button>`).join('')
            : '<p class="muted pequeno" style="padding:10px">Nada encontrado. Cadastre a peça em Estoque, ou use serviço avulso.</p>';
          sug.hidden = false;
        }, 200);
      });
      sug.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-i]'); if (!b) return;
        const x = res[Number(b.dataset.i)];
        itens.push({ tipo: x.controla_estoque ? 'peca' : 'servico', produto_id: x.id, descricao: x.nome, quantidade: 1, preco: x.preco_venda_centavos, estoque: x.controla_estoque ? Number(x.estoque_atual) : null });
        if (x.controla_estoque && Number(x.estoque_atual) <= 0) toast(`Atenção: ${x.nome} está sem estoque.`, 'erro');
        sug.hidden = true; busca.value = ''; desenhar();
      });
      $('[data-avulso]', f).addEventListener('click', async () => {
        const r = await abrirModal({ titulo: 'Serviço avulso', largura: 'sm', botao: 'Adicionar',
          corpo: '<label>Descrição *<input name="d" placeholder="Ex.: Mão de obra troca de tela"></label><label>Valor *<input name="v" data-mascara="dinheiro" inputmode="numeric"></label>',
          aoSalvar: (g) => { if (g.d.value.trim().length < 2) { g.erro('Descreva.'); return false; } return { tipo: 'servico', descricao: g.d.value.trim(), quantidade: 1, preco: valorDinheiro(g.v) }; } });
        if (r) { itens.push(r); desenhar(); }
      });
      desenhar();
    },
    aoSalvar: async (f) => {
      if (!itens.length) { f.erro('Inclua pelo menos um item no orçamento.'); return false; }
      const r = await rpc('salvar_orcamento_os', { p: {
        id: o.id, diagnostico: f.diag.value, desconto_centavos: valorDinheiro(f.desc), taxa_diagnostico_centavos: f.taxa ? valorDinheiro(f.taxa) : 0,
        garantia_dias: f.gar.value === '' ? null : Number(f.gar.value), enviar: !!f.enviar?.checked,
        itens: itens.map((i) => ({ id: i.id || null, tipo: i.tipo, produto_id: i.produto_id || null, descricao: i.descricao, quantidade: i.quantidade, preco_unitario_centavos: i.preco })),
      } });
      toast(r.status === 'aguardando_aprovacao' ? 'Orçamento salvo: aguardando o cliente' : 'Orçamento salvo');
      return true;
    },
  });
}

// ---------------------------------------------------------------------
// Entrega com pagamento
// ---------------------------------------------------------------------
async function entregar(o) {
  const formas = (await listaCache('formas')).filter((f) => f.ativo && !f.interna);
  const reparou = o.status === 'pronta';
  let total = reparou ? o.total_centavos : o.taxa_diagnostico_centavos;
  const pags = total ? [{ forma: formas.find((f) => f.forma === 'pix') ? 'pix' : formas[0]?.forma, valor: total, parcelas: 1 }] : [];
  return abrirModal({
    titulo: reparou ? `Entregar OS nº ${o.numero}` : `Devolver sem reparo — OS nº ${o.numero}`, largura: 'md', botao: 'Confirmar entrega', botaoClasse: 'btn-ok',
    corpo: `<p>${esc(o.aparelho)} · <b>${esc(o.cliente_nome)}</b></p>
      ${reparou ? `<div class="form-grade"><label>Desconto na entrega<input name="desc" data-mascara="dinheiro" inputmode="numeric" value="${o.desconto_centavos ? fmtMoeda(o.desconto_centavos) : ''}"></label>
        <label>A cobrar<input data-total disabled></label></div>` : `<p>Taxa de diagnóstico: <b>${fmtMoeda(total)}</b>${total ? '' : ' (sem cobrança)'}</p>`}
      <div data-pags></div>
      <button type="button" class="link-btn" data-mais>+ outra forma</button>
      <p class="pequeno" data-falta></p>
      ${reparou ? `<p class="muted pequeno">A garantia de ${o.garantia_dias ?? 0} dias começa hoje. A senha do aparelho é apagada.</p>` : ''}`,
    aoAbrir: (f) => {
      const subtotal = reparou ? o.total_centavos + o.desconto_centavos : total;
      const box = $('[data-pags]', f);
      const aCobrar = () => (reparou ? Math.max(0, subtotal - valorDinheiro(f.desc)) : total);
      const conferir = () => {
        if (reparou) $('[data-total]', f).value = fmtMoeda(aCobrar());
        const falta = aCobrar() - pags.reduce((s, p) => s + (p.valor || 0), 0);
        $('[data-falta]', f).innerHTML = falta === 0 ? '<span class="pos">Pagamento confere.</span>' : `<span class="neg">${falta > 0 ? 'Falta' : 'Passou'} ${fmtMoeda(Math.abs(falta))}</span>`;
      };
      const desenhar = () => {
        box.innerHTML = pags.map((p, k) => `<div class="pag-linha">
          <select data-pk="${k}" data-c="forma">${formas.map((x) => `<option value="${x.forma}" ${x.forma === p.forma ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select>
          <input data-pk="${k}" data-c="valor" data-mascara="dinheiro" inputmode="numeric" value="${fmtMoeda(p.valor)}">
          ${PARCELAVEL.includes(p.forma) ? `<select data-pk="${k}" data-c="parc">${Array.from({ length: 12 }, (_, n) => `<option value="${n + 1}" ${p.parcelas === n + 1 ? 'selected' : ''}>${n + 1}x</option>`).join('')}</select>` : '<span></span>'}
          <button type="button" class="link-btn perigo" data-rem="${k}">✕</button></div>`).join('');
        $$('[data-pk]', box).forEach((i) => i.addEventListener('change', () => {
          const p = pags[Number(i.dataset.pk)];
          if (i.dataset.c === 'forma') { p.forma = i.value; if (!PARCELAVEL.includes(p.forma)) p.parcelas = 1; desenhar(); }
          if (i.dataset.c === 'valor') p.valor = valorDinheiro(i);
          if (i.dataset.c === 'parc') p.parcelas = Number(i.value);
          conferir();
        }));
        $$('[data-rem]', box).forEach((b) => b.addEventListener('click', () => { pags.splice(Number(b.dataset.rem), 1); desenhar(); }));
        conferir();
      };
      $('[data-mais]', f).addEventListener('click', () => { const falta = Math.max(0, aCobrar() - pags.reduce((s, p) => s + p.valor, 0)); pags.push({ forma: 'dinheiro', valor: falta, parcelas: 1 }); desenhar(); });
      f.desc?.addEventListener('change', () => { if (pags.length === 1) pags[0].valor = aCobrar(); desenhar(); });
      desenhar();
    },
    aoSalvar: async (f) => {
      const ps = pags.filter((p) => p.valor > 0);
      await rpc('entregar_os', { p: { id: o.id, ...(reparou ? { desconto_centavos: valorDinheiro(f.desc) } : {}),
        pagamentos: ps.map((p) => ({ forma: p.forma, valor_centavos: p.valor, parcelas: p.parcelas || 1, primeiro_vencimento: ['crediario', 'boleto'].includes(p.forma) ? somarDias(hojeSP(), 30) : null })) } });
      toast('OS entregue');
      return true;
    },
  });
}
