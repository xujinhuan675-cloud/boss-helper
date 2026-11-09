$ErrorActionPreference = 'Stop'

$databasePath = Join-Path $PSScriptRoot '..\..\Resume-Matcher\apps\backend\data\resume_matcher.db'
if (-not (Test-Path -LiteralPath $databasePath -PathType Leaf)) {
  throw "Resume Matcher database is missing: $databasePath"
}

function Test-Healthy([string]$Url) {
  try {
    (Invoke-WebRequest -Uri $Url -TimeoutSec 3 -UseBasicParsing).StatusCode -eq 200
  } catch {
    $false
  }
}

function Ensure-Service([string]$TaskName, [string]$Name, [string]$Url) {
  if (Test-Healthy $Url) {
    Write-Host "$Name is already running."
    return
  }

  $task = Get-ScheduledTask -TaskName $TaskName
  if ($task.State -ne 'Running') {
    Write-Host "Starting $Name..."
    Start-ScheduledTask -TaskName $TaskName
  }

  $deadline = (Get-Date).AddSeconds(120)
  while ((Get-Date) -lt $deadline) {
    if (Test-Healthy $Url) {
      Write-Host "$Name is ready."
      return
    }
    Start-Sleep -Seconds 2
  }

  throw "$Name did not become healthy within 120 seconds at $Url. Check Task Scheduler history."
}

Ensure-Service 'ResumeMatcher-Backend' 'Resume Matcher backend' 'http://127.0.0.1:8100/api/v1/health'
Ensure-Service 'ResumeMatcher-Frontend' 'Resume Matcher frontend' 'http://127.0.0.1:3000/tailor'
Write-Host 'Resume Matcher is ready at http://localhost:3000/tailor'
