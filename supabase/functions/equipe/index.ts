// =====================================================================
// Função "equipe": o gerente cria funcionários e redefine senhas pelo
// sistema, sem abrir o painel do Supabase.
// Publicada com verify_jwt = false: a autorização é feita aqui dentro
// (sessão válida + permissão config.gerenciar no banco).
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const resp = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function chave(novas: string, antiga: string): string {
  try {
    const j = JSON.parse(Deno.env.get(novas) ?? '');
    if (j && typeof j === 'object' && j.default) return j.default as string;
  } catch { /* usa a chave antiga */ }
  return Deno.env.get(antiga) ?? '';
}

const CARGOS = ['gerente', 'vendedor', 'tecnico'];
const senhaOk = (s: unknown) => typeof s === 'string' && s.length >= 8 && s.length <= 72;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resp({ erro: 'Use POST.' }, 405);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token || token.startsWith('sb_')) return resp({ erro: 'Faça login para continuar.' }, 401);

  // cliente com a sessão de quem chamou (respeita as regras do banco)
  const usuario = createClient(url, chave('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: eu, error: eErr } = await usuario.auth.getUser(token);
  if (eErr || !eu?.user) return resp({ erro: 'Sessão expirada. Entre de novo.' }, 401);
  const { data: pode, error: pErr } = await usuario.rpc('pode_gerir_equipe');
  if (pErr || pode !== true) return resp({ erro: 'Só o gerente pode cuidar da equipe.' }, 403);

  const admin = createClient(url, chave('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let corpo: Record<string, unknown>;
  try { corpo = await req.json(); } catch { return resp({ erro: 'Pedido inválido.' }, 400); }

  try {
    if (corpo.acao === 'criar') {
      const email = String(corpo.email ?? '').trim().toLowerCase();
      const nome = String(corpo.nome ?? '').trim().replace(/\s+/g, ' ');
      const cargo = String(corpo.cargo ?? 'vendedor');
      const telefone = String(corpo.telefone ?? '').replace(/\D/g, '') || null;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return resp({ erro: 'E-mail inválido.' }, 400);
      if (nome.length < 2) return resp({ erro: 'Informe o nome.' }, 400);
      if (!CARGOS.includes(cargo)) return resp({ erro: 'Cargo inválido.' }, 400);
      if (!senhaOk(corpo.senha)) return resp({ erro: 'A senha precisa ter pelo menos 8 caracteres.' }, 400);
      if (telefone && !/^\d{10,11}$/.test(telefone)) return resp({ erro: 'Telefone com DDD (10 ou 11 números).' }, 400);

      const { data: novo, error } = await admin.auth.admin.createUser({
        email, password: corpo.senha as string, email_confirm: true,
        user_metadata: { nome, trocar_senha: corpo.trocar_senha !== false },
      });
      if (error || !novo?.user) {
        const m = /already|registered|exists/i.test(error?.message ?? '') ? 'Já existe um usuário com esse e-mail.' : (error?.message ?? 'Não deu para criar.');
        return resp({ erro: m }, 400);
      }
      // o banco cria o perfil como vendedor; aqui ajusta cargo e telefone com a sessão do gerente
      const { error: uErr } = await usuario.from('perfis')
        .update({ nome, cargo, telefone, ativo: true }).eq('user_id', novo.user.id);
      if (uErr) return resp({ erro: `Usuário criado, mas não deu para ajustar o cargo: ${uErr.message}`, user_id: novo.user.id }, 207);
      await usuario.rpc('registrar_equipe', { p_acao: 'CRIAR_USUARIO', p_alvo: novo.user.id, p_detalhe: { email, cargo } });
      return resp({ ok: true, user_id: novo.user.id });
    }

    if (corpo.acao === 'senha') {
      const alvo = String(corpo.user_id ?? '');
      if (!/^[0-9a-f-]{36}$/.test(alvo)) return resp({ erro: 'Usuário inválido.' }, 400);
      if (!senhaOk(corpo.senha)) return resp({ erro: 'A senha precisa ter pelo menos 8 caracteres.' }, 400);
      const { data: atual, error: gErr } = await admin.auth.admin.getUserById(alvo);
      if (gErr || !atual?.user) return resp({ erro: 'Usuário não encontrado.' }, 404);
      const { error } = await admin.auth.admin.updateUserById(alvo, {
        password: corpo.senha as string,
        user_metadata: { ...(atual.user.user_metadata ?? {}), trocar_senha: corpo.trocar_senha !== false },
      });
      if (error) return resp({ erro: error.message }, 400);
      await usuario.rpc('registrar_equipe', { p_acao: 'REDEFINIR_SENHA', p_alvo: alvo, p_detalhe: { trocar_no_login: corpo.trocar_senha !== false } });
      return resp({ ok: true });
    }

    return resp({ erro: 'Ação desconhecida.' }, 400);
  } catch (e) {
    return resp({ erro: (e as Error).message ?? 'Erro inesperado.' }, 500);
  }
});
