// Comissões: sugestão do mês (vendas e mão de obra das OS), ajuste do gerente e fechamento com conta a pagar
import {
  estado, pode, $, $$, esc, fmtMoeda, fmtMoedaSinal, fmtData, fmtPct, hojeSP, addMeses, nomeMes, somarDias, ultimoDiaMes,
  abrirModal, pedirMotivo, toast, msgErro, rpc, cabecalho, vazio, tag, kpi, valorDinheiro, baixarCsv, csvMoeda,
} from '../core.js';

const f0 = { mes: '' };
export async function tela(el, ctx) {
  if (!f0.mes) f0.mes = hojeSP().slice(0, 7);
  const c = await rpc('comissoes_mes', { p_mes: `${f0.mes}-01` });
  if (!ctx.ativo()) return;
  const gerir = c.gerir;
  const meses = Array.from({ length: 13 }, (_, i) => addMeses(hojeSP().slice(0, 7) + '-01', -i).slice(0, 7));
  const pct = (n) => fmtPct(Number(n));
  const total = c.pessoas.reduce((s, p) => s + p.total, 0);
  const mesAtual = f0.mes === hojeSP().slice(0, 7);
  const fech = c.fechamentos;
  const ST_T = { aberto: ['A pagar', 'warn'], parcial: ['Pago em parte', 'warn'], pago: ['Paga', 'ok'], cancelado: ['Cancelada', 'cinza'] };

  el.innerHTML = `
    ${cabecalho(gerir ? 'Comissões' : 'Minha comissão', { sub: gerir ? 'O sistema sugere: % das vendas de cada vendedor e % da mão de obra das OS de cada técnico. Você confere, ajusta e fecha o mês — só então vira conta a pagar.'
      : 'Prévia da sua comissão no mês. O valor final é conferido e fechado pelo gerente.' })}
    <div class="ferramentas" style="margin-bottom:12px"><select id="f-mes" style="width:auto">${meses.map((m) => `<option value="${m}" ${m === f0.mes ? 'selected' : ''}>${nomeMes(m)}</option>`).join('')}</select>
      ${c.fechado ? tag('Mês fechado', 'ok') : tag(mesAtual ? 'Mês em andamento (prévia)' : 'Aberto: falta fechar', 'warn')}
      <span style="flex:1"></span>
      ${gerir && c.pessoas.length ? '<button class="btn btn-ghost btn-sm" type="button" id="b-exp">Exportar</button>' : ''}
      ${gerir && !c.fechado && c.pessoas.length ? '<button class="btn btn-primary" type="button" id="b-fechar">Fechar o mês</button>' : ''}
      ${gerir && c.fechado ? '<button class="btn btn-ghost" type="button" id="b-reabrir" style="color:var(--danger)">Reabrir o mês</button>' : ''}</div>
    ${c.fechado ? `<div class="card"><div class="card-topo"><h3>Fechamento</h3><a class="pequeno" href="#/financas/pagar">Contas a pagar</a></div><div class="tabela-wrap"><table class="tabela">
      <thead><tr><th>Pessoa</th><th class="num esconder-cel">Vendas</th><th class="num esconder-cel">OS</th><th class="num esconder-cel">Ajuste</th><th class="num">Total</th><th>Pagamento</th></tr></thead><tbody>
      ${fech.map((f) => `<tr><td><b>${esc(f.nome)}</b>${f.motivo_ajuste ? `<div class="muted pequeno">ajuste: ${esc(f.motivo_ajuste)}</div>` : ''}</td><td class="num esconder-cel">${fmtMoeda(f.valor_venda)}</td><td class="num esconder-cel">${fmtMoeda(f.valor_os)}</td>
        <td class="num esconder-cel">${f.ajuste ? fmtMoedaSinal(f.ajuste) : '—'}</td><td class="num"><b>${fmtMoeda(f.total)}</b></td>
        <td>${f.titulo_id ? `${tag(...(ST_T[f.titulo_status] || [f.titulo_status, 'cinza']))} <span class="muted pequeno">${fmtData(f.vencimento)}</span>` : '<span class="muted pequeno">sem valor</span>'}</td></tr>`).join('')}
      </tbody></table></div></div>` : ''}
    ${!c.fechado || gerir ? `<div class="kpis">${kpi(c.fechado ? 'Calculado agora' : 'Total sugerido', fmtMoeda(total), `${c.pessoas.length} pessoa(s)`)}
      ${kpi('Vendas que geram comissão', fmtMoeda(c.pessoas.reduce((s, p) => s + p.base_venda, 0)))}${kpi('Mão de obra das OS', fmtMoeda(c.pessoas.reduce((s, p) => s + p.base_os, 0)), `${c.os.length} OS entregue(s)`)}</div>
    <div class="card"><div class="card-topo"><h3>Por pessoa</h3></div>${c.pessoas.length ? `<div class="tabela-wrap"><table class="tabela">
      <thead><tr><th>Pessoa</th><th class="num">Vendido (líquido)</th><th class="num esconder-cel">%</th><th class="num">Comissão vendas</th><th class="num esconder-cel">Mão de obra</th><th class="num">Comissão OS</th><th class="num">Total</th></tr></thead><tbody>
      ${c.pessoas.map((p) => `<tr><td><b>${esc(p.nome)}</b><div class="muted pequeno">${p.vendas_qtd} venda(s)${p.devolucoes ? ` · devoluções ${fmtMoeda(p.devolucoes)}` : ''}${p.estornos ? ` · cancelamentos de meses fechados ${fmtMoeda(p.estornos)}` : ''}</div></td>
        <td class="num">${fmtMoeda(p.base_venda)}</td><td class="num esconder-cel">${pct(p.pct_venda)}</td><td class="num">${fmtMoeda(p.valor_venda)}</td>
        <td class="num esconder-cel">${p.os_qtd ? `${fmtMoeda(p.base_os)} <span class="muted pequeno">(${pct(p.pct_os)})</span>` : '—'}</td><td class="num">${p.os_qtd ? fmtMoeda(p.valor_os) : '—'}</td><td class="num"><b>${fmtMoeda(p.total)}</b></td></tr>`).join('')}
      </tbody></table></div>` : vazio('Nada neste mês', gerir ? 'Defina o % de cada pessoa em Configurações › Usuários.' : '')}
      ${gerir && c.pessoas.some((p) => !Number(p.pct_venda) && p.vendas_qtd) ? '<p class="muted pequeno card-pad">Quem está com 0% não tem o percentual definido: ajuste em Configurações › Usuários.</p>' : ''}</div>
    ${c.os.length ? `<div class="card" style="margin-top:16px"><div class="card-topo"><h3>OS entregues no mês</h3>${gerir && !c.fechado ? '<span class="muted pequeno">Clique no valor para ajustar</span>' : ''}</div><div class="tabela-wrap"><table class="tabela">
      <thead><tr><th>OS</th><th class="esconder-cel">Técnico</th><th class="num esconder-cel">Cobrado</th><th class="num">Mão de obra</th><th class="num esconder-cel">Sugerido</th><th class="num">Comissão</th></tr></thead><tbody>
      ${c.os.map((o) => `<tr><td><a href="#/os/${o.id}">nº ${o.numero}</a> · ${esc(o.aparelho)}<div class="muted pequeno">${esc(o.cliente || '')} · ${fmtData(o.entregue_em)}</div></td>
        <td class="esconder-cel">${esc(o.tecnico_nome)}</td><td class="num esconder-cel">${fmtMoeda(o.total)}</td><td class="num">${fmtMoeda(o.mao_obra)}</td><td class="num esconder-cel muted">${fmtMoeda(o.sugerido)}</td>
        <td class="num">${gerir && !c.fechado ? `<button class="link-btn" data-os="${o.id}">${fmtMoeda(o.valor)}</button>` : fmtMoeda(o.valor)}${o.ajustado ? `<div class="muted pequeno" title="${esc(o.motivo || '')}">ajustado</div>` : ''}</td></tr>`).join('')}
      </tbody></table></div></div>` : ''}` : ''}`;

  const recarregar = () => { if (ctx.ativo()) tela(el, ctx); };
  $('#f-mes', el).addEventListener('change', (e) => { f0.mes = e.target.value; recarregar(); });
  $$('[data-os]', el).forEach((b) => b.addEventListener('click', async () => {
    const o = c.os.find((x) => x.id === b.dataset.os);
    const r = await abrirModal({
      titulo: `Comissão da OS nº ${o.numero}`, largura: 'sm', botao: 'Salvar',
      corpo: `<p>${esc(o.aparelho)} · técnico <b>${esc(o.tecnico_nome)}</b><br><span class="muted">Mão de obra ${fmtMoeda(o.mao_obra)} × ${pct(o.pct)} = sugestão de <b>${fmtMoeda(o.sugerido)}</b></span></p>
        <label>Comissão desta OS<input name="v" data-mascara="dinheiro" inputmode="numeric" value="${fmtMoeda(o.valor)}"></label>
        <label>Motivo do ajuste *<input name="m" value="${esc(o.motivo || '')}" placeholder="Ex.: serviço rápido, dividido com outro técnico…"></label>
        ${o.ajustado ? '<label class="check"><input type="checkbox" name="voltar"> Voltar para a sugestão do sistema</label>' : ''}`,
      aoSalvar: async (f) => {
        if (f.voltar?.checked) { await rpc('ajustar_comissao_os', { p_os: o.id, p_valor: null, p_motivo: null }); return true; }
        await rpc('ajustar_comissao_os', { p_os: o.id, p_valor: valorDinheiro(f.v), p_motivo: f.m.value }); return true;
      },
    });
    if (r) { toast('Comissão ajustada'); recarregar(); }
  }));
  $('#b-fechar', el)?.addEventListener('click', async () => {
    const venc = somarDias(ultimoDiaMes(`${f0.mes}-01`), 5);
    const r = await abrirModal({
      titulo: `Fechar comissões de ${nomeMes(f0.mes)}`, largura: 'md', botao: 'Fechar e lançar a pagar',
      corpo: `${mesAtual ? '<div class="alerta">O mês ainda não acabou: vendas e OS de hoje em diante não entram neste fechamento.</div>' : ''}
        <p class="muted pequeno">Use “ajuste” para bônus (+) ou descontos (−), com o motivo. Cada pessoa vira uma conta a pagar.</p>
        <div class="tabela-wrap"><table class="tabela"><thead><tr><th>Pessoa</th><th class="num">Calculado</th><th class="num">Ajuste</th><th>Motivo</th></tr></thead><tbody>
        ${c.pessoas.map((p) => `<tr><td>${esc(p.nome)}</td><td class="num">${fmtMoeda(p.total)}</td>
          <td class="num"><input data-aj="${p.user_id}" inputmode="decimal" placeholder="0,00" style="width:100px;margin:0"></td><td><input data-mot="${p.user_id}" style="margin:0"></td></tr>`).join('')}
        </tbody></table></div>
        <label>Pagar em<input type="date" name="venc" value="${venc}"></label>`,
      aoSalvar: async (f) => {
        const aj = [];
        for (const p of c.pessoas) {
          const raw = $(`[data-aj="${p.user_id}"]`, f).value.trim();
          if (!raw) continue;
          const neg = raw.startsWith('-');
          const v = Math.round(Number(raw.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.').replace('-', '')) * 100) * (neg ? -1 : 1);
          if (!v) continue;
          aj.push({ user_id: p.user_id, ajuste_centavos: v, motivo: $(`[data-mot="${p.user_id}"]`, f).value });
        }
        return rpc('fechar_comissoes', { p_mes: `${f0.mes}-01`, p_vencimento: f.venc.value, p_ajustes: aj });
      },
    });
    if (r) { toast(`Mês fechado: ${fmtMoeda(r.total_centavos)} em ${r.pessoas} conta(s) a pagar`); recarregar(); }
  });
  $('#b-reabrir', el)?.addEventListener('click', async () => {
    const m = await pedirMotivo({ titulo: `Reabrir ${nomeMes(f0.mes)}`, texto: 'As contas a pagar das comissões são canceladas (só se nenhuma foi paga).', botao: 'Reabrir' });
    if (!m) return;
    try { await rpc('cancelar_fechamento_comissoes', { p_mes: `${f0.mes}-01`, p_motivo: m }); toast('Mês reaberto'); recarregar(); } catch (err) { toast(msgErro(err), 'erro'); }
  });
  $('#b-exp', el)?.addEventListener('click', () => baixarCsv(`comissoes-${f0.mes}.csv`,
    ['Pessoa', 'Vendido líquido', '% vendas', 'Comissão vendas', 'Mão de obra OS', '% OS', 'Comissão OS', 'Total'],
    c.pessoas.map((p) => [p.nome, csvMoeda(p.base_venda), String(p.pct_venda).replace('.', ','), csvMoeda(p.valor_venda), csvMoeda(p.base_os), String(p.pct_os).replace('.', ','), csvMoeda(p.valor_os), csvMoeda(p.total)])));
}
