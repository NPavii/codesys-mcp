# Warm CODESYS bridge daemon - headless launcher with companion monitor.
# Started from bridge_daemon.cmd (double-click or MCP autostart).
# Both the daemon (CODESYS.exe --noUI) and the monitor window (pythonw) are
# spawned via WMI, i.e. fully detached: no console window to accidentally
# close, and the processes survive the death of whatever started them.
#
# Environment switches:
#   CB_MONITOR=0      - start the daemon without the monitor window
#   CB_KEEP=1         - do NOT kill existing CODESYS.exe processes first
#   CODESYS_EXE       - full path to CODESYS.exe (overrides the search)
#   CODESYS_PROFILE   - CODESYS profile name (default: SP21 Patch 1)
#   CB_PYTHONW        - full path to pythonw.exe for the monitor window
#   CB_PROJECT_DIR    - project dir to clean *.~u lock files from (optional)
#
# Machine-specific values can live in bridge_daemon.local.ps1 next to this
# file (dot-sourced when present; that file is git-ignored).
$ErrorActionPreference = "Stop"
$bridge = Split-Path -Parent $MyInvocation.MyCommand.Path

$local = Join-Path $bridge "bridge_daemon.local.ps1"
if (Test-Path $local) { . $local }

# --- Locate CODESYS.exe: env override, then a shallow search under the
# --- usual install roots (mirrors src/mcp/bridge.ts resolveCodesysExe()).
function Resolve-CodesysExe {
    if ($env:CODESYS_EXE -and (Test-Path $env:CODESYS_EXE)) { return $env:CODESYS_EXE }
    $roots = @("C:\Program Files\CODESYS", "C:\Program Files (x86)\CODESYS")
    foreach ($root in $roots) {
        if (-not (Test-Path $root)) { continue }
        $hit = Get-ChildItem -Path $root -Filter "CODESYS.exe" -Recurse -Depth 2 -ErrorAction SilentlyContinue |
               Select-Object -First 1
        if ($hit) { return $hit.FullName }
    }
    throw "CODESYS.exe not found. Set CODESYS_EXE to the full path " +
          "(e.g. C:\Program Files\CODESYS\...\CODESYS.exe) or create bridge_daemon.local.ps1."
}

$codesys = Resolve-CodesysExe
$profile = if ($env:CODESYS_PROFILE) { $env:CODESYS_PROFILE } else { "CODESYS V3.5 SP21 Patch 1" }

# clean stale project lock files next to known projects
if ($env:CB_PROJECT_DIR -and (Test-Path $env:CB_PROJECT_DIR)) {
    Get-ChildItem -Path $env:CB_PROJECT_DIR -Filter "*.~u" -Recurse -ErrorAction SilentlyContinue |
        Remove-Item -Force -ErrorAction SilentlyContinue
}

if ($env:CB_KEEP -ne "1") {
    # iron rule: exactly ONE daemon - kill leftovers first
    Get-CimInstance Win32_Process -Filter "Name='CODESYS.exe'" | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
}

function Spawn([string]$cmdLine) {
    $r = Invoke-CimMethod -ClassName Win32_Process -Name Create -Arguments @{ CommandLine = $cmdLine }
    if ($r.ReturnValue -ne 0) { throw "WMI Create failed: $($r.ReturnValue)" }
    return $r.ProcessId
}

$pythonw = $null
if ($env:CB_PYTHONW -and (Test-Path $env:CB_PYTHONW)) {
    $pythonw = $env:CB_PYTHONW
} else {
    $cmd = Get-Command pythonw.exe -ErrorAction SilentlyContinue
    if ($cmd) { $pythonw = $cmd.Source }
}

if ($env:CB_MONITOR -ne "0" -and $pythonw) {
    Spawn("`"$pythonw`" `"$bridge\daemon_monitor.pyw`"") | Out-Null
}

$daemonCmd = "`"$codesys`" --noUI --profile=`"$profile`" --runscript=`"$bridge\bridge_daemon.py`""
Spawn($daemonCmd) | Out-Null
