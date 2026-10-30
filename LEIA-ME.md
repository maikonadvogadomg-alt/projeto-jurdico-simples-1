# ⚖️ SK Jurídico 1.7.1 — versão SIMPLIFICADA (28/10)

O mesmo jurídico 1.7 (com todos os consertos de 28/10 — veja `LEIA-ME-1.7.1.md`),
só que **arrumado do jeito simples**, igual às versões que funcionavam:

```
client/    a TELA (o que você vê)
server/    o MOTOR (salva, chama a IA, consulta tribunais)
shared/    as tabelas do banco
package.json   UM só, com npm (sem pnpm)
```
As pastas de modelos do Replit que não eram usadas foram para `_sobras-do-replit/` (nada foi apagado).
O `electron/` (programa .exe antigo) ficou guardado, ainda sem ajustar para esta arrumação.

## 📱 Jeito mais fácil (sem rodar nada pesado no celular): o GitHub monta
1. No Mini SK: abra este projeto → 🐙 GitHub → mande para um repositório seu.
2. No GitHub: **Actions** → **Montar o SK Jurídico** → **Run workflow**.
3. Verde ✔ → **Artifacts**:
   - **Juridico-abre-pelo-index** → um `index.html` que abre sozinho (celular, PWA, Netlify, pen drive).
   - **Juridico-APK** → o app Android.
   - **Juridico-computador** → a versão com servidor.
   Sem servidor, o 🧩 plano B salva no aparelho e a IA fala direto com o Gemini (pede a sua chave uma vez).

## 💻 No computador (Mini SK para PC → 💻 Terminal, dentro da pasta)
```
npm install
npm run dev
```
Abra **http://localhost:5173** (o servidor fica na 8080).
Sem banco: salva no arquivo `sk-juridico-local-data.json`, aqui na pasta.
Com banco: no app, **Configurações** → cole o endereço do **Neon** ou do **Supabase**; para criar as tabelas: `npm run banco`.

Outros comandos: `npm run index` (gera a versão "abre pelo index" em `dist/index`),
`npm run build` + `npm start` (um programa só, abre em http://localhost:8080).

Deu erro? Botão 🐞 → 📋 Copiar → mande para a IA.
