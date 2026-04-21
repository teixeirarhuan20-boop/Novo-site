@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo ================================================
echo   Meu Negocio Pro -- Deploy para o site
echo ================================================
echo.

echo [1/3] Adicionando alteracoes...
git add .
echo     OK!

echo.
echo [2/3] Commitando...
set /p MSG="Descricao do que mudou (Enter para mensagem padrao): "
if "%MSG%"=="" set MSG=update: melhorias no sistema
git commit -m "%MSG%"
echo     OK!

echo.
echo [3/3] Enviando para o servidor (Vercel)...
git push
echo     Push concluido!

echo.
echo ================================================
echo   PRONTO! Aguarde ~1 min e acesse seu site.
echo ================================================
echo.
pause
