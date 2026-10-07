# Sistema de gestão — como hospedar e como replicar

Sistema de gestão da loja: clientes, vendas (PDV), estoque com IMEI, caixa, contas a pagar e a receber, fluxo de caixa, DRE, permissões por cargo e histórico de alterações.
Roda em **Supabase** (banco e login) e **Vercel** (site). Nos planos grátis, o custo é R$ 0.

## Arquivos

| Arquivo / pasta | Para que serve |
|---|---|
| `index.html`, `css/`, `js/` | O sistema (telas) |
| `config.js` | Endereço e chave pública do Supabase |
| `vercel.json` | Configurações de segurança do site |
| `supabase/*.sql` | Banco de dados, para rodar **em ordem** (01, 02, … 11) num projeto novo; o 09 só faz algo no banco antigo da MSC |

## Atualizar o site da MSC (GitHub → Vercel)

O banco da MSC já está atualizado (o Claude aplica as mudanças direto no Supabase). Para atualizar o site:

1. No GitHub, abra o repositório **msc-clientes**.
2. Clique em **Add file → Upload files** e arraste **todo o conteúdo** do pacote: `index.html`, `config.js`, `vercel.json`, `COMO-HOSPEDAR.md` e as pastas `css`, `js` e `supabase`. Arquivos com o mesmo nome são substituídos. Clique em *Commit changes*.
3. A Vercel publica sozinha em cerca de 1 minuto. No computador da loja, aperte **Ctrl + Shift + R** uma vez para carregar a versão nova.

## Replicar para outro cliente

1. **Supabase:** crie um projeto novo (região São Paulo). Em **SQL Editor**, rode os arquivos `supabase/01` até o último (`11`), **um por vez e em ordem**. Cada um deve terminar com *Success*.
2. **Login:** em Authentication → Providers → Email, desligue *Allow new users to sign up*. Depois crie o primeiro usuário em Authentication → Users → *Add user*, marcando *Auto Confirm User*.
3. **Primeiro gerente:** em SQL Editor, rode o comando abaixo trocando o e-mail:
   `update perfis set cargo = 'gerente' where email = 'email@do.dono';`
4. **Site:** copie esta pasta para um repositório novo no GitHub e troque o `config.js` pela Project URL e pela chave *publishable* do projeto novo. **Nunca** use a chave `service_role`. Por fim, importe o repositório na Vercel.
5. Ao entrar no sistema, abra **Configurações › Empresa e aparência** e troque o nome, o logo, as cores e os textos do recibo. Nenhum nome ou cor da loja fica preso no código.
6. Em **Configurações › Pagamentos e contas**, preencha as taxas da maquininha e os prazos de repasse.

## Usuários e acessos

- Usuário novo: Supabase → Authentication → Users → *Add user*, com *Auto Confirm User* marcado. Ele aparece no sistema como **Vendedor**.
- Para trocar o cargo (Gerente, Vendedor ou Técnico), bloquear alguém ou definir a meta, use **Configurações › Usuários**.
- O que cada cargo pode fazer é marcado em **Configurações › Permissões**. O gerente sempre pode tudo.

## Regras importantes

- Nada é apagado. Venda, conta e entrada são **canceladas** ou **estornadas**, com motivo. Cliente e produto são **inativados**.
- Saldos de estoque e de caixa vêm sempre dos movimentos registrados, que não podem ser alterados.
- Os valores são guardados em centavos, para não haver erro de arredondamento.
