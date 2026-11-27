# Installation 100% Windows natif de Prusa Pilot 3D
# ZERO WSL, ZERO Linux, ZERO droit administrateur requis !
# Double-cliquez sur "1-Installer-sur-Windows.bat"

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

try {
    $ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
    Set-Location $ProjectDir

    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host " Prusa Pilot 3D - Installation 100% Windows (Sans Admin)" -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "Dossier du projet : $ProjectDir" -ForegroundColor Gray
    Write-Host ""

    $VendorDir = Join-Path $ProjectDir "vendor"
    $NodeDir = Join-Path $VendorDir "node"
    $SlicerDir = Join-Path $VendorDir "prusaslicer"
    New-Item -ItemType Directory -Force -Path $VendorDir | Out-Null

    # 1. Verifier ou telecharger Node.js 20 portable (sans droits admin)
    $needNode = $true
    $localNodeExe = Join-Path $NodeDir "node.exe"

    if (Test-Path $localNodeExe) {
        $env:Path = "$NodeDir;$env:Path"
        $needNode = $false
    } else {
        $sysNode = Get-Command node.exe -ErrorAction SilentlyContinue
        if ($sysNode) {
            $verRaw = (& node.exe -v 2>$null)
            if ($verRaw -match "^v(\d+)\.") {
                if ([int]$Matches[1] -ge 20) {
                    $needNode = $false
                    Write-Host "[1/5] Node.js systeme detecte : $verRaw" -ForegroundColor Green
                }
            }
        }
    }

    if ($needNode) {
        Write-Host "[1/5] Telechargement de Node.js 20 portable (Windows 64-bit, sans admin)..." -ForegroundColor Cyan
        $oldProgress = $ProgressPreference
        $ProgressPreference = "SilentlyContinue"
        try {
            $shasums = Invoke-RestMethod -Uri "https://nodejs.org/dist/latest-v20.x/SHASUMS256.txt"
            $zipName = ($shasums -split "`n" | Where-Object { $_ -match "node-v20\.\d+\.\d+-win-x64\.zip" } | Select-Object -First 1)
            if ($zipName -match "(node-v20\.\d+\.\d+-win-x64\.zip)") {
                $fileName = $Matches[1]
            } else {
                $fileName = "node-v20.20.1-win-x64.zip"
            }
            $nodeUrl = "https://nodejs.org/dist/latest-v20.x/$fileName"
            $nodeZip = Join-Path $env:TEMP "prusapilot_node.zip"
            $nodeExtract = Join-Path $env:TEMP "prusapilot_node_extract"

            Write-Host "      Source : $nodeUrl" -ForegroundColor Gray
            Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeZip
            if (Test-Path $nodeExtract) { Remove-Item -Recurse -Force $nodeExtract }
            Expand-Archive -Path $nodeZip -DestinationPath $nodeExtract -Force

            $inner = Get-ChildItem -Path $nodeExtract -Directory | Select-Object -First 1
            if (Test-Path $NodeDir) { Remove-Item -Recurse -Force $NodeDir }
            Move-Item -Path $inner.FullName -Destination $NodeDir

            Remove-Item -Force $nodeZip -ErrorAction SilentlyContinue
            Remove-Item -Recurse -Force $nodeExtract -ErrorAction SilentlyContinue
        } finally {
            $ProgressPreference = $oldProgress
        }
        $env:Path = "$NodeDir;$env:Path"
        Write-Host "      Node.js portable pret : $(& node.exe -v)" -ForegroundColor Green
    }

    # 2. Verifier ou telecharger PrusaSlicer Windows portable (sans droits admin)
    Write-Host ""
    $slicerCandidates = @(
        (Join-Path $SlicerDir "prusa-slicer.exe"),
        "C:\Program Files\Prusa3D\PrusaSlicer\prusa-slicer.exe",
        "C:\Program Files (x86)\Prusa3D\PrusaSlicer\prusa-slicer.exe",
        (Join-Path $env:LOCALAPPDATA "Programs\Prusa3D\PrusaSlicer\prusa-slicer.exe")
    )
    $foundSlicer = $slicerCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

    if ($foundSlicer) {
        Write-Host "[2/5] PrusaSlicer Windows detecte : $foundSlicer" -ForegroundColor Green
    } else {
        Write-Host "[2/5] Telechargement de PrusaSlicer Windows portable (sans admin)..." -ForegroundColor Cyan
        $oldProgress = $ProgressPreference
        $ProgressPreference = "SilentlyContinue"
        try {
            $release = Invoke-RestMethod -Uri "https://api.github.com/repos/prusa3d/PrusaSlicer/releases/latest" -Headers @{ "User-Agent" = "PrusaPilotWindows" }
            $asset = $release.assets | Where-Object { $_.name -match "win64.*\.zip$" } | Select-Object -First 1
            if (-not $asset) {
                throw "Archive ZIP Windows introuvable sur GitHub PrusaSlicer. Installez PrusaSlicer manuellement depuis prusa3d.com."
            }
            Write-Host "      Source : $($asset.name)" -ForegroundColor Gray
            $slicerZip = Join-Path $env:TEMP "prusapilot_slicer.zip"
            $slicerExtract = Join-Path $env:TEMP "prusapilot_slicer_extract"

            Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $slicerZip
            if (Test-Path $slicerExtract) { Remove-Item -Recurse -Force $slicerExtract }
            Expand-Archive -Path $slicerZip -DestinationPath $slicerExtract -Force

            $exeFound = Get-ChildItem -Path $slicerExtract -Filter "prusa-slicer.exe" -Recurse | Select-Object -First 1
            if (-not $exeFound) {
                throw "prusa-slicer.exe introuvable dans l'archive telechargee."
            }
            if (Test-Path $SlicerDir) { Remove-Item -Recurse -Force $SlicerDir }
            Move-Item -Path $exeFound.Directory.FullName -Destination $SlicerDir

            Remove-Item -Force $slicerZip -ErrorAction SilentlyContinue
            Remove-Item -Recurse -Force $slicerExtract -ErrorAction SilentlyContinue
        } finally {
            $ProgressPreference = $oldProgress
        }
        Write-Host "      PrusaSlicer portable pret dans vendor\prusaslicer\" -ForegroundColor Green
    }

    # 3. Copier le profil imprimante personnalise dans %APPDATA%\PrusaSlicer\printer
    Write-Host ""
    Write-Host "[3/5] Installation du profil imprimante MK4S + PLA..." -ForegroundColor Cyan
    $appDataSlicer = Join-Path $env:APPDATA "PrusaSlicer"
    $appDataPrinter = Join-Path $appDataSlicer "printer"
    New-Item -ItemType Directory -Force -Path $appDataPrinter | Out-Null

    $bundledIni = Join-Path $ProjectDir "config\prusaslicer\printer\Original Prusa MK4S 0.4 nozzle bon.ini"
    if (Test-Path $bundledIni) {
        Copy-Item -Path $bundledIni -Destination $appDataPrinter -Force
        Write-Host "      Profil 'Original Prusa MK4S 0.4 nozzle bon' installe." -ForegroundColor Green
    }

    # 4. Configuration PrusaLink (.env)
    Write-Host ""
    Write-Host "[4/5] Configuration PrusaLink (modifiable aussi a tout moment via le bouton parametres du site)" -ForegroundColor Cyan
    $envPath = Join-Path $ProjectDir ".env"
    if (Test-Path $envPath) {
        Write-Host "      Fichier .env deja present, conserve tel quel." -ForegroundColor Green
    } else {
        $prusaIp = Read-Host "Adresse IP de la Prusa [192.168.0.17]"
        if ([string]::IsNullOrWhiteSpace($prusaIp)) { $prusaIp = "192.168.0.17" }

        $prusaUser = Read-Host "Utilisateur PrusaLink [maker]"
        if ([string]::IsNullOrWhiteSpace($prusaUser)) { $prusaUser = "maker" }

        $prusaKey = Read-Host "Mot de passe / Cle API PrusaLink"

        $envContent = @(
            'DATABASE_URL="file:./dev.db"',
            "PRUSA_IP=`"$prusaIp`"",
            'PRUSA_HOSTNAME="prusa-mk4"',
            "PRUSA_USER=`"$prusaUser`"",
            "PRUSA_API_KEY=`"$prusaKey`"",
            'PRUSA_MOCK="false"'
        ) -join "`r`n"
        Set-Content -Path $envPath -Value $envContent -Encoding ASCII
        Write-Host "      Fichier .env cree." -ForegroundColor Green
    }

    # 5. Dependances npm, base SQLite et build de production
    Write-Host ""
    Write-Host "[5/5] Installation des modules npm, base SQLite et compilation..." -ForegroundColor Cyan
    & npm.cmd install
    if ($LASTEXITCODE -ne 0) { throw "npm install a echoue." }

    & npx.cmd prisma migrate deploy
    if ($LASTEXITCODE -ne 0) { throw "prisma migrate deploy a echoue." }

    $dbPath = Join-Path $ProjectDir "prisma\dev.db"
    if (-not (Test-Path $dbPath) -or (Get-Item $dbPath).Length -eq 0) {
        & npm.cmd run db:seed
    }

    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build a echoue." }

    # Creer le raccourci de lancement sur le Bureau Windows
    $desktop = [Environment]::GetFolderPath("Desktop")
    $launcherPath = Join-Path $desktop "Lancer-Prusa-Pilot.bat"
    $launcherContent = @(
        "@echo off",
        "title Prusa Pilot 3D - Serveur Windows",
        "cd /d `"$ProjectDir`"",
        "call `"$ProjectDir\windows\2-Lancer-Prusa-Pilot.bat`""
    ) -join "`r`n"
    Set-Content -Path $launcherPath -Value $launcherContent -Encoding ASCII

    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host " Installation 100% Windows terminee avec succes !" -ForegroundColor Green
    Write-Host " Double-cliquez sur 'Lancer-Prusa-Pilot.bat' sur votre Bureau." -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Green
}
catch {
    Write-Host ""
    Write-Host "ERREUR PENDANT L'INSTALLATION :" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
}
