// Clientes: lista, ficha, cadastro, aniversariantes
import {
  estado, pode, $, $$, esc, soDigitos, fmtMoeda, fmtData, fmtTelefone, fmtCep, fmtCpf, linkZap, idade, hojeSP, validarCpf,
  abrirModal, toast, msgErro, consulta, buscarTudo, baixarCsv, csvMoeda, cabecalho, vazio, carregando, tag, MESES, kpi, icone, rpc, pedirMotivo,
} from '../core.js';

const PAGINA = 50;
const est = { termo: '', inativos: false, carregados: 0 };

function filtroBusca(termo) {
  const t = termo.replace(/[,()"*%\\]/g, ' ').trim();
  if (!t) return null;
  const partes = [`nome.ilike."%${t}%"`, `email.ilike."%${t}%"`];
  const d = soDigitos(t);
  if (d.length >= 3) { partes.push(`telefone.ilike."%${d}%"`); partes.push(`cpf.ilike."%${d}%"`); }
  return partes.join(',');
}

// ---------------------------------------------------------------------
// LISTA
// ---------------------------------------------------------------------
export async function lista(el, ctx) {
  const valores = pode('clientes.ver_valores');
  el.innerHTML = `
    ${cabecalho('Clientes', { sub: 'Busque, cadastre e acompanhe o histórico de cada cliente.' })}
    <div class="card">
      <div class="ferramentas">
        <input class="busca" id="busca" type="search" placeholder="Buscar por nome, telefone, CPF ou e-mail…" value="${esc(est.termo)}">
        ${pode('clientes.inativar') ? `<label class="check"><input type="checkbox" id="chk-inativos" ${est.inativos ? 'checked' : ''}> Só inativos</label>` : ''}
        <span style="flex:1"></span>
        ${pode('clientes.exportar') ? `<button class="btn btn-ghost btn-sm" id="btn-exportar" type="button">Exportar</button>` : ''}
        ${pode('clientes.criar') ? `<button class="btn btn-primary btn-sm" id="btn-novo" type="button">${icone('mais')} Novo cliente</button>` : ''}
      </div>
      <div class="tabela-wrap"><table class="tabela">
        <thead><tr><th>Nome</th><th>Telefone</th><th class="esconder-cel">Cidade</th><th class="num">Compras</th>
          ${valores ? '<th class="num">Total gasto</th>' : ''}<th class="num esconder-cel">Última compra</th></tr></thead>
        <tbody id="corpo"></tbody>
      </table></div>
      <div id="rodape"></div>
    </div>`;
  let t;
  $('#busca', el).addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { est.termo = e.target.value; carregar(true); }, 280); });
  $('#chk-inativos', el)?.addEventListener('change', (e) => { est.inativos = e.target.checked; carregar(true); });
  $('#btn-novo', el)?.addEventListener('click', () => novoCliente());
  $('#btn-exportar', el)?.addEventListener('click', exportar);
  el.addEventListener('click', (e) => {
    if (e.target.closest('a, button')) return;
    const tr = e.target.closest('tr[data-id]'); if (tr) location.hash = `#/clientes/${tr.dataset.id}`;
  });

  async function carregar(reiniciar) {
    const corpo = $('#corpo', el); const rodape = $('#rodape', el);
    if (!corpo) return;
    if (reiniciar) { est.carregados = 0; corpo.innerHTML = ''; rodape.innerHTML = carregando(); }
    const termo = est.termo;
    let q = estado.sb.from('clientes_resumo').select('*', { count: 'exact' }).eq('ativo', !est.inativos)
      .order('nome').range(est.carregados, est.carregados + PAGINA - 1);
    const f = filtroBusca(termo); if (f) q = q.or(f);
    const { data, error, count } = await q;
    if (!ctx.ativo() || termo !== est.termo) return;
    if (error) { rodape.innerHTML = vazio('Erro', esc(msgErro(error))); return; }
    corpo.insertAdjacentHTML('beforeend', data.map((c) => `
      <tr class="clicavel" data-id="${c.id}">
        <td><b>${esc(c.nome)}</b>${c.ativo ? '' : ' ' + tag('inativo', 'cinza')}</td>
        <td>${c.telefone ? `<a class="zap" href="${linkZap(c.telefone)}" target="_blank" rel="noopener">${fmtTelefone(c.telefone)}</a>` : '<span class="muted">—</span>'}</td>
        <td class="esconder-cel">${esc(c.cidade || '—')}</td>
        <td class="num">${c.qtd_compras}</td>
        ${valores ? `<td class="num">${fmtMoeda(c.total_centavos)}</td>` : ''}
        <td class="num esconder-cel">${fmtData(c.ultima_compra)}</td>
      </tr>`).join(''));
    est.carregados += data.length;
    if (count === 0) rodape.innerHTML = termo ? vazio('Nenhum cliente encontrado', 'Tente outro nome ou telefone.') : vazio('Nenhum cliente ainda', 'Clique em “Novo cliente” para começar.');
    else if (est.carregados < count) {
      rodape.innerHTML = `<div class="rodape-tabela"><span>${est.carregados} de ${count} clientes</span><button class="btn btn-ghost btn-sm" id="mais" type="button">Carregar mais</button></div>`;
      $('#mais', el).addEventListener('click', () => carregar(false));
    } else rodape.innerHTML = `<div class="rodape-tabela"><span>${count} cliente${count === 1 ? '' : 's'}</span></div>`;
  }
  carregar(true);
}

async function exportar() {
  try {
    const linhas = await buscarTudo(() => estado.sb.from('clientes_resumo').select('*').order('nome'));
    baixarCsv(`clientes-${hojeSP()}.csv`,
      ['Nome', 'Telefone', 'E-mail', 'CPF', 'Nascimento', 'CEP', 'Rua', 'Número', 'Complemento', 'Bairro', 'Cidade', 'UF', 'Compras', 'Total gasto', 'Última compra', 'Aceita marketing', 'Situação', 'Observações'],
      linhas.map((c) => [c.nome, fmtTelefone(c.telefone), c.email, fmtCpf(c.cpf), c.data_nascimento ? fmtData(c.data_nascimento) : '', fmtCep(c.cep),
        c.logradouro, c.numero, c.complemento, c.bairro, c.cidade, c.uf, c.qtd_compras, c.total_centavos == null ? '' : csvMoeda(c.total_centavos),
        c.ultima_compra ? fmtData(c.ultima_compra) : '', c.aceita_marketing ? 'Sim' : 'Não', c.ativo ? 'Ativo' : 'Inativo', c.observacoes]));
    toast(`${linhas.length} clientes exportados`);
  } catch (err) { toast(msgErro(err), 'erro'); }
}

// ---------------------------------------------------------------------
// FICHA
// ---------------------------------------------------------------------
export async function ficha(el, ctx) {
  const id = ctx.params[0];
  const [cli, vendas] = await Promise.all([
    consulta(estado.sb.from('clientes_resumo').select('*').eq('id', id).maybeSingle()),
    consulta(estado.sb.from('vendas_lista').select('*').eq('cliente_id', id).order('data', { ascending: false }).order('numero', { ascending: false }).limit(200)),
  ]);
  if (!ctx.ativo()) return;
  if (!cli) { el.innerHTML = vazio('Cliente não encontrado', '<a href="#/clientes">Voltar</a>'); return; }
  const endereco = [[cli.logradouro, cli.numero].filter(Boolean).join(', '), cli.complemento, cli.bairro,
    [cli.cidade, cli.uf].filter(Boolean).join(' / '), cli.cep ? `CEP ${fmtCep(cli.cep)}` : ''].filter(Boolean).map(esc).join('<br>');
  const valores = pode('clientes.ver_valores') && cli.total_centavos !== null;
  const STATUS = { concluida: ['Concluída', 'ok'], cancelada: ['Cancelada', 'danger'], devolvida: ['Devolvida', 'warn'], aguardando_aprovacao: ['Aguardando aprovação', 'warn'] };

  el.innerHTML = `
    <a class="voltar" href="#/clientes">← Clientes</a>
    <div class="lado-a-lado">
      <div class="card card-pad">
        <h2 style="font-size:20px">${esc(cli.nome)}</h2>
        <p class="muted pequeno" style="margin:4px 0 14px">Cliente desde ${fmtData(cli.criado_em)}${cli.cadastrado_por ? ` · por ${esc(cli.cadastrado_por)}` : ''} ${cli.ativo ? '' : tag('inativo', 'cinza')}</p>
        <dl class="dl">
          <div><dt>Telefone</dt><dd>${cli.telefone ? `<a class="zap" href="${linkZap(cli.telefone)}" target="_blank" rel="noopener">${fmtTelefone(cli.telefone)} · WhatsApp</a>` : '—'}</dd></div>
          <div><dt>E-mail</dt><dd>${cli.email ? `<a href="mailto:${esc(cli.email)}">${esc(cli.email)}</a>` : '—'}</dd></div>
          ${cli.cpf ? `<div><dt>CPF</dt><dd>${fmtCpf(cli.cpf)}</dd></div>` : ''}
          <div><dt>Nascimento</dt><dd>${cli.data_nascimento ? `${fmtData(cli.data_nascimento)} (${idade(cli.data_nascimento)} anos)` : '—'}</dd></div>
          <div><dt>Endereço</dt><dd>${endereco || '—'}</dd></div>
          <div><dt>Marketing</dt><dd>${cli.aceita_marketing ? `Aceita receber ofertas ${cli.aceita_marketing_em ? `(desde ${fmtData(cli.aceita_marketing_em)})` : ''}` : 'Não autorizou ofertas'}</dd></div>
          ${cli.observacoes ? `<div><dt>Observações</dt><dd>${esc(cli.observacoes)}</dd></div>` : ''}
        </dl>
        <div class="separador"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${pode('clientes.editar') ? '<button class="btn btn-ghost btn-sm" id="btn-editar" type="button">Editar dados</button>' : ''}
          ${pode('clientes.inativar') ? `<button class="btn btn-ghost btn-sm" id="btn-ativo" type="button">${cli.ativo ? 'Inativar' : 'Reativar'}</button>` : ''}
        </div>
      </div>
      <div>
        ${valores ? `<div class="kpis">${kpi('Total gasto', fmtMoeda(cli.total_centavos))}${kpi('Compras', cli.qtd_compras)}${kpi('Ticket médio', fmtMoeda(cli.qtd_compras ? Math.round(cli.total_centavos / cli.qtd_compras) : 0))}</div>` : ''}
        <div class="card">
          <div class="card-topo"><h3>Histórico de compras</h3>
            ${pode('vendas.criar') && cli.ativo ? `<button class="btn btn-primary btn-sm" id="btn-vender" type="button">${icone('mais')} Nova venda</button>` : ''}</div>
          ${vendas.length ? `<div class="tabela-wrap"><table class="tabela">
            <thead><tr><th>Data</th><th>Itens</th><th class="esconder-cel">Pagamento</th><th class="num">Total</th><th></th></tr></thead>
            <tbody>${vendas.map((v) => `<tr class="clicavel ${v.status === 'cancelada' ? 'cancelado' : ''}" data-venda="${v.id}">
              <td>${fmtData(v.data)}<div class="muted pequeno">nº ${v.numero}</div></td>
              <td><span class="riscado">${esc(v.itens_resumo || '')}</span>${v.vendedor_nome ? `<div class="muted pequeno">por ${esc(v.vendedor_nome)}</div>` : ''}</td>
              <td class="esconder-cel"><span class="muted pequeno">${esc(v.pagamentos_resumo || '')}</span></td>
              <td class="num">${fmtMoeda(v.total_centavos)}</td>
              <td class="num">${v.status !== 'concluida' ? tag(STATUS[v.status][0], STATUS[v.status][1]) : ''}</td></tr>`).join('')}</tbody>
          </table></div>` : vazio('Nenhuma compra ainda', '')}
        </div>
      </div>
    </div>`;

  $('#btn-editar', el)?.addEventListener('click', async () => { if (await formCliente(cli)) ficha(el, ctx); });
  $('#btn-ativo', el)?.addEventListener('click', async () => {
    const { error } = await estado.sb.from('clientes').update({ ativo: !cli.ativo }).eq('id', cli.id);
    if (error) return toast(msgErro(error), 'erro');
    toast(cli.ativo ? 'Cliente inativado (o histórico continua guardado)' : 'Cliente reativado');
    ficha(el, ctx);
  });
  $('#btn-vender', el)?.addEventListener('click', () => { estado.preCliente = { id: cli.id, nome: cli.nome }; location.hash = '#/vendas/nova'; });
  $$('tr[data-venda]', el).forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/vendas/${tr.dataset.venda}`; }));
}

// ---------------------------------------------------------------------
// FORMULÁRIO (novo / editar)
// ---------------------------------------------------------------------
export async function novoCliente(nomeInicial = '') {
  const c = await formCliente(null, nomeInicial);
  if (c && !location.hash.startsWith('#/vendas/nova')) location.hash = `#/clientes/${c.id}`;
  return c;
}

export function formCliente(cli, nomeInicial = '') {
  let avisoDup = null;
  let ibge; // só vai para o banco quando o CEP for consultado
  return abrirModal({
    titulo: cli ? 'Editar cliente' : 'Novo cliente', largura: 'lg', botao: 'Salvar cliente',
    corpo: `<div class="form-grade">
      <label class="col-2">Nome completo *<input name="nome" required value="${esc(cli?.nome ?? nomeInicial)}" autocomplete="off"></label>
      <label>Telefone / WhatsApp<input name="telefone" inputmode="tel" data-mascara="telefone" placeholder="(21) 99999-9999" value="${esc(fmtTelefone(cli?.telefone))}"></label>
      <label>E-mail<input name="email" type="email" value="${esc(cli?.email)}"></label>
      <label>CPF <span class="dica-campo muted">(opcional)</span><input name="cpf" inputmode="numeric" data-mascara="cpf" value="${esc(fmtCpf(cli?.cpf))}"></label>
      <label>Data de nascimento<input name="data_nascimento" type="date" max="${hojeSP()}" value="${esc(cli?.data_nascimento)}"></label>
      <label>CEP <span class="dica-campo muted" data-cep-status></span><input name="cep" inputmode="numeric" data-mascara="cep" placeholder="00000-000" value="${esc(fmtCep(cli?.cep))}"></label>
      <label>Rua<input name="logradouro" value="${esc(cli?.logradouro)}"></label>
      <label>Número<input name="numero" value="${esc(cli?.numero)}"></label>
      <label>Complemento<input name="complemento" value="${esc(cli?.complemento)}"></label>
      <label>Bairro<input name="bairro" value="${esc(cli?.bairro)}"></label>
      <div class="linha"><label>Cidade<input name="cidade" value="${esc(cli?.cidade)}"></label><label class="estreito">UF<input name="uf" maxlength="2" value="${esc(cli?.uf)}" style="text-transform:uppercase"></label></div>
      <label class="col-2">Observações<textarea name="observacoes" rows="2">${esc(cli?.observacoes)}</textarea></label>
      <label class="check col-2"><input type="checkbox" name="aceita_marketing" ${cli?.aceita_marketing ? 'checked' : ''}> O cliente aceita receber ofertas e novidades (WhatsApp/e-mail)</label>
    </div>`,
    aoAbrir: (f) => {
      f.cep.addEventListener('input', async () => {
        const cep = soDigitos(f.cep.value); const st = $('[data-cep-status]', f);
        if (cep.length !== 8) { st.textContent = ''; ibge = null; return; }
        st.textContent = 'buscando…';
        try {
          const j = await (await fetch(`https://viacep.com.br/ws/${cep}/json/`)).json();
          if (soDigitos(f.cep.value) !== cep) return;
          if (j.erro) { st.textContent = 'CEP não encontrado'; return; }
          f.logradouro.value = j.logradouro || ''; f.bairro.value = j.bairro || ''; f.cidade.value = j.localidade || ''; f.uf.value = j.uf || '';
          ibge = /^\d{7}$/.test(j.ibge || '') ? j.ibge : null;
          st.textContent = '✓'; f.numero.focus();
        } catch { st.textContent = 'preencha à mão'; }
      });
    },
    aoSalvar: async (f) => {
      const v = (x) => (x.trim() === '' ? null : x.trim());
      const d = {
        nome: f.nome.value.trim().replace(/\s+/g, ' '), telefone: v(soDigitos(f.telefone.value)), email: v(f.email.value.toLowerCase()),
        cpf: v(soDigitos(f.cpf.value)), data_nascimento: v(f.data_nascimento.value), cep: v(soDigitos(f.cep.value)),
        logradouro: v(f.logradouro.value), numero: v(f.numero.value), complemento: v(f.complemento.value), bairro: v(f.bairro.value),
        cidade: v(f.cidade.value), uf: v(f.uf.value.toUpperCase()), observacoes: v(f.observacoes.value), aceita_marketing: f.aceita_marketing.checked,
      };
      if (ibge !== undefined) d.ibge = d.cep ? ibge : null;
      if (d.nome.length < 2) { f.erro('Informe o nome.'); return false; }
      if (d.telefone && !/^\d{10,11}$/.test(d.telefone)) { f.erro('Telefone inválido: DDD + número.'); return false; }
      if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) { f.erro('E-mail inválido.'); return false; }
      if (d.cpf && !validarCpf(d.cpf)) { f.erro('CPF inválido.'); return false; }
      if (d.cep && d.cep.length !== 8) { f.erro('CEP precisa ter 8 dígitos.'); return false; }
      if (d.uf && !/^[A-Z]{2}$/.test(d.uf)) { f.erro('UF com 2 letras (ex.: RJ).'); return false; }
      if (!cli && (d.telefone || d.email || d.cpf)) {
        const chave = `${d.telefone}|${d.email}|${d.cpf}`;
        if (avisoDup !== chave) {
          const fs = [d.telefone && `telefone.eq.${d.telefone}`, d.email && `email.eq."${d.email.replace(/"/g, '')}"`, d.cpf && `cpf.eq.${d.cpf}`].filter(Boolean);
          const { data: dup } = await estado.sb.from('clientes').select('id,nome').or(fs.join(',')).limit(1);
          if (dup?.length) { avisoDup = chave; f.erro(`Já existe “${dup[0].nome}” com esse telefone/e-mail/CPF. Se for outra pessoa, clique em Salvar de novo.`); return false; }
        }
      }
      const q = cli ? estado.sb.from('clientes').update(d).eq('id', cli.id).select('id,nome').single()
        : estado.sb.from('clientes').insert(d).select('id,nome').single();
      const r = await consulta(q);
      toast(cli ? 'Dados atualizados' : 'Cliente cadastrado');
      return r;
    },
  });
}

// Escolher cliente (usado no PDV): busca + cadastro rápido
export function escolherCliente() {
  return abrirModal({
    titulo: 'Escolher cliente', largura: 'md', botao: null, cancelar: 'Fechar',
    corpo: `<input type="search" name="q" placeholder="Nome, telefone ou CPF…" autocomplete="off" autofocus>
      <div data-res class="busca-resultados" style="padding:0;max-height:50vh"></div>
      ${pode('clientes.criar') ? '<button class="btn btn-ghost" type="button" data-novo>+ Cadastrar cliente novo</button>' : ''}`,
    aoAbrir: (f) => {
      let t;
      const res = $('[data-res]', f);
      const buscar = async () => {
        const termo = f.q.value; const fl = filtroBusca(termo);
        if (!fl) { res.innerHTML = ''; return; }
        const { data } = await estado.sb.from('clientes').select('id,nome,telefone,cpf').eq('ativo', true).or(fl).order('nome').limit(12);
        if (termo !== f.q.value) return;
        res.innerHTML = (data || []).length ? data.map((c) => `<a href="#" data-id="${c.id}" data-nome="${esc(c.nome)}"><span><b>${esc(c.nome)}</b><small>${fmtTelefone(c.telefone) || ''} ${c.cpf ? '· CPF ' + fmtCpf(c.cpf) : ''}</small></span></a>`).join('')
          : '<p class="muted pequeno" style="padding:8px">Nenhum cliente encontrado.</p>';
      };
      f.q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(buscar, 250); });
      res.addEventListener('click', (e) => { const a = e.target.closest('a[data-id]'); if (!a) return; e.preventDefault(); f.fechar({ id: a.dataset.id, nome: a.dataset.nome }); });
      $('[data-novo]', f)?.addEventListener('click', async () => {
        const c = await formCliente(null, /\d/.test(f.q.value) ? '' : f.q.value);
        if (c) f.fechar(c);
      });
    },
  });
}

// ---------------------------------------------------------------------
// ANIVERSARIANTES
// ---------------------------------------------------------------------
let mesAniv = null;
export async function aniversariantes(el, ctx) {
  const hoje = hojeSP();
  if (!mesAniv) mesAniv = Number(hoje.slice(5, 7));
  el.innerHTML = `${cabecalho('Aniversariantes', { sub: 'Clientes que fazem aniversário no mês, com mensagem pronta no WhatsApp.' })}
    <div class="card"><div class="ferramentas"><select id="mes" style="width:auto">${MESES.map((m, i) => `<option value="${i + 1}" ${i + 1 === mesAniv ? 'selected' : ''}>${m}</option>`).join('')}</select>
    <span class="muted pequeno">Só aparecem clientes ativos com data de nascimento.</span></div><div id="corpo">${carregando()}</div></div>`;
  $('#mes', el).addEventListener('change', (e) => { mesAniv = Number(e.target.value); aniversariantes(el, ctx); });
  const data = await consulta(estado.sb.from('clientes_resumo').select('id,nome,telefone,data_nascimento,aceita_marketing').eq('ativo', true).eq('mes_aniversario', mesAniv));
  if (!ctx.ativo()) return;
  data.sort((a, b) => a.data_nascimento.slice(8) - b.data_nascimento.slice(8) || a.nome.localeCompare(b.nome));
  const loja = estado.empresa?.nome_fantasia || 'loja';
  $('#corpo', el).innerHTML = data.length ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Dia</th><th>Cliente</th><th class="esconder-cel">Faz</th><th>WhatsApp</th></tr></thead><tbody>
    ${data.map((c) => `<tr><td><b>${c.data_nascimento.slice(8)}/${c.data_nascimento.slice(5, 7)}</b> ${c.data_nascimento.slice(5) === hoje.slice(5) ? tag('hoje', 'ok') : ''}</td>
      <td><a href="#/clientes/${c.id}">${esc(c.nome)}</a></td><td class="esconder-cel">${Number(hoje.slice(0, 4)) - Number(c.data_nascimento.slice(0, 4))} anos</td>
      <td>${c.telefone ? `<a class="zap" target="_blank" rel="noopener" href="${linkZap(c.telefone, `Feliz aniversário, ${c.nome.split(' ')[0]}! A equipe da ${loja} deseja um novo ano cheio de conquistas. Passa aqui na loja, temos um mimo esperando por você!`)}">Mandar parabéns</a>` : '<span class="muted">sem telefone</span>'}</td></tr>`).join('')}
    </tbody></table></div>` : vazio(`Nenhum aniversariante em ${MESES[mesAniv - 1]}`, 'Cadastre a data de nascimento dos clientes para aparecerem aqui.');
}
