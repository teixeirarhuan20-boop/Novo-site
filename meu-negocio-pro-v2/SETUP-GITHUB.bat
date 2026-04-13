@echo off
chcp 65001 >nul
echo.
echo ================================================
echo   Meu Negócio Pro 2.0 — Setup GitHub + Vercel
echo ================================================
echo.

:: ── Configurações ─────────────────────────────────────────────
set GITHUB_USER=SEU_USUARIO_GITHUB
set GITHUB_TOKEN=SEU_TOKEN_GITHUB
set REPO_NAME=meu-negocio-pro

set VITE_SUPABASE_URL=SUA_URL_SUPABASE
set VITE_SUPABASE_ANON_KEY=SUA_CHAVE_SUPABASE
set VITE_GEMINI_API_KEY=SUA_CHAVE_GEMINI
set VITE_GROQ_API_KEY=SUA_CHAVE_GROQ

:: ── Garante que .bat e arquivos sensíveis não vão pro GitHub ──
echo SETUP-GITHUB.bat >> .gitignore

echo [1/5] Inicializando repositório Git...
git init
git branch -M main
git add .
git commit -m "feat: Meu Negócio Pro 2.0 - initial commit"
echo     OK!

echo.
echo [2/5] Criando repositório no GitHub...
curl -s -X POST ^
  -H "Authorization: token %GITHUB_TOKEN%" ^
  -H "Content-Type: application/json" ^
  -d "{\"name\":\"%REPO_NAME%\",\"description\":\"Meu Negocio Pro 2.0 - Gestao de estoque e pedidos\",\"private\":false}" ^
  https://api.github.com/user/repos
echo     Repositório criado!

echo.
echo [3/5] Fazendo push para o GitHub...
git remote remove origin 2>nul
git remote add origin https://%GITHUB_USER%:%GITHUB_TOKEN%@github.com/%GITHUB_USER%/%REPO_NAME%.git
git push -u origin main
echo     Push concluído!

echo.
echo [4/5] Instalando Vercel CLI e fazendo deploy...
call npm install -g vercel 2>nul
echo.
echo     Configurando variáveis de ambiente no Vercel...
echo %VITE_SUPABASE_URL%       | vercel env add VITE_SUPABASE_URL       production
echo %VITE_SUPABASE_ANON_KEY%  | vercel env add VITE_SUPABASE_ANON_KEY  production
echo %VITE_GEMINI_API_KEY%     | vercel env add VITE_GEMINI_API_KEY     production
echo %VITE_GROQ_API_KEY%       | vercel env add VITE_GROQ_API_KEY       production
echo.
echo     Fazendo deploy no Vercel...
vercel --prod --yes

echo.
echo [5/5] Abrindo repositório no GitHub...
start https://github.com/%GITHUB_USER%/%REPO_NAME%

echo.
echo ================================================
echo   PRONTO! Seu site está no ar.
echo   Acesse: https://%REPO_NAME%.vercel.app
e