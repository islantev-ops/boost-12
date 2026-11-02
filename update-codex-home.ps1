#Requires -Version 5.1
param([string]$Destination='D:\GPT Codex Redstar Dom',[switch]$CheckOnly)
$ErrorActionPreference='Stop'
function Run-Git([string[]]$GitArgs) {
    & git @GitArgs
    if($LASTEXITCODE -ne 0){throw ('git failed: '+($GitArgs -join ' '))}
}
function Update-Repo([string]$Path,[string]$Remote) {
    if(-not(Test-Path -LiteralPath $Path)) {
        if($CheckOnly){Write-Host "Would clone $Remote -> $Path";return}
        Run-Git @('clone',$Remote,$Path)
    } else {
        if(-not(Test-Path -LiteralPath (Join-Path $Path '.git'))){throw "Folder exists but is not a repository: $Path"}
        $actual= & git -C $Path remote get-url origin
        if($LASTEXITCODE -ne 0 -or $actual.TrimEnd('/') -ne $Remote){throw "Unexpected origin in $Path"}
        $dirty= & git -C $Path status --porcelain
        if($LASTEXITCODE -ne 0 -or $dirty){throw "Local changes in $Path. Save them before updating."}
        if(-not $CheckOnly) {
            Run-Git @('-C',$Path,'fetch','origin')
            Run-Git @('-C',$Path,'merge','--ff-only','origin/main')
        }
    }
}
if([IO.Path]::GetFullPath($Destination).TrimEnd('\') -ine 'D:\GPT Codex Redstar Dom'){throw 'Destination must be D:\GPT Codex Redstar Dom'}
foreach($cmd in @('git','node','npm','codex')) {if(-not(Get-Command $cmd -ErrorAction SilentlyContinue)){throw "Missing command: $cmd"}}
Update-Repo $Destination 'https://github.com/islantev-ops/boost-12.git'
Update-Repo (Join-Path $Destination 'Codex-config') 'https://github.com/islantev-ops/claude-config.git'
if($CheckOnly){Write-Host 'Check completed; no changes made.';exit 0}
& (Join-Path $Destination 'Codex-config\scripts\setup-codex-home.ps1') -Apply
if(-not $?){throw 'Home setup failed'}
Write-Host "READY. Restart Codex and open: $Destination"
Start-Process explorer.exe -ArgumentList ('"'+$Destination+'"')
