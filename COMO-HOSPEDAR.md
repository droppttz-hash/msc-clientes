# MSC Clientes — como colocar no ar

Sistema de cadastro de clientes e compras da MSC Assistência Técnica.
Custo: **R$ 0** (plano grátis do Supabase + Vercel). Tempo: uns 20 minutos.

## O que tem no pacote

| Arquivo | Para que serve |
|---|---|
| `supabase/schema.sql` | Cria o banco de dados (tabelas, segurança, histórico de alterações) |
| `index.html`, `app.js`, `styles.css` | O sistema (telas) |
| `config.js` | Onde você cola as chaves do Supabase |
| `vercel.json` | Configurações de segurança do site |

## O que o sistema faz

- Cadastro de clientes: nome, telefone/WhatsApp, e-mail, data de nascimento, CEP (preenche rua, bairro e cidade sozinho), observações
- Compras de cada cliente: data, descrição, valor, forma de pagamento (com parcelas no crédito), observação
- Total gasto, número de compras e ticket médio por cliente
- Aba Compras: tudo que foi vendido num período, com total e divisão por forma de pagamento
- Aba Aniversariantes: clientes que fazem aniversário no mês, com botão de parabéns pronto no WhatsApp
- Busca por nome, telefone ou e-mail; botão para exportar tudo em planilha (abre no Excel)
- Avisa se você tentar cadastrar um cliente com telefone ou e-mail que já existe
- Nada é apagado: cliente é **inativado** e compra é **cancelada** com motivo. O histórico fica guardado, e toda alteração fica registrada na tabela `auditoria`

---

## Passo 1 — Criar o banco no Supabase

1. Entre em **supabase.com** → *Start your project* → crie a conta (pode ser com o GitHub ou e-mail).
2. Clique em **New project**:
   - Name: `msc-clientes`
   - Database Password: crie uma senha forte e **guarde**
   - Region: **South America (São Paulo)**
   - Clique em *Create new project* e espere uns 2 minutos.
3. No menu da esquerda, abra **SQL Editor** → **New query**.
4. Abra o arquivo `supabase/schema.sql`, copie **tudo**, cole no editor e clique em **Run**.
   Deve aparecer *Success. No rows returned*.

## Passo 2 — Criar o login da loja

1. Menu **Authentication** → **Sign In / Providers** (ou *Providers*) → em **Email**, **desligue** *Allow new users to sign up* e salve.
   (Assim ninguém de fora consegue criar conta no sistema.)
2. **Authentication** → **Users** → **Add user** → **Create new user**:
   - E-mail: o e-mail da loja
   - Senha: uma senha forte
   - Marque **Auto Confirm User**
3. Esse é o login que a equipe vai usar.

## Passo 3 — Colar as chaves no `config.js`

1. Menu **Project Settings** (engrenagem) → **Data API** → copie a **Project URL**.
2. **Project Settings** → **API Keys** → copie a chave **anon public** (ou a *publishable key*, que começa com `sb_publishable_` — as duas funcionam).
3. Abra o `config.js` num editor de texto (Bloco de Notas serve) e troque:
   ```js
   export const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'cole-a-chave-aqui';
   ```
4. **Nunca** use a chave `service_role` / `secret` aqui.

## Passo 4 — Colocar o site no ar (GitHub + Vercel)

1. Entre em **github.com**, crie conta e clique em **New repository**:
   - Nome: `msc-clientes`, marque **Private**, *Create repository*.
   - Clique em **uploading an existing file**, arraste todos os arquivos e a pasta `supabase` e clique em *Commit changes*.
2. Entre em **vercel.com** → *Sign up* com o GitHub.
3. **Add New** → **Project** → escolha o repositório `msc-clientes` → **Deploy** (não precisa mudar nada).
4. Em 1 minuto ele te dá um link tipo `msc-clientes.vercel.app`. Pronto, o sistema está no ar.
5. (Opcional) De volta ao Supabase: **Authentication** → **URL Configuration** → em *Site URL*, cole o link da Vercel.

Para atualizar o sistema depois: troque o arquivo no GitHub e a Vercel publica sozinha.

> Alternativa sem GitHub: **app.netlify.com/drop** — arraste a pasta inteira e ele gera o link na hora.

## Passo 5 — Usar no dia a dia

- Abra o link no computador da loja e no celular. No celular, use *Adicionar à tela inicial* para virar um "app".
- Lançar compra: aba **Clientes** → abra o cliente → **+ Nova compra**.

## Cuidados importantes

- **Backup:** o plano grátis do Supabase não deixa baixar backups automáticos. Clique em **Exportar planilha** pelo menos 1x por semana e guarde o arquivo.
- **Projeto pausado:** no plano grátis, se o sistema ficar 7 dias sem ninguém usar, o Supabase pausa o projeto. É só entrar no painel e clicar em *Restore*. Com uso diário isso não acontece.
- **LGPD:** são dados pessoais dos clientes. Use o sistema só para atendimento e relacionamento da loja, não compartilhe a senha fora da equipe e troque a senha se alguém sair da loja (Authentication → Users).
- Esqueceu a senha? No Supabase: Authentication → Users → clique no usuário → *Send password recovery* (ou crie um usuário novo).
