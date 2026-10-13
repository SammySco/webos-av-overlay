<#
.SYNOPSIS
  Installs the AV Overlay and its settings icon on a rooted LG TV from Windows (no Git Bash or Node needed).

.DESCRIPTION
  Does what scripts/install.sh does: copies the two packages to the TV over SSH, installs them, asks for the
  settings it needs (receiver address, optional Plex, Auto info, bar position), saves them on the TV and starts
  the service. It uses the .ipk files from the "build" folder next to the "scripts" folder; if there are none it
  builds them with Node (npm run package).

  Run it by double-clicking Install-AVOverlay.cmd, or:
    powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -TvHost root@192.168.1.50

  Settings can be given as parameters or environment variables (EARC_AMP_HOST, EARC_AMP_PORT, EARC_PLEX_URL,
  EARC_PLEX_TOKEN, EARC_PLEX_PLAYER_IP, EARC_AUTO_INFO, EARC_CORNER); -NonInteractive never asks questions.
#>
[CmdletBinding()]
param(
  [string]$TvHost = $env:TV_HOST,
  [string]$SshKey = $env:TV_SSH_KEY,
  [string]$AmpHost = $env:EARC_AMP_HOST,   # 'none' removes a saved receiver (the info bar then shows only what the TV knows)
  [string]$AmpPort = $env:EARC_AMP_PORT,
  [string]$PlexUrl = $env:EARC_PLEX_URL,
  [string]$PlexToken = $env:EARC_PLEX_TOKEN,
  [string]$PlexPlayerIp = $env:EARC_PLEX_PLAYER_IP,
  [string]$AutoInfo = $env:EARC_AUTO_INFO,
  [string]$TvAudio = $env:EARC_TV_AUDIO,   # on|off: the "Audio (TV)" line (what the TV itself sees on its input)
  [string]$Corner = $env:EARC_CORNER,
  [switch]$NonInteractive
)

$ErrorActionPreference = 'Stop'
$AppId = 'com.sammysco.avoverlay'
$SettingsId = 'com.sammysco.avoverlay.settings'
$Root = Split-Path -Parent $PSScriptRoot
if ($env:EARC_NONINTERACTIVE -eq '1') { $NonInteractive = $true }
$Interactive = (-not $NonInteractive) -and [Environment]::UserInteractive -and ($Host.Name -ne 'Default Host')

function Fail($message) { Write-Host "ERROR: $message" -ForegroundColor Red; exit 1 }

# ---------- tools ----------
if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
  Fail 'ssh was not found. Turn on "OpenSSH Client" in Windows (Settings > Apps > Optional features) and run this again.'
}
if (-not (Get-Command scp -ErrorAction SilentlyContinue)) { Fail 'scp was not found (it comes with the Windows OpenSSH Client).' }

# ---------- where is the TV ----------
if (-not $TvHost) {
  if (-not $Interactive) { Fail 'Give the TV address with -TvHost root@TV_IP (or set TV_HOST).' }
  $ans = Read-Host 'TV IP address (for example 192.168.1.50)'
  if (-not $ans) { Fail 'No TV address given.' }
  $TvHost = $ans
}
if ($TvHost -notmatch '@') { $TvHost = "root@$TvHost" }
if ($TvHost -notmatch '^[A-Za-z0-9_.-]+@[A-Za-z0-9.-]+$') { Fail "That does not look like user@address: $TvHost" }

$sshArgs = @('-o', 'StrictHostKeyChecking=accept-new')
if ($SshKey) { $sshArgs += @('-i', $SshKey) }
$noise = 'post-quantum|store now, decrypt later|openssh\.com/pq|^\*\* '

# Runs ssh with the given remote command words and sends $Stdin to it as plain UTF-8 bytes. (Piping text to a native
# command from Windows PowerShell can add a byte-order mark, which the TV's shell would try to run as a command.)
function Invoke-Ssh([string[]]$Remote, [string]$Stdin) {
  $parts = @()
  foreach ($x in ($sshArgs + @($TvHost) + $Remote)) {
    if ($x -match '[\s"]') { $parts += ('"' + $x.Replace('"', '\"') + '"') } else { $parts += $x }
  }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = (Get-Command ssh).Source
  $psi.Arguments = ($parts -join ' ')
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  # Windows PowerShell's .NET writes a byte-order mark first when the console input encoding is UTF-8 with a preamble
  $savedEnc = $null
  try { $savedEnc = [Console]::InputEncoding; [Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
  try { $p = [System.Diagnostics.Process]::Start($psi) }
  finally { if ($savedEnc) { try { [Console]::InputEncoding = $savedEnc } catch { } } }
  $outTask = $p.StandardOutput.ReadToEndAsync()
  $errTask = $p.StandardError.ReadToEndAsync()
  $bytes = (New-Object System.Text.UTF8Encoding $false).GetBytes($Stdin)
  try { $p.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length); $p.StandardInput.BaseStream.Flush() } catch { }
  $p.StandardInput.Close()
  $p.WaitForExit()
  $errLines = $errTask.Result -split '\r?\n' | Where-Object { $_ -and $_ -notmatch $noise }
  return [pscustomobject]@{ Out = ($outTask.Result -replace '\r', ''); Err = ($errLines -join "`n"); Code = $p.ExitCode }
}

# Runs a shell script on the TV (sent on stdin, so quoting never gets in the way) and returns its output.
function Invoke-Tv([string]$Script) {
  $r = Invoke-Ssh @('sh', '-s') ($Script -replace "`r`n", "`n")
  return (($r.Out + "`n" + $r.Err).Trim())
}

Write-Host "Checking the connection to $TvHost ..."
$check = Invoke-Tv 'echo ok'
if ($check -notmatch '(?m)^ok\s*$') {
  Write-Host $check
  Fail "Could not log in to $TvHost over SSH. Is SSH enabled in the Homebrew Channel, and does 'ssh $TvHost' work from a terminal?"
}

# ---------- find the packages ----------
function Find-Ipk([string]$id) {
  foreach ($d in @((Join-Path $Root 'build'), $Root)) {
    if (Test-Path $d) {
      $f = Get-ChildItem -Path $d -Filter "${id}_*_all.ipk" -File -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -Last 1
      if ($f) { return $f.FullName }
    }
  }
  return $null
}
$Ipk = Find-Ipk $AppId
$SettingsIpk = Find-Ipk $SettingsId
if (-not $Ipk -or -not $SettingsIpk) {
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Fail 'No .ipk packages were found and Node.js (npm) is not installed to build them. Use the release archive, which contains the packages.'
  }
  Write-Host 'Building the packages with Node ...'
  Push-Location $Root
  try {
    if (-not (Test-Path 'node_modules')) { & npm install; if ($LASTEXITCODE -ne 0) { Fail 'npm install failed.' } }
    & npm run package; if ($LASTEXITCODE -ne 0) { Fail 'npm run package failed.' }
  } finally { Pop-Location }
  $Ipk = Find-Ipk $AppId
  $SettingsIpk = Find-Ipk $SettingsId
  if (-not $Ipk -or -not $SettingsIpk) { Fail 'The packages were not created.' }
}

function Install-Ipk([string]$path, [string]$name) {
  Write-Host "Installing $name ..."
  $scpArgs = @('-o', 'StrictHostKeyChecking=accept-new')
  if ($SshKey) { $scpArgs += @('-i', $SshKey) }
  $null = & scp @scpArgs $path "${TvHost}:/tmp/earc-volume-overlay.ipk" 2>&1
  if ($LASTEXITCODE -ne 0) { Fail "Could not copy $path to the TV." }
  # luna-send needs a terminal on these TVs, so it runs under script(1)
  $remote = @'
script -q -c "luna-send -w 60000 -i luna://com.webos.appInstallService/dev/install '{\"id\":\"com.ares.defaultName\",\"ipkUrl\":\"/tmp/earc-volume-overlay.ipk\",\"subscribe\":true}'" /dev/null | tr -d '\r' | grep -oE '"state":"[^"]*"|"errorText":"[^"]*"' | uniq
'@
  $result = Invoke-Tv $remote
  if ($result -match '"state":"installed"') { Write-Host '  installed' }
  else { Write-Host $result; Fail "$name did not report 'installed'." }
}
Install-Ipk $Ipk $AppId
Install-Ipk $SettingsIpk $SettingsId

# ---------- find the app on the TV and read what is already configured ----------
$findApp = @'
for BASE in /media/developer/apps/usr/palm/applications /media/cryptofs/apps/usr/palm/applications; do
  if [ -f "$BASE/com.sammysco.avoverlay/runtime/watcher.js" ]; then echo "$BASE/com.sammysco.avoverlay"; break; fi
done
'@
$AppDir = (Invoke-Tv $findApp).Trim()
if (-not $AppDir -or $AppDir -match '\s') { Fail 'Could not find the installed app on the TV.' }
$cur = @{}
(Invoke-Tv "node '$AppDir/runtime/configure.js' get") -split "`n" | ForEach-Object {
  if ($_ -match '^([A-Za-z]+)=(.*)$') { $cur[$Matches[1]] = $Matches[2].Trim() }
}

# ---------- settings ----------
function Ask([string]$prompt, [string]$default) {
  $a = Read-Host $(if ($default) { "$prompt [$default]" } else { $prompt })
  if ($a) { return $a.Trim() } else { return $default }
}
function Test-HostName([string]$h) { return ($h -match '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$') }

$AmpClear = $false
if ($AmpHost -match '^(?i:none)$') { $AmpHost = ''; $AmpClear = $true }

if ($Interactive) {
  Write-Host ''
  Write-Host 'Settings (press Enter to keep the value in [brackets]; everything can be changed later at http://<tv>:41101/setup)'
  if (-not $AmpHost -and -not $AmpClear) {
    $port = if ($AmpPort) { $AmpPort } else { '80' }
    while ($true) {
      $label = if ($cur['ampHost']) { 'Yamaha receiver IP address or hostname, or "none" to remove it' } else { 'Yamaha receiver IP address or hostname (press Enter to skip: the info bar then shows only what the TV knows)' }
      $ans = Ask $label $cur['ampHost']
      if ($ans -match '^(?i:none)$') { $AmpClear = $true; Write-Host '  No receiver. You can add one later at http://<tv>:41101/setup.'; break }
      if (-not $ans) { Write-Host '  Skipped. You can add a receiver later at http://<tv>:41101/setup.'; break }
      if (-not (Test-HostName $ans)) { Write-Host '  That does not look like an IP address or hostname.'; continue }
      Write-Host '  Checking that the TV can reach it ...'
      $probe = Invoke-Tv "curl -s -m 4 http://${ans}:${port}/YamahaExtendedControl/v1/system/getDeviceInfo"
      if ($probe -match '"response_code"\s*:\s*0') { Write-Host '  Found a Yamaha receiver.'; $AmpHost = $ans; break }
      $yn = Read-Host '  No Yamaha receiver answered there. Use it anyway? [y/N]'
      if ($yn -match '^[yY]') { $AmpHost = $ans; break }
    }
  }
  if (-not $PlexUrl) {
    $hasPlex = [bool]$cur['plexUrl']
    $hint = if ($hasPlex) { 'Y/n' } else { 'y/N' }
    $yn = Read-Host "Show Plex stream details (codec, bitrate, direct play)? [$hint]"
    $want = if ($yn) { $yn -match '^[yY]' } else { $hasPlex }
    if ($want) {
      $defUrl = if ($cur['plexUrl']) { $cur['plexUrl'] } else { 'http://192.168.1.10:32400' }
      $PlexUrl = Ask 'Plex server URL' $defUrl
      if (-not $PlexToken) {
        $keep = ($cur['plexTokenSet'] -eq 'yes' -and $PlexUrl -eq $cur['plexUrl'])
        $label = if ($keep) { 'Plex token (Enter to keep the saved one; typing is hidden)' } else { 'Plex token (typing is hidden)' }
        $secure = Read-Host $label -AsSecureString
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try { $PlexToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
      }
      if (-not $PlexPlayerIp) { $PlexPlayerIp = Ask 'Only use sessions from one player? Its IP address, or Enter for any' $cur['plexPlayer'] }
    }
  }
  if (-not $AutoInfo) {
    $defAuto = if ($cur['autoInfo']) { $cur['autoInfo'] } else { 'on' }
    $AutoInfo = Ask 'Show the info bar by itself when the stream or amp info changes? (on/off)' $defAuto
  }
  if (-not $TvAudio) {
    $defTva = if ($cur['tvAudio']) { $cur['tvAudio'] } else { 'off' }
    # with no receiver the TV's own audio line is the only audio information, so suggest it
    if ($AmpClear -or (-not $AmpHost -and -not $cur['ampHost'])) { $defTva = 'on' }
    $TvAudio = Ask 'Show an "Audio (TV)" line (the audio format, channels and rate the TV itself sees on its input)? (on/off)' $defTva
  }
  if (-not $Corner) {
    $defCorner = if ($cur['corner']) { $cur['corner'] } else { 'top-left' }
    $Corner = Ask 'Info bar position (top-left, top-center, top-right, middle-left, middle-right, bottom-left, bottom-center, bottom-right)' $defCorner
  }
}

$lines = @()
if ($AmpHost)      { $lines += "ampHost=$AmpHost" }
if ($AmpClear)     { $lines += 'ampClear=yes' }
if ($TvAudio)      { $lines += "tvAudio=$TvAudio" }
if ($AmpPort)      { $lines += "ampPort=$AmpPort" }
if ($PlexUrl)      { $lines += "plexUrl=$PlexUrl" }
if ($PlexToken)    { $lines += "plexToken=$PlexToken" }     # sent on stdin only, never on a command line
if ($PlexPlayerIp) { $lines += "plexPlayer=$PlexPlayerIp" }
if ($AutoInfo)     { $lines += "autoInfo=$AutoInfo" }
if ($Corner)       { $lines += "corner=$Corner" }
if ($lines.Count -gt 0) {
  $payload = ($lines -join "`n") + "`n"
  $res = Invoke-Ssh @('node', "$AppDir/runtime/configure.js", 'set') $payload
  if ($res.Out -notmatch 'settings saved') { Fail "The TV did not accept the settings: $($res.Out) $($res.Err)" }
  Write-Host 'Settings saved.'
}
if ($AmpClear -or (-not $AmpHost -and -not $cur['ampHost'])) {
  Write-Host 'NOTE: no receiver address is set. The info bar will show only what the TV (and Plex/Jellyfin) knows, with no volume popup' -ForegroundColor Yellow
  Write-Host '      or sound programs. Add a Yamaha receiver any time at http://<tv>:41101/setup (or the AV Overlay icon on the TV).' -ForegroundColor Yellow
}

# ---------- start the service ----------
Write-Host 'Enabling the watcher ...'
# the app directory is put into the script text itself
$enable = @"
set -e
APP_DIR='$AppDir'
"@ + @'

rm -rf /var/lib/earc-volume-overlay
if [ -f /tmp/earc-volume-overlay.pid ]; then
  pid=$(cat /tmp/earc-volume-overlay.pid 2>/dev/null || true)
  if [ -n "$pid" ] && tr "\000" " " < "/proc/$pid/cmdline" 2>/dev/null | grep -q watcher.js; then kill "$pid" 2>/dev/null || true; sleep 1; fi
fi
mkdir -p /var/lib/webosbrew/init.d
chmod 755 "$APP_DIR/runtime/91-earc-volume-overlay"
ln -sf "$APP_DIR/runtime/91-earc-volume-overlay" /var/lib/webosbrew/init.d/91-earc-volume-overlay
rm -f /tmp/earc-volume-overlay.pid /tmp/earc-volume-overlay.ipk
/var/lib/webosbrew/init.d/91-earc-volume-overlay
echo started
'@
$r = Invoke-Tv $enable
if ($r -notmatch 'started') { Write-Host $r; Fail 'The service could not be started.' }

$ip = ($TvHost -split '@')[-1]
Write-Host ''
Write-Host 'Installed and enabled.' -ForegroundColor Green
Write-Host "  Status page : http://${ip}:41101/status"
Write-Host "  Settings    : http://${ip}:41101/setup  (or the AV Overlay icon on the TV home screen)"
Write-Host '  Log on TV   : /tmp/earc-volume-overlay.log'
