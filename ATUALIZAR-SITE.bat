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

echo [1/5] Verificando projeto...
echo     ATENCAO: copia automatica do v2 foi desativada.
echo     As alteracoes agora sao feitas diretamente na pasta src/.
echo     Use DEPLOY.bat para subir as mudancas para o site.
echo     Passo pulado.

:: Garante que estamos na pasta do projeto
cd /d "%PROJETO%"

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
cd /d "%PROJETO%"
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
