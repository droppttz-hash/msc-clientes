// Configurações: empresa e aparência, usuários, permissões, categorias, pagamentos/contas e histórico
import {
  estado, pode, $, $$, esc, soDigitos, fmtMoeda, fmtData, fmtDataHora, fmtTelefone, fmtCep, hojeSP, abrirModal, confirmar, toast, msgErro,
  consulta, lista as listaCache, limparCache, cabecalho, vazio, carregando, tag, icone, valorDinheiro, aplicarTema, textoSobre, contraste, CARGOS, lerNumero,
} from '../core.js';
import { aplicarMarca, recarregarSessao } from '../main.js';
import * as conta from './conta.js';

const SECOES = [
  ['empresa', 'Empresa e aparência', 'config.gerenciar'],
  ['usuarios', 'Usuários', 'config.gerenciar'],
  ['permissoes', 'Permissões', 'config.gerenciar'],
  ['categorias', 'Categorias', 'config.gerenciar'],
  ['pagamentos', 'Pagamentos e contas', 'config.gerenciar'],
  ['textos', 'Textos e checklists', 'config.gerenciar'],
  ['horario', 'Horário', 'config.gerenciar'],
  ['dados', 'Backup e LGPD', 'backup.baixar'],
  ['auditoria', 'Histórico', 'auditoria.ver'],
];
const abas = (atual) => `<nav class="abas-pagina">${SECOES.filter(([, , p]) => pode(p)).map(([id, r]) => `<a href="#/config/${id}" class="${id === atual ? 'ativa' : ''}">${r}</a>`).join('')}</nav>`;

export async function tela(el, ctx) {
  const secao = ctx.params[0];
  const sec = SECOES.find(([id]) => id === secao);
  if (!sec || !pode(sec[2])) { el.innerHTML = vazio('Sem acesso', 'Seu usuário não pode abrir esta tela.'); return; }
  const extra = { textos: (e, c) => conta.textos(e, c, abas('textos')), horario: (e, c) => conta.horario(e, c, abas('horario')), dados: (e, c) => conta.dados(e, c, abas('dados')) };
  await ({ empresa, usuarios, permissoes, categorias, pagamentos, auditoria, ...extra })[secao](el, ctx);
}

// =====================================================================
// EMPRESA E APARÊNCIA
// =====================================================================
async function empresa(el, ctx) {
  const e = await consulta(estado.sb.from('empresa').select('*').eq('id', 1).single());
  if (!ctx.ativo()) return;
  const campo = (nome, rot, extra = '', cls = '') => `<label class="${cls}">${rot}<input name="${nome}" value="${esc(e[nome])}" ${extra}></label>`;
  el.innerHTML = `${abas('empresa')}${cabecalho('Empresa e aparência', { sub: 'Dados que aparecem no recibo, no sistema e na tela de login. Para usar com outro cliente, basta mudar aqui.' })}
    <form id="f-emp" novalidate>
    <div class="grade-2" style="align-items:start">
      <div class="card card-pad"><h3 style="margin-bottom:12px">Dados da empresa</h3><div class="form-grade">
        ${campo('nome_fantasia', 'Nome fantasia *', 'required', 'col-2')}
        ${campo('razao_social', 'Razão social', '', 'col-2')}
        ${campo('cnpj', 'CNPJ', 'inputmode="numeric" placeholder="só números"')}
        <label>Regime tributário<select name="regime_tributario"><option value="">—</option>${[['mei', 'MEI'], ['simples', 'Simples Nacional'], ['presumido', 'Lucro Presumido'], ['real', 'Lucro Real']].map(([v, r]) => `<option value="${v}" ${e.regime_tributario === v ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
        ${campo('ie', 'Inscrição estadual')}${campo('im', 'Inscrição municipal')}
        ${campo('telefone', 'Telefone', 'inputmode="tel"')}${campo('whatsapp', 'WhatsApp', 'inputmode="tel"')}
        ${campo('email', 'E-mail', 'type="email"')}${campo('instagram', 'Instagram', 'placeholder="@sualoja"')}
        ${campo('cep', 'CEP', 'inputmode="numeric" maxlength="9"')}${campo('logradouro', 'Rua')}
        ${campo('numero', 'Número')}${campo('complemento', 'Complemento')}
        ${campo('bairro', 'Bairro')}${campo('cidade', 'Cidade')}
        ${campo('uf', 'UF', 'maxlength="2" style="text-transform:uppercase"')}${campo('site', 'Site')}
      </div></div>
      <div>
        <div class="card card-pad"><h3 style="margin-bottom:12px">Logo e cores</h3>
          <div style="display:flex;gap:14px;align-items:center;margin-bottom:12px">
            <div class="logo-quadro" id="logo-prev" style="width:72px;height:72px;border-radius:14px;border:1px solid var(--line);display:grid;place-items:center;overflow:hidden;background:var(--surface)">${e.logo ? `<img src="${e.logo}" alt="" style="max-width:100%;max-height:100%">` : '<span class="muted pequeno">sem logo</span>'}</div>
            <div><label class="btn btn-ghost btn-sm" style="cursor:pointer">Enviar logo<input type="file" id="logo-arq" accept="image/*" hidden></label>
              <button class="btn btn-ghost btn-sm" type="button" id="logo-tirar" ${e.logo ? '' : 'hidden'}>Remover</button>
              <p class="muted pequeno" style="margin-top:6px">PNG ou JPG, de preferência quadrado. Reduzimos automaticamente.</p></div>
          </div>
          <div class="form-grade">
            <label>Cor principal<input type="color" name="cor_primaria" value="${e.cor_primaria}"></label>
            <label>Cor do menu lateral<input type="color" name="cor_sidebar" value="${e.cor_sidebar}"></label>
            <label class="col-2">Tema<select name="modo_tema">${[['auto', 'Automático (segue o aparelho)'], ['claro', 'Sempre claro'], ['escuro', 'Sempre escuro']].map(([v, r]) => `<option value="${v}" ${e.modo_tema === v ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
          </div>
          <p class="pequeno" id="aviso-contraste"></p>
          <div style="margin-top:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button type="button" class="btn btn-primary btn-sm">Botão principal</button><span class="tag">Etiqueta</span><a href="#" onclick="return false">Link</a></div>
        </div>
        <div class="card card-pad" style="margin-top:16px"><h3 style="margin-bottom:12px">Regras da loja</h3><div class="form-grade">
          <label>Desconto máximo sem aprovação (%)<input name="desconto_max_pct" inputmode="decimal" value="${String(e.desconto_max_pct).replace('.', ',')}"></label>
          <label>Garantia padrão (dias)<input name="garantia_padrao_dias" type="number" min="0" max="3650" value="${e.garantia_padrao_dias}"></label>
          <label>Alerta de cliente sem comprar (dias)<input name="dias_alerta_sem_compra" type="number" min="1" value="${e.dias_alerta_sem_compra}"></label>
          <label>Alerta de aparelho parado (dias)<input name="dias_alerta_aparelho_parado" type="number" min="1" max="3650" value="${e.dias_alerta_aparelho_parado ?? 60}"></label>
          <label>Garantia do serviço de OS (dias)<input name="garantia_os_dias" type="number" min="0" max="3650" value="${e.garantia_os_dias ?? 90}"></label>
          <label>OS sem retirada vira "abandonada" após (dias)<input name="dias_abandono_os" type="number" min="7" max="3650" value="${e.dias_abandono_os ?? 90}"></label>
          <label>Reserva: segurar aparelho por (dias)<input name="reserva_dias_padrao" type="number" min="1" max="90" value="${e.reserva_dias_padrao ?? 7}"></label>
          <label>Orçamento válido por (dias)<input name="orcamento_validade_dias" type="number" min="1" max="90" value="${e.orcamento_validade_dias ?? 7}"></label>
          <label>Sair sozinho após (minutos parado)<input name="sessao_inatividade_min" type="number" min="0" max="1440" value="${e.sessao_inatividade_min ?? 60}"></label>
          <p class="muted pequeno col-2" style="margin-top:-6px">Encerra a sessão do computador que ficar sem uso. Use 0 para nunca sair sozinho.</p>
          <label class="check col-2"><input type="checkbox" name="permitir_estoque_negativo" ${e.permitir_estoque_negativo ? 'checked' : ''}> Permitir vender sem estoque (estoque fica negativo)</label>
          <p class="muted pequeno col-2">Textos impressos e checklists ficam em <a href="#/config/textos">Textos e checklists</a>; horário da loja em <a href="#/config/horario">Horário</a>.</p>
        </div></div>
      </div>
    </div>
    <p class="erro" id="erro-emp" hidden></p>
    <div class="barra-acoes" style="margin-top:16px"><button class="btn btn-primary btn-lg" type="submit">Salvar alterações</button><button class="btn btn-ghost" type="button" id="b-desfazer">Desfazer</button></div>
    </form>`;
  const f = $('#f-emp', el);
  let logo = e.logo || null;
  let ibge = e.ibge || null;
  const previa = () => {
    const tema = { ...e, cor_primaria: f.cor_primaria.value, cor_sidebar: f.cor_sidebar.value, modo_tema: f.modo_tema.value };
    aplicarTema(tema);
    const c = contraste(f.cor_primaria.value, textoSobre(f.cor_primaria.value));
    $('#aviso-contraste', el).innerHTML = c < 4.5 ? `<span class="neg">Contraste baixo (${c.toFixed(1)}:1) — o texto dos botões pode ficar difícil de ler.</span>` : '<span class="muted">Contraste bom para leitura.</span>';
  };
  ['cor_primaria', 'cor_sidebar', 'modo_tema'].forEach((n) => f[n].addEventListener('input', previa));
  f.modo_tema.addEventListener('change', previa);
  previa();
  f.cep.addEventListener('input', async () => {
    const d = soDigitos(f.cep.value);
    if (d.length !== 8) return;
    try {
      const r = await (await fetch(`https://viacep.com.br/ws/${d}/json/`)).json();
      if (r.erro) return;
      ibge = /^\d{7}$/.test(r.ibge || '') ? r.ibge : ibge;
      f.logradouro.value = r.logradouro || f.logradouro.value; f.bairro.value = r.bairro || f.bairro.value; f.cidade.value = r.localidade || f.cidade.value; f.uf.value = r.uf || f.uf.value;
    } catch { /* sem internet: preenche à mão */ }
  });
  $('#logo-arq', el).addEventListener('change', async (ev) => {
    const arq = ev.target.files[0]; if (!arq) return;
    try {
      logo = await reduzirImagem(arq, 256);
      $('#logo-prev', el).innerHTML = `<img src="${logo}" alt="" style="max-width:100%;max-height:100%">`;
      $('#logo-tirar', el).hidden = false;
    } catch { toast('Não deu para ler essa imagem.', 'erro'); }
  });
  $('#logo-tirar', el).addEventListener('click', () => { logo = null; $('#logo-prev', el).innerHTML = '<span class="muted pequeno">sem logo</span>'; $('#logo-tirar', el).hidden = true; });
  $('#b-desfazer', el).addEventListener('click', () => { aplicarTema(estado.empresa); empresa(el, ctx); });
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const erro = (m) => { $('#erro-emp', el).textContent = m || ''; $('#erro-emp', el).hidden = !m; };
    erro('');
    const v = (n) => f[n].value.trim() || null;
    const cnpj = soDigitos(f.cnpj.value) || null;
    if (!v('nome_fantasia') || v('nome_fantasia').length < 2) return erro('Informe o nome fantasia.');
    if (cnpj && cnpj.length !== 14) return erro('CNPJ precisa ter 14 números.');
    const desc = lerNumero(f.desconto_max_pct.value);
    if (desc < 0 || desc > 100) return erro('Desconto máximo entre 0 e 100%.');
    const dados = {
      nome_fantasia: v('nome_fantasia'), razao_social: v('razao_social'), cnpj, regime_tributario: f.regime_tributario.value || null, ie: v('ie'), im: v('im'),
      telefone: soDigitos(f.telefone.value) || null, whatsapp: soDigitos(f.whatsapp.value) || null, email: v('email'), instagram: v('instagram'), site: v('site'),
      cep: soDigitos(f.cep.value) || null, logradouro: v('logradouro'), numero: v('numero'), complemento: v('complemento'), bairro: v('bairro'), cidade: v('cidade'),
      uf: (v('uf') || '').toUpperCase() || null, logo, cor_primaria: f.cor_primaria.value, cor_sidebar: f.cor_sidebar.value, modo_tema: f.modo_tema.value,
      desconto_max_pct: desc, garantia_padrao_dias: Number(f.garantia_padrao_dias.value) || 0, dias_alerta_sem_compra: Number(f.dias_alerta_sem_compra.value) || 90,
      dias_alerta_aparelho_parado: Math.max(1, Number(f.dias_alerta_aparelho_parado.value) || 60),
      garantia_os_dias: Math.min(3650, Math.max(0, Number(f.garantia_os_dias.value) || 0)),
      dias_abandono_os: Math.min(3650, Math.max(7, Number(f.dias_abandono_os.value) || 90)),
      reserva_dias_padrao: Math.min(90, Math.max(1, Number(f.reserva_dias_padrao.value) || 7)),
      orcamento_validade_dias: Math.min(90, Math.max(1, Number(f.orcamento_validade_dias.value) || 7)),
      sessao_inatividade_min: Math.min(1440, Math.max(0, Number(f.sessao_inatividade_min.value) || 0)), ibge,
      permitir_estoque_negativo: f.permitir_estoque_negativo.checked,
    };
    const btn = $('button[type=submit]', f); btn.disabled = true;
    try {
      const novo = await consulta(estado.sb.from('empresa').update(dados).eq('id', 1).select().single());
      estado.empresa = novo; aplicarMarca();
      toast('Dados da empresa salvos');
    } catch (err) { erro(msgErro(err)); } finally { btn.disabled = false; }
  });
}

function reduzirImagem(arq, max) {
  return new Promise((ok, falha) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      let url = c.toDataURL('image/webp', 0.9);
      if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/png');
      ok(url);
    };
    img.onerror = falha;
    img.src = URL.createObjectURL(arq);
  });
}

// =====================================================================
// USUÁRIOS
// =====================================================================
async function usuarios(el, ctx) {
  const ps = await consulta(estado.sb.from('perfis').select('*').order('ativo', { ascending: false }).order('nome'));
  if (!ctx.ativo()) return;
  el.innerHTML = `${abas('usuarios')}${cabecalho('Usuários', { sub: 'Quem pode entrar no sistema e com qual cargo. Clique no nome para mudar cargo, comissão, bloquear ou redefinir a senha.',
    acoes: `<button class="btn btn-primary" type="button" id="b-novo-func">${icone('mais')} Novo funcionário</button>` })}
    <div class="card"><div class="tabela-wrap"><table class="tabela"><thead><tr><th>Nome</th><th class="esconder-cel">E-mail</th><th>Cargo</th><th class="num esconder-cel">Meta mensal</th><th>Situação</th></tr></thead><tbody>
      ${ps.map((p) => `<tr class="clicavel" data-id="${p.user_id}"><td><b>${esc(p.nome)}</b>${p.user_id === estado.perfil.user_id ? ' <small class="muted">(você)</small>' : ''}<div class="muted pequeno">${fmtTelefone(p.telefone) || ''}</div></td>
        <td class="esconder-cel">${esc(p.email || '')}</td><td>${tag(CARGOS[p.cargo] || p.cargo, p.cargo === 'gerente' ? '' : 'cinza')}</td>
        <td class="num esconder-cel">${p.meta_mensal_centavos ? fmtMoeda(p.meta_mensal_centavos) : '—'}</td><td>${p.ativo ? tag('Ativo', 'ok') : tag('Bloqueado', 'danger')}</td></tr>`).join('')}
    </tbody></table></div></div>`;
  $('#b-novo-func', el).addEventListener('click', async () => { if (await conta.novoFuncionario()) { limparCache('perfis'); usuarios(el, ctx); } });
  $$('tr[data-id]', el).forEach((tr) => tr.addEventListener('click', async () => {
    const p = ps.find((x) => x.user_id === tr.dataset.id);
    const eu = p.user_id === estado.perfil.user_id;
    const ok = await abrirModal({
      titulo: `Editar ${esc(p.nome)}`, largura: 'sm',
      corpo: `<label>Nome *<input name="nome" value="${esc(p.nome)}"></label>
        <label>Telefone<input name="telefone" inputmode="tel" value="${esc(fmtTelefone(p.telefone) || '')}"></label>
        <label>Cargo<select name="cargo">${Object.entries(CARGOS).map(([k, v]) => `<option value="${k}" ${p.cargo === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <p class="muted pequeno" data-cargo-txt></p>
        <label>Meta de vendas por mês<input name="meta" data-mascara="dinheiro" inputmode="numeric" value="${p.meta_mensal_centavos ? fmtMoeda(p.meta_mensal_centavos) : ''}"></label>
        <div class="form-grade"><label>Comissão sobre vendas (%)<input name="cv" inputmode="decimal" value="${String(Number(p.comissao_venda_pct || 0)).replace('.', ',')}"></label>
          <label>Comissão sobre mão de obra das OS (%)<input name="co" inputmode="decimal" value="${String(Number(p.comissao_os_pct || 0)).replace('.', ',')}"></label></div>
        <p class="muted pequeno">A comissão é só uma sugestão: você confere, ajusta e fecha o mês em Comissões.</p>
        <label class="check"><input type="checkbox" name="ativo" ${p.ativo ? 'checked' : ''} ${eu ? 'disabled' : ''}> Pode entrar no sistema</label>
        ${eu ? '<p class="muted pequeno">Você não pode bloquear o próprio acesso. Para trocar sua senha use Minha conta.</p>' : '<button class="btn btn-ghost btn-sm" type="button" data-senha>Redefinir senha</button>'}`,
      aoAbrir: (f) => {
        const upd = () => { $('[data-cargo-txt]', f).textContent = { gerente: 'Gerente pode tudo, inclusive configurações.', vendedor: 'Vendedor: o que estiver marcado em Permissões › Vendedor.', tecnico: 'Técnico: o que estiver marcado em Permissões › Técnico.' }[f.cargo.value]; };
        f.cargo.addEventListener('change', upd); upd();
        $('[data-senha]', f)?.addEventListener('click', () => conta.redefinirSenha(p));
      },
      aoSalvar: async (f) => {
        if (f.nome.value.trim().length < 2) { f.erro('Informe o nome.'); return false; }
        const tel = soDigitos(f.telefone.value);
        if (tel && (tel.length < 10 || tel.length > 11)) { f.erro('Telefone com DDD (10 ou 11 números).'); return false; }
        if (eu && f.cargo.value !== 'gerente' && !(await confirmar({ titulo: 'Tirar seu próprio acesso de gerente?', texto: 'Você deixará de ver as configurações. Só outro gerente poderá desfazer.', botao: 'Sim, mudar', perigo: true }))) return false;
        const cv = lerNumero(f.cv.value); const co = lerNumero(f.co.value);
        if (cv < 0 || cv > 100 || co < 0 || co > 100) { f.erro('Comissão entre 0 e 100%.'); return false; }
        await consulta(estado.sb.from('perfis').update({ nome: f.nome.value.trim(), telefone: tel || null, cargo: f.cargo.value, meta_mensal_centavos: valorDinheiro(f.meta) || null,
          comissao_venda_pct: cv, comissao_os_pct: co,
          ativo: eu ? true : f.ativo.checked }).eq('user_id', p.user_id).select('user_id'));
        return true;
      },
    });
    if (!ok) return;
    toast('Usuário atualizado'); limparCache('perfis');
    if (eu) { await recarregarSessao(); return; }
    usuarios(el, ctx);
  }));
}

// =====================================================================
// PERMISSÕES (matriz cargo × ação)
// =====================================================================
async function permissoes(el, ctx) {
  const [cat, pc] = await Promise.all([
    consulta(estado.sb.from('permissoes_catalogo').select('*').order('ordem')),
    consulta(estado.sb.from('permissoes_cargo').select('*')),
  ]);
  if (!ctx.ativo()) return;
  const tem = (cargo, chave) => pc.find((x) => x.cargo === cargo && x.permissao === chave)?.permitido;
  const grupos = [...new Set(cat.map((c) => c.modulo))];
  el.innerHTML = `${abas('permissoes')}${cabecalho('Permissões', { sub: 'Marque o que cada cargo pode fazer. O gerente sempre pode tudo. Vale na hora para todos.' })}
    <div class="card"><div class="tabela-wrap"><table class="tabela matriz"><thead><tr><th>Ação</th><th>Vendedor</th><th>Técnico</th><th>Gerente</th></tr></thead><tbody>
      ${grupos.map((g) => `<tr><td colspan="4" style="background:var(--bg);font-weight:700">${esc(g)}</td></tr>
        ${cat.filter((c) => c.modulo === g).map((c) => `<tr><td>${esc(c.descricao)}</td>
          ${['vendedor', 'tecnico'].map((cg) => `<td><input type="checkbox" aria-label="${esc(c.descricao)} — ${CARGOS[cg]}" data-cargo="${cg}" data-chave="${c.chave}" ${tem(cg, c.chave) ? 'checked' : ''} ${c.chave === 'config.gerenciar' ? 'disabled title="Só gerente"' : ''}></td>`).join('')}
          <td><input type="checkbox" checked disabled></td></tr>`).join('')}`).join('')}
    </tbody></table></div></div>`;
  $$('input[data-cargo]', el).forEach((cb) => cb.addEventListener('change', async () => {
    cb.disabled = true;
    try {
      const r = await consulta(estado.sb.from('permissoes_cargo').update({ permitido: cb.checked }).eq('cargo', cb.dataset.cargo).eq('permissao', cb.dataset.chave).select('permissao'));
      if (!r.length) throw new Error('Permissão não encontrada no banco.');
      toast(`${CARGOS[cb.dataset.cargo]}: ${cb.checked ? 'liberado' : 'bloqueado'}`);
    } catch (err) { cb.checked = !cb.checked; toast(msgErro(err), 'erro'); } finally { cb.disabled = false; }
  }));
}

// =====================================================================
// CATEGORIAS
// =====================================================================
let catTipo = 'venda';
async function categorias(el, ctx) {
  const cats = await listaCache('categorias', true);
  if (!ctx.ativo()) return;
  const TIPOS = { venda: 'De produtos (vendas)', despesa: 'De despesas', receita: 'De receitas' };
  const AREAS = { aparelhos: 'Aparelhos', acessorios: 'Acessórios', informatica: 'Informática', assistencia: 'Assistência técnica', outros: 'Outros' };
  const l = cats.filter((c) => c.tipo === catTipo);
  el.innerHTML = `${abas('categorias')}${cabecalho('Categorias', { sub: 'Organizam produtos, despesas e receitas nos relatórios.', acoes: `<button class="btn btn-primary" id="b-nova" type="button">${icone('mais')} Nova categoria</button>` })}
    <div class="abas-pagina" style="border:0">${Object.entries(TIPOS).map(([k, v]) => `<button type="button" data-tipo="${k}" class="${k === catTipo ? 'ativa' : ''}">${v}</button>`).join('')}</div>
    <div class="card">${l.length ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Nome</th>${catTipo === 'venda' ? '<th>Área</th>' : ''}<th class="num">Ordem</th><th>Situação</th></tr></thead><tbody>
      ${l.map((c) => `<tr class="clicavel" data-id="${c.id}"><td>${esc(c.nome)}${c.sistema ? ' ' + tag('usada pelo sistema', 'cinza') : ''}</td>${catTipo === 'venda' ? `<td>${esc(AREAS[c.area] || '—')}</td>` : ''}<td class="num">${c.ordem}</td><td>${c.ativo ? tag('Ativa', 'ok') : tag('Inativa', 'cinza')}</td></tr>`).join('')}
    </tbody></table></div>` : vazio('Nenhuma categoria')}</div>`;
  $$('[data-tipo]', el).forEach((b) => b.addEventListener('click', () => { catTipo = b.dataset.tipo; categorias(el, ctx); }));
  const form = async (c) => {
    const ok = await abrirModal({
      titulo: c ? 'Editar categoria' : 'Nova categoria', largura: 'sm',
      aoAbrir: (f) => f.tipo.addEventListener('change', () => { $('[data-area]', f).hidden = f.tipo.value !== 'venda'; }),
      corpo: `<label>Nome *<input name="nome" value="${esc(c?.nome)}"></label>
        <label>Tipo<select name="tipo" ${c ? 'disabled' : ''}>${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}" ${(c?.tipo || catTipo) === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label data-area ${(c?.tipo || catTipo) === 'venda' ? '' : 'hidden'}>Área da loja (para o DRE por área)<select name="area">${Object.entries(AREAS).map(([k, v]) => `<option value="${k}" ${(c?.area || 'outros') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Ordem na lista<input name="ordem" type="number" value="${c?.ordem ?? 50}"></label>
        ${c && !c.sistema ? `<label class="check"><input type="checkbox" name="ativo" ${c.ativo ? 'checked' : ''}> Ativa</label>` : ''}
        ${c?.sistema ? '<p class="muted pequeno">Esta categoria é usada automaticamente pelo sistema e não pode ser desativada.</p>' : ''}`,
      aoSalvar: async (f) => {
        if (f.nome.value.trim().length < 2) { f.erro('Informe o nome.'); return false; }
        const d = { nome: f.nome.value.trim(), ordem: Number(f.ordem.value) || 0 };
        if ((c?.tipo || f.tipo.value) === 'venda') d.area = f.area.value;
        if (c) { if (f.ativo) d.ativo = f.ativo.checked; await consulta(estado.sb.from('categorias').update(d).eq('id', c.id).select('id')); }
        else await consulta(estado.sb.from('categorias').insert({ ...d, tipo: f.tipo.value }).select('id'));
        return true;
      },
    });
    if (ok) { limparCache('categorias'); toast('Categoria salva'); categorias(el, ctx); }
  };
  $('#b-nova', el).addEventListener('click', () => form(null));
  $$('tr[data-id]', el).forEach((tr) => tr.addEventListener('click', () => form(cats.find((c) => c.id === tr.dataset.id))));
}

// =====================================================================
// PAGAMENTOS E CONTAS
// =====================================================================
const TIPO_CONTA = { caixa: 'Caixa (gaveta)', banco: 'Banco', maquininha: 'Maquininha', carteira: 'Carteira digital', outro: 'Outro' };
async function pagamentos(el, ctx) {
  const [formas, taxas, contas, saldos, bands, btaxas] = await Promise.all([
    listaCache('formas', true), consulta(estado.sb.from('credito_taxas').select('*').order('parcelas')), listaCache('contas', true),
    consulta(estado.sb.from('saldos_contas').select('id,saldo_centavos')),
    consulta(estado.sb.from('bandeiras').select('*').order('ordem')), consulta(estado.sb.from('bandeira_taxas').select('*')),
  ]);
  if (!ctx.ativo()) return;
  const saldoDe = (id) => saldos.find((s) => s.id === id)?.saldo_centavos ?? 0;
  const nomeConta = (id) => contas.find((c) => c.id === id)?.nome || '—';
  const pct = (n) => `${String(Number(n)).replace('.', ',')}%`;
  el.innerHTML = `${abas('pagamentos')}${cabecalho('Pagamentos e contas', { sub: 'Taxas da maquininha, prazo de repasse e as contas onde o dinheiro fica.' })}
    <div class="card"><div class="card-topo"><h3>Formas de pagamento</h3></div>
      <div class="tabela-wrap"><table class="tabela"><thead><tr><th>Forma</th><th>Cai na conta</th><th class="num">Taxa</th><th class="num">Repasse</th><th class="esconder-cel">Baixa</th><th>Situação</th></tr></thead><tbody>
      ${formas.filter((x) => !x.interna).map((x) => `<tr class="clicavel" data-forma="${x.forma}"><td><b>${esc(x.nome)}</b></td><td>${esc(nomeConta(x.conta_id))}</td>
        <td class="num">${x.forma === 'credito' ? 'por parcela' : pct(x.taxa_pct)}</td><td class="num">${x.dias_repasse ? `D+${x.dias_repasse}` : 'na hora'}</td>
        <td class="esconder-cel">${x.forma === 'crediario' ? 'manual' : x.baixa_automatica ? 'automática' : 'manual'}${x.antecipar ? ' · antecipa' : ''}</td><td>${x.ativo ? tag('Ativa', 'ok') : tag('Inativa', 'cinza')}</td></tr>`).join('')}
      </tbody></table></div></div>
    <div class="grade-2" style="margin-top:16px;align-items:start">
      <div class="card"><div class="card-topo"><h3>Taxas do cartão de crédito</h3><button class="btn btn-ghost btn-sm" type="button" id="b-taxas">Editar taxas</button></div>
        <div class="tabela-wrap"><table class="tabela"><thead><tr><th>Parcelas</th><th class="num">Taxa total</th></tr></thead><tbody>
        ${taxas.map((t) => `<tr><td>${t.parcelas}x</td><td class="num">${pct(t.taxa_pct)}</td></tr>`).join('')}</tbody></table></div>
        ${taxas.every((t) => !Number(t.taxa_pct)) ? '<p class="neg pequeno" style="padding:0 14px 14px">As taxas ainda estão zeradas: confira no app da sua maquininha e preencha para o lucro ficar certo.</p>' : ''}</div>
      <div class="card"><div class="card-topo"><h3>Taxas por bandeira</h3><button class="btn btn-ghost btn-sm" type="button" id="b-bandeiras">Editar</button></div>
        <p class="muted pequeno card-pad" style="padding-top:0">Se a maquininha cobra diferente por bandeira (ex.: Elo e Amex mais caros), cadastre aqui. Em branco = usa a taxa padrão acima. O vendedor escolhe a bandeira no pagamento.</p>
        ${btaxas.length ? `<div class="tabela-wrap"><table class="tabela"><tbody>${bands.filter((b) => btaxas.some((t) => t.bandeira === b.codigo)).map((b) => `<tr><td><b>${esc(b.nome)}</b></td><td class="pequeno">${btaxas.filter((t) => t.bandeira === b.codigo).sort((x, y) => (x.forma > y.forma ? -1 : 1) || x.parcelas - y.parcelas).map((t) => `${t.forma === 'debito' ? 'débito' : `${t.parcelas}x`} ${pct(t.taxa_pct)}`).join(' · ')}</td></tr>`).join('')}</tbody></table></div>` : ''}</div>
      <div class="card"><div class="card-topo"><h3>Contas (onde o dinheiro fica)</h3><button class="btn btn-ghost btn-sm" type="button" id="b-conta">${icone('mais')} Nova conta</button></div>
        <div class="tabela-wrap"><table class="tabela"><tbody>
        ${contas.map((c) => `<tr class="clicavel" data-conta="${c.id}"><td><b>${esc(c.nome)}</b><div class="muted pequeno">${TIPO_CONTA[c.tipo]}${c.ativo ? '' : ' · inativa'}</div></td><td class="num">${fmtMoeda(saldoDe(c.id))}</td></tr>`).join('')}
        </tbody></table></div></div>
    </div>`;

  $$('tr[data-forma]', el).forEach((tr) => tr.addEventListener('click', async () => {
    const x = formas.find((y) => y.forma === tr.dataset.forma);
    const ok = await abrirModal({
      titulo: `Forma: ${esc(x.nome)}`, largura: 'sm',
      corpo: `<label>Nome que aparece<input name="nome" value="${esc(x.nome)}"></label>
        <label>Dinheiro cai na conta<select name="conta"><option value="">—</option>${contas.filter((c) => c.ativo).map((c) => `<option value="${c.id}" ${c.id === x.conta_id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></label>
        ${x.forma === 'credito' ? '<p class="muted pequeno">A taxa do crédito é por número de parcelas (quadro ao lado).</p>' : `<label>Taxa cobrada (%)<input name="taxa" inputmode="decimal" value="${String(Number(x.taxa_pct)).replace('.', ',')}"></label>`}
        <label>Dias para o dinheiro cair (repasse)<input name="dias" type="number" min="0" max="365" value="${x.dias_repasse}"></label>
        ${x.forma === 'crediario' ? '' : `<label class="check"><input type="checkbox" name="auto" ${x.baixa_automatica ? 'checked' : ''}> Dar baixa sozinho no dia previsto</label>`}
        ${x.forma === 'credito' ? `<label class="check"><input type="checkbox" name="antecipar" ${x.antecipar ? 'checked' : ''}> Recebo tudo de uma vez (antecipação automática)</label>` : ''}
        <label class="check"><input type="checkbox" name="ativo" ${x.ativo ? 'checked' : ''}> Aparece no caixa/vendas</label>`,
      aoSalvar: async (f) => {
        const taxa = f.taxa ? lerNumero(f.taxa.value) : Number(x.taxa_pct);
        if (taxa < 0 || taxa > 100) { f.erro('Taxa entre 0 e 100%.'); return false; }
        const d = { nome: f.nome.value.trim() || x.nome, conta_id: f.conta.value || null, taxa_pct: taxa, dias_repasse: Number(f.dias.value) || 0, ativo: f.ativo.checked };
        if (f.auto) d.baixa_automatica = f.auto.checked;
        if (f.antecipar) d.antecipar = f.antecipar.checked;
        await consulta(estado.sb.from('formas_pagamento').update(d).eq('forma', x.forma).select('forma'));
        return true;
      },
    });
    if (ok) { limparCache('formas'); toast('Forma de pagamento salva'); pagamentos(el, ctx); }
  }));

  $('#b-taxas', el).addEventListener('click', async () => {
    const ok = await abrirModal({
      titulo: 'Taxas do crédito por parcelas', largura: 'sm',
      corpo: `<p class="muted pequeno">Taxa total cobrada pela maquininha em cada opção de parcelamento (inclua a antecipação, se houver).</p>
        <div class="form-grade">${Array.from({ length: 12 }, (_, i) => { const t = taxas.find((y) => y.parcelas === i + 1); return `<label>${i + 1}x (%)<input name="p${i + 1}" inputmode="decimal" value="${t ? String(Number(t.taxa_pct)).replace('.', ',') : '0'}"></label>`; }).join('')}</div>`,
      aoSalvar: async (f) => {
        for (let i = 1; i <= 12; i++) {
          const v = lerNumero(f[`p${i}`].value);
          if (v < 0 || v > 100) { f.erro(`Taxa de ${i}x inválida.`); return false; }
        }
        for (let i = 1; i <= 12; i++) {
          const v = lerNumero(f[`p${i}`].value);
          const t = taxas.find((y) => y.parcelas === i);
          if (t && Number(t.taxa_pct) === v) continue;
          if (t) await consulta(estado.sb.from('credito_taxas').update({ taxa_pct: v }).eq('parcelas', i).select('parcelas'));
          else await consulta(estado.sb.from('credito_taxas').insert({ parcelas: i, taxa_pct: v }).select('parcelas'));
        }
        return true;
      },
    });
    if (ok) { toast('Taxas salvas'); pagamentos(el, ctx); }
  });

  $('#b-bandeiras', el).addEventListener('click', async () => {
    const val = (b, forma, n) => { const t = btaxas.find((x) => x.bandeira === b && x.forma === forma && x.parcelas === n); return t ? String(Number(t.taxa_pct)).replace('.', ',') : ''; };
    const ok = await abrirModal({
      titulo: 'Taxas por bandeira', largura: 'lg',
      corpo: `<p class="muted pequeno">Deixe em branco para usar a taxa padrão. Valores em %.</p>
        <div class="tabela-wrap"><table class="tabela"><thead><tr><th>Bandeira</th><th>Débito</th>${Array.from({ length: 12 }, (_, i) => `<th>${i + 1}x</th>`).join('')}</tr></thead><tbody>
        ${bands.filter((b) => b.ativo).map((b) => `<tr><td><b>${esc(b.nome)}</b></td><td><input data-b="${b.codigo}" data-f="debito" data-n="1" value="${val(b.codigo, 'debito', 1)}" inputmode="decimal" style="width:62px;margin:0"></td>
          ${Array.from({ length: 12 }, (_, i) => `<td><input data-b="${b.codigo}" data-f="credito" data-n="${i + 1}" value="${val(b.codigo, 'credito', i + 1)}" inputmode="decimal" style="width:62px;margin:0"></td>`).join('')}</tr>`).join('')}
        </tbody></table></div>`,
      aoSalvar: async (f) => {
        const ins = []; const del = [];
        for (const inp of $$('input[data-b]', f)) {
          const k = { bandeira: inp.dataset.b, forma: inp.dataset.f, parcelas: Number(inp.dataset.n) };
          if (inp.value.trim() === '') { if (btaxas.some((t) => t.bandeira === k.bandeira && t.forma === k.forma && t.parcelas === k.parcelas)) del.push(k); continue; }
          const v = lerNumero(inp.value);
          if (v < 0 || v > 100) { f.erro('Taxa entre 0 e 100%.'); return false; }
          ins.push({ ...k, taxa_pct: v });
        }
        for (const k of del) await consulta(estado.sb.from('bandeira_taxas').delete().eq('bandeira', k.bandeira).eq('forma', k.forma).eq('parcelas', k.parcelas));
        if (ins.length) await consulta(estado.sb.from('bandeira_taxas').upsert(ins).select('bandeira'));
        return true;
      },
    });
    if (ok) { limparCache('bandeiras'); toast('Taxas por bandeira salvas'); pagamentos(el, ctx); }
  });

  const formConta = async (c) => {
    const ok = await abrirModal({
      titulo: c ? 'Editar conta' : 'Nova conta', largura: 'sm',
      corpo: `<label>Nome *<input name="nome" value="${esc(c?.nome)}" placeholder="Ex.: Nubank, Caixa 2…"></label>
        <label>Tipo<select name="tipo" ${c?.sistema ? 'disabled' : ''}>${Object.entries(TIPO_CONTA).map(([k, v]) => `<option value="${k}" ${c?.tipo === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <div class="form-grade"><label>Saldo inicial<input name="saldo" data-mascara="dinheiro" inputmode="numeric" value="${c?.saldo_inicial_centavos ? fmtMoeda(c.saldo_inicial_centavos) : ''}"></label>
        <label>Em<input name="data" type="date" value="${c?.saldo_inicial_data || hojeSP()}"></label></div>
        <p class="muted pequeno">Saldo que a conta tinha antes de começar a usar o sistema. Ex.: quanto havia no banco no dia.</p>
        ${c && !c.sistema ? `<label class="check"><input type="checkbox" name="ativo" ${c.ativo ? 'checked' : ''}> Ativa</label>` : ''}`,
      aoSalvar: async (f) => {
        if (f.nome.value.trim().length < 2) { f.erro('Informe o nome.'); return false; }
        const d = { nome: f.nome.value.trim(), saldo_inicial_centavos: valorDinheiro(f.saldo), saldo_inicial_data: f.data.value || hojeSP() };
        if (!c?.sistema) d.tipo = f.tipo.value;
        if (f.ativo) d.ativo = f.ativo.checked;
        if (c) await consulta(estado.sb.from('contas_financeiras').update(d).eq('id', c.id).select('id'));
        else await consulta(estado.sb.from('contas_financeiras').insert(d).select('id'));
        return true;
      },
    });
    if (ok) { limparCache('contas'); toast('Conta salva'); pagamentos(el, ctx); }
  };
  $('#b-conta', el).addEventListener('click', () => formConta(null));
  $$('tr[data-conta]', el).forEach((tr) => tr.addEventListener('click', () => formConta(contas.find((c) => c.id === tr.dataset.conta))));
}

// =====================================================================
// HISTÓRICO DE ALTERAÇÕES (auditoria)
// =====================================================================
const TABELAS = {
  clientes: 'Clientes', vendas: 'Vendas', devolucoes: 'Devoluções', produtos: 'Produtos', entradas: 'Entradas de mercadoria', titulos: 'Contas a pagar/receber',
  baixas: 'Pagamentos/recebimentos', recorrencias: 'Despesas fixas', contas_financeiras: 'Contas', formas_pagamento: 'Formas de pagamento', categorias: 'Categorias',
  perfis: 'Usuários', permissoes_cargo: 'Permissões', empresa: 'Empresa', acesso: 'Acesso fora do horário', leads: 'Interessados (CRM)', lista_espera: 'Lista de espera', fornecedores: 'Fornecedores', compras: 'Compras (antigo)', lancamentos: 'Caixa (antigo)',
};
const IGNORAR = new Set(['atualizado_em', 'criado_em', 'logo']);
const audF = { tabela: '', de: '' };
async function auditoria(el, ctx) {
  const perfis = await listaCache('perfis');
  if (!ctx.ativo()) return;
  el.innerHTML = `${abas('auditoria')}${cabecalho('Histórico de alterações', { sub: 'Quem criou ou mudou o quê, e quando. Nada é apagado do sistema.' })}
    <div class="card"><div class="ferramentas">
      <select id="f-tab"><option value="">Tudo</option>${Object.entries(TABELAS).map(([k, v]) => `<option value="${k}" ${audF.tabela === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <input type="date" id="f-de" value="${audF.de}" title="A partir de">
    </div><div id="lista">${carregando()}</div><div class="rodape-tabela"><button class="btn btn-ghost btn-sm" id="b-mais" type="button" hidden>Carregar mais</button></div></div>`;
  const nome = (id) => perfis.find((p) => p.user_id === id)?.nome || (id ? 'usuário removido' : 'sistema');
  let pagina = 0; let itens = [];
  const ESPECIAIS = { CRIAR_USUARIO: 'Criou o acesso de', REDEFINIR_SENHA: 'Redefiniu a senha de', LIBERAR: 'Liberou o acesso fora do horário', BLOQUEAR: 'Encerrou a liberação de acesso fora do horário' };
  const resumo = (a) => {
    if (ESPECIAIS[a.acao]) return `${ESPECIAIS[a.acao]} ${a.registro_texto && a.tabela === 'perfis' ? `<b>${esc(a.registro_texto)}</b>` : ''}${a.depois?.ate ? ` até ${fmtDataHora(a.depois.ate)}` : ''}`;
    if (a.depois?.anonimizado) return '<span class="muted">dados anonimizados (LGPD)</span>';
    if (a.acao === 'INSERT') {
      const d = a.depois || {};
      return `Criou ${esc(d.nome || d.descricao || (d.numero ? `nº ${d.numero}` : '') || d.permissao || '')}`;
    }
    const mud = Object.keys(a.depois || {}).filter((k) => !IGNORAR.has(k) && JSON.stringify(a.antes?.[k]) !== JSON.stringify(a.depois?.[k]));
    if (!mud.length) return '<span class="muted">sem mudança visível</span>';
    const val = (v) => (v === null || v === undefined || v === '' ? '<i class="muted">vazio</i>' : esc(typeof v === 'object' ? JSON.stringify(v) : String(v)).slice(0, 80));
    const tit = esc(a.depois?.nome || a.depois?.descricao || (a.depois?.numero ? `nº ${a.depois.numero}` : '') || a.depois?.permissao || '');
    return `${tit ? `<b>${tit}</b>: ` : ''}${mud.slice(0, 6).map((k) => `${esc(k.replace(/_/g, ' '))} ${val(a.antes?.[k])} → ${val(a.depois?.[k])}`).join('; ')}${mud.length > 6 ? ` <span class="muted">(+${mud.length - 6})</span>` : ''}`;
  };
  const carregar = async (mais = false) => {
    if (!mais) { pagina = 0; itens = []; }
    let q = estado.sb.from('auditoria').select('*').order('quando', { ascending: false }).range(pagina * 100, pagina * 100 + 99);
    if (audF.tabela) q = q.eq('tabela', audF.tabela);
    if (audF.de) q = q.gte('quando', `${audF.de}T00:00:00-03:00`);
    let r;
    try { r = await consulta(q); } catch (err) { $('#lista', el).innerHTML = vazio('Erro', esc(msgErro(err))); return; }
    if (!ctx.ativo()) return;
    itens.push(...r); pagina++;
    $('#lista', el).innerHTML = itens.length ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Quando</th><th>Quem</th><th class="esconder-cel">Onde</th><th>O que mudou</th></tr></thead><tbody>
      ${itens.map((a) => `<tr><td style="white-space:nowrap">${fmtDataHora(a.quando)}</td><td>${esc(nome(a.usuario_id))}</td><td class="esconder-cel">${esc(TABELAS[a.tabela] || a.tabela)}</td><td class="pequeno">${resumo(a)}</td></tr>`).join('')}
    </tbody></table></div>` : vazio('Nada registrado', '');
    $('#b-mais', el).hidden = r.length < 100;
  };
  $('#f-tab', el).addEventListener('change', (e) => { audF.tabela = e.target.value; carregar(); });
  $('#f-de', el).addEventListener('change', (e) => { audF.de = e.target.value; carregar(); });
  $('#b-mais', el).addEventListener('click', () => carregar(true));
  carregar();
}
