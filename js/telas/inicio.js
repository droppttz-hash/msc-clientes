// Início: números do dia e do mês (cada pessoa vê só o que pode)
import { estado, pode, esc, rpc, fmtMoeda, fmtPct, fmtNum, kpi, vazio, icone, hojeSP, nomeMes, fmtTelefone, linkZap, $, $$ } from '../core.js';

export async function tela(el, ctx) {
  const [p, ap, os] = await Promise.all([rpc('painel'), pode('estoque.ver') ? rpc('aparelhos_resumo').catch(() => null) : null,
    pode('os.ver') ? rpc('os_resumo').catch(() => null) : null]);
  if (!ctx.ativo()) return;
  estado.painel = p;
  const hora = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(new Date()));
  const saud = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const blocos = [];

  // atalhos
  const atalhos = [
    pode('vendas.criar') && `<a class="btn btn-primary btn-lg" href="#/vendas/nova">${icone('vendas')} Nova venda</a>`,
    pode('os.criar') && `<a class="btn btn-ghost btn-lg" href="#/os/nova">${icone('ferramenta')} Nova OS</a>`,
    pode('clientes.criar') && `<button class="btn btn-ghost btn-lg" type="button" data-novo-cliente>${icone('clientes')} Novo cliente</button>`,
    pode('financeiro.caixa') && `<a class="btn btn-ghost btn-lg" href="#/financas/caixa">${icone('caixa')} Caixa do dia</a>`,
    pode('estoque.ver') && `<a class="btn btn-ghost btn-lg" href="#/estoque">${icone('estoque')} Consultar estoque</a>`,
  ].filter(Boolean).join('');

  // alertas
  const alertas = [];
  if (p.aguardando_aprovacao) alertas.push(`<a class="alerta" href="#/vendas/aprovacoes">${icone('alerta')}<span><b>${p.aguardando_aprovacao} venda(s) aguardando sua aprovação</b> — desconto acima do limite.</span></a>`);
  if (os?.minhas) alertas.push(`<a class="alerta info" href="#/os">${icone('ferramenta')}<span><b>${os.minhas} OS na sua bancada</b>${os.atrasadas ? ` — ${os.atrasadas} atrasada(s)` : ''}.</span></a>`);
  if (os?.prontas) alertas.push(`<a class="alerta info" href="#/os">${icone('ferramenta')}<span><b>${os.prontas} OS pronta(s) para retirada</b> — avise o cliente pelo WhatsApp.</span></a>`);
  if (os?.aguardando_aprovacao) alertas.push(`<a class="alerta info" href="#/os">${icone('ferramenta')}<span><b>${os.aguardando_aprovacao} orçamento(s) de OS esperando resposta do cliente.</b></span></a>`);
  if (os?.para_abandono) alertas.push(`<a class="alerta" href="#/os">${icone('alerta')}<span><b>${os.para_abandono} aparelho(s) sem retirada há mais de ${os.dias_abandono} dias</b> na assistência.</span></a>`);
  if (ap?.parados) alertas.push(`<a class="alerta" href="#/aparelhos">${icone('alerta')}<span><b>${ap.parados} aparelho(s) parado(s) há mais de ${ap.dias_alerta} dias</b> — vale revisar o preço.</span></a>`);
  if (ap?.em_teste) alertas.push(`<a class="alerta" href="#/aparelhos">${icone('alerta')}<span><b>${ap.em_teste} aparelho(s) em teste</b> esperando liberação.</span></a>`);
  if (p.pagar?.vencido) alertas.push(`<a class="alerta" href="#/financas/pagar">${icone('alerta')}<span><b>Contas a pagar vencidas: ${fmtMoeda(p.pagar.vencido)}</b></span></a>`);

  // números
  const kpis = [];
  if (p.minhas_vendas_hoje && !p.vendas_hoje) kpis.push(kpi('Suas vendas hoje', fmtMoeda(p.minhas_vendas_hoje.total), `${p.minhas_vendas_hoje.qtd} venda(s)`));
  if (p.vendas_hoje) kpis.push(kpi('Vendas hoje', fmtMoeda(p.vendas_hoje.total), `${p.vendas_hoje.qtd} venda(s)`));
  if (p.mes) {
    const ant = p.mes_anterior_ate_hoje || 0;
    const varPct = ant ? ((p.mes.total - ant) / ant) * 100 : null;
    kpis.push(kpi(`Faturamento de ${nomeMes(hojeSP().slice(0, 7)).split(' ')[0].toLowerCase()}`, fmtMoeda(p.mes.total),
      varPct === null ? `${p.mes.qtd} venda(s)` : `<span class="${varPct >= 0 ? 'pos' : 'neg'}">${varPct >= 0 ? '▲' : '▼'} ${fmtPct(Math.abs(varPct))}</span> vs. mesmo período do mês passado`));
    kpis.push(kpi('Ticket médio', fmtMoeda(p.mes.qtd ? Math.round(p.mes.total / p.mes.qtd) : 0), 'no mês'));
  }
  if (p.lucro_bruto_mes !== undefined) kpis.push(kpi('Lucro bruto do mês', fmtMoeda(p.lucro_bruto_mes), p.mes?.total ? `margem ${fmtPct((p.lucro_bruto_mes / p.mes.total) * 100)}` : ''));
  if (p.saldo_contas !== undefined) kpis.push(kpi('Saldo nas contas', fmtMoeda(p.saldo_contas), 'caixa + banco + maquininha', p.saldo_contas < 0 ? 'neg' : ''));
  if (p.receber) kpis.push(kpi('A receber (7 dias)', fmtMoeda(p.receber.semana), p.receber.vencido ? `<span class="neg">${fmtMoeda(p.receber.vencido)} em atraso</span>` : 'nada em atraso'));
  if (p.pagar) kpis.push(kpi('A pagar (7 dias)', fmtMoeda(p.pagar.semana), p.pagar.vencido ? `<span class="neg">${fmtMoeda(p.pagar.vencido)} vencido</span>` : `hoje: ${fmtMoeda(p.pagar.hoje)}`));

  // meta
  if (p.mes && p.meta_mes) {
    const pct = Math.min(100, (p.mes.total / p.meta_mes) * 100);
    blocos.push(`<div class="card card-pad"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><b>Meta do mês</b><span class="muted">${fmtMoeda(p.mes.total)} de ${fmtMoeda(p.meta_mes)} · ${fmtPct(pct)}</span></div><div class="progresso"><div style="width:${pct}%"></div></div></div>`);
  }

  // gráfico do mês
  let grafico = '';
  if (p.por_dia?.length) {
    const max = Math.max(1, ...p.por_dia.map((d) => d.total));
    grafico = `<div class="card grafico">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px"><h3 style="font-size:15.5px">Vendas por dia</h3><span class="muted pequeno">${nomeMes(hojeSP().slice(0, 7))}</span></div>
      <div class="grafico-area" role="img" aria-label="Vendas por dia do mês">
        ${p.por_dia.map((d) => `<div class="grafico-col ${d.dia === hojeSP() ? 'ativo' : ''}" data-dia="${d.dia}" data-total="${d.total}"><div class="b" style="height:${(d.total / max) * 100}%;background:var(--primary)"></div></div>`).join('')}
      </div>
      <div class="grafico-rotulos">${p.por_dia.map((d, i) => `<span>${(i % 5 === 0 || i === p.por_dia.length - 1) ? Number(d.dia.slice(8)) : ''}</span>`).join('')}</div>
    </div>`;
  }

  const lista = (titulo, itens, linha, link = '') => `<div class="card"><div class="card-topo"><h3>${titulo}</h3>${link}</div>
    ${itens?.length ? `<div class="lista-barras">${itens.map(linha).join('')}</div>` : vazio('Nada por enquanto', '')}</div>`;
  const maxTop = (arr) => Math.max(1, ...(arr || []).map((x) => x.total));
  const barra = (nome, valor, max, extra = '') => `<div class="item"><span>${esc(nome)}${extra}</span><span class="valor">${fmtMoeda(valor)}</span><div class="trilho"><div class="enchimento" style="width:${Math.max(2, (valor / max) * 100)}%"></div></div></div>`;

  const cards = [];
  if (p.top_produtos) cards.push(lista('Mais vendidos do mês', p.top_produtos, (x) => barra(x.nome, x.total, maxTop(p.top_produtos), ` <small class="muted">· ${fmtNum(x.qtd)} un.</small>`)));
  if (p.top_categorias) cards.push(lista('Vendas por categoria', p.top_categorias, (x) => barra(x.nome, x.total, maxTop(p.top_categorias))));
  if (p.top_clientes) cards.push(lista('Melhores clientes do mês', p.top_clientes, (x) => barra(x.nome, x.total, maxTop(p.top_clientes))));
  if (p.ranking_vendedores?.length) cards.push(lista('Vendedores no mês', p.ranking_vendedores, (x) => barra(x.nome, x.total, maxTop(p.ranking_vendedores), ` <small class="muted">· ${x.qtd} venda(s)${x.meta ? ` · meta ${fmtMoeda(x.meta)}` : ''}</small>`)));
  if (p.estoque_baixo) cards.push(`<div class="card"><div class="card-topo"><h3>Estoque baixo</h3><a href="#/estoque" class="pequeno">Ver estoque</a></div>
    ${p.estoque_baixo.length ? `<div class="tabela-wrap"><table class="tabela"><tbody>${p.estoque_baixo.map((x) => `<tr class="clicavel" data-href="#/estoque/produto/${x.id}"><td>${esc(x.nome)}</td><td class="num"><span class="tag ${x.estoque <= 0 ? 'danger' : 'warn'}">${fmtNum(x.estoque)} un.</span></td><td class="num muted pequeno">mín. ${fmtNum(x.minimo)}</td></tr>`).join('')}</tbody></table></div>` : vazio('Tudo certo', 'Nenhum produto abaixo do mínimo.')}</div>`);
  if (p.aniversariantes_hoje?.length) cards.push(`<div class="card"><div class="card-topo"><h3>🎂 Aniversariantes de hoje</h3></div><div class="tabela-wrap"><table class="tabela"><tbody>
    ${p.aniversariantes_hoje.map((c) => `<tr><td><a href="#/clientes/${c.id}">${esc(c.nome)}</a></td><td class="num">${c.telefone ? `<a class="zap" target="_blank" rel="noopener" href="${linkZap(c.telefone, `Feliz aniversário, ${c.nome.split(' ')[0]}! A equipe da ${estado.empresa?.nome_fantasia || 'loja'} deseja um ano incrível. Passa aqui, temos um mimo para você!`)}">Mandar parabéns</a>` : ''}</td></tr>`).join('')}
    </tbody></table></div></div>`);

  el.innerHTML = `
    <div class="pagina-topo"><div><h1>${saud}, ${esc(estado.perfil.nome.split(' ')[0])}!</h1><p class="muted">${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' })}</p></div></div>
    ${atalhos ? `<div class="barra-acoes">${atalhos}</div>` : ''}
    ${alertas.join('')}
    ${kpis.length ? `<div class="kpis">${kpis.join('')}</div>` : ''}
    ${blocos.join('')}
    ${grafico ? `<div style="margin:16px 0">${grafico}</div>` : ''}
    ${cards.length ? `<div class="grade-2">${cards.join('')}</div>` : ''}
    ${!kpis.length && !cards.length ? vazio('Bem-vindo!', 'Use o menu ao lado para começar.') : ''}`;

  $('[data-novo-cliente]', el)?.addEventListener('click', async () => (await import('./clientes.js')).novoCliente());
  $$('tr[data-href]', el).forEach((tr) => tr.addEventListener('click', () => { location.hash = tr.dataset.href; }));
  dicaGrafico(el, (c) => `<b>${c.dataset.dia.split('-').reverse().slice(0, 2).join('/')}</b><div class="linha-d"><span>Vendido</span><span>${fmtMoeda(Number(c.dataset.total))}</span></div>`);
}

// Dica flutuante para colunas de gráfico
export function dicaGrafico(el, conteudo, seletor = '.grafico-col') {
  const dica = $('#dica');
  $$(seletor, el).forEach((c) => {
    c.addEventListener('mousemove', (e) => {
      dica.innerHTML = conteudo(c); dica.hidden = false;
      dica.style.left = `${Math.min(e.clientX + 14, innerWidth - dica.offsetWidth - 8)}px`;
      dica.style.top = `${e.clientY + 14}px`;
    });
    c.addEventListener('mouseleave', () => { dica.hidden = true; });
  });
}
