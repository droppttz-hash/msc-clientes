// MSC Clientes — cadastro de clientes e compras (Supabase)
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const PAGINA = 50;
const FORMAS = { pix: 'PIX', dinheiro: 'Dinheiro', debito: 'Débito', credito: 'Crédito', boleto: 'Boleto', outro: 'Outro' };
const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

let sb = null;
let logado = false;

// Categorias (produto, despesa, outras entradas) — carregadas uma vez e recarregadas ao editar
let CATS = null;
async function categorias(recarregar = false) {
  if (CATS && !recarregar) return CATS;
  const { data, error } = await sb.from('categorias').select('*').order('ordem').order('nome');
  if (error) throw error;
  CATS = data;
  return CATS;
}
function opcoesCategoria(lista, tipo, atualId) {
  const itens = lista.filter((c) => c.tipo === tipo && (c.ativo || c.id === atualId));
  return '<option value="">Escolha…</option>' + itens.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('');
}

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
  if (/categorias_tipo_nome_uk|duplicate key/.test(m)) return 'Já existe uma categoria com esse nome.';
  if (/Categoria não combina/.test(m)) return 'Escolha uma categoria do tipo certo (despesa para saída, entrada para entrada).';
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
  const aba = ['compras', 'caixa', 'aniversariantes', 'config'].find((a) => h.startsWith(`#/${a}`)) || 'clientes';
  $$('.abas a').forEach((a) => a.classList.toggle('ativa', a.dataset.aba === aba));
  window.scrollTo(0, 0);
  const m = h.match(/^#\/cliente\/([0-9a-f-]{36})$/i);
  if (m) return telaCliente(m[1]);
  if (aba === 'compras') return telaCompras();
  if (aba === 'caixa') return telaCaixa();
  if (aba === 'config') return telaConfig();
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
    sb.from('compras').select('*, categorias(nome)').eq('cliente_id', id).order('data', { ascending: false }).order('numero', { ascending: false }),
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
  $$('[data-cancelar-compra]').forEach((b) => b.addEventListener('click', () => abrirCancelarCompra(compras.find((c) => c.id === b.dataset.cancelarCompra))));
}

const tagCategoria = (nome) => (nome ? `<span class="tag cinza">${esc(nome)}</span>` : '<span class="tag cinza">sem categoria</span>');

function linhaCompra(c) {
  const cancelada = c.status === 'cancelada';
  const pag = FORMAS[c.forma_pagamento] + (c.forma_pagamento === 'credito' && c.parcelas > 1 ? ` ${c.parcelas}x` : '');
  return `
    <tr class="${cancelada ? 'cancelada' : ''}">
      <td>${fmtData(c.data)}<div class="muted pequeno">nº ${c.numero}</div></td>
      <td><span class="desc">${esc(c.descricao)}</span> ${tagCategoria(c.categorias?.nome)}
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

// cliente = null → venda balcão (sem cliente cadastrado)
async function abrirCompra(cliente, compra) {
  compraCtx = { cliente, compra };
  formCompra.reset();
  mostrarErro($('#compra-erro'), '');
  try {
    formCompra.categoria_id.innerHTML = opcoesCategoria(await categorias(), 'venda', compra?.categoria_id);
  } catch (err) { return toast(msgErro(err), 'erro'); }
  $('#dlg-compra-titulo').textContent = compra ? `Editar venda nº ${compra.numero}` : cliente ? 'Nova compra' : 'Venda balcão';
  $('#dlg-compra-cliente').textContent = cliente ? `Cliente: ${cliente.nome}` : 'Sem cliente cadastrado (venda rápida no balcão)';
  if (compra?.categoria_id) formCompra.categoria_id.value = compra.categoria_id;
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
  (compra ? formCompra.descricao : formCompra.categoria_id).focus();
}

formCompra.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = formCompra;
  const erroEl = $('#compra-erro');
  const valor = Number(soDigitos(f.valor.value) || 0);
  const forma = f.forma_pagamento.value;
  const dados = {
    categoria_id: f.categoria_id.value || null,
    descricao: f.descricao.value.trim().replace(/\s+/g, ' '),
    valor_centavos: valor,
    data: f.data.value,
    forma_pagamento: forma,
    parcelas: forma === 'credito' ? Number(f.parcelas.value) : 1,
    observacao: f.observacao.value.trim() || null,
  };
  if (!dados.categoria_id) return mostrarErro(erroEl, 'Escolha a categoria.');
  if (dados.descricao.length < 2) return mostrarErro(erroEl, 'Descreva o que foi comprado.');
  if (valor <= 0) return mostrarErro(erroEl, 'Informe o valor da compra.');
  if (!dados.data) return mostrarErro(erroEl, 'Informe a data.');
  if (dados.data > hojeSP()) return mostrarErro(erroEl, 'A data não pode ser no futuro.');

  const btn = $('button[type=submit]', f);
  btn.disabled = true;
  const { error } = compraCtx.compra
    ? await sb.from('compras').update(dados).eq('id', compraCtx.compra.id)
    : await sb.from('compras').insert({ ...dados, cliente_id: compraCtx.cliente?.id ?? null });
  btn.disabled = false;
  if (error) return mostrarErro(erroEl, msgErro(error));
  dlgCompra.close();
  toast(compraCtx.compra ? 'Venda atualizada' : `Venda de ${fmtMoeda(valor)} lançada`);
  render();
});

// ===================================================================
// Modal: cancelar compra
// ===================================================================
const dlgCancelar = $('#dlg-cancelar');
const formCancelar = $('#form-cancelar');
let cancelando = null; // { tabela: 'compras' | 'lancamentos', item }

function abrirCancelar(tabela, item) {
  cancelando = { tabela, item };
  formCancelar.reset();
  mostrarErro($('#cancelar-erro'), '');
  const nome = tabela === 'compras' ? 'venda' : item.tipo === 'saida' ? 'saída' : 'entrada';
  $('#dlg-cancelar-titulo').textContent = `Cancelar ${nome}`;
  $('#dlg-cancelar-info').textContent = `Nº ${item.numero} · ${fmtData(item.data)} · ${item.descricao} · ${fmtMoeda(item.valor_centavos)}`;
  dlgCancelar.showModal();
  formCancelar.motivo.focus();
}
const abrirCancelarCompra = (compra) => abrirCancelar('compras', compra);

formCancelar.addEventListener('submit', async (e) => {
  e.preventDefault();
  const motivo = formCancelar.motivo.value.trim();
  if (motivo.length < 3) return mostrarErro($('#cancelar-erro'), 'Escreva o motivo do cancelamento.');
  const agora = new Date().toISOString();
  const mudanca = cancelando.tabela === 'compras'
    ? { status: 'cancelada', motivo_cancelamento: motivo, cancelada_em: agora }
    : { status: 'cancelado', motivo_cancelamento: motivo, cancelado_em: agora };
  const { error } = await sb.from(cancelando.tabela).update(mudanca).eq('id', cancelando.item.id);
  if (error) return mostrarErro($('#cancelar-erro'), msgErro(error));
  dlgCancelar.close();
  toast('Cancelado. Continua no histórico e saiu dos totais.');
  render();
});

// ===================================================================
// Modal: lançamento de caixa (saída / entrada que não é venda)
// ===================================================================
const dlgLanc = $('#dlg-lanc');
const formLanc = $('#form-lanc');
let lancEditando = null;

async function preencherCategoriasLanc(atualId) {
  const tipo = formLanc.querySelector('input[name=tipo]:checked').value;
  formLanc.categoria_id.innerHTML = opcoesCategoria(await categorias(), tipo === 'saida' ? 'despesa' : 'receita', atualId);
  if (atualId) formLanc.categoria_id.value = atualId;
  $('#dlg-lanc-titulo').textContent = `${lancEditando ? 'Editar' : 'Nova'} ${tipo === 'saida' ? 'saída' : 'entrada'}`;
}
$$('input[name=tipo]', formLanc).forEach((r) => r.addEventListener('change', () => preencherCategoriasLanc()));

async function abrirLancamento(tipo, lanc = null) {
  lancEditando = lanc;
  formLanc.reset();
  mostrarErro($('#lanc-erro'), '');
  formLanc.querySelector(`input[name=tipo][value=${lanc?.tipo ?? tipo}]`).checked = true;
  $$('input[name=tipo]', formLanc).forEach((r) => { r.disabled = !!lanc; });
  try { await preencherCategoriasLanc(lanc?.categoria_id); } catch (err) { return toast(msgErro(err), 'erro'); }
  formLanc.data.value = lanc?.data ?? hojeSP();
  formLanc.data.max = hojeSP();
  if (lanc) {
    formLanc.descricao.value = lanc.descricao;
    formLanc.valor.value = fmtMoeda(lanc.valor_centavos);
    formLanc.forma_pagamento.value = lanc.forma_pagamento;
    formLanc.observacao.value = lanc.observacao ?? '';
  }
  dlgLanc.showModal();
  formLanc.categoria_id.focus();
}

formLanc.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = formLanc;
  const erroEl = $('#lanc-erro');
  const dados = {
    tipo: f.querySelector('input[name=tipo]:checked').value,
    categoria_id: f.categoria_id.value || null,
    descricao: f.descricao.value.trim().replace(/\s+/g, ' '),
    valor_centavos: Number(soDigitos(f.valor.value) || 0),
    data: f.data.value,
    forma_pagamento: f.forma_pagamento.value,
    observacao: f.observacao.value.trim() || null,
  };
  if (!dados.categoria_id) return mostrarErro(erroEl, 'Escolha a categoria.');
  if (dados.descricao.length < 2) return mostrarErro(erroEl, 'Escreva uma descrição.');
  if (dados.valor_centavos <= 0) return mostrarErro(erroEl, 'Informe o valor.');
  if (!dados.data || dados.data > hojeSP()) return mostrarErro(erroEl, 'Informe uma data até hoje.');
  const btn = $('button[type=submit]', f);
  btn.disabled = true;
  const { error } = lancEditando
    ? await sb.from('lancamentos').update(dados).eq('id', lancEditando.id)
    : await sb.from('lancamentos').insert(dados);
  btn.disabled = false;
  if (error) return mostrarErro(erroEl, msgErro(error));
  dlgLanc.close();
  toast(`${dados.tipo === 'saida' ? 'Saída' : 'Entrada'} de ${fmtMoeda(dados.valor_centavos)} registrada`);
  render();
});

// Fechar modais
$$('[data-fechar]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

// ===================================================================
// Tela: todas as vendas (por período e categoria)
// ===================================================================
const estadoCompras = { de: null, ate: null, canceladas: false, categoria: '' };

function seletorPeriodo(estado, idPrefixo) {
  return `
    <div class="periodo">
      <label>De<input type="date" id="${idPrefixo}-de" value="${estado.de}"></label>
      <label>Até<input type="date" id="${idPrefixo}-ate" value="${estado.ate}"></label>
    </div>`;
}

async function telaCompras() {
  const hoje = hojeSP();
  if (!estadoCompras.de) { estadoCompras.de = hoje.slice(0, 8) + '01'; estadoCompras.ate = hoje; }
  let cats = [];
  try { cats = await categorias(); } catch { /* segue sem filtro */ }
  conteudo.innerHTML = `
    <div class="barra">
      <h1>Compras</h1>
      <div class="acoes">
        <button class="btn btn-ghost btn-sm" data-periodo="hoje" type="button">Hoje</button>
        <button class="btn btn-ghost btn-sm" data-periodo="mes" type="button">Este mês</button>
        <button class="btn btn-ghost btn-sm" data-periodo="passado" type="button">Mês passado</button>
        <button class="btn btn-primary btn-sm" id="btn-venda-balcao" type="button">+ Venda balcão</button>
      </div>
    </div>
    <div class="barra">
      <div class="periodo">
        ${seletorPeriodo(estadoCompras, 'per')}
        <label>Categoria<select id="filtro-cat" style="width:auto">
          <option value="">Todas</option>
          ${cats.filter((c) => c.tipo === 'venda').map((c) => `<option value="${c.id}" ${estadoCompras.categoria === c.id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}
        </select></label>
      </div>
      <label class="check"><input type="checkbox" id="chk-canceladas" ${estadoCompras.canceladas ? 'checked' : ''}> Mostrar canceladas</label>
    </div>
    <div id="compras-corpo"><div class="vazio">Carregando…</div></div>
    <p class="muted pequeno" style="margin-top:12px">Venda para cliente cadastrado: abra o cliente na aba Clientes. Venda rápida sem cadastro: “+ Venda balcão”.</p>`;

  const atualizar = () => {
    estadoCompras.de = $('#per-de').value;
    estadoCompras.ate = $('#per-ate').value;
    carregarCompras();
  };
  $('#per-de').addEventListener('change', atualizar);
  $('#per-ate').addEventListener('change', atualizar);
  $('#filtro-cat').addEventListener('change', (e) => { estadoCompras.categoria = e.target.value; carregarCompras(); });
  $('#chk-canceladas').addEventListener('change', (e) => { estadoCompras.canceladas = e.target.checked; carregarCompras(); });
  $('#btn-venda-balcao').addEventListener('click', () => abrirCompra(null, null));
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

function listaBarras(pares, cor) {
  if (!pares.length) return '<p class="muted pequeno" style="padding:14px 16px">Nada no período.</p>';
  const max = Math.max(...pares.map(([, v]) => v));
  return `<div class="lista-barras">${pares.map(([nome, v]) => `
    <div class="item"><span>${esc(nome)}</span><span class="valor">${fmtMoeda(v)}</span>
      <div class="trilho"><div class="enchimento" style="width:${Math.max(2, (v / max) * 100)}%;background:${cor}"></div></div></div>`).join('')}</div>`;
}
const somarPor = (lista, chave) => {
  const m = {};
  for (const x of lista) { const k = chave(x); m[k] = (m[k] || 0) + Number(x.valor_centavos); }
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
};

async function carregarCompras() {
  const alvo = $('#compras-corpo');
  if (!alvo) return;
  const { de, ate, categoria } = estadoCompras;
  if (!de || !ate || de > ate) { alvo.innerHTML = '<div class="vazio">Escolha um período válido.</div>'; return; }
  alvo.innerHTML = '<div class="vazio">Carregando…</div>';
  let lista;
  try {
    lista = await buscarTudo(() => {
      let q = sb.from('compras').select('*, clientes(nome), categorias(nome)')
        .gte('data', de).lte('data', ate);
      if (categoria) q = q.eq('categoria_id', categoria);
      return q.order('data', { ascending: false }).order('numero', { ascending: false });
    });
  } catch (err) { alvo.innerHTML = `<div class="vazio">${esc(msgErro(err))}</div>`; return; }

  const ativas = lista.filter((c) => c.status === 'ativa');
  const total = ativas.reduce((s, c) => s + Number(c.valor_centavos), 0);
  const mostrar = estadoCompras.canceladas ? lista : ativas;

  alvo.innerHTML = `
    <div class="kpis">
      <div class="card kpi"><div class="rot">Total vendido</div><div class="val">${fmtMoeda(total)}</div></div>
      <div class="card kpi"><div class="rot">Vendas</div><div class="val">${ativas.length}</div></div>
      <div class="card kpi"><div class="rot">Ticket médio</div><div class="val">${fmtMoeda(ativas.length ? Math.round(total / ativas.length) : 0)}</div></div>
    </div>
    <div class="grade-2">
      <div class="card"><div class="secao-topo"><h3>Por categoria</h3></div>${listaBarras(somarPor(ativas, (c) => c.categorias?.nome ?? 'Sem categoria'), 'var(--serie-entrada)')}</div>
      <div class="card"><div class="secao-topo"><h3>Por forma de pagamento</h3></div>${listaBarras(somarPor(ativas, (c) => FORMAS[c.forma_pagamento]), 'var(--serie-entrada)')}</div>
    </div>
    <div class="card">
      ${mostrar.length ? `
      <div class="tabela-wrap"><table class="tabela">
        <thead><tr><th>Data</th><th>Cliente</th><th>Descrição</th><th class="esconder-cel">Pagamento</th><th class="num">Valor</th><th></th></tr></thead>
        <tbody>${mostrar.map((c) => `
          <tr class="${c.status === 'cancelada' ? 'cancelada' : ''}">
            <td>${fmtData(c.data)}<div class="muted pequeno">nº ${c.numero}</div></td>
            <td>${c.cliente_id ? `<a href="#/cliente/${c.cliente_id}">${esc(c.clientes?.nome ?? '—')}</a>` : '<span class="muted">Venda balcão</span>'}</td>
            <td><span class="desc">${esc(c.descricao)}</span> ${tagCategoria(c.categorias?.nome)}${c.status === 'cancelada' ? ` <span class="tag cancelada">cancelada</span>` : ''}</td>
            <td class="esconder-cel"><span class="tag">${FORMAS[c.forma_pagamento]}${c.forma_pagamento === 'credito' && c.parcelas > 1 ? ` ${c.parcelas}x` : ''}</span></td>
            <td class="num">${fmtMoeda(c.valor_centavos)}</td>
            <td class="num">${c.status === 'cancelada' ? '' : `<div class="acoes-linha">
              <button class="link-btn" type="button" data-editar-venda="${c.id}">Editar</button>
              <button class="link-btn perigo" type="button" data-cancelar-venda="${c.id}">Cancelar</button></div>`}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : '<div class="vazio"><b>Nenhuma venda nesse período</b></div>'}
    </div>`;

  const acha = (id) => lista.find((c) => c.id === id);
  $$('[data-editar-venda]', alvo).forEach((b) => b.addEventListener('click', () => {
    const c = acha(b.dataset.editarVenda);
    abrirCompra(c.cliente_id ? { id: c.cliente_id, nome: c.clientes?.nome } : null, c);
  }));
  $$('[data-cancelar-venda]', alvo).forEach((b) => b.addEventListener('click', () => abrirCancelarCompra(acha(b.dataset.cancelarVenda))));
}

// ===================================================================
// Tela: CAIXA — entradas, saídas, saldo e faturamento mensal
// ===================================================================
const estadoCaixa = { mes: null, cancelados: false };
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const nomeMes = (ym) => `${MESES[Number(ym.slice(5, 7)) - 1]} de ${ym.slice(0, 4)}`;

async function telaCaixa() {
  if (!estadoCaixa.mes) estadoCaixa.mes = hojeSP().slice(0, 7);
  conteudo.innerHTML = `
    <div class="barra">
      <h1>Caixa</h1>
      <div class="acoes">
        <button class="btn btn-ghost btn-sm" id="btn-exportar-caixa" type="button">Exportar mês</button>
        <button class="btn btn-ghost btn-sm" id="btn-entrada" type="button">+ Entrada</button>
        <button class="btn btn-ghost btn-sm" id="btn-saida" type="button">− Saída</button>
        <button class="btn btn-primary btn-sm" id="btn-venda-caixa" type="button">+ Venda balcão</button>
      </div>
    </div>
    <div class="barra">
      <div class="periodo">
        <label>Mês<input type="month" id="caixa-mes" value="${estadoCaixa.mes}" max="${hojeSP().slice(0, 7)}"></label>
      </div>
      <label class="check"><input type="checkbox" id="chk-cancelados" ${estadoCaixa.cancelados ? 'checked' : ''}> Mostrar cancelados</label>
    </div>
    <div id="caixa-corpo"><div class="vazio">Carregando…</div></div>`;

  $('#caixa-mes').addEventListener('change', (e) => { if (e.target.value) { estadoCaixa.mes = e.target.value; carregarCaixa(); } });
  $('#chk-cancelados').addEventListener('change', (e) => { estadoCaixa.cancelados = e.target.checked; carregarCaixa(); });
  $('#btn-entrada').addEventListener('click', () => abrirLancamento('entrada'));
  $('#btn-saida').addEventListener('click', () => abrirLancamento('saida'));
  $('#btn-venda-caixa').addEventListener('click', () => abrirCompra(null, null));
  $('#btn-exportar-caixa').addEventListener('click', exportarCaixa);
  carregarCaixa();
}

async function movimentosEntre(de, ate) {
  return buscarTudo(() => sb.from('caixa_movimentos').select('*')
    .gte('data', de).lte('data', ate)
    .order('data', { ascending: false }).order('criado_em', { ascending: false }));
}

async function carregarCaixa() {
  const alvo = $('#caixa-corpo');
  if (!alvo) return;
  const ym = estadoCaixa.mes;
  const ini = `${ym}-01`;
  const fim = ultimoDiaMes(ini);
  const ini12 = addMeses(ini, -11);
  alvo.innerHTML = '<div class="vazio">Carregando…</div>';
  let todos;
  try { todos = await movimentosEntre(ini12, fim); } catch (err) { alvo.innerHTML = `<div class="vazio">${esc(msgErro(err))}</div>`; return; }
  if (estadoCaixa.mes !== ym || !$('#caixa-corpo')) return;

  const doMes = todos.filter((m) => m.data >= ini);
  const ativos = doMes.filter((m) => m.ativo);
  const soma = (f) => ativos.filter(f).reduce((s, m) => s + Number(m.valor_centavos), 0);
  const vendas = soma((m) => m.origem === 'venda');
  const outrasEntradas = soma((m) => m.origem === 'lancamento' && m.tipo === 'entrada');
  const saidas = soma((m) => m.tipo === 'saida');
  const saldo = vendas + outrasEntradas - saidas;

  // últimos 12 meses
  const meses = Array.from({ length: 12 }, (_, i) => addMeses(ini12, i).slice(0, 7));
  const porMes = Object.fromEntries(meses.map((m) => [m, { entrada: 0, saida: 0 }]));
  for (const m of todos) if (m.ativo && porMes[m.data.slice(0, 7)]) porMes[m.data.slice(0, 7)][m.tipo] += Number(m.valor_centavos);
  const maxMes = Math.max(1, ...meses.map((m) => Math.max(porMes[m].entrada, porMes[m].saida)));

  // saldo por forma de pagamento (ajuda a conferir o dinheiro na gaveta)
  const formas = {};
  for (const m of ativos) formas[m.forma_pagamento] = (formas[m.forma_pagamento] || 0) + (m.tipo === 'entrada' ? 1 : -1) * Number(m.valor_centavos);

  const mostrar = estadoCaixa.cancelados ? doMes : ativos;

  alvo.innerHTML = `
    <div class="kpis">
      <div class="card kpi"><div class="rot">Faturamento (vendas)</div><div class="val">${fmtMoeda(vendas)}</div></div>
      <div class="card kpi"><div class="rot">Outras entradas</div><div class="val">${fmtMoeda(outrasEntradas)}</div></div>
      <div class="card kpi"><div class="rot">Saídas</div><div class="val neg">− ${fmtMoeda(saidas)}</div></div>
      <div class="card kpi"><div class="rot">Saldo do mês</div><div class="val ${saldo >= 0 ? 'pos' : 'neg'}">${saldo < 0 ? '− ' : ''}${fmtMoeda(Math.abs(saldo))}</div></div>
    </div>

    <div class="card grafico" style="margin-bottom:18px">
      <div class="secao-topo" style="padding:0 0 10px;border:0"><h3>Entradas e saídas · últimos 12 meses</h3></div>
      <div class="grafico-legenda" aria-hidden="true">
        <span><i style="background:var(--serie-entrada)"></i>Entradas</span>
        <span><i style="background:var(--serie-saida)"></i>Saídas</span>
      </div>
      <div class="grafico-area" role="img" aria-label="Gráfico de entradas e saídas por mês">
        ${meses.map((m) => `
          <div class="grafico-mes ${m === ym ? 'ativo' : ''}" data-mes="${m}">
            <div class="b" style="height:${(porMes[m].entrada / maxMes) * 100}%;background:var(--serie-entrada)"></div>
            <div class="b" style="height:${(porMes[m].saida / maxMes) * 100}%;background:var(--serie-saida)"></div>
          </div>`).join('')}
      </div>
      <div class="grafico-rotulos">${meses.map((m) => `<span>${MESES_CURTOS[Number(m.slice(5, 7)) - 1]}</span>`).join('')}</div>
      <table class="sr-only"><caption>Entradas e saídas por mês</caption>
        <tr><th>Mês</th><th>Entradas</th><th>Saídas</th></tr>
        ${meses.map((m) => `<tr><td>${nomeMes(m)}</td><td>${fmtMoeda(porMes[m].entrada)}</td><td>${fmtMoeda(porMes[m].saida)}</td></tr>`).join('')}
      </table>
    </div>

    <div class="grade-2">
      <div class="card"><div class="secao-topo"><h3>Entradas por categoria</h3></div>
        ${listaBarras(somarPor(ativos.filter((m) => m.tipo === 'entrada'), (m) => m.categoria ?? 'Sem categoria'), 'var(--serie-entrada)')}</div>
      <div class="card"><div class="secao-topo"><h3>Saídas por categoria</h3></div>
        ${listaBarras(somarPor(ativos.filter((m) => m.tipo === 'saida'), (m) => m.categoria), 'var(--serie-saida)')}</div>
      <div class="card"><div class="secao-topo"><h3>Saldo por forma de pagamento</h3></div>
        <div class="lista-barras">${Object.keys(formas).length ? Object.entries(formas).sort((a, b) => b[1] - a[1]).map(([k, v]) => `
          <div class="item"><span>${FORMAS[k]}</span><span class="valor ${v >= 0 ? 'pos' : 'neg'}" style="color:var(${v >= 0 ? '--texto-entrada' : '--texto-saida'})">${v < 0 ? '− ' : ''}${fmtMoeda(Math.abs(v))}</span></div>`).join('') : '<p class="muted pequeno">Nada no mês.</p>'}</div></div>
    </div>

    <div class="card">
      <div class="secao-topo"><h3>Movimentos de ${nomeMes(ym)}</h3></div>
      ${mostrar.length ? `
      <div class="tabela-wrap"><table class="tabela">
        <thead><tr><th>Data</th><th class="esconder-cel">Tipo</th><th>Descrição</th><th class="esconder-cel">Pagamento</th><th class="num">Valor</th><th></th></tr></thead>
        <tbody>${mostrar.map((m) => {
          const ent = m.tipo === 'entrada';
          const rotulo = m.origem === 'venda' ? 'Venda' : ent ? 'Entrada' : 'Saída';
          return `
          <tr class="${m.ativo ? '' : 'cancelada'}">
            <td>${fmtData(m.data)}</td>
            <td class="esconder-cel"><span class="tag ${ent ? 'entrada' : 'saida'}">${rotulo}</span></td>
            <td><span class="desc">${esc(m.descricao)}</span> ${tagCategoria(m.categoria)}
              ${m.origem === 'venda' ? `<div class="muted pequeno">${m.cliente_id ? `<a href="#/cliente/${m.cliente_id}">${esc(m.cliente_nome)}</a>` : 'Venda balcão'} · nº ${m.numero}</div>` : ''}
              ${m.ativo ? '' : `<div class="pequeno"><span class="tag cancelada">cancelado</span> ${esc(m.motivo_cancelamento)}</div>`}</td>
            <td class="esconder-cel"><span class="tag">${FORMAS[m.forma_pagamento]}${m.parcelas > 1 ? ` ${m.parcelas}x` : ''}</span></td>
            <td class="num ${ent ? 'pos' : 'neg'}">${ent ? '+' : '−'} ${fmtMoeda(m.valor_centavos)}</td>
            <td class="num">${m.ativo ? `<div class="acoes-linha">
              <button class="link-btn" type="button" data-editar-mov="${m.id}">Editar</button>
              <button class="link-btn perigo" type="button" data-cancelar-mov="${m.id}">Cancelar</button></div>` : ''}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>` : `<div class="vazio"><b>Nenhum movimento em ${nomeMes(ym)}</b>As vendas entram aqui sozinhas. Use “− Saída” para registrar despesas.</div>`}
    </div>`;

  // dica do gráfico
  const dica = $('#dica-grafico');
  $$('.grafico-mes', alvo).forEach((el) => {
    el.addEventListener('mousemove', (e) => {
      const m = el.dataset.mes; const v = porMes[m]; const s = v.entrada - v.saida;
      dica.innerHTML = `<b>${nomeMes(m)}</b>
        <div class="linha-d"><span>Entradas</span><span>${fmtMoeda(v.entrada)}</span></div>
        <div class="linha-d"><span>Saídas</span><span>${fmtMoeda(v.saida)}</span></div>
        <div class="linha-d"><span>Saldo</span><b style="margin:0;color:var(${s >= 0 ? '--texto-entrada' : '--texto-saida'})">${s < 0 ? '− ' : ''}${fmtMoeda(Math.abs(s))}</b></div>`;
      dica.hidden = false;
      const x = Math.min(e.clientX + 14, window.innerWidth - dica.offsetWidth - 8);
      dica.style.left = `${x}px`; dica.style.top = `${e.clientY + 14}px`;
    });
    el.addEventListener('mouseleave', () => { dica.hidden = true; });
    el.addEventListener('click', () => { dica.hidden = true; estadoCaixa.mes = el.dataset.mes; $('#caixa-mes').value = el.dataset.mes; carregarCaixa(); });
  });

  // ações
  const acha = (id) => doMes.find((m) => m.id === id);
  $$('[data-editar-mov]', alvo).forEach((b) => b.addEventListener('click', async () => {
    const m = acha(b.dataset.editarMov);
    const tabela = m.origem === 'venda' ? 'compras' : 'lancamentos';
    const { data, error } = await sb.from(tabela).select('*').eq('id', m.id).single();
    if (error) return toast(msgErro(error), 'erro');
    if (tabela === 'compras') abrirCompra(data.cliente_id ? { id: data.cliente_id, nome: m.cliente_nome } : null, data);
    else abrirLancamento(data.tipo, data);
  }));
  $$('[data-cancelar-mov]', alvo).forEach((b) => b.addEventListener('click', () => {
    const m = acha(b.dataset.cancelarMov);
    abrirCancelar(m.origem === 'venda' ? 'compras' : 'lancamentos', m);
  }));
}

async function exportarCaixa() {
  const ym = estadoCaixa.mes;
  try {
    const lista = (await movimentosEntre(`${ym}-01`, ultimoDiaMes(`${ym}-01`))).reverse();
    const csvCel = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const cab = ['Data', 'Tipo', 'Categoria', 'Descrição', 'Cliente', 'Pagamento', 'Parcelas', 'Valor', 'Situação'];
    const linhas = lista.map((m) => [
      fmtData(m.data), m.origem === 'venda' ? 'Venda' : m.tipo === 'entrada' ? 'Entrada' : 'Saída', m.categoria, m.descricao,
      m.origem === 'venda' ? (m.cliente_nome ?? 'Venda balcão') : '', FORMAS[m.forma_pagamento], m.parcelas,
      ((m.tipo === 'saida' ? -1 : 1) * Number(m.valor_centavos) / 100).toFixed(2).replace('.', ','),
      m.ativo ? 'Ativo' : `Cancelado: ${m.motivo_cancelamento ?? ''}`,
    ].map(csvCel).join(';'));
    const csv = '﻿' + [cab.map(csvCel).join(';'), ...linhas].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `caixa-msc-${ym}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`${lista.length} movimentos exportados`);
  } catch (err) { toast(msgErro(err), 'erro'); }
}

// ===================================================================
// Tela: CONFIGURAÇÕES — categorias
// ===================================================================
const GRUPOS_CAT = [
  ['venda', 'Categorias de produto', 'Usadas nas vendas. Ex.: Celulares, Capas…'],
  ['despesa', 'Tipos de saída (despesas)', 'Usados nas saídas do caixa. Ex.: Aluguel, Fornecedor…'],
  ['receita', 'Tipos de entrada (que não são venda)', 'Ex.: dinheiro colocado pelo dono.'],
];

async function telaConfig() {
  conteudo.innerHTML = '<div class="vazio">Carregando…</div>';
  let lista;
  try { lista = await categorias(true); } catch (err) { conteudo.innerHTML = `<div class="vazio">${esc(msgErro(err))}</div>`; return; }
  conteudo.innerHTML = `
    <div class="barra"><h1>Configurações</h1></div>
    <p class="muted" style="margin-bottom:16px">Para renomear, edite o nome e clique fora do campo. Categorias desativadas somem das listas, mas o histórico continua.</p>
    <div class="grade-2">
      ${GRUPOS_CAT.map(([tipo, titulo, dica]) => `
        <div class="card">
          <div class="secao-topo"><div><h3>${titulo}</h3><p class="muted pequeno">${dica}</p></div></div>
          <div class="cfg-lista">
            ${lista.filter((c) => c.tipo === tipo).map((c) => `
              <div class="cfg-item ${c.ativo ? '' : 'inativa'}">
                <input value="${esc(c.nome)}" data-renomear="${c.id}" aria-label="Nome da categoria">
                <button class="btn btn-ghost btn-sm" type="button" data-alternar="${c.id}">${c.ativo ? 'Desativar' : 'Ativar'}</button>
              </div>`).join('')}
          </div>
          <form class="cfg-novo" data-novo="${tipo}">
            <input name="nome" placeholder="Nova categoria…" aria-label="Nova categoria">
            <button class="btn btn-primary btn-sm" type="submit">Adicionar</button>
          </form>
        </div>`).join('')}
    </div>`;

  $$('[data-renomear]').forEach((inp) => inp.addEventListener('change', async () => {
    const nome = inp.value.trim().replace(/\s+/g, ' ');
    const atual = lista.find((c) => c.id === inp.dataset.renomear);
    if (nome.length < 2) { inp.value = atual.nome; return toast('O nome precisa ter pelo menos 2 letras.', 'erro'); }
    const { error } = await sb.from('categorias').update({ nome }).eq('id', atual.id);
    if (error) { inp.value = atual.nome; return toast(msgErro(error), 'erro'); }
    atual.nome = nome; CATS = null;
    toast('Categoria renomeada');
  }));
  $$('[data-alternar]').forEach((b) => b.addEventListener('click', async () => {
    const c = lista.find((x) => x.id === b.dataset.alternar);
    const { error } = await sb.from('categorias').update({ ativo: !c.ativo }).eq('id', c.id);
    if (error) return toast(msgErro(error), 'erro');
    CATS = null;
    toast(c.ativo ? 'Categoria desativada' : 'Categoria ativada');
    telaConfig();
  }));
  $$('[data-novo]').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = f.nome.value.trim().replace(/\s+/g, ' ');
    if (nome.length < 2) return toast('Escreva o nome da categoria.', 'erro');
    const tipo = f.dataset.novo;
    const ordem = Math.max(0, ...lista.filter((c) => c.tipo === tipo && c.ordem < 99).map((c) => c.ordem)) + 1;
    const { error } = await sb.from('categorias').insert({ tipo, nome, ordem });
    if (error) return toast(msgErro(error), 'erro');
    CATS = null;
    toast(`“${nome}” adicionada`);
    telaConfig();
  }));
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
