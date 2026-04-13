@echo off
chcp 65001 >nul
:: Garante que roda na pasta correta (onde o .bat está)
cd /d "%~dp0"
echo.
echo ==============================
echo   Novo-site — Deploy v2
echo ==============================
echo.
echo Pasta: %CD%
echo.

echo [1/3] Instalando dependencias...
call npm install
if %errorlevel% neq 0 ( echo ERRO no npm install! & pause & exit /b 1 )

echo.
echo [2/3] Fazendo commit...
git add .
git commit -m "feat: Meu Negocio Pro v2 - nova UI, novos componentes, melhor performance"

echo.
echo [3/3] Push para GitHub (Vercel faz deploy automatico)...
git push

echo.
echo ==============================
echo   PRONTO! Aguarde ~1 min e
echo   acesse seu site no ar.
echo ==============================
pause
