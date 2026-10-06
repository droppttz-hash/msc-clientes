// MSC Clientes — cadastro de clientes e compras (Supabase)
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const PAGINA = 50;
const FORMAS = { pix: 'PIX', dinheiro: 'Dinheiro', debito: 'Débito', credito: 'Crédito', boleto: 'Boleto', outro: 'Outro' };
const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

let sb = null;
let logado = false;

// ===================================================================
// Utilidades
// ===================================================================
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const conteudo = $('#conteudo');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const fmtMoeda = (centavos) => (Number(centavos || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

function fmtTelefone(t) {
  const d = soDigitos(t);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}
const fmtCep = (c) => { const d = soDigitos(c); return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : d; };
const linkZap = (tel, msg = '') => `https://wa.me/55${soDigitos(tel)}${msg ? `?text=${encodeURIComponent(msg)}` : ''}`;

function idade(nasc, ref = hojeSP()) {
  if (!nasc) return null;
  const [a, m, d] = nasc.split('-').map(Number);
  const [ra, rm, rd] = ref.split('-').map(Number);
  return ra - a - ((rm < m || (rm === m && rd < d)) ? 1 : 0);
}

function addMeses(iso, n) {
  const [a, m] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1 + n, 1));
  return dt.toISOString().slice(0, 10);
}
function ultimoDiaMes(iso) {
  const [a, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

let toastTimer;
function toast(msg, tipo = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast ${tipo === 'erro' ? 'erro-t' : ''}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

function msgErro(error) {
  const m = `${error?.message || error || ''} ${error?.details || ''}`;
  if (/JWT|session|refresh token/i.test(m)) return 'Sua sessão expirou. Entre de novo.';
  if (/telefone_check/.test(m)) return 'Telefone inválido: use DDD + número (10 ou 11 dígitos).';
  if (/email_check/.test(m)) return 'E-mail inválido.';
  if (/cep_check/.test(m)) return 'CEP inválido: precisa ter 8 dígitos.';
  if (/data_nascimento_check/.test(m)) return 'Data de nascimento inválida.';
  if (/valor_centavos_check/.test(m)) return 'O valor precisa ser maior que zero.';
  if (/parcelas/.test(m)) return 'Parcelas só podem ser usadas no cartão de crédito (1 a 24).';
  if (/cancelamento_consistente/.test(m)) return 'Informe o motivo do cancelamento.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Sem conexão com o servidor. Verifique a internet.';
  return error?.message || 'Algo deu errado. Tente de novo.';
}

function mostrarErro(el, msg) { el.textContent = msg; el.hidden = !msg; }

// Busca todas as linhas de uma consulta, de 1000 em 1000 (limite do Supabase).
async function buscarTudo(montarConsulta) {
  const todas = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await montarConsulta().range(de, de + 999);
    if (error) throw error;
    todas.push(...data);
    if (data.length < 1000) return todas;
  }
}

// ===================================================================
// Máscaras de campo
// ===================================================================
function aplicarMascara(input) {
  const tipo = input.dataset.mascara;
  const d = soDigitos(input.value);
  if (tipo === 'telefone') {
    const x = d.slice(0, 11);
    if (x.length <= 2) input.value = x ? `(${x}` : '';
    else if (x.length <= 6) input.value = `(${x.slice(0, 2)}) ${x.slice(2)}`;
    else if (x.length <= 10) input.value = `(${x.slice(0, 2)}) ${x.slice(2, 6)}-${x.slice(6)}`;
    else input.value = `(${x.slice(0, 2)}) ${x.slice(2, 7)}-${x.slice(7)}`;
  } else if (tipo === 'cep') {
    const x = d.slice(0, 8);
    input.value = x.length > 5 ? `${x.slice(0, 5)}-${x.slice(5)}` : x;
  } else if (tipo === 'dinheiro') {
    const x = d.replace(/^0+/, '').slice(0, 11);
    input.value = x ? fmtMoeda(Number(x)) : '';
  }
}
document.addEventListener('input', (e) => {
  if (e.target.matches('[data-mascara]')) aplicarMascara(e.target);
});

// ===================================================================
// Login
// ===================================================================
function mostrarTela(session) {
  const estava = logado;
  logado = !!session;
  $('#tela-login').hidden = logado;
  $('#app').hidden = !logado;
  if (logado && !estava) {
    if (!location.hash || location.hash === '#') location.hash = '#/clientes';
    else render();
  }
}

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const btn = $('button[type=submit]', f);
  btn.disabled = true;
  mostrarErro($('#login-erro'), '');
  const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.senha.value });
  btn.disabled = false;
  if (error) mostrarErro($('#login-erro'), /invalid/i.test(error.message) ? 'E-mail ou senha incorretos.' : msgErro(error));
  else f.senha.value = '';
});

$('#btn-sair').addEventListener('click', async () => {
  await sb.auth.signOut();
  mostrarTela(null);
});

// ===================================================================
// Rotas
// ===================================================================
window.addEventListener('hashchange', () => logado && render());

function render() {
  const h = location.hash || '#/clientes';
  const aba = h.startsWith('#/compras') ? 'compras' : h.startsWith('#/aniversariantes') ? 'aniversariantes' : 'clientes';
  $$('.abas a').forEach((a) => a.classList.toggle('ativa', a.dataset.aba === aba));
  window.scrollTo(0, 0);
  const m = h.match(/^#\/cliente\/([0-9a-f-]{36})$/i);
  if (m) return telaCliente(m[1]);
  if (aba === 'compras') return telaCompras();
  if (aba === 'aniversariantes') return telaAniversariantes();
  return telaClientes();
}

// ===================================================================
// Tela: lista de clientes
// ===================================================================
const estadoLista = { termo: '', inativos: false, carregados: 0 };

function telaClientes() {
  conteudo.innerHTML = `
    <div class="barra">
      <h1>Clientes</h1>
      <div class="acoes">
        <button class="btn btn-ghost" id="btn-exportar" type="button">Exportar planilha</button>
        <button class="btn btn-primary" id="btn-novo-cliente" type="button">+ Novo cliente</button>
      </div>
    </div>
    <div class="barra">
      <input class="busca" id="busca" type="search" placeholder="Buscar por nome, telefone ou e-mail…" value="${esc(estadoLista.termo)}">
      <label class="check"><input type="checkbox" id="chk-inativos" ${estadoLista.inativos ? 'checked' : ''}> Mostrar só inativos</label>
    </div>
    <div class="card">
      <div class="tabela-wrap"><table class="tabela">
        <thead><tr>
          <th>Nome</th><th>Telefone</th><th class="esconder-cel">Cidade</th>
          <th class="num">Compras</th><th class="num">Total gasto</th><th class="num esconder-cel">Última compra</th>
        </tr></thead>
        <tbody id="lista-clientes"></tbody>
      </table></div>
      <div id="lista-rodape"></div>
    </div>`;

  let t;
  $('#busca').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => { estadoLista.termo = e.target.value; carregarClientes(true); }, 300);
  });
  $('#chk-inativos').addEventListener('change', (e) => { estadoLista.inativos = e.target.checked; carregarClientes(true); });
  $('#btn-novo-cliente').addEventListener('click', () => abrirCliente(null));
  $('#btn-exportar').addEventListener('click', exportarClientes);
  carregarClientes(true);
}

function filtroBusca(termo) {
  const t = termo.replace(/[,()"*%\\]/g, ' ').trim();
  if (!t) return null;
  const partes = [`nome.ilike."%${t}%"`, `email.ilike."%${t}%"`];
  const d = soDigitos(t);
  if (d.length >= 3) partes.push(`telefone.ilike."%${d}%"`);
  return partes.join(',');
}

async function carregarClientes(reiniciar) {
  const corpo = $('#lista-clientes');
  const rodape = $('#lista-rodape');
  if (!corpo) return;
  if (reiniciar) { estadoLista.carregados = 0; corpo.innerHTML = ''; rodape.innerHTML = '<div class="vazio">Carregando…</div>'; }

  const termoAtual = estadoLista.termo;
  let q = sb.from('clientes_resumo').select('*', { count: 'exact' })
    .eq('ativo', !estadoLista.inativos)
    .order('nome', { ascending: true })
    .range(estadoLista.carregados, estadoLista.carregados + PAGINA - 1);
  const f = filtroBusca(termoAtual);
  if (f) q = q.or(f);

  const { data, error, count } = await q;
  if (termoAtual !== estadoLista.termo || !$('#lista-clientes')) return; // usuário digitou de novo
  if (error) { rodape.innerHTML = `<div class="vazio">${esc(msgErro(error))}</div>`; return; }

  corpo.insertAdjacentHTML('beforeend', data.map((c) => `
    <tr class="clicavel" data-id="${c.id}">
      <td><b>${esc(c.nome)}</b>${c.ativo ? '' : ' <span class="tag cinza">inativo</span>'}</td>
      <td>${c.telefone ? `<a class="zap" href="${linkZap(c.telefone)}" target="_blank" rel="noopener">${fmtTelefone(c.telefone)}</a>` : '<span class="muted">—</span>'}</td>
      <td class="esconder-cel">${esc(c.cidade || '—')}</td>
      <td class="num">${c.qtd_compras}</td>
      <td class="num">${fmtMoeda(c.total_centavos)}</td>
      <td class="num esconder-cel">${fmtData(c.ultima_compra)}</td>
    </tr>`).join(''));
  estadoLista.carregados += data.length;

  if (count === 0) {
    rodape.innerHTML = termoAtual
      ? `<div class="vazio"><b>Nenhum cliente encontrado</b>Tente outro nome ou telefone.</div>`
      : estadoLista.inativos
        ? `<div class="vazio"><b>Nenhum cliente inativo</b></div>`
        : `<div class="vazio"><b>Nenhum cliente cadastrado ainda</b>Clique em “+ Novo cliente” para começar.</div>`;
  } else if (estadoLista.carregados < count) {
    rodape.innerHTML = `<div class="mais"><button class="btn btn-ghost" id="btn-mais" type="button">Carregar mais (${estadoLista.carregados} de ${count})</button></div>`;
    $('#btn-mais').addEventListener('click', () => carregarClientes(false));
  } else {
    rodape.innerHTML = `<p class="muted pequeno" style="padding:10px 14px">${count} cliente${count === 1 ? '' : 's'}</p>`;
  }
}

$('#conteudo').addEventListener('click', (e) => {
  if (e.target.closest('a, button')) return;
  const tr = e.target.closest('tr.clicavel[data-id]');
  if (tr) location.hash = `#/cliente/${tr.dataset.id}`;
});

async function exportarClientes() {
  try {
    const linhas = await buscarTudo(() => sb.from('clientes_resumo').select('*').order('nome'));
    const cab = ['Nome', 'Telefone', 'E-mail', 'Nascimento', 'CEP', 'Rua', 'Número', 'Complemento', 'Bairro', 'Cidade', 'UF', 'Compras', 'Total gasto', 'Última compra', 'Situação', 'Observações'];
    const csvCel = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const corpo = linhas.map((c) => [
      c.nome, fmtTelefone(c.telefone), c.email, c.data_nascimento ? fmtData(c.data_nascimento) : '', fmtCep(c.cep),
      c.logradouro, c.numero, c.complemento, c.bairro, c.cidade, c.uf, c.qtd_compras,
      (Number(c.total_centavos) / 100).toFixed(2).replace('.', ','), c.ultima_compra ? fmtData(c.ultima_compra) : '',
      c.ativo ? 'Ativo' : 'Inativo', c.observacoes,
    ].map(csvCel).join(';'));
    const csv = '﻿' + [cab.map(csvCel).join(';'), ...corpo].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `clientes-msc-${hojeSP()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`${linhas.length} clientes exportados`);
  } catch (err) { toast(msgErro(err), 'erro'); }
}

// ===================================================================
// Tela: detalhe do cliente + compras
// ===================================================================
let clienteAtual = null;

async function telaCliente(id) {
  conteudo.innerHTML = '<div class="vazio">Carregando…</div>';
  const [{ data: cli, error: e1 }, { data: compras, error: e2 }] = await Promise.all([
    sb.from('clientes_resumo').select('*').eq('id', id).maybeSingle(),
    sb.from('compras').select('*').eq('cliente_id', id).order('data', { ascending: false }).order('numero', { ascending: false }),
  ]);
  if (e1 || e2) { conteudo.innerHTML = `<div class="vazio">${esc(msgErro(e1 || e2))}</div>`; return; }
  if (!cli) { conteudo.innerHTML = '<div class="vazio"><b>Cliente não encontrado</b><a href="#/clientes">Voltar para a lista</a></div>'; return; }
  clienteAtual = cli;

  const ticket = cli.qtd_compras ? Math.round(cli.total_centavos / cli.qtd_compras) : 0;
  const endereco = [
    [cli.logradouro, cli.numero].filter(Boolean).join(', '),
    cli.complemento, cli.bairro,
    [cli.cidade, cli.uf].filter(Boolean).join(' / '),
    cli.cep ? `CEP ${fmtCep(cli.cep)}` : '',
  ].filter(Boolean).map(esc).join('<br>');
  const anos = idade(cli.data_nascimento);

  conteudo.innerHTML = `
    <a class="voltar" href="#/clientes">← Clientes</a>
    <div class="detalhe">
      <div class="card card-pad dados">
        <h2>${esc(cli.nome)}</h2>
        <p class="muted pequeno" style="margin-bottom:14px">Cliente desde ${fmtData(cli.criado_em)} ${cli.ativo ? '' : '· <span class="tag cinza">inativo</span>'}</p>
        <dl>
          <div><dt>Telefone</dt><dd>${cli.telefone ? `<a class="zap" href="${linkZap(cli.telefone)}" target="_blank" rel="noopener">${fmtTelefone(cli.telefone)} · WhatsApp</a>` : '—'}</dd></div>
          <div><dt>E-mail</dt><dd>${cli.email ? `<a href="mailto:${esc(cli.email)}">${esc(cli.email)}</a>` : '—'}</dd></div>
          <div><dt>Nascimento</dt><dd>${cli.data_nascimento ? `${fmtData(cli.data_nascimento)} (${anos} anos)` : '—'}</dd></div>
          <div><dt>Endereço</dt><dd>${endereco || '—'}</dd></div>
          ${cli.observacoes ? `<div><dt>Observações</dt><dd>${esc(cli.observacoes)}</dd></div>` : ''}
        </dl>
        <div class="acoes-cli">
          <button class="btn btn-ghost btn-sm" id="btn-editar-cli" type="button">Editar dados</button>
          <button class="btn btn-ghost btn-sm" id="btn-ativo-cli" type="button">${cli.ativo ? 'Inativar cliente' : 'Reativar cliente'}</button>
        </div>
      </div>

      <div>
        <div class="kpis">
          <div class="card kpi"><div class="rot">Total gasto</div><div class="val">${fmtMoeda(cli.total_centavos)}</div></div>
          <div class="card kpi"><div class="rot">Compras</div><div class="val">${cli.qtd_compras}</div></div>
          <div class="card kpi"><div class="rot">Ticket médio</div><div class="val">${fmtMoeda(ticket)}</div></div>
        </div>
        <div class="card">
          <div class="secao-topo">
            <h3>Histórico de compras</h3>
            <button class="btn btn-primary btn-sm" id="btn-nova-compra" type="button" ${cli.ativo ? '' : 'disabled title="Reative o cliente para lançar compras"'}>+ Nova compra</button>
          </div>
          ${compras.length ? `
          <div class="tabela-wrap"><table class="tabela">
            <thead><tr><th>Data</th><th>Descrição</th><th class="esconder-cel">Pagamento</th><th class="num">Valor</th><th></th></tr></thead>
            <tbody>${compras.map(linhaCompra).join('')}</tbody>
          </table></div>` : '<div class="vazio"><b>Nenhuma compra ainda</b>Clique em “+ Nova compra” para lançar.</div>'}
        </div>
      </div>
    </div>`;

  $('#btn-editar-cli').addEventListener('click', () => abrirCliente(cli));
  $('#btn-nova-compra').addEventListener('click', () => abrirCompra(cli, null));
  $('#btn-ativo-cli').addEventListener('click', () => alternarAtivo(cli));
  $$('[data-editar-compra]').forEach((b) => b.addEventListener('click', () => abrirCompra(cli, compras.find((c) => c.id === b.dataset.editarCompra))));
  $$('[data-cancelar-compra]').forEach((b) => b.addEventListener('click', () => abrirCancelar(compras.find((c) => c.id === b.dataset.cancelarCompra))));
}

function linhaCompra(c) {
  const cancelada = c.status === 'cancelada';
  const pag = FORMAS[c.forma_pagamento] + (c.forma_pagamento === 'credito' && c.parcelas > 1 ? ` ${c.parcelas}x` : '');
  return `
    <tr class="${cancelada ? 'cancelada' : ''}">
      <td>${fmtData(c.data)}<div class="muted pequeno">nº ${c.numero}</div></td>
      <td><span class="desc">${esc(c.descricao)}</span>
        ${c.observacao ? `<div class="muted pequeno">${esc(c.observacao)}</div>` : ''}
        ${cancelada ? `<div class="pequeno"><span class="tag cancelada">cancelada</span> ${esc(c.motivo_cancelamento)}</div>` : ''}</td>
      <td class="esconder-cel"><span class="tag">${pag}</span></td>
      <td class="num">${fmtMoeda(c.valor_centavos)}</td>
      <td class="num">${cancelada ? '' : `<div class="acoes-linha">
        <button class="link-btn" type="button" data-editar-compra="${c.id}">Editar</button>
        <button class="link-btn perigo" type="button" data-cancelar-compra="${c.id}">Cancelar</button></div>`}</td>
    </tr>`;
}

async function alternarAtivo(cli) {
  const { error } = await sb.from('clientes').update({ ativo: !cli.ativo }).eq('id', cli.id);
  if (error) return toast(msgErro(error), 'erro');
  toast(cli.ativo ? 'Cliente inativado (o histórico continua guardado)' : 'Cliente reativado');
  render();
}

// ===================================================================
// Modal: cliente (novo / editar)
// ===================================================================
const dlgCliente = $('#dlg-cliente');
const formCliente = $('#form-cliente');
let clienteEditando = null;
let avisoDuplicado = null;

function abrirCliente(cli) {
  clienteEditando = cli;
  avisoDuplicado = null;
  formCliente.reset();
  mostrarErro($('#cliente-erro'), '');
  $('#cep-status').textContent = '';
  $('#dlg-cliente-titulo').textContent = cli ? 'Editar cliente' : 'Novo cliente';
  if (cli) {
    for (const campo of ['nome', 'email', 'data_nascimento', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'observacoes']) {
      formCliente[campo].value = cli[campo] ?? '';
    }
    formCliente.telefone.value = fmtTelefone(cli.telefone);
    formCliente.cep.value = fmtCep(cli.cep);
  }
  formCliente.data_nascimento.max = hojeSP();
  dlgCliente.showModal();
  formCliente.nome.focus();
}

// CEP -> endereço automático (ViaCEP)
formCliente.cep.addEventListener('input', async (e) => {
  const cep = soDigitos(e.target.value);
  const st = $('#cep-status');
  if (cep.length !== 8) { st.textContent = ''; return; }
  st.textContent = 'buscando…';
  try {
    const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const j = await r.json();
    if (soDigitos(formCliente.cep.value) !== cep) return;
    if (j.erro) { st.textContent = 'CEP não encontrado'; return; }
    formCliente.logradouro.value = j.logradouro || '';
    formCliente.bairro.value = j.bairro || '';
    formCliente.cidade.value = j.localidade || '';
    formCliente.uf.value = j.uf || '';
    st.textContent = '✓';
    formCliente.numero.focus();
  } catch { st.textContent = 'não deu para buscar, preencha à mão'; }
});

function lerCliente() {
  const f = formCliente;
  const vazio = (v) => (v.trim() === '' ? null : v.trim());
  return {
    nome: f.nome.value.trim().replace(/\s+/g, ' '),
    telefone: vazio(soDigitos(f.telefone.value)),
    email: vazio(f.email.value.toLowerCase()),
    data_nascimento: vazio(f.data_nascimento.value),
    cep: vazio(soDigitos(f.cep.value)),
    logradouro: vazio(f.logradouro.value),
    numero: vazio(f.numero.value),
    complemento: vazio(f.complemento.value),
    bairro: vazio(f.bairro.value),
    cidade: vazio(f.cidade.value),
    uf: vazio(f.uf.value.toUpperCase()),
    observacoes: vazio(f.observacoes.value),
  };
}

function validarCliente(c) {
  if (c.nome.length < 2) return 'Informe o nome do cliente.';
  if (c.telefone && !/^\d{10,11}$/.test(c.telefone)) return 'Telefone inválido: use DDD + número.';
  if (c.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)) return 'E-mail inválido.';
  if (c.cep && c.cep.length !== 8) return 'CEP precisa ter 8 dígitos.';
  if (c.uf && !/^[A-Z]{2}$/.test(c.uf)) return 'UF precisa ter 2 letras (ex.: RJ).';
  if (c.data_nascimento && c.data_nascimento > hojeSP()) return 'Data de nascimento no futuro.';
  return null;
}

formCliente.addEventListener('submit', async (e) => {
  e.preventDefault();
  const dados = lerCliente();
  const erroEl = $('#cliente-erro');
  const invalido = validarCliente(dados);
  if (invalido) return mostrarErro(erroEl, invalido);

  const btn = $('button[type=submit]', formCliente);
  btn.disabled = true;
  try {
    // Aviso de cliente repetido (mesmo telefone ou e-mail) — clica Salvar de novo para confirmar
    if (!clienteEditando && (dados.telefone || dados.email)) {
      const chave = `${dados.telefone}|${dados.email}`;
      if (avisoDuplicado !== chave) {
        const filtros = [];
        if (dados.telefone) filtros.push(`telefone.eq.${dados.telefone}`);
        if (dados.email) filtros.push(`email.eq."${dados.email.replace(/"/g, '')}"`);
        const { data: dup } = await sb.from('clientes').select('id,nome').or(filtros.join(',')).limit(1);
        if (dup?.length) {
          avisoDuplicado = chave;
          return mostrarErro(erroEl, `Já existe “${dup[0].nome}” com esse telefone/e-mail. Se for outra pessoa, clique em Salvar de novo.`);
        }
      }
    }

    const consulta = clienteEditando
      ? sb.from('clientes').update(dados).eq('id', clienteEditando.id).select('id').single()
      : sb.from('clientes').insert(dados).select('id').single();
    const { data, error } = await consulta;
    if (error) return mostrarErro(erroEl, msgErro(error));

    dlgCliente.close();
    toast(clienteEditando ? 'Dados atualizados' : 'Cliente cadastrado');
    const destino = `#/cliente/${data.id}`;
    if (location.hash === destino) render(); else location.hash = destino;
  } finally { btn.disabled = false; }
});

// ===================================================================
// Modal: compra (nova / editar)
// ===================================================================
const dlgCompra = $('#dlg-compra');
const formCompra = $('#form-compra');
let compraCtx = { cliente: null, compra: null };

formCompra.parcelas.innerHTML = Array.from({ length: 24 }, (_, i) => `<option value="${i + 1}">${i + 1}x</option>`).join('');
formCompra.forma_pagamento.addEventListener('change', () => {
  $('#campo-parcelas').hidden = formCompra.forma_pagamento.value !== 'credito';
});

function abrirCompra(cliente, compra) {
  compraCtx = { cliente, compra };
  formCompra.reset();
  mostrarErro($('#compra-erro'), '');
  $('#dlg-compra-titulo').textContent = compra ? `Editar compra nº ${compra.numero}` : 'Nova compra';
  $('#dlg-compra-cliente').textContent = `Cliente: ${cliente.nome}`;
  formCompra.data.value = compra?.data ?? hojeSP();
  formCompra.data.max = hojeSP();
  if (compra) {
    formCompra.descricao.value = compra.descricao;
    formCompra.valor.value = fmtMoeda(compra.valor_centavos);
    formCompra.forma_pagamento.value = compra.forma_pagamento;
    formCompra.parcelas.value = String(compra.parcelas);
    formCompra.observacao.value = compra.observacao ?? '';
  }
  $('#campo-parcelas').hidden = formCompra.forma_pagamento.value !== 'credito';
  dlgCompra.showModal();
  formCompra.descricao.focus();
}

formCompra.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = formCompra;
  const erroEl = $('#compra-erro');
  const valor = Number(soDigitos(f.valor.value) || 0);
  const forma = f.forma_pagamento.value;
  const dados = {
    descricao: f.descricao.value.trim().replace(/\s+/g, ' '),
    valor_centavos: valor,
    data: f.data.value,
    forma_pagamento: forma,
    parcelas: forma === 'credito' ? Number(f.parcelas.value) : 1,
    observacao: f.observacao.value.trim() || null,
  };
  if (dados.descricao.length < 2) return mostrarErro(erroEl, 'Descreva o que foi comprado.');
  if (valor <= 0) return mostrarErro(erroEl, 'Informe o valor da compra.');
  if (!dados.data) return mostrarErro(erroEl, 'Informe a data.');
  if (dados.data > hojeSP()) return mostrarErro(erroEl, 'A data não pode ser no futuro.');

  const btn = $('button[type=submit]', f);
  btn.disabled = true;
  const { error } = compraCtx.compra
    ? await sb.from('compras').update(dados).eq('id', compraCtx.compra.id)
    : await sb.from('compras').insert({ ...dados, cliente_id: compraCtx.cliente.id });
  btn.disabled = false;
  if (error) return mostrarErro(erroEl, msgErro(error));
  dlgCompra.close();
  toast(compraCtx.compra ? 'Compra atualizada' : `Compra de ${fmtMoeda(valor)} lançada`);
  render();
});

// ===================================================================
// Modal: cancelar compra
// ===================================================================
const dlgCancelar = $('#dlg-cancelar');
const formCancelar = $('#form-cancelar');
let compraCancelando = null;

function abrirCancelar(compra) {
  compraCancelando = compra;
  formCancelar.reset();
  mostrarErro($('#cancelar-erro'), '');
  $('#dlg-cancelar-info').textContent = `Compra nº ${compra.numero} · ${fmtData(compra.data)} · ${compra.descricao} · ${fmtMoeda(compra.valor_centavos)}`;
  dlgCancelar.showModal();
  formCancelar.motivo.focus();
}

formCancelar.addEventListener('submit', async (e) => {
  e.preventDefault();
  const motivo = formCancelar.motivo.value.trim();
  if (motivo.length < 3) return mostrarErro($('#cancelar-erro'), 'Escreva o motivo do cancelamento.');
  const { error } = await sb.from('compras')
    .update({ status: 'cancelada', motivo_cancelamento: motivo, cancelada_em: new Date().toISOString() })
    .eq('id', compraCancelando.id);
  if (error) return mostrarErro($('#cancelar-erro'), msgErro(error));
  dlgCancelar.close();
  toast('Compra cancelada');
  render();
});

// Fechar modais
$$('[data-fechar]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

// ===================================================================
// Tela: todas as compras (por período)
// ===================================================================
const estadoCompras = { de: null, ate: null, canceladas: false };

function telaCompras() {
  const hoje = hojeSP();
  if (!estadoCompras.de) { estadoCompras.de = hoje.slice(0, 8) + '01'; estadoCompras.ate = hoje; }
  conteudo.innerHTML = `
    <div class="barra">
      <h1>Compras</h1>
      <div class="acoes">
        <button class="btn btn-ghost btn-sm" data-periodo="hoje" type="button">Hoje</button>
        <button class="btn btn-ghost btn-sm" data-periodo="mes" type="button">Este mês</button>
        <button class="btn btn-ghost btn-sm" data-periodo="passado" type="button">Mês passado</button>
      </div>
    </div>
    <div class="barra">
      <div class="periodo">
        <label>De<input type="date" id="per-de" value="${estadoCompras.de}"></label>
        <label>Até<input type="date" id="per-ate" value="${estadoCompras.ate}"></label>
      </div>
      <label class="check"><input type="checkbox" id="chk-canceladas" ${estadoCompras.canceladas ? 'checked' : ''}> Mostrar canceladas</label>
    </div>
    <div id="compras-corpo"><div class="vazio">Carregando…</div></div>
    <p class="muted pequeno" style="margin-top:12px">Para lançar uma compra, abra o cliente na aba Clientes.</p>`;

  const atualizar = () => {
    estadoCompras.de = $('#per-de').value;
    estadoCompras.ate = $('#per-ate').value;
    carregarCompras();
  };
  $('#per-de').addEventListener('change', atualizar);
  $('#per-ate').addEventListener('change', atualizar);
  $('#chk-canceladas').addEventListener('change', (e) => { estadoCompras.canceladas = e.target.checked; carregarCompras(); });
  $$('[data-periodo]').forEach((b) => b.addEventListener('click', () => {
    const p = b.dataset.periodo;
    if (p === 'hoje') { estadoCompras.de = hoje; estadoCompras.ate = hoje; }
    if (p === 'mes') { estadoCompras.de = hoje.slice(0, 8) + '01'; estadoCompras.ate = hoje; }
    if (p === 'passado') { const ini = addMeses(hoje, -1); estadoCompras.de = ini; estadoCompras.ate = ultimoDiaMes(ini); }
    $('#per-de').value = estadoCompras.de;
    $('#per-ate').value = estadoCompras.ate;
    carregarCompras();
  }));
  carregarCompras();
}

async function carregarCompras() {
  const alvo = $('#compras-corpo');
  if (!alvo) return;
  const { de, ate } = estadoCompras;
  if (!de || !ate || de > ate) { alvo.innerHTML = '<div class="vazio">Escolha um período válido.</div>'; return; }
  alvo.innerHTML = '<div class="vazio">Carregando…</div>';
  let lista;
  try {
    lista = await buscarTudo(() => sb.from('compras').select('*, clientes(nome)')
      .gte('data', de).lte('data', ate)
      .order('data', { ascending: false }).order('numero', { ascending: false }));
  } catch (err) { alvo.innerHTML = `<div class="vazio">${esc(msgErro(err))}</div>`; return; }

  const ativas = lista.filter((c) => c.status === 'ativa');
  const total = ativas.reduce((s, c) => s + Number(c.valor_centavos), 0);
  const porForma = {};
  for (const c of ativas) porForma[c.forma_pagamento] = (porForma[c.forma_pagamento] || 0) + Number(c.valor_centavos);
  const mostrar = estadoCompras.canceladas ? lista : ativas;

  alvo.innerHTML = `
    <div class="kpis">
      <div class="card kpi"><div class="rot">Total vendido</div><div class="val">${fmtMoeda(total)}</div></div>
      <div class="card kpi"><div class="rot">Compras</div><div class="val">${ativas.length}</div></div>
      <div class="card kpi"><div class="rot">Ticket médio</div><div class="val">${fmtMoeda(ativas.length ? Math.round(total / ativas.length) : 0)}</div></div>
      <div class="card kpi"><div class="rot">Por pagamento</div>
        <div class="pequeno" style="margin-top:4px">${Object.entries(porForma).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${FORMAS[k]}: <b>${fmtMoeda(v)}</b>`).join('<br>') || '—'}</div></div>
    </div>
    <div class="card">
      ${mostrar.length ? `
      <div class="tabela-wrap"><table class="tabela">
        <thead><tr><th>Data</th><th>Cliente</th><th>Descrição</th><th class="esconder-cel">Pagamento</th><th class="num">Valor</th></tr></thead>
        <tbody>${mostrar.map((c) => `
          <tr class="${c.status === 'cancelada' ? 'cancelada' : ''}">
            <td>${fmtData(c.data)}<div class="muted pequeno">nº ${c.numero}</div></td>
            <td><a href="#/cliente/${c.cliente_id}">${esc(c.clientes?.nome ?? '—')}</a></td>
            <td><span class="desc">${esc(c.descricao)}</span>${c.status === 'cancelada' ? ` <span class="tag cancelada">cancelada</span>` : ''}</td>
            <td class="esconder-cel"><span class="tag">${FORMAS[c.forma_pagamento]}${c.forma_pagamento === 'credito' && c.parcelas > 1 ? ` ${c.parcelas}x` : ''}</span></td>
            <td class="num">${fmtMoeda(c.valor_centavos)}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : '<div class="vazio"><b>Nenhuma compra nesse período</b></div>'}
    </div>`;
}

// ===================================================================
// Tela: aniversariantes do mês
// ===================================================================
let mesAniv = null;

async function telaAniversariantes() {
  const hoje = hojeSP();
  if (!mesAniv) mesAniv = Number(hoje.slice(5, 7));
  conteudo.innerHTML = `
    <div class="barra">
      <h1>Aniversariantes</h1>
      <div class="acoes"><select id="sel-mes" style="margin:0;width:auto">
        ${MESES.map((m, i) => `<option value="${i + 1}" ${i + 1 === mesAniv ? 'selected' : ''}>${m}</option>`).join('')}
      </select></div>
    </div>
    <div class="card" id="aniv-corpo"><div class="vazio">Carregando…</div></div>`;
  $('#sel-mes').addEventListener('change', (e) => { mesAniv = Number(e.target.value); telaAniversariantes(); });

  const { data, error } = await sb.from('clientes_resumo').select('id,nome,telefone,data_nascimento,total_centavos')
    .eq('ativo', true).eq('mes_aniversario', mesAniv);
  const alvo = $('#aniv-corpo');
  if (!alvo) return;
  if (error) { alvo.innerHTML = `<div class="vazio">${esc(msgErro(error))}</div>`; return; }
  data.sort((a, b) => a.data_nascimento.slice(8) - b.data_nascimento.slice(8) || a.nome.localeCompare(b.nome));
  const anoRef = Number(hoje.slice(0, 4));
  const diaHoje = hoje.slice(5);

  alvo.innerHTML = data.length ? `
    <div class="tabela-wrap"><table class="tabela">
      <thead><tr><th>Dia</th><th>Cliente</th><th class="esconder-cel">Faz</th><th>WhatsApp</th></tr></thead>
      <tbody>${data.map((c) => {
        const primeiroNome = c.nome.split(' ')[0];
        const msg = `Feliz aniversário, ${primeiroNome}! A equipe da MSC Assistência Técnica deseja um novo ano cheio de conquistas. Passa aqui na loja, temos um mimo esperando por você!`;
        const ehHoje = c.data_nascimento.slice(5) === diaHoje;
        return `<tr class="clicavel" data-id="${c.id}">
          <td><b>${c.data_nascimento.slice(8)}/${c.data_nascimento.slice(5, 7)}</b> ${ehHoje ? '<span class="tag ok">hoje</span>' : ''}</td>
          <td>${esc(c.nome)}</td>
          <td class="esconder-cel">${anoRef - Number(c.data_nascimento.slice(0, 4))} anos</td>
          <td>${c.telefone ? `<a class="zap" href="${linkZap(c.telefone, msg)}" target="_blank" rel="noopener">Mandar parabéns</a>` : '<span class="muted">sem telefone</span>'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>` : `<div class="vazio"><b>Nenhum aniversariante em ${MESES[mesAniv - 1]}</b>Cadastre a data de nascimento dos clientes para aparecerem aqui.</div>`;
}

// ===================================================================
// Início
// ===================================================================
async function iniciar() {
  if (window.__SUPABASE_MOCK__) {
    sb = window.__SUPABASE_MOCK__;
  } else {
    if (!/^https?:\/\//.test(SUPABASE_URL) || SUPABASE_ANON_KEY.startsWith('COLE')) {
      $('#tela-config').hidden = false;
      return;
    }
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  sb.auth.onAuthStateChange((_evento, session) => mostrarTela(session));
  const { data } = await sb.auth.getSession();
  mostrarTela(data.session);
}

iniciar();
