// =====================================================================
// Núcleo do front: conexão, permissões, formatação, máscaras, modais
// =====================================================================
export const estado = {
  sb: null,          // cliente Supabase
  perfil: null,      // { user_id, nome, cargo, ... }
  perms: new Set(),  // permissões da pessoa logada
  empresa: null,     // dados da loja (nome, cores, logo…)
  cache: {},         // listas pequenas (categorias, formas, contas)
};

export const pode = (p) => estado.perfil?.cargo === 'gerente' || estado.perms.has(p);
export const podeAlgum = (...ps) => ps.some(pode);

// ---------------------------------------------------------------------
// DOM e texto
// ---------------------------------------------------------------------
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
export const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => ((Math.random() * 16) | 0).toString(16)));

// ---------------------------------------------------------------------
// Formatação (pt-BR, fuso de São Paulo)
// ---------------------------------------------------------------------
const FMT_MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtMoeda = (c) => FMT_MOEDA.format(Number(c || 0) / 100);
export const fmtMoedaSinal = (c) => (Number(c) < 0 ? '− ' : '') + fmtMoeda(Math.abs(Number(c || 0)));
export const fmtNum = (n, casas = 0) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas || 3 });
export const fmtPct = (n) => `${Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
export const fmtData = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
export const fmtDataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '—');
export const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
export const diaSP = (iso) => (iso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso)) : '');
export function somarDias(iso, n) { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export function addMeses(iso, n) { const [a, m] = iso.split('-').map(Number); return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 10); }
export function ultimoDiaMes(iso) { const [a, m] = iso.split('-').map(Number); return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10); }
export const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export const nomeMes = (ym) => `${MESES[Number(ym.slice(5, 7)) - 1]} de ${ym.slice(0, 4)}`;

export function fmtTelefone(t) {
  const d = soDigitos(t);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}
export const fmtCep = (c) => { const d = soDigitos(c); return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : d; };
export function fmtCpf(c) { const d = soDigitos(c); return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : d; }
export const linkZap = (tel, msg = '') => `https://wa.me/55${soDigitos(tel)}${msg ? `?text=${encodeURIComponent(msg)}` : ''}`;
export function idade(nasc, ref = hojeSP()) {
  if (!nasc) return null;
  const [a, m, d] = nasc.split('-').map(Number); const [ra, rm, rd] = ref.split('-').map(Number);
  return ra - a - ((rm < m || (rm === m && rd < d)) ? 1 : 0);
}
export function validarCpf(cpf) {
  const d = soDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const dv = (n) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

// CNPJ numérico ou alfanumérico (regra da Receita a partir de 2026)
export const limparCnpj = (v) => String(v ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
export function validarCnpj(cnpj) {
  const v = limparCnpj(cnpj);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(v) || /^(.)\1{13}$/.test(v)) return false;
  const dv = (n, pesos) => { let s = 0; for (let i = 0; i < n; i++) s += (v.charCodeAt(i) - 48) * pesos[i]; const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return dv(12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(v[12]) && dv(13, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(v[13]);
}
export function fmtCnpj(c) { const v = limparCnpj(c); return v.length === 14 ? `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8, 12)}-${v.slice(12)}` : v; }
export const COMO_CONHECEU = { instagram: 'Instagram', whatsapp: 'WhatsApp', indicacao: 'Indicação', passou_na_frente: 'Passou na frente da loja', google: 'Google', trafego_pago: 'Anúncio (tráfego pago)', outro: 'Outro' };
export const FORMAS = { dinheiro: 'Dinheiro', pix: 'PIX', debito: 'Débito', credito: 'Crédito', boleto: 'Boleto', crediario: 'Crediário', outro: 'Outro', troca: 'Aparelho na troca', sinal: 'Sinal da reserva' };
export const CONDICOES = { novo: 'Novo', seminovo: 'Seminovo', usado: 'Usado', recondicionado: 'Recondicionado' };
export const CONDICOES_APARELHO = { lacrado: 'Lacrado', seminovo: 'Seminovo', usado: 'Usado' };
// Retrato do aparelho em uma linha: "Seminovo · grau A · bateria 89% · Azul · 128GB"
export function textoAparelho(d) {
  if (!d) return '';
  return [CONDICOES_APARELHO[d.condicao] || d.condicao, d.grau && `grau ${d.grau}`, d.bateria_pct != null && `bateria ${d.bateria_pct}%`,
    d.cor, d.capacidade, d.imei2 && `IMEI 2 ${d.imei2}`, d.pecas_trocadas && `peças trocadas: ${d.pecas_trocadas}`].filter(Boolean).join(' · ');
}
export const CARGOS = { gerente: 'Gerente', vendedor: 'Vendedor', tecnico: 'Técnico' };

// Dinheiro digitado → centavos ("1.234,56" ou "R$ 1.234,56" ou "1234.5")
export function lerMoeda(v) {
  if (typeof v === 'number') return Math.round(v * 100);
  let s = String(v ?? '').replace(/[^\d,.-]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');        // 1.234,56
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');   // 1.234.567
  else if (/\.\d{3}$/.test(s)) s = s.replace('.', '');                    // 1.234 = mil duzentos…
  return Math.round(Number(s) * 100) || 0;
}
export const lerNumero = (v) => Number(String(v ?? '').replace(/\./g, '').replace(',', '.')) || 0;

// ---------------------------------------------------------------------
// Máscaras (data-mascara="telefone|cep|cpf|dinheiro")
// ---------------------------------------------------------------------
export function aplicarMascara(input) {
  const tipo = input.dataset.mascara;
  const d = soDigitos(input.value);
  if (tipo === 'telefone') {
    const x = d.slice(0, 11);
    input.value = x.length <= 2 ? (x ? `(${x}` : '') : x.length <= 6 ? `(${x.slice(0, 2)}) ${x.slice(2)}`
      : x.length <= 10 ? `(${x.slice(0, 2)}) ${x.slice(2, 6)}-${x.slice(6)}` : `(${x.slice(0, 2)}) ${x.slice(2, 7)}-${x.slice(7)}`;
  } else if (tipo === 'cep') {
    const x = d.slice(0, 8); input.value = x.length > 5 ? `${x.slice(0, 5)}-${x.slice(5)}` : x;
  } else if (tipo === 'cpf') {
    const x = d.slice(0, 11);
    input.value = x.length > 9 ? `${x.slice(0, 3)}.${x.slice(3, 6)}.${x.slice(6, 9)}-${x.slice(9)}`
      : x.length > 6 ? `${x.slice(0, 3)}.${x.slice(3, 6)}.${x.slice(6)}` : x.length > 3 ? `${x.slice(0, 3)}.${x.slice(3)}` : x;
  } else if (tipo === 'dinheiro') {
    const x = d.replace(/^0+/, '').slice(0, 11); input.value = x ? fmtMoeda(Number(x)) : '';
  }
}
document.addEventListener('input', (e) => { if (e.target.matches?.('[data-mascara]')) aplicarMascara(e.target); });
export const valorDinheiro = (input) => Number(soDigitos(input.value) || 0);
export const setDinheiro = (input, c) => { input.value = c ? fmtMoeda(c) : ''; };

// ---------------------------------------------------------------------
// Erros e chamadas ao banco
// ---------------------------------------------------------------------
export function msgErro(error) {
  const m = `${error?.message || error || ''} ${error?.details || ''}`;
  if (/JWT|session|refresh token/i.test(m)) return 'Sua sessão expirou. Entre de novo.';
  if (/row-level security|permission denied|Sem permissão/i.test(m)) return error?.message?.startsWith('Sem permissão') ? error.message : 'Seu usuário não tem permissão para isso. Fale com o gerente.';
  if (/telefone_check/.test(m)) return 'Telefone inválido: use DDD + número (10 ou 11 dígitos).';
  if (/email_check/.test(m)) return 'E-mail inválido.';
  if (/cep_check/.test(m)) return 'CEP inválido: precisa ter 8 dígitos.';
  if (/cpf_check/.test(m)) return 'CPF inválido.';
  if (/categorias_tipo_nome_uk|duplicate key/.test(m)) return 'Já existe um cadastro com esse nome.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Sem conexão com o servidor. Verifique a internet.';
  return error?.message || 'Algo deu errado. Tente de novo.';
}
export async function rpc(fn, args = {}) {
  const { data, error } = await estado.sb.rpc(fn, args);
  if (error) throw error;
  return data;
}
export async function consulta(q) {
  const { data, error, count } = await q;
  if (error) throw error;
  return count !== undefined && count !== null ? { data, count } : data;
}
export async function buscarTudo(montar) {
  const todas = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await montar().range(de, de + 999);
    if (error) throw error;
    todas.push(...data);
    if (data.length < 1000) return todas;
  }
}

// Listas pequenas com cache (recarregar quando o gerente muda)
export async function lista(nome, recarregar = false) {
  if (estado.cache[nome] && !recarregar) return estado.cache[nome];
  const q = {
    categorias: () => estado.sb.from('categorias').select('*').order('ordem').order('nome'),
    formas: () => estado.sb.from('formas_pagamento').select('*').order('ordem'),
    contas: () => estado.sb.from('contas_financeiras').select('*').order('ordem').order('nome'),
    fornecedores: () => estado.sb.from('fornecedores').select('id,nome,telefone,ativo').order('nome'),
    perfis: () => estado.sb.from('perfis').select('user_id,nome,cargo,ativo').order('nome'),
    bandeiras: () => estado.sb.from('bandeiras').select('codigo,nome,ativo').eq('ativo', true).order('ordem'),
  }[nome];
  estado.cache[nome] = await consulta(q());
  return estado.cache[nome];
}
export const limparCache = (...nomes) => { (nomes.length ? nomes : Object.keys(estado.cache)).forEach((n) => delete estado.cache[n]); };

// ---------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------
let toastTimer;
export function toast(msg, tipo = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast ${tipo === 'erro' ? 'toast-erro' : ''}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, tipo === 'erro' ? 6000 : 3500);
}

// ---------------------------------------------------------------------
// Modal genérico
// abrirModal({ titulo, corpo, largura, botao, botaoClasse, aoAbrir(form), aoSalvar(form) → true fecha })
// ---------------------------------------------------------------------
export function abrirModal({ titulo, corpo, largura = 'md', botao = 'Salvar', botaoClasse = 'btn-primary', cancelar = 'Cancelar', aoAbrir, aoSalvar, semRodape = false }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = `modal modal-${largura}`;
    dlg.innerHTML = `
      <form method="dialog" novalidate>
        <header class="modal-topo"><h2>${titulo}</h2><button type="button" class="x" data-fechar aria-label="Fechar">×</button></header>
        <div class="modal-corpo">${corpo}</div>
        <p class="erro" data-erro hidden></p>
        ${semRodape ? '' : `<footer class="modal-rodape">
          ${cancelar ? `<button type="button" class="btn btn-ghost" data-fechar>${cancelar}</button>` : ''}
          ${botao ? `<button type="submit" class="btn ${botaoClasse}">${botao}</button>` : ''}
        </footer>`}
      </form>`;
    document.body.appendChild(dlg);
    const form = $('form', dlg);
    let resultado = null;
    const fechar = () => { dlg.close(); };
    dlg.addEventListener('close', () => { dlg.remove(); resolve(resultado); });
    $$('[data-fechar]', dlg).forEach((b) => b.addEventListener('click', fechar));
    form.erro = (m) => { const e = $('[data-erro]', dlg); e.textContent = m || ''; e.hidden = !m; };
    form.fechar = (r) => { resultado = r ?? true; fechar(); };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!aoSalvar) return form.fechar(true);
      const btn = $('button[type=submit]', dlg);
      if (btn) btn.disabled = true;
      form.erro('');
      try {
        const r = await aoSalvar(form);
        if (r !== false && r !== undefined) { resultado = r; fechar(); }
      } catch (err) { form.erro(msgErro(err)); }
      finally { if (btn) btn.disabled = false; }
    });
    dlg.showModal();
    aoAbrir?.(form, dlg);
    const primeiro = $('[autofocus]', dlg) || $('input:not([type=hidden]):not([disabled]), select, textarea', dlg);
    primeiro?.focus();
  });
}

// Confirmação com motivo obrigatório (cancelamentos, estornos…)
export function pedirMotivo({ titulo, texto = '', botao = 'Confirmar', placeholder = 'Ex.: lançado errado, cliente desistiu…' }) {
  return abrirModal({
    titulo, botao, botaoClasse: 'btn-danger', largura: 'sm',
    corpo: `${texto ? `<p class="muted">${texto}</p>` : ''}
      <label>Motivo *<input name="motivo" required placeholder="${esc(placeholder)}"></label>
      <p class="muted pequeno">O registro continua no histórico, marcado como cancelado.</p>`,
    aoSalvar: (f) => {
      const m = f.motivo.value.trim();
      if (m.length < 3) { f.erro('Escreva o motivo.'); return false; }
      return m;
    },
  });
}

export function confirmar({ titulo, texto, botao = 'Confirmar', perigo = false }) {
  return abrirModal({ titulo, corpo: `<p>${texto}</p>`, botao, botaoClasse: perigo ? 'btn-danger' : 'btn-primary', largura: 'sm' });
}

// ---------------------------------------------------------------------
// Pequenos blocos de interface
// ---------------------------------------------------------------------
export const vazio = (titulo, texto = '') => `<div class="vazio"><b>${titulo}</b>${texto}</div>`;
export const carregando = () => '<div class="vazio"><span class="girando"></span> Carregando…</div>';
export const tag = (txt, cls = '') => `<span class="tag ${cls}">${esc(txt)}</span>`;

export function cabecalho(titulo, { sub = '', acoes = '', resumo = '' } = {}) {
  return `<div class="pagina-topo">
      <div><h1>${titulo}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}</div>
      ${resumo ? `<div class="resumos">${resumo}</div>` : ''}
    </div>
    ${acoes ? `<div class="barra-acoes">${acoes}</div>` : ''}`;
}
export const resumoCard = (rotulo, valor, cls = '') => `<div class="resumo-card"><span>${rotulo}</span><b class="${cls}">${valor}</b></div>`;
export const kpi = (rotulo, valor, sub = '', cls = '') => `<div class="card kpi"><div class="rot">${rotulo}</div><div class="val ${cls}">${valor}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;

export function baixarCsv(nome, cab, linhas) {
  const cel = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [cab.map(cel).join(';'), ...linhas.map((l) => l.map(cel).join(';'))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export const csvMoeda = (c) => (Number(c || 0) / 100).toFixed(2).replace('.', ',');

// Abre uma janela para imprimir (recibo, termo…) com a marca da loja
export function imprimir(titulo, html) {
  const e = estado.empresa || {};
  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) { toast('Libere as janelas pop-up para imprimir.', 'erro'); return; }
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
    <style>
      *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px;font-size:13px}
      h1{font-size:18px;margin:0} h2{font-size:15px;margin:18px 0 6px} .topo{display:flex;gap:14px;align-items:center;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:12px}
      .topo img{max-height:56px;max-width:140px} .muted{color:#555} table{width:100%;border-collapse:collapse;margin:8px 0}
      th,td{border-bottom:1px solid #ccc;padding:6px 4px;text-align:left;vertical-align:top} th{font-size:11px;text-transform:uppercase;color:#444}
      .num{text-align:right;white-space:nowrap} .total{font-size:16px;font-weight:bold} .assin{margin-top:48px;display:flex;gap:40px}
      .assin div{flex:1;border-top:1px solid #111;padding-top:4px;text-align:center;font-size:12px} .caixa{border:1px solid #ccc;padding:8px 10px;border-radius:6px;margin:8px 0}
      @media print{body{margin:8mm} .nao-imprimir{display:none}}
    </style></head><body>
    <div class="topo">${e.logo ? `<img src="${e.logo}" alt="">` : ''}<div><h1>${esc(e.nome_fantasia || '')}</h1>
      <div class="muted">${[e.razao_social, e.cnpj ? `CNPJ ${e.cnpj}` : ''].filter(Boolean).map(esc).join(' · ')}</div>
      <div class="muted">${[[e.logradouro, e.numero].filter(Boolean).join(', '), e.bairro, [e.cidade, e.uf].filter(Boolean).join('/')].filter(Boolean).map(esc).join(' · ')}
      ${e.telefone ? ` · ${fmtTelefone(e.telefone)}` : ''}</div></div></div>
    ${html}
    <p class="nao-imprimir" style="margin-top:24px"><button onclick="print()">Imprimir / salvar em PDF</button></p>
    <script>setTimeout(()=>print(),300)<\/script></body></html>`);
  w.document.close();
}

// ---------------------------------------------------------------------
// Tema (cores da empresa) — gera tons a partir da cor primária
// ---------------------------------------------------------------------
function hexParaRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbParaHex(r, g, b) { return '#' + [r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join(''); }
const misturar = (a, b, t) => { const x = hexParaRgb(a), y = hexParaRgb(b); return rgbParaHex(...x.map((v, i) => v + (y[i] - v) * t)); };
function luminancia(h) { return hexParaRgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0); }
export const contraste = (a, b) => { const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };
export const textoSobre = (cor) => (contraste(cor, '#ffffff') >= contraste(cor, '#111827') ? '#ffffff' : '#111827');

export function aplicarTema(emp = estado.empresa) {
  const raiz = document.documentElement;
  const p = /^#[0-9a-f]{6}$/i.test(emp?.cor_primaria || '') ? emp.cor_primaria : '#1d4ed8';
  const sb = /^#[0-9a-f]{6}$/i.test(emp?.cor_sidebar || '') ? emp.cor_sidebar : '#ffffff';
  let modo = emp?.modo_tema || 'auto';
  try { modo = localStorage.getItem('msc-modo') || modo; } catch { /* sem armazenamento */ }
  const escuro = modo === 'escuro' || (modo === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  raiz.dataset.tema = escuro ? 'escuro' : 'claro';
  const s = raiz.style;
  s.setProperty('--primary', escuro ? misturar(p, '#ffffff', 0.18) : p);
  s.setProperty('--primary-fg', textoSobre(escuro ? misturar(p, '#ffffff', 0.18) : p));
  s.setProperty('--primary-hover', escuro ? misturar(p, '#ffffff', 0.3) : misturar(p, '#000000', 0.15));
  s.setProperty('--primary-soft', escuro ? misturar(p, '#0b1020', 0.78) : misturar(p, '#ffffff', 0.88));
  s.setProperty('--primary-50', escuro ? misturar(p, '#0b1020', 0.86) : misturar(p, '#ffffff', 0.94));
  const sbFundo = escuro && luminancia(sb) > 0.5 ? '#111827' : sb;
  s.setProperty('--sidebar-bg', sbFundo);
  s.setProperty('--sidebar-fg', textoSobre(sbFundo) === '#ffffff' ? '#e5e7eb' : '#1f2937');
  s.setProperty('--sidebar-muted', textoSobre(sbFundo) === '#ffffff' ? '#9ca3af' : '#6b7280');
  s.setProperty('--sidebar-hover', textoSobre(sbFundo) === '#ffffff' ? 'rgba(255,255,255,.07)' : misturar(p, '#ffffff', 0.92));
  s.setProperty('--sidebar-sub', textoSobre(sbFundo) === '#ffffff' ? 'rgba(255,255,255,.04)' : misturar(p, '#ffffff', 0.95));
  document.title = `${emp?.nome_fantasia || 'Gestão'}`;
}

// ---------------------------------------------------------------------
// Ícones (traço simples, estilo "line")
// ---------------------------------------------------------------------
const P = {
  inicio: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  clientes: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.4 3.3-5.5 6.5-5.5s5.9 2.1 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.6c2.6.2 4.4 2 5 5.4"/>',
  vendas: '<path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h9.7a1 1 0 0 0 1-.8L21 8H6"/><circle cx="9.5" cy="20" r="1.4"/><circle cx="17.5" cy="20" r="1.4"/>',
  estoque: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  financas: '<rect x="2.5" y="5.5" width="19" height="13" rx="2"/><path d="M2.5 10h19M6.5 15h4"/>',
  config: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  busca: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  mais: '<path d="M12 5v14M5 12h14"/>',
  seta: '<path d="m9 6 6 6-6 6"/>',
  baixo: '<path d="m6 9 6 6 6-6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  sair: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3"/>',
  bolo: '<path d="M4 21h16v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2zM4 16c2 1 4-1 4-1s2 2 4 0 4 1 4 1 2 2 4 0M12 11V7"/><path d="M12 4.5c.8-.8.8-1.7 0-2.5-.8.8-.8 1.7 0 2.5"/>',
  caixa: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2M3 12h18"/>',
  lua: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  alerta: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
  impressora: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  zap: '<path d="M3.5 20.5 5 16a8.5 8.5 0 1 1 3.2 3z"/><path d="M9 9.5c.3 2 2.5 4.3 4.6 4.6l1.4-1.3 2 1-.5 1.7c-3.6.4-8-4-7.6-7.6L10.6 7l1 2z"/>',
  recolher: '<path d="m15 18-6-6 6-6"/>',
  aparelho: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
  ferramenta: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
};
export const icone = (nome, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[nome] || ''}</svg>`;
