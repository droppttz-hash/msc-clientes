// =====================================================================
// Início do sistema: login, menu lateral, rotas, busca geral, avisos
// =====================================================================
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import {
  estado, pode, podeAlgum, $, $$, esc, icone, aplicarTema, toast, msgErro, rpc, consulta, fmtMoeda, limparCache, fmtTelefone,
} from './core.js';

// ---------------------------------------------------------------------
// Menu (cada item só aparece para quem tem a permissão)
// ---------------------------------------------------------------------
const MENU = [
  { id: 'inicio', rotulo: 'Início', icone: 'inicio', href: '#/inicio' },
  { id: 'vendas', rotulo: 'Vendas', icone: 'vendas', perm: ['vendas.criar', 'vendas.ver_todas'], filhos: [
    { rotulo: 'Nova venda', href: '#/vendas/nova', perm: ['vendas.criar'] },
    { rotulo: 'Vendas', href: '#/vendas', perm: ['vendas.criar', 'vendas.ver_todas'] },
    { rotulo: 'Aprovações', href: '#/vendas/aprovacoes', perm: ['vendas.aprovar'], badge: 'aguardando_aprovacao' },
  ] },
  { id: 'clientes', rotulo: 'Clientes', icone: 'clientes', perm: ['clientes.ver'], filhos: [
    { rotulo: 'Clientes', href: '#/clientes' },
    { rotulo: 'Aniversariantes', href: '#/clientes/aniversariantes' },
  ] },
  { id: 'estoque', rotulo: 'Estoque', icone: 'estoque', perm: ['estoque.ver'], filhos: [
    { rotulo: 'Produtos', href: '#/estoque' },
    { rotulo: 'Entradas de mercadoria', href: '#/estoque/entradas', perm: ['estoque.entrada'] },
    { rotulo: 'Movimentações', href: '#/estoque/movimentos' },
    { rotulo: 'Inventário e ajustes', href: '#/estoque/inventario', perm: ['estoque.ajustar'] },
    { rotulo: 'Importar planilha', href: '#/estoque/importar', perm: ['estoque.importar'] },
    { rotulo: 'Fornecedores', href: '#/estoque/fornecedores', perm: ['estoque.entrada', 'financeiro.lancar'] },
  ] },
  { id: 'financas', rotulo: 'Finanças', icone: 'financas', perm: ['financeiro.ver', 'financeiro.caixa'], filhos: [
    { rotulo: 'Visão geral', href: '#/financas', perm: ['financeiro.ver'] },
    { rotulo: 'Caixa do dia', href: '#/financas/caixa', perm: ['financeiro.caixa', 'financeiro.ver'] },
    { rotulo: 'Contas a receber', href: '#/financas/receber', perm: ['financeiro.ver'] },
    { rotulo: 'Contas a pagar', href: '#/financas/pagar', perm: ['financeiro.ver'], badge: 'pagar_vencido' },
    { rotulo: 'Extrato das contas', href: '#/financas/extrato', perm: ['financeiro.ver'] },
    { rotulo: 'Despesas fixas', href: '#/financas/fixas', perm: ['financeiro.ver'] },
    { rotulo: 'Fluxo de caixa', href: '#/financas/fluxo', perm: ['financeiro.relatorios'] },
    { rotulo: 'DRE (resultado)', href: '#/financas/dre', perm: ['financeiro.relatorios'] },
  ] },
  { id: 'config', rotulo: 'Configurações', icone: 'config', perm: ['config.gerenciar', 'auditoria.ver'], filhos: [
    { rotulo: 'Empresa e aparência', href: '#/config/empresa', perm: ['config.gerenciar'] },
    { rotulo: 'Usuários', href: '#/config/usuarios', perm: ['config.gerenciar'] },
    { rotulo: 'Permissões', href: '#/config/permissoes', perm: ['config.gerenciar'] },
    { rotulo: 'Categorias', href: '#/config/categorias', perm: ['config.gerenciar'] },
    { rotulo: 'Pagamentos e contas', href: '#/config/pagamentos', perm: ['config.gerenciar'] },
    { rotulo: 'Histórico de alterações', href: '#/config/auditoria', perm: ['auditoria.ver'] },
  ] },
];

// rota → [módulo, função]
const ROTAS = [
  [/^#\/inicio$/, 'inicio', 'tela'],
  [/^#\/clientes$/, 'clientes', 'lista'],
  [/^#\/clientes\/aniversariantes$/, 'clientes', 'aniversariantes'],
  [/^#\/clientes\/([0-9a-f-]{36})$/, 'clientes', 'ficha'],
  [/^#\/vendas\/nova$/, 'vendas', 'nova'],
  [/^#\/vendas$/, 'vendas', 'lista'],
  [/^#\/vendas\/aprovacoes$/, 'vendas', 'aprovacoes'],
  [/^#\/vendas\/([0-9a-f-]{36})$/, 'vendas', 'detalhe'],
  [/^#\/estoque$/, 'estoque', 'produtos'],
  [/^#\/estoque\/produto\/([0-9a-f-]{36})$/, 'estoque', 'produto'],
  [/^#\/estoque\/entradas$/, 'estoque', 'entradas'],
  [/^#\/estoque\/entradas\/nova$/, 'estoque', 'novaEntrada'],
  [/^#\/estoque\/entradas\/([0-9a-f-]{36})$/, 'estoque', 'entrada'],
  [/^#\/estoque\/movimentos$/, 'estoque', 'movimentos'],
  [/^#\/estoque\/inventario$/, 'estoque', 'inventario'],
  [/^#\/estoque\/importar$/, 'estoque', 'importar'],
  [/^#\/estoque\/fornecedores$/, 'estoque', 'fornecedores'],
  [/^#\/financas$/, 'financas', 'visao'],
  [/^#\/financas\/caixa$/, 'financas', 'caixa'],
  [/^#\/financas\/receber$/, 'financas', 'receber'],
  [/^#\/financas\/pagar$/, 'financas', 'pagar'],
  [/^#\/financas\/extrato$/, 'financas', 'extrato'],
  [/^#\/financas\/fixas$/, 'financas', 'fixas'],
  [/^#\/financas\/fluxo$/, 'financas', 'fluxo'],
  [/^#\/financas\/dre$/, 'financas', 'dre'],
  [/^#\/config\/(empresa|usuarios|permissoes|categorias|pagamentos|auditoria)$/, 'config', 'tela'],
];
const MODULOS = {
  inicio: () => import('./telas/inicio.js'),
  clientes: () => import('./telas/clientes.js'),
  vendas: () => import('./telas/vendas.js'),
  estoque: () => import('./telas/estoque.js'),
  financas: () => import('./telas/financas.js'),
  config: () => import('./telas/config.js'),
};

const conteudo = $('#conteudo');
let logado = false;
let navAtual = 0;

// ---------------------------------------------------------------------
// Roteador
// ---------------------------------------------------------------------
export const navId = () => navAtual;
async function render() {
  if (!logado) return;
  const h = location.hash || '#/inicio';
  const id = ++navAtual;
  fecharMenuMobile();
  $$('.dropdown').forEach((d) => { d.hidden = true; });
  marcarMenu(h);
  window.scrollTo(0, 0);
  const rota = ROTAS.find(([re]) => re.test(h));
  if (!rota) { location.hash = '#/inicio'; return; }
  const [re, mod, fn] = rota;
  const params = h.match(re).slice(1);
  conteudo.innerHTML = '<div class="vazio"><span class="girando"></span> Carregando…</div>';
  try {
    const m = await MODULOS[mod]();
    if (id !== navAtual) return;
    // cada tela ganha um contêiner novo: ouvintes da tela anterior não sobrevivem
    const tela = document.createElement('div');
    tela.className = 'tela';
    conteudo.replaceChildren(tela);
    tela.innerHTML = '<div class="vazio"><span class="girando"></span> Carregando…</div>';
    await m[fn](tela, { params, ativo: () => id === navAtual });
  } catch (err) {
    console.error(err);
    if (id === navAtual) conteudo.innerHTML = `<div class="vazio"><b>Não deu para abrir esta tela</b>${esc(msgErro(err))}</div>`;
  }
  if (id === navAtual) conteudo.focus({ preventScroll: true });
}
window.addEventListener('hashchange', render);

// Telas usam isto para checar se o usuário ainda está nelas depois de um await
export const aindaEm = (prefixo) => (location.hash || '#/inicio').startsWith(prefixo);

// ---------------------------------------------------------------------
// Menu lateral
// ---------------------------------------------------------------------
const visivel = (item) => !item.perm || podeAlgum(...item.perm);
let abertos = new Set();
try { abertos = new Set(JSON.parse(localStorage.getItem('menu-abertos') || '[]')); } catch { /* ok */ }

function montarMenu() {
  const html = MENU.filter(visivel).map((g) => {
    const filhos = (g.filhos || []).filter(visivel);
    if (g.filhos && !filhos.length) return '';
    if (!g.filhos) {
      return `<div class="menu-grupo"><a class="menu-item" href="${g.href}" data-href="${g.href}" title="${g.rotulo}">${icone(g.icone)}<span>${g.rotulo}</span></a></div>`;
    }
    if (filhos.length === 1) {
      return `<div class="menu-grupo"><a class="menu-item" href="${filhos[0].href}" data-href="${filhos[0].href}" title="${g.rotulo}">${icone(g.icone)}<span>${g.rotulo}</span></a></div>`;
    }
    const aberto = abertos.has(g.id);
    return `<div class="menu-grupo" data-grupo="${g.id}">
      <button class="menu-item ${aberto ? 'aberto' : ''}" type="button" data-abrir="${g.id}" title="${g.rotulo}">${icone(g.icone)}<span>${g.rotulo}</span>
        <b class="menu-badge" data-badge-grupo="${g.id}" hidden></b>${icone('seta', 'seta')}</button>
      <div class="submenu" ${aberto ? '' : 'hidden'}>
        ${filhos.map((f) => `<a class="menu-item" href="${f.href}" data-href="${f.href}"><span>${f.rotulo}</span>${f.badge ? `<b class="menu-badge" data-badge="${f.badge}" hidden></b>` : ''}</a>`).join('')}
      </div></div>`;
  }).join('');
  $('#menu').innerHTML = html;
  $$('[data-abrir]').forEach((b) => b.addEventListener('click', () => {
    const app = $('#app');
    if (app.classList.contains('recolhido') && innerWidth > 860) { app.classList.remove('recolhido'); salvarRecolhido(false); }
    const g = b.dataset.abrir; const sub = b.nextElementSibling;
    const abrir = sub.hidden;
    sub.hidden = !abrir; b.classList.toggle('aberto', abrir);
    if (abrir) abertos.add(g); else abertos.delete(g);
    try { localStorage.setItem('menu-abertos', JSON.stringify([...abertos])); } catch { /* ok */ }
  }));
  atualizarBadges();
}

function marcarMenu(h) {
  const links = $$('#menu a[data-href]');
  // o link mais específico que combina com a rota atual
  let melhor = null;
  for (const a of links) {
    const href = a.dataset.href;
    if (h === href || h.startsWith(href + '/')) { if (!melhor || href.length > melhor.dataset.href.length) melhor = a; }
  }
  if (!melhor && h.startsWith('#/estoque')) melhor = links.find((a) => a.dataset.href === '#/estoque');
  links.forEach((a) => a.classList.toggle('ativo', a === melhor));
  $$('[data-abrir]').forEach((b) => {
    const contem = melhor && b.nextElementSibling.contains(melhor);
    b.classList.toggle('pai-ativo', !!contem && $('#app').classList.contains('recolhido'));
    if (contem && b.nextElementSibling.hidden) { b.nextElementSibling.hidden = false; b.classList.add('aberto'); abertos.add(b.dataset.abrir); }
  });
  $$('#barra-inferior a').forEach((a) => a.classList.toggle('ativo', h.startsWith(a.getAttribute('href'))));
}

function salvarRecolhido(v) { try { localStorage.setItem('menu-recolhido', v ? '1' : '0'); } catch { /* ok */ } }
$('#btn-recolher').innerHTML = icone('recolher');
$('#btn-recolher').addEventListener('click', () => { const r = $('#app').classList.toggle('recolhido'); salvarRecolhido(r); marcarMenu(location.hash); });
try { if (localStorage.getItem('menu-recolhido') === '1') $('#app').classList.add('recolhido'); } catch { /* ok */ }

function fecharMenuMobile() { $('#app').classList.remove('menu-aberto'); $('#fundo-menu').hidden = true; }
$('#btn-menu').innerHTML = icone('menu');
$('#btn-menu').addEventListener('click', () => { $('#app').classList.add('menu-aberto'); $('#fundo-menu').hidden = false; });
$('#fundo-menu').addEventListener('click', fecharMenuMobile);

// ---------------------------------------------------------------------
// Botão "+ Novo"
// ---------------------------------------------------------------------
const NOVOS = [
  { rotulo: 'Nova venda', perm: 'vendas.criar', href: '#/vendas/nova' },
  { rotulo: 'Novo cliente', perm: 'clientes.criar', acao: async () => (await import('./telas/clientes.js')).novoCliente() },
  { rotulo: 'Novo produto', perm: 'estoque.produtos', acao: async () => (await import('./telas/estoque.js')).novoProduto() },
  { rotulo: 'Entrada de mercadoria', perm: 'estoque.entrada', href: '#/estoque/entradas/nova' },
  { sep: true },
  { rotulo: 'Conta a pagar', perm: 'financeiro.lancar', acao: async () => (await import('./telas/financas.js')).novoTitulo('pagar') },
  { rotulo: 'Conta a receber', perm: 'financeiro.lancar', acao: async () => (await import('./telas/financas.js')).novoTitulo('receber') },
  { rotulo: 'Sangria / suprimento', perm: 'financeiro.caixa', href: '#/financas/caixa' },
];
function montarNovo() {
  const itens = NOVOS.filter((n) => n.sep || pode(n.perm));
  const limpos = itens.filter((n, i) => !(n.sep && (i === 0 || i === itens.length - 1 || itens[i - 1].sep)));
  const btn = $('#btn-novo');
  btn.hidden = !limpos.some((n) => !n.sep);
  btn.innerHTML = `${icone('mais')}<span class="rotulo">Novo</span>${icone('baixo')}`;
  $('#menu-novo').innerHTML = limpos.map((n, i) => n.sep ? '<div class="sep"></div>'
    : n.href ? `<a href="${n.href}" role="menuitem">${n.rotulo}</a>` : `<button class="item" type="button" data-novo="${i}" role="menuitem">${n.rotulo}</button>`).join('');
  $$('[data-novo]').forEach((b) => b.addEventListener('click', () => { $('#menu-novo').hidden = true; limpos[Number(b.dataset.novo)].acao(); }));
}
$('#btn-novo').addEventListener('click', (e) => { e.stopPropagation(); $('#menu-avisos').hidden = true; $('#menu-novo').hidden = !$('#menu-novo').hidden; });
document.addEventListener('click', (e) => {
  if (!e.target.closest('.novo-wrap')) $('#menu-novo').hidden = true;
  if (!e.target.closest('#btn-avisos') && !e.target.closest('#menu-avisos')) $('#menu-avisos').hidden = true;
});

// ---------------------------------------------------------------------
// Avisos (sino) e contadores do menu — vêm do painel()
// ---------------------------------------------------------------------
export async function atualizarAvisos() {
  try { estado.painel = await rpc('painel'); } catch { return; }
  atualizarBadges();
}
function atualizarBadges() {
  const p = estado.painel || {};
  const nums = { aguardando_aprovacao: p.aguardando_aprovacao || 0, pagar_vencido: p.pagar?.vencido ? 1 : 0 };
  $$('[data-badge]').forEach((b) => {
    const n = nums[b.dataset.badge]; b.hidden = !n;
    b.textContent = b.dataset.badge === 'pagar_vencido' ? '!' : n;
  });
  $$('[data-badge-grupo]').forEach((b) => {
    const sub = b.closest('.menu-grupo').querySelector('.submenu');
    const total = $$('[data-badge]:not([hidden])', sub).length; b.hidden = !total; b.textContent = '•';
  });
  const avisos = [];
  if (p.aguardando_aprovacao) avisos.push(`<a href="#/vendas/aprovacoes" class="aviso"><b>${p.aguardando_aprovacao} venda(s) aguardando aprovação</b><br><small class="muted">Desconto acima do limite</small></a>`);
  if (p.pagar?.vencido) avisos.push(`<a href="#/financas/pagar" class="aviso"><b>Contas a pagar vencidas: ${fmtMoeda(p.pagar.vencido)}</b></a>`);
  if (p.pagar?.hoje) avisos.push(`<a href="#/financas/pagar" class="aviso"><b>Vence hoje: ${fmtMoeda(p.pagar.hoje)}</b><br><small class="muted">Contas a pagar</small></a>`);
  if (p.receber?.vencido) avisos.push(`<a href="#/financas/receber" class="aviso"><b>A receber em atraso: ${fmtMoeda(p.receber.vencido)}</b></a>`);
  if (p.estoque_baixo_qtd) avisos.push(`<a href="#/estoque" class="aviso"><b>${p.estoque_baixo_qtd} produto(s) com estoque baixo</b></a>`);
  (p.aniversariantes_hoje || []).forEach((c) => avisos.push(`<a href="#/clientes/${c.id}" class="aviso"><b>🎂 Aniversário: ${esc(c.nome)}</b>${c.telefone ? `<br><small class="muted">${fmtTelefone(c.telefone)}</small>` : ''}</a>`));
  $('#avisos-badge').hidden = !avisos.length;
  $('#avisos-badge').textContent = avisos.length;
  $('#menu-avisos').innerHTML = avisos.length ? avisos.join('<div class="sep"></div>') : '<p class="muted aviso">Nenhum aviso por enquanto.</p>';
}
$('#avisos-ico').innerHTML = icone('alerta');
$('#btn-avisos').addEventListener('click', (e) => { e.stopPropagation(); $('#menu-novo').hidden = true; $('#menu-avisos').hidden = !$('#menu-avisos').hidden; });

// ---------------------------------------------------------------------
// Tema claro/escuro (preferência de cada pessoa)
// ---------------------------------------------------------------------
function iconeTema() { $('#btn-tema').innerHTML = icone(document.documentElement.dataset.tema === 'escuro' ? 'sol' : 'lua'); }
$('#btn-tema').addEventListener('click', () => {
  const novo = document.documentElement.dataset.tema === 'escuro' ? 'claro' : 'escuro';
  try { localStorage.setItem('msc-modo', novo); } catch { /* ok */ }
  aplicarTema(); iconeTema();
});

// ---------------------------------------------------------------------
// Busca geral (Ctrl+K)
// ---------------------------------------------------------------------
const dlgBusca = $('#dlg-busca');
$('#busca-ico').innerHTML = icone('busca');
$('#busca-ico2').innerHTML = icone('busca');
function abrirBusca() { $('#busca-input').value = ''; $('#busca-resultados').innerHTML = '<p class="muted aviso pequeno" style="padding:10px 12px">Digite pelo menos 2 letras.</p>'; dlgBusca.showModal(); $('#busca-input').focus(); }
$('#btn-busca').addEventListener('click', abrirBusca);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && logado) { e.preventDefault(); abrirBusca(); }
});
dlgBusca.addEventListener('click', (e) => { if (e.target === dlgBusca) dlgBusca.close(); });
let tBusca; let selBusca = -1;
$('#busca-input').addEventListener('input', (e) => {
  clearTimeout(tBusca);
  tBusca = setTimeout(async () => {
    const termo = e.target.value;
    let r = [];
    try { r = await rpc('busca_geral', { p_termo: termo }); } catch (err) { $('#busca-resultados').innerHTML = `<p class="erro">${esc(msgErro(err))}</p>`; return; }
    if (termo !== $('#busca-input').value) return;
    const rot = { cliente: 'Cliente', produto: 'Produto', serie: 'IMEI', venda: 'Venda' };
    const link = (x) => ({ cliente: `#/clientes/${x.id}`, produto: `#/estoque/produto/${x.id}`, serie: `#/estoque/produto/${x.id}`, venda: `#/vendas/${x.id}` }[x.tipo]);
    selBusca = r.length ? 0 : -1;
    $('#busca-resultados').innerHTML = r.length ? r.map((x, i) => `<a href="${link(x)}" class="${i === 0 ? 'sel' : ''}">${'<span class="tag cinza">' + rot[x.tipo] + '</span>'}<span><b>${esc(x.titulo)}</b><small>${esc(x.sub || '')}</small></span></a>`).join('')
      : (termo.trim().length < 2 ? '' : '<p class="muted aviso" style="padding:10px 12px">Nada encontrado.</p>');
  }, 220);
});
$('#busca-input').addEventListener('keydown', (e) => {
  const itens = $$('#busca-resultados a');
  if (!itens.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    selBusca = (selBusca + (e.key === 'ArrowDown' ? 1 : -1) + itens.length) % itens.length;
    itens.forEach((a, i) => a.classList.toggle('sel', i === selBusca));
  } else if (e.key === 'Enter' && selBusca >= 0) { e.preventDefault(); location.hash = itens[selBusca].getAttribute('href'); dlgBusca.close(); }
});
$('#busca-resultados').addEventListener('click', (e) => { if (e.target.closest('a')) dlgBusca.close(); });

// ---------------------------------------------------------------------
// Barra inferior (celular)
// ---------------------------------------------------------------------
function montarBarraInferior() {
  const itens = [
    { href: '#/inicio', rot: 'Início', ico: 'inicio' },
    pode('clientes.ver') ? { href: '#/clientes', rot: 'Clientes', ico: 'clientes' } : null,
    pode('vendas.criar') ? { href: '#/vendas/nova', rot: 'Vender', ico: 'mais', meio: true } : null,
    pode('estoque.ver') ? { href: '#/estoque', rot: 'Estoque', ico: 'estoque' } : null,
    podeAlgum('financeiro.caixa', 'financeiro.ver') ? { href: '#/financas/caixa', rot: 'Caixa', ico: 'caixa' } : null,
  ].filter(Boolean);
  $('#barra-inferior').innerHTML = itens.map((i) => i.meio
    ? `<a href="${i.href}" class="meio"><span class="bola">${icone(i.ico)}</span><span style="color:var(--primary)">${i.rot}</span></a>`
    : `<a href="${i.href}">${icone(i.ico)}<span>${i.rot}</span></a>`).join('');
}

// ---------------------------------------------------------------------
// Marca (logo/nome)
// ---------------------------------------------------------------------
export function aplicarMarca() {
  const e = estado.empresa || {};
  const iniciais = (e.nome_fantasia || 'G').split(/\s+/).filter(Boolean).slice(0, 3).map((p) => p[0]).join('').toUpperCase();
  const logo = e.logo ? `<img src="${e.logo}" alt="">` : esc(iniciais);
  $('#marca-logo').innerHTML = logo;
  $('#marca-nome').textContent = e.nome_fantasia || '';
  aplicarTema(e);
  iconeTema();
  const fav = e.logo || `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='${e.cor_primaria || '#1d4ed8'}'/><text x='16' y='21' font-family='Arial' font-weight='700' font-size='11' fill='white' text-anchor='middle'>${iniciais}</text></svg>`)}`;
  $('#favicon').href = fav;
  try { localStorage.setItem('msc-marca', JSON.stringify({ nome_fantasia: e.nome_fantasia, cor_primaria: e.cor_primaria, cor_sidebar: e.cor_sidebar, modo_tema: e.modo_tema, logo: e.logo && e.logo.length < 150000 ? e.logo : null })); } catch { /* ok */ }
}
function marcaLogin() {
  let m = null;
  try { m = JSON.parse(localStorage.getItem('msc-marca') || 'null'); } catch { /* ok */ }
  if (!m) { aplicarTema({}); return; }
  aplicarTema(m);
  $('#login-nome').textContent = m.nome_fantasia || 'Gestão';
  $('#login-logo').innerHTML = m.logo ? `<img src="${m.logo}" alt="">` : esc((m.nome_fantasia || 'G').slice(0, 3).toUpperCase());
}

// ---------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------
function aviso(titulo, texto, sair = false) {
  $('#tela-login').hidden = true; $('#app').hidden = true;
  $('#tela-aviso').hidden = false;
  $('#aviso-titulo').textContent = titulo; $('#aviso-texto').textContent = texto; $('#btn-sair-aviso').hidden = !sair;
}

let carregando = false;
async function entrar(session) {
  if (!session) {
    logado = false; estado.perfil = null; estado.perms = new Set(); limparCache();
    marcaLogin();
    $('#tela-login').hidden = false; $('#app').hidden = true; $('#tela-aviso').hidden = true;
    return;
  }
  if (logado || carregando) return;
  carregando = true;
  try {
    const [perfil, perms, empresa] = await Promise.all([
      consulta(estado.sb.from('perfis').select('*').eq('user_id', session.user.id).maybeSingle()),
      rpc('minhas_permissoes'),
      consulta(estado.sb.from('empresa').select('*').eq('id', 1).maybeSingle()),
    ]);
    if (!perfil) return aviso('Sem acesso', 'Seu usuário ainda não foi liberado. Peça ao gerente.', true);
    if (!perfil.ativo) return aviso('Acesso bloqueado', 'Seu acesso está bloqueado. Fale com o gerente.', true);
    estado.perfil = perfil; estado.perms = new Set(perms || []); estado.empresa = empresa || {};
    aplicarMarca();
    $('#usuario-nome').textContent = perfil.nome;
    $('#usuario-cargo').textContent = { gerente: 'Gerente', vendedor: 'Vendedor', tecnico: 'Técnico' }[perfil.cargo] || perfil.cargo;
    $('#usuario-avatar').textContent = perfil.nome.split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
    montarMenu(); montarNovo(); montarBarraInferior();
    $('#tela-login').hidden = true; $('#tela-aviso').hidden = true; $('#app').hidden = false;
    logado = true;
    vigiarInatividade();
    atualizarAvisos();
    if (!estado.timerAvisos) estado.timerAvisos = setInterval(atualizarAvisos, 5 * 60 * 1000);
    if (!location.hash || location.hash === '#' || location.hash === '#/') location.hash = '#/inicio'; else render();
  } catch (err) {
    aviso('Não deu para entrar', msgErro(err), true);
  } finally { carregando = false; }
}

// Recarregar perfil/permissões/empresa depois que o gerente muda algo
export async function recarregarSessao() {
  const { data } = await estado.sb.auth.getSession();
  logado = false;
  await entrar(data.session);
}

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target; const btn = $('button[type=submit]', f);
  btn.disabled = true; $('#login-erro').hidden = true;
  const { error } = await estado.sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.senha.value });
  btn.disabled = false;
  if (error) { $('#login-erro').textContent = /invalid/i.test(error.message) ? 'E-mail ou senha incorretos.' : msgErro(error); $('#login-erro').hidden = false; }
  else f.senha.value = '';
});

// Sai sozinho quando o computador fica parado (tempo em Configurações › Empresa)
let ultimaAtividade = Date.now(); let vigia = null;
function marcarAtividade() {
  ultimaAtividade = Date.now();
  try { localStorage.setItem('msc-atividade', String(ultimaAtividade)); } catch { /* ok */ }
}
['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => document.addEventListener(ev, marcarAtividade, { passive: true }));
function vigiarInatividade() {
  marcarAtividade();
  if (vigia) return;
  vigia = setInterval(async () => {
    const min = Number(estado.empresa?.sessao_inatividade_min ?? 60);
    if (!logado || !min) return;
    let ultima = ultimaAtividade;
    try { ultima = Math.max(ultima, Number(localStorage.getItem('msc-atividade')) || 0); } catch { /* ok */ }
    if (Date.now() - ultima > min * 60000) {
      await sair();
      $('#login-erro').textContent = 'Você saiu automaticamente por ficar um tempo sem usar o sistema. Entre de novo.';
      $('#login-erro').hidden = false;
    }
  }, 30000);
}

async function sair() { await estado.sb.auth.signOut(); location.hash = ''; entrar(null); }
$('#btn-sair-aviso').addEventListener('click', sair);
$('#btn-usuario').addEventListener('click', async () => {
  const { abrirModal } = await import('./core.js');
  const r = await abrirModal({
    titulo: estado.perfil.nome, largura: 'sm', botao: 'Sair do sistema', botaoClasse: 'btn-danger', cancelar: 'Fechar',
    corpo: `<p class="muted">${esc(estado.perfil.email || '')}</p><p>Cargo: <b>${esc($('#usuario-cargo').textContent)}</b></p>`,
  });
  if (r) sair();
});

// ---------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------
async function iniciar() {
  marcaLogin();
  if (window.__SUPABASE_MOCK__) {
    estado.sb = window.__SUPABASE_MOCK__;
  } else {
    if (!/^https?:\/\//.test(SUPABASE_URL) || SUPABASE_ANON_KEY.startsWith('COLE')) {
      return aviso('Falta configurar', 'Abra o arquivo config.js e cole a URL e a chave pública do seu projeto Supabase.');
    }
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    estado.sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  estado.sb.auth.onAuthStateChange((evento, session) => {
    if (evento === 'SIGNED_OUT') entrar(null);
    else if (session && !logado) entrar(session);
  });
  const { data } = await estado.sb.auth.getSession();
  entrar(data.session);
}
iniciar();
