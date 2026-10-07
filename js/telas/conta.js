// Conta e equipe: minha conta, funcionários (criar / redefinir senha), textos e checklists,
// horário de funcionamento, LGPD (exportar / anonimizar cliente) e backup
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../config.js';
import {
  estado, pode, $, $$, esc, soDigitos, fmtData, fmtDataHora, fmtTelefone, hojeSP, abrirModal, confirmar, toast, msgErro, rpc, consulta,
  cabecalho, vazio, tag, icone, CARGOS, textoHorario, DIAS_SEMANA,
} from '../core.js';
import { atualizarAvisos } from '../main.js';

// =====================================================================
// SENHAS
// =====================================================================
const regraSenha = 'Mínimo de 8 caracteres. Misture letras e números.';
function validarSenha(s1, s2) {
  if (s1.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (!/[a-zA-Z]/.test(s1) || !/\d/.test(s1)) return 'Use letras e números na senha.';
  if (s1 !== s2) return 'As duas senhas não são iguais.';
  return '';
}
export function gerarSenha() {
  const L = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ'; const N = '23456789';
  const a = new Uint32Array(10); crypto.getRandomValues(a);
  let s = [...a].slice(0, 7).map((x) => L[x % L.length]).join('') + [...a].slice(7).map((x) => N[x % N.length]).join('');
  return s;
}

// Troca da própria senha (também usada quando o gerente marcou "trocar no próximo acesso")
export function trocarMinhaSenha({ obrigatoria = false } = {}) {
  return abrirModal({
    titulo: obrigatoria ? 'Crie sua senha' : 'Trocar minha senha', largura: 'sm', botao: 'Salvar senha', cancelar: obrigatoria ? null : 'Cancelar',
    corpo: `${obrigatoria ? '<p>O gerente definiu uma senha provisória para você. Crie agora a sua senha pessoal.</p>' : ''}
      <label>Nova senha<input type="password" name="s1" autocomplete="new-password" autofocus></label>
      <label>Repita a nova senha<input type="password" name="s2" autocomplete="new-password"></label>
      <p class="muted pequeno">${regraSenha}</p>`,
    aoAbrir: (f, dlg) => { if (obrigatoria) { dlg.addEventListener('cancel', (e) => e.preventDefault()); $('.x', dlg).hidden = true; } },
    aoSalvar: async (f) => {
      const m = validarSenha(f.s1.value, f.s2.value); if (m) { f.erro(m); return false; }
      const { error } = await estado.sb.auth.updateUser({ password: f.s1.value, data: { trocar_senha: false } });
      if (error) { f.erro(/different|same/i.test(error.message) ? 'Escolha uma senha diferente da atual.' : msgErro(error)); return false; }
      toast('Senha alterada');
      return true;
    },
  });
}

// Chama a função "equipe" (Supabase Edge Function) com a sessão do gerente
async function chamarEquipe(corpo) {
  const { data } = await estado.sb.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Sessão expirada. Entre de novo.');
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/functions/v1/equipe`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
    });
  } catch { throw new Error('Sem conexão com o servidor. Tente de novo.'); }
  let j = {}; try { j = await r.json(); } catch { /* sem corpo */ }
  if (r.status === 404 && !j.erro) throw new Error('A função "equipe" ainda não foi publicada no Supabase.');
  if (!r.ok && r.status !== 207) throw new Error(j.erro || `Erro ${r.status}`);
  if (r.status === 207) toast(j.erro, 'erro');
  return j;
}

export function novoFuncionario() {
  const sug = gerarSenha();
  return abrirModal({
    titulo: 'Novo funcionário', largura: 'sm', botao: 'Criar acesso',
    corpo: `<label>Nome *<input name="nome" autocomplete="off"></label>
      <label>E-mail (usado para entrar) *<input name="email" type="email" autocomplete="off"></label>
      <label>Telefone<input name="telefone" inputmode="tel" data-mascara="telefone"></label>
      <label>Cargo<select name="cargo">${Object.entries(CARGOS).map(([k, v]) => `<option value="${k}" ${k === 'vendedor' ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Senha provisória<div style="display:flex;gap:6px"><input name="senha" value="${sug}" autocomplete="off" style="margin:0"><button class="btn btn-ghost btn-sm" type="button" data-gerar>Outra</button></div></label>
      <label class="check"><input type="checkbox" name="trocar" checked> Pedir para a pessoa criar a própria senha no primeiro acesso</label>
      <p class="muted pequeno">Anote e entregue a senha para a pessoa. Depois ajuste comissão e meta clicando no nome dela na lista.</p>`,
    aoAbrir: (f) => { $('[data-gerar]', f).addEventListener('click', () => { f.senha.value = gerarSenha(); }); },
    aoSalvar: async (f) => {
      const d = { acao: 'criar', nome: f.nome.value.trim(), email: f.email.value.trim().toLowerCase(), telefone: soDigitos(f.telefone.value) || null,
        cargo: f.cargo.value, senha: f.senha.value, trocar_senha: f.trocar.checked };
      if (d.nome.length < 2) { f.erro('Informe o nome.'); return false; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) { f.erro('E-mail inválido.'); return false; }
      const m = validarSenha(d.senha, d.senha); if (m) { f.erro(m); return false; }
      const r = await chamarEquipe(d);
      await mostrarSenha(d.nome, d.email, d.senha);
      return r;
    },
  });
}

export function redefinirSenha(p) {
  const sug = gerarSenha();
  return abrirModal({
    titulo: `Nova senha para ${esc(p.nome)}`, largura: 'sm', botao: 'Redefinir senha',
    corpo: `<p class="muted pequeno">Use quando a pessoa esqueceu a senha. A senha antiga deixa de funcionar na hora.</p>
      <label>Senha provisória<div style="display:flex;gap:6px"><input name="senha" value="${sug}" autocomplete="off" style="margin:0"><button class="btn btn-ghost btn-sm" type="button" data-gerar>Outra</button></div></label>
      <label class="check"><input type="checkbox" name="trocar" checked> Pedir para criar a própria senha no próximo acesso</label>`,
    aoAbrir: (f) => { $('[data-gerar]', f).addEventListener('click', () => { f.senha.value = gerarSenha(); }); },
    aoSalvar: async (f) => {
      const m = validarSenha(f.senha.value, f.senha.value); if (m) { f.erro(m); return false; }
      await chamarEquipe({ acao: 'senha', user_id: p.user_id, senha: f.senha.value, trocar_senha: f.trocar.checked });
      await mostrarSenha(p.nome, p.email, f.senha.value);
      return true;
    },
  });
}

function mostrarSenha(nome, email, senha) {
  const texto = `Acesso ao sistema da ${estado.empresa?.nome_fantasia || 'loja'}\nEndereço: ${location.origin}\nE-mail: ${email}\nSenha provisória: ${senha}`;
  return abrirModal({
    titulo: 'Acesso pronto', largura: 'sm', botao: null, cancelar: 'Fechar',
    corpo: `<p>Entregue estes dados para <b>${esc(nome)}</b>:</p><pre class="caixa-senha" style="white-space:pre-wrap;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:10px;user-select:all">${esc(texto)}</pre>
      <button class="btn btn-ghost btn-sm" type="button" data-copiar>Copiar</button>`,
    aoAbrir: (f) => { $('[data-copiar]', f).addEventListener('click', async () => { try { await navigator.clipboard.writeText(texto); toast('Copiado'); } catch { toast('Selecione e copie o texto', 'erro'); } }); },
  });
}

// =====================================================================
// MINHA CONTA
// =====================================================================
export async function minhaConta(el, ctx) {
  const p = estado.perfil;
  el.innerHTML = `${cabecalho('Minha conta', { sub: 'Seus dados de acesso ao sistema.' })}
    <div class="grade-2" style="align-items:start">
      <div class="card card-pad"><form id="f-eu"><h3 style="margin-bottom:12px">Meus dados</h3>
        <label>Nome<input name="nome" value="${esc(p.nome)}"></label>
        <label>Telefone<input name="telefone" inputmode="tel" data-mascara="telefone" value="${esc(fmtTelefone(p.telefone) || '')}"></label>
        <p class="muted pequeno">E-mail de acesso: <b>${esc(p.email || '')}</b> · Cargo: <b>${esc(CARGOS[p.cargo] || p.cargo)}</b></p>
        <button class="btn btn-primary" type="submit">Salvar</button></form></div>
      <div class="card card-pad"><h3 style="margin-bottom:12px">Senha</h3>
        <p class="muted pequeno">Troque sua senha sempre que achar que alguém pode ter visto. ${regraSenha}</p>
        <button class="btn btn-ghost" type="button" id="b-senha">Trocar minha senha</button></div>
    </div>`;
  $('#f-eu', el).addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    try {
      await rpc('atualizar_meu_perfil', { p_nome: f.nome.value, p_telefone: f.telefone.value });
      estado.perfil = { ...p, nome: f.nome.value.trim(), telefone: soDigitos(f.telefone.value) || null };
      $('#usuario-nome').textContent = estado.perfil.nome;
      toast('Dados salvos');
    } catch (err) { toast(msgErro(err), 'erro'); }
  });
  $('#b-senha', el).addEventListener('click', () => trocarMinhaSenha());
}

// =====================================================================
// TEXTOS E CHECKLISTS
// =====================================================================
export async function textos(el, ctx, abasHtml) {
  const e = await consulta(estado.sb.from('empresa').select('*').eq('id', 1).single());
  if (!ctx.ativo()) return;
  const area = (nome, rot, dica, linhas = 3) => `<label class="col-2">${rot}${dica ? ` <span class="dica-campo muted">(${dica})</span>` : ''}<textarea name="${nome}" rows="${linhas}">${esc(e[nome] || '')}</textarea></label>`;
  const lista = (nome, rot) => `<label class="col-2">${rot} <span class="dica-campo muted">(um item por linha)</span><textarea name="${nome}" rows="6">${esc((e[nome] || []).join('\n'))}</textarea></label>`;
  el.innerHTML = `${abasHtml}${cabecalho('Textos e checklists', { sub: 'O que sai impresso para o cliente assinar e os itens que a equipe confere. As mensagens de WhatsApp ficam em CRM › Modelos de mensagem.',
    acoes: `<a class="btn btn-ghost" href="#/crm/modelos">${icone('zap')} Mensagens de WhatsApp</a>` })}
    <form id="f-txt" novalidate><div class="grade-2" style="align-items:start">
      <div class="card card-pad"><h3 style="margin-bottom:12px">Vendas</h3><div class="form-grade">
        ${area('texto_recibo', 'Rodapé do recibo', 'ex.: trocas em até 7 dias com a nota', 2)}
        ${area('texto_garantia', 'Termo de garantia dos produtos', 'impresso no termo de garantia e enviado no WhatsApp', 4)}
        ${area('texto_orcamento', 'Condições do orçamento', 'aparece no orçamento impresso', 3)}
        ${area('texto_reserva', 'Regras da reserva de aparelho', 'aparece no comprovante de reserva', 3)}
        ${area('texto_termo_compra', 'Declaração do termo de compra/troca de aparelho', 'o cliente assina', 4)}
      </div></div>
      <div class="card card-pad"><h3 style="margin-bottom:12px">Assistência e aparelhos</h3><div class="form-grade">
        ${area('texto_os_entrada', 'Termos do comprovante de entrada da OS', 'o cliente assina ao deixar o aparelho', 4)}
        ${area('texto_os_garantia', 'Garantia do serviço (entrega da OS)', 'o que a garantia cobre e não cobre', 3)}
        ${lista('checklist_os', 'Checklist de entrada da OS')}
        ${lista('checklist_aparelho', 'Checklist de teste dos aparelhos (seminovos)')}
      </div></div>
    </div>
    <p class="erro" id="erro-txt" hidden></p>
    <div class="barra-acoes" style="margin-top:16px"><button class="btn btn-primary btn-lg" type="submit">Salvar textos</button></div></form>`;
  $('#f-txt', el).addEventListener('submit', async (ev) => {
    ev.preventDefault(); const f = ev.target;
    const t = (n) => f[n].value.trim() || null;
    const l = (n) => [...new Set(f[n].value.split('\n').map((x) => x.trim()).filter(Boolean))];
    const dados = { texto_recibo: t('texto_recibo'), texto_garantia: t('texto_garantia'), texto_orcamento: t('texto_orcamento'),
      texto_reserva: t('texto_reserva') || 'O aparelho fica reservado até a data acima. Depois dessa data a loja pode liberar o aparelho para venda.',
      texto_termo_compra: t('texto_termo_compra'), texto_os_entrada: t('texto_os_entrada'),
      texto_os_garantia: t('texto_os_garantia') || 'Cobre o serviço e as peças trocadas. Não cobre queda, contato com líquido, mau uso ou violação por terceiros.',
      checklist_os: l('checklist_os'), checklist_aparelho: l('checklist_aparelho') };
    try { estado.empresa = await consulta(estado.sb.from('empresa').update(dados).eq('id', 1).select().single()); toast('Textos salvos'); }
    catch (err) { $('#erro-txt', el).textContent = msgErro(err); $('#erro-txt', el).hidden = false; }
  });
}

// =====================================================================
// HORÁRIO DE FUNCIONAMENTO
// =====================================================================
export async function horario(el, ctx, abasHtml) {
  const [e, st] = await Promise.all([consulta(estado.sb.from('empresa').select('*').eq('id', 1).single()), rpc('acesso_status')]);
  if (!ctx.ativo()) return;
  const h = e.horario || {};
  let feriados = [...(e.feriados || [])].sort();
  el.innerHTML = `${abasHtml}${cabecalho('Horário de funcionamento', { sub: 'Aparece nos comprovantes e pode limitar o acesso da equipe ao sistema fora do expediente.' })}
    <form id="f-hor" novalidate><div class="grade-2" style="align-items:start">
      <div class="card card-pad"><h3 style="margin-bottom:12px">Dias e horários</h3>
        <div class="tabela-wrap"><table class="tabela"><thead><tr><th>Dia</th><th>Abre</th><th>Fecha</th><th>Fechado</th></tr></thead><tbody>
        ${DIAS_SEMANA.map(([k, nome]) => { const d = h[k]; return `<tr><td><b>${nome}</b></td>
          <td><input type="time" data-abre="${k}" value="${esc(d?.abre || '09:00')}" style="margin:0" ${d ? '' : 'disabled'}></td>
          <td><input type="time" data-fecha="${k}" value="${esc(d?.fecha || '18:00')}" style="margin:0" ${d ? '' : 'disabled'}></td>
          <td><input type="checkbox" data-fechado="${k}" ${d ? '' : 'checked'}></td></tr>`; }).join('')}
        </tbody></table></div>
        <p class="muted pequeno" id="prev-hor" style="margin-top:8px"></p>
        <h3 style="margin:16px 0 8px">Feriados e dias sem expediente</h3>
        <div style="display:flex;gap:6px;align-items:center"><input type="date" id="novo-fer" min="${hojeSP().slice(0, 4)}-01-01" style="margin:0;width:auto"><button class="btn btn-ghost btn-sm" type="button" id="b-fer">Adicionar</button></div>
        <div id="lista-fer" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px"></div>
      </div>
      <div class="card card-pad"><h3 style="margin-bottom:12px">Acesso da equipe</h3>
        <label class="check"><input type="checkbox" name="restringir" ${e.restringir_horario ? 'checked' : ''}> Vendedores e técnicos só usam o sistema no horário de funcionamento</label>
        <label>Tolerância antes de abrir e depois de fechar (minutos)<input type="number" name="tol" min="0" max="240" value="${e.horario_tolerancia_min ?? 30}"></label>
        <p class="muted pequeno">O gerente sempre tem acesso. Fora do horário, a equipe vê um aviso e não consegue lançar nada.</p>
        <div class="separador"></div>
        <p>${st.liberado_ate ? `Acesso liberado fora do horário até <b>${fmtDataHora(st.liberado_ate)}</b>.` : 'Precisa que alguém trabalhe fora do horário hoje (inventário, evento)?'}</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${[2, 4, 8].map((n) => `<button class="btn btn-ghost btn-sm" type="button" data-liberar="${n}">Liberar por ${n}h</button>`).join('')}
          ${st.liberado_ate ? '<button class="btn btn-ghost btn-sm" type="button" data-liberar="0" style="color:var(--danger)">Encerrar liberação</button>' : ''}</div>
      </div>
    </div>
    <p class="erro" id="erro-hor" hidden></p>
    <div class="barra-acoes" style="margin-top:16px"><button class="btn btn-primary btn-lg" type="submit">Salvar horário</button></div></form>`;
  const f = $('#f-hor', el);
  const ler = () => Object.fromEntries(DIAS_SEMANA.map(([k]) => [k, $(`[data-fechado="${k}"]`, f).checked ? null : { abre: $(`[data-abre="${k}"]`, f).value, fecha: $(`[data-fecha="${k}"]`, f).value }]));
  const prev = () => { $('#prev-hor', el).textContent = `Nos comprovantes: ${textoHorario({ horario: ler() }) || 'sem horário'}`; };
  const pintarFer = () => {
    $('#lista-fer', el).innerHTML = feriados.length ? feriados.map((d) => `<span class="tag">${fmtData(d)} <button type="button" class="link-btn" data-tirar="${d}" aria-label="Tirar">×</button></span>`).join('') : '<span class="muted pequeno">Nenhum cadastrado.</span>';
    $$('[data-tirar]', el).forEach((b) => b.addEventListener('click', () => { feriados = feriados.filter((x) => x !== b.dataset.tirar); pintarFer(); }));
  };
  pintarFer(); prev();
  $$('[data-fechado]', f).forEach((c) => c.addEventListener('change', () => {
    const k = c.dataset.fechado; $(`[data-abre="${k}"]`, f).disabled = c.checked; $(`[data-fecha="${k}"]`, f).disabled = c.checked; prev();
  }));
  $$('input[type=time]', f).forEach((i) => i.addEventListener('input', prev));
  $('#b-fer', el).addEventListener('click', () => { const v = $('#novo-fer', el).value; if (v && !feriados.includes(v)) { feriados = [...feriados, v].sort(); pintarFer(); } });
  $$('[data-liberar]', el).forEach((b) => b.addEventListener('click', async () => {
    try { await rpc('liberar_acesso', { p_horas: Number(b.dataset.liberar) }); toast(Number(b.dataset.liberar) ? `Acesso liberado por ${b.dataset.liberar}h` : 'Liberação encerrada'); horario(el, ctx, abasHtml); } catch (err) { toast(msgErro(err), 'erro'); }
  }));
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const hor = ler();
    const ruim = Object.entries(hor).find(([, d]) => d && (!d.abre || !d.fecha || d.abre >= d.fecha));
    if (ruim) { $('#erro-hor', el).textContent = `Confira ${DIAS_SEMANA.find(([k]) => k === ruim[0])[1]}: o horário de fechar precisa ser depois do de abrir.`; $('#erro-hor', el).hidden = false; return; }
    if (f.restringir.checked && !Object.values(hor).some(Boolean)) { $('#erro-hor', el).textContent = 'Com a loja fechada todos os dias ninguém da equipe conseguiria entrar.'; $('#erro-hor', el).hidden = false; return; }
    $('#erro-hor', el).hidden = true;
    const dados = { horario: hor, feriados, restringir_horario: f.restringir.checked, horario_tolerancia_min: Math.min(240, Math.max(0, Number(f.tol.value) || 0)) };
    try { estado.empresa = await consulta(estado.sb.from('empresa').update(dados).eq('id', 1).select().single()); toast('Horário salvo'); }
    catch (err) { $('#erro-hor', el).textContent = msgErro(err); $('#erro-hor', el).hidden = false; }
  });
}

// =====================================================================
// DADOS: BACKUP E LGPD
// =====================================================================
export async function dados(el, ctx, abasHtml) {
  const [logs, lgpd] = await Promise.all([
    pode('backup.baixar') ? consulta(estado.sb.from('backups_log').select('*').order('feito_em', { ascending: false }).limit(10)) : [],
    pode('clientes.lgpd') ? consulta(estado.sb.from('lgpd_registros').select('*').order('feito_em', { ascending: false }).limit(30)) : [],
  ]);
  if (!ctx.ativo()) return;
  const perfis = Object.fromEntries((await consulta(estado.sb.from('perfis').select('user_id,nome'))).map((p) => [p.user_id, p.nome]));
  const cliIds = [...new Set(lgpd.map((x) => x.cliente_id))];
  const clis = cliIds.length ? Object.fromEntries((await consulta(estado.sb.from('clientes').select('id,nome').in('id', cliIds))).map((c) => [c.id, c.nome])) : {};
  const ult = estado.empresa?.ultimo_backup_em;
  const dias = ult ? Math.floor((Date.now() - new Date(ult).getTime()) / 86400000) : null;
  el.innerHTML = `${abasHtml}${cabecalho('Backup e LGPD', { sub: 'Cópia de segurança de todos os dados e registro do que foi feito com dados de clientes.' })}
    ${pode('backup.baixar') ? `<div class="card card-pad"><h3 style="margin-bottom:8px">Backup</h3>
      <p>${ult ? `Último backup: <b>${fmtDataHora(ult)}</b>${dias >= 7 ? ` ${tag(`há ${dias} dias`, 'danger')}` : ''}` : tag('Nenhum backup baixado ainda', 'warn')}</p>
      <p class="muted pequeno">Baixa um arquivo com todas as tabelas (clientes, vendas, estoque, finanças, OS…). Guarde em um lugar seguro, fora deste computador (Google Drive, pendrive). Recomendado: uma vez por semana. As senhas de aparelhos das OS nunca entram no backup.</p>
      <label class="check"><input type="checkbox" id="c-fotos"> Incluir as fotos (arquivo bem maior)</label>
      <div style="display:flex;gap:8px;align-items:center;margin-top:8px"><button class="btn btn-primary" type="button" id="b-backup">Baixar backup agora</button><span class="muted pequeno" id="prog-backup"></span></div>
      ${logs.length ? `<div class="tabela-wrap" style="margin-top:12px"><table class="tabela"><thead><tr><th>Quando</th><th>Por</th><th class="num">Tabelas</th><th class="num">Linhas</th></tr></thead><tbody>
        ${logs.map((b) => `<tr><td>${fmtDataHora(b.feito_em)}${b.com_fotos ? ' · com fotos' : ''}</td><td>${esc(perfis[b.feito_por] || '')}</td><td class="num">${b.tabelas}</td><td class="num">${b.linhas}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <p class="muted pequeno" style="margin-top:8px">O Supabase também guarda cópias automáticas do banco conforme o plano contratado. Este arquivo é a sua cópia, independente do fornecedor.</p></div>` : ''}
    ${pode('clientes.lgpd') ? `<div class="card" style="margin-top:16px"><div class="card-topo"><h3>LGPD — pedidos de clientes</h3></div>
      <p class="muted pequeno card-pad" style="margin:0">Para exportar os dados ou anonimizar um cliente, abra a ficha dele em Clientes e use os botões “Exportar dados” ou “Anonimizar”.</p>
      ${lgpd.length ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Quando</th><th>Cliente</th><th>O quê</th><th class="esconder-cel">Por</th></tr></thead><tbody>
        ${lgpd.map((r) => `<tr><td>${fmtDataHora(r.feito_em)}</td><td><a href="#/clientes/${r.cliente_id}">${esc(clis[r.cliente_id] || '—')}</a></td>
          <td>${r.tipo === 'anonimizacao' ? tag('Anonimizado', 'cinza') : tag('Dados exportados', '')}${r.motivo ? `<div class="muted pequeno">${esc(r.motivo)}</div>` : ''}</td><td class="esconder-cel">${esc(perfis[r.feito_por] || '')}</td></tr>`).join('')}
      </tbody></table></div>` : vazio('Nenhum pedido registrado', '')}</div>` : ''}`;
  $('#b-backup', el)?.addEventListener('click', async (ev) => {
    const b = ev.target; b.disabled = true;
    try { await baixarBackup($('#c-fotos', el).checked, (t) => { $('#prog-backup', el).textContent = t; }); toast('Backup baixado'); atualizarAvisos(); dados(el, ctx, abasHtml); }
    catch (err) { toast(msgErro(err), 'erro'); $('#prog-backup', el).textContent = ''; } finally { b.disabled = false; }
  });
}

async function baixarBackup(fotos, progresso) {
  const tabs = (await rpc('backup_tabelas')).filter((t) => fotos || !/fotos$/.test(t.tabela));
  const saida = { sistema: 'MSC', gerado_em: new Date().toISOString(), loja: estado.empresa?.nome_fantasia || '', versao: 1, tabelas: {} };
  let linhas = 0;
  for (const [i, t] of tabs.entries()) {
    const rows = [];
    const lote = /fotos$/.test(t.tabela) ? 50 : 1000;
    for (let off = 0; off < t.linhas; off += lote) {
      progresso(`${i + 1}/${tabs.length} · ${t.tabela} (${Math.min(off + lote, t.linhas)}/${t.linhas})`);
      rows.push(...await rpc('backup_lote', { p_tabela: t.tabela, p_offset: off, p_limite: lote }));
    }
    saida.tabelas[t.tabela] = rows; linhas += rows.length;
  }
  progresso('Gerando arquivo…');
  const blob = new Blob([JSON.stringify(saida)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `backup-${(estado.empresa?.nome_fantasia || 'loja').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${hojeSP()}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  await rpc('backup_registrar', { p_tabelas: tabs.length, p_linhas: linhas, p_fotos: fotos });
  estado.empresa = { ...estado.empresa, ultimo_backup_em: new Date().toISOString() };
  progresso(`${tabs.length} tabelas, ${linhas} linhas.`);
}

// ---------------------------------------------------------------------
// LGPD na ficha do cliente
// ---------------------------------------------------------------------
export async function exportarCliente(cli) {
  const d = await rpc('cliente_exportar', { p_cliente: cli.id });
  const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `dados-${cli.nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')}-${hojeSP()}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Arquivo com os dados do cliente baixado');
}

export async function anonimizarCliente(cli) {
  const ok = await confirmar({ titulo: `Anonimizar ${esc(cli.nome)}?`, perigo: true, botao: 'Continuar',
    texto: 'Apaga nome, telefone, e-mail, CPF/CNPJ, endereço, nascimento e observações. As vendas, OS e o financeiro continuam no sistema, mas sem identificar a pessoa (o extrato das contas mantém a descrição original, como registro contábil). NÃO dá para desfazer. Exporte os dados antes se o cliente pediu uma cópia.' });
  if (!ok) return false;
  return abrirModal({
    titulo: 'Confirmar anonimização', largura: 'sm', botao: 'Anonimizar agora', botaoClasse: 'btn-danger',
    corpo: `<label>Motivo / pedido do titular *<input name="motivo" placeholder="Ex.: pedido por WhatsApp em ${fmtData(hojeSP())}" autofocus></label>
      <label>Digite ANONIMIZAR para confirmar<input name="conf" autocomplete="off"></label>`,
    aoSalvar: async (f) => {
      if (f.conf.value.trim().toUpperCase() !== 'ANONIMIZAR') { f.erro('Digite ANONIMIZAR para confirmar.'); return false; }
      await rpc('anonimizar_cliente', { p_cliente: cli.id, p_motivo: f.motivo.value });
      toast('Cliente anonimizado');
      return true;
    },
  });
}
