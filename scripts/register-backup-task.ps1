# Registers (or shows) the Windows scheduled task for the daily TALLERIA
# backup. By default it only prints what it would do; it registers the task
# only with -Registrar, and removes it with -Quitar.
#
# The task runs as the current Windows user and only while that user is
# signed in: Docker Desktop and the DPAPI-protected key need the user's
# session. If the computer is off or asleep at the scheduled time, it runs as
# soon as possible afterwards. Failures show a Windows notification and are
# written to %USERPROFILE%\TALLERIA-COPIAS-PRIVADO\registro\copias.log.
#
# Usage (from the repository folder, in PowerShell; -ExecutionPolicy Bypass
# applies only to this run and changes no system setting):
#   powershell -ExecutionPolicy Bypass -File .\scripts\register-backup-task.ps1               # show only
#   powershell -ExecutionPolicy Bypass -File .\scripts\register-backup-task.ps1 -Registrar    # register
#   powershell -ExecutionPolicy Bypass -File .\scripts\register-backup-task.ps1 -Hora 22:30 -Registrar
#   powershell -ExecutionPolicy Bypass -File .\scripts\register-backup-task.ps1 -Quitar       # remove
param(
  [string]$Hora = '21:00',
  [switch]$Registrar,
  [switch]$Quitar
)
$ErrorActionPreference = 'Stop'
$name = 'TALLERIA - copia de seguridad diaria'
$repo = Split-Path -Parent $PSScriptRoot
$script = Join-Path $repo 'scripts\backup-database.mjs'
$node = (Get-Command node -ErrorAction Stop).Source

if ($Quitar) {
  if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
    "Tarea '$name' eliminada."
  } else { "No hay ninguna tarea '$name'." }
  return
}

# Checks that do not reveal any secret.
$checks = [ordered]@{
  'TALLERIA_DB_URL guardada como variable de usuario' = [bool][Environment]::GetEnvironmentVariable('TALLERIA_DB_URL', 'User')
  'Clave de cifrado creada'                          = Test-Path (Join-Path $env:USERPROFILE 'TALLERIA-COPIAS-PRIVADO\clave\backup-key.dpapi')
  'Script de copias presente'                        = Test-Path $script
}
$checks.GetEnumerator() | ForEach-Object { '{0}: {1}' -f $_.Key, $(if ($_.Value) { 'sí' } else { 'NO' }) }
if ($checks.Values -contains $false) { throw 'Falta algún requisito: no se registra la tarea.' }

$at = [datetime]::ParseExact($Hora, 'HH:mm', $null)
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$script`" --daily" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Daily -At $at
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

"Tarea: $name"
"  Cuándo: todos los días a las $Hora (o en cuanto sea posible si el equipo estaba apagado)"
"  Qué: `"$node`" `"$script`" --daily"
"  Como: $env:USERDOMAIN\$env:USERNAME, solo con la sesión iniciada, sin privilegios elevados"
if (-not $Registrar) { 'Solo se ha mostrado. Para registrarla: powershell -ExecutionPolicy Bypass -File .\scripts\register-backup-task.ps1 -Registrar'; return }

Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Copia de seguridad cifrada y verificada de la base de datos de TALLERIA (scripts/backup-database.mjs --daily).' -Force | Out-Null
"Tarea '$name' registrada."
