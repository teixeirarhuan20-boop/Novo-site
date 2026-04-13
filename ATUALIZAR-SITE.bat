@echo off
chcp 65001 >nul
echo.
echo ================================================
echo   Novo-site — Atualizar com Meu Negócio Pro v2
echo ================================================
echo.

:: Pasta onde este script está = raiz do projeto novo
set PROJETO=%~dp0
set V2=%PROJETO%meu-negocio-pro-v2

echo [1/5] Copiando arquivos do v2 para o projeto...

:: Substitui src/
robocopy "%V2%\src" "%PROJETO%src" /E /IS /IT /NFL /NDL >nul
echo     src/ atualizado!

:: Substitui index.html
copy /Y "%V2%\index.html" "%PROJETO%index.html" >nul
echo     index.html atualizado!

:: Substitui package.json
copy /Y "%V2%\package.json" "%PROJETO%package.json" >nul
echo     package.json atualizado!

:: Substitui vite.config.js
copy /Y "%V2%\vite.config.js" "%PROJETO%vite.config.js" >nul
echo     vite.config.js atualizado!

:: Copia supabase-setup.sql (útil ter na raiz)
copy /Y "%V2%\supabase-setup.sql" "%PROJETO%supabase-setup.sql" >nul
echo     supabase-setup.sql copiado!

echo.
echo [2/5] Instalando dependências...
call npm install
echo     Dependências instaladas!

echo.
echo [3/5] Fazendo build para verificar...
call npm run build
if %errorlevel% neq 0 (
  echo.
  echo ERRO no build! Verifique os erros acima.
  pause
  exit /b 1
)
echo     Build OK!

echo.
echo [4/5] Commitando e fazendo push...
git add .
git commit -m "feat: atualiza para Meu Negócio Pro v2 - UI melhorada, novos componentes, melhor performance"
git push
echo     Push concluído!

echo.
echo ================================================
echo   PRONTO! Vercel vai fazer deploy automaticamente.
echo   Aguarde ~1 min e acesse seu site!
echo ================================================
echo.
pause
