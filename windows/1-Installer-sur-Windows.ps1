# Installation automatique de Prusa Pilot 3D (avec vrai PrusaSlicer intégré dans l'onglet) sur Windows 10/11 via WSL2
# Utilisation : Clic droit -> "Exécuter avec PowerShell"

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Prusa Pilot 3D — Installation Windows (PrusaSlicer Web)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Vérifier si WSL Ubuntu est installé
$wslList = ""
try {
    $wslList = (wsl -l -q 2>$null | Out-String)
} catch {
    $wslList = ""
}

if (-not ($wslList -match "Ubuntu")) {
    Write-Host "[1/4] Installation de WSL2 + Ubuntu (nécessite les droits administrateur)..." -ForegroundColor Yellow
    Start-Process powershell -Verb RunAs -Wait -ArgumentList "-NoProfile -Command `"wsl --install -d Ubuntu`""
    Write-Host ""
    Write-Host "IMPORTANT : Redémarrez Windows si demandé, ouvrez Ubuntu une fois pour créer votre nom d'utilisateur Linux, puis relancez ce script." -ForegroundColor Yellow
    Pause
    exit 0
}

# Détermine le nom exact de la distro Ubuntu installée
$distro = (wsl -l -q | ForEach-Object { $_.Trim() -replace "`0","" } | Where-Object { $_ -match "^Ubuntu" } | Select-Object -First 1)
if (-not $distro) { $distro = "Ubuntu" }
Write-Host "[1/4] Distribution WSL détectée : $distro" -ForegroundColor Green

# 2. Demander les infos PrusaLink
Write-Host ""
Write-Host "[2/4] Configuration PrusaLink (laissez vide pour garder la valeur par défaut)" -ForegroundColor Cyan
$prusaIp = Read-Host "Adresse IP de la Prusa MK4S [192.168.0.17]"
if ([string]::IsNullOrWhiteSpace($prusaIp)) { $prusaIp = "192.168.0.17" }

$prusaUser = Read-Host "Utilisateur PrusaLink [maker]"
if ([string]::IsNullOrWhiteSpace($prusaUser)) { $prusaUser = "maker" }

$prusaKey = Read-Host "Mot de passe / Clé API PrusaLink (affiché sur l'écran de la Prusa)"

# 3. Copier le dossier courant du projet dans ~/prusa (système de fichiers natif rapide de WSL2)
$winProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$wslSourcePath = (wsl -d $distro -- wslpath -a "$winProjectDir").Trim()

Write-Host ""
Write-Host "[3/4] Copie du projet dans WSL2 (~/prusa) et lancement de l'installation..." -ForegroundColor Cyan
wsl -d $distro -- bash -lc "mkdir -p ~/prusa && cp -a '$wslSourcePath/.' ~/prusa/ && rm -rf ~/prusa/node_modules ~/prusa/.next && chmod +x ~/prusa/scripts/setup-wsl.sh"

# Écrire le fichier .env dans WSL2
$envContent = @"
DATABASE_URL="file:./dev.db"
PRUSA_IP="$prusaIp"
PRUSA_HOSTNAME="prusa-mk4"
PRUSA_USER="$prusaUser"
PRUSA_API_KEY="$prusaKey"
PRUSA_MOCK="false"
"@
$envBase64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($envContent))
wsl -d $distro -- bash -lc "echo '$envBase64' | base64 -d > ~/prusa/.env"

# Exécuter setup-wsl.sh (demande votre mot de passe sudo Ubuntu une fois)
wsl -d $distro -- bash -lc "cd ~/prusa && ./scripts/setup-wsl.sh"

# 4. Copier le raccourci de lancement sur le Bureau Windows (calé sur la distro détectée)
Write-Host ""
Write-Host "[4/4] Création du raccourci 'Lancer-Prusa-Pilot.bat' sur votre Bureau Windows..." -ForegroundColor Cyan
$desktop = [Environment]::GetFolderPath("Desktop")
$batContent = Get-Content (Join-Path $PSScriptRoot "2-Lancer-Prusa-Pilot.bat") -Raw
$batContent = $batContent -replace "wsl -- ", "wsl -d $distro -- "
Set-Content -Path (Join-Path $desktop "Lancer-Prusa-Pilot.bat") -Value $batContent -Encoding ASCII

Write-Host ""
Write-Host "Installation terminée ! Double-cliquez sur 'Lancer-Prusa-Pilot.bat' sur votre Bureau pour démarrer." -ForegroundColor Green
Pause
