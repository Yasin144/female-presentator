$port = 8430
$baseUrl = "http://127.0.0.1:$port"
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
$script:MuxUploadSessions = @{}

function Get-StatusText {
  param([int]$StatusCode)

  switch ($StatusCode) {
    200 { return "OK" }
    204 { return "No Content" }
    400 { return "Bad Request" }
    404 { return "Not Found" }
    405 { return "Method Not Allowed" }
    500 { return "Internal Server Error" }
    default { return "OK" }
  }
}

function Get-BytePatternIndex {
  param(
    [byte[]]$Bytes,
    [byte[]]$Pattern
  )

  if (-not $Bytes -or -not $Pattern -or $Pattern.Length -gt $Bytes.Length) {
    return -1
  }

  for ($index = 0; $index -le ($Bytes.Length - $Pattern.Length); $index += 1) {
    $matched = $true
    for ($patternIndex = 0; $patternIndex -lt $Pattern.Length; $patternIndex += 1) {
      if ($Bytes[$index + $patternIndex] -ne $Pattern[$patternIndex]) {
        $matched = $false
        break
      }
    }

    if ($matched) {
      return $index
    }
  }

  return -1
}

function Read-HttpRequest {
  param([System.IO.Stream]$Stream)

  $buffer = New-Object byte[] 8192
  $headerDelimiter = [byte[]](13, 10, 13, 10)
  $headerEndIndex = -1
  $headerBytes = [byte[]]@()
  $initialBodyBytes = [byte[]]@()
  $headerMemory = New-Object System.IO.MemoryStream

  try {
    while ($headerEndIndex -lt 0) {
      $read = $Stream.Read($buffer, 0, $buffer.Length)
      if ($read -le 0) {
        break
      }

      $headerMemory.Write($buffer, 0, $read)
      $currentHeaderBytes = $headerMemory.ToArray()
      $headerEndIndex = Get-BytePatternIndex -Bytes $currentHeaderBytes -Pattern $headerDelimiter

      if ($headerEndIndex -ge 0) {
        $bodyStartIndex = $headerEndIndex + 4
        $headerBytes = New-Object byte[] $headerEndIndex
        [System.Buffer]::BlockCopy($currentHeaderBytes, 0, $headerBytes, 0, $headerEndIndex)

        $initialBodyLength = $currentHeaderBytes.Length - $bodyStartIndex
        if ($initialBodyLength -gt 0) {
          $initialBodyBytes = New-Object byte[] $initialBodyLength
          [System.Buffer]::BlockCopy($currentHeaderBytes, $bodyStartIndex, $initialBodyBytes, 0, $initialBodyLength)
        }
      }
    }
  } finally {
    $headerMemory.Dispose()
  }

  if ($headerEndIndex -lt 0) {
    throw "Could not parse the HTTP request."
  }

  $headerText = [System.Text.Encoding]::ASCII.GetString($headerBytes)
  $lines = $headerText -split "`r`n"
  $requestLine = $lines[0].Split(" ")
  $headers = @{}
  $contentLength = 0

  foreach ($line in $lines[1..($lines.Length - 1)]) {
    if (-not $line) {
      continue
    }

    $separatorIndex = $line.IndexOf(":")
    if ($separatorIndex -lt 0) {
      continue
    }

    $headers[$line.Substring(0, $separatorIndex).Trim()] = $line.Substring($separatorIndex + 1).Trim()
    if ($line.Substring(0, $separatorIndex).Trim() -ieq "Content-Length") {
      $contentLength = [int]$line.Substring($separatorIndex + 1).Trim()
    }
  }

  $bodyBytes = if ($contentLength -gt 0) {
    New-Object byte[] $contentLength
  } else {
    [byte[]]@()
  }

  $copiedLength = 0
  if ($contentLength -gt 0 -and $initialBodyBytes.Length -gt 0) {
    $copiedLength = [Math]::Min($initialBodyBytes.Length, $contentLength)
    [System.Buffer]::BlockCopy($initialBodyBytes, 0, $bodyBytes, 0, $copiedLength)
  }

  while ($copiedLength -lt $contentLength) {
    $read = $Stream.Read($bodyBytes, $copiedLength, $contentLength - $copiedLength)
    if ($read -le 0) {
      throw "The HTTP request body ended before the declared Content-Length was received."
    }

    $copiedLength += $read
  }

  return @{
    Method = $requestLine[0]
    RawUrl = $requestLine[1]
    Headers = $headers
    BodyBytes = $bodyBytes
  }
}

function Write-HttpResponse {
  param(
    [System.IO.Stream]$Stream,
    [int]$StatusCode,
    [byte[]]$BodyBytes,
    [string]$ContentType = "application/json; charset=utf-8",
    [hashtable]$ExtraHeaders = @{}
  )

  if (-not $BodyBytes) {
    $BodyBytes = [byte[]]@()
  }

  $headers = @(
    "HTTP/1.1 $StatusCode $(Get-StatusText -StatusCode $StatusCode)",
    "Access-Control-Allow-Origin: *",
    "Access-Control-Allow-Methods: GET, POST, OPTIONS",
    "Access-Control-Allow-Headers: Content-Type",
    "Content-Length: $($BodyBytes.Length)",
    "Connection: close"
  )

  if ($ContentType) {
    $headers += "Content-Type: $ContentType"
  }

  foreach ($key in $ExtraHeaders.Keys) {
    $headers += "${key}: $($ExtraHeaders[$key])"
  }

  $headerText = ($headers -join "`r`n") + "`r`n`r`n"
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headerText)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)

  if ($BodyBytes.Length -gt 0) {
    $Stream.Write($BodyBytes, 0, $BodyBytes.Length)
  }
}

function Write-FileResponse {
  param(
    [System.IO.Stream]$Stream,
    [int]$StatusCode,
    [string]$FilePath,
    [string]$ContentType = "application/octet-stream",
    [hashtable]$ExtraHeaders = @{}
  )

  if (-not (Test-Path $FilePath)) {
    throw "The response file was not found."
  }

  $fileInfo = Get-Item $FilePath
  $headers = @(
    "HTTP/1.1 $StatusCode $(Get-StatusText -StatusCode $StatusCode)",
    "Access-Control-Allow-Origin: *",
    "Access-Control-Allow-Methods: GET, POST, OPTIONS",
    "Access-Control-Allow-Headers: Content-Type",
    "Content-Length: $($fileInfo.Length)",
    "Connection: close"
  )

  if ($ContentType) {
    $headers += "Content-Type: $ContentType"
  }

  foreach ($key in $ExtraHeaders.Keys) {
    $headers += "${key}: $($ExtraHeaders[$key])"
  }

  $headerText = ($headers -join "`r`n") + "`r`n`r`n"
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headerText)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)

  $buffer = New-Object byte[] 65536
  $fileStream = [System.IO.File]::OpenRead($FilePath)
  try {
    while (($read = $fileStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
      $Stream.Write($buffer, 0, $read)
    }
  } finally {
    $fileStream.Dispose()
  }
}

function Write-JsonResponse {
  param(
    [System.IO.Stream]$Stream,
    [int]$StatusCode,
    [object]$Payload
  )

  $json = $Payload | ConvertTo-Json -Depth 6 -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  Write-HttpResponse -Stream $Stream -StatusCode $StatusCode -BodyBytes $bytes -ContentType "application/json; charset=utf-8"
}

function Read-JsonBody {
  param([byte[]]$Bytes)

  if (-not $Bytes -or $Bytes.Length -eq 0) {
    return $null
  }

  $json = [System.Text.Encoding]::UTF8.GetString($Bytes)
  if ([string]::IsNullOrWhiteSpace($json)) {
    return $null
  }

  return $json | ConvertFrom-Json
}

function Get-QueryParameters {
  param([System.Uri]$Uri)

  $result = @{}
  $queryText = [string]$Uri.Query
  if ([string]::IsNullOrWhiteSpace($queryText)) {
    return $result
  }

  foreach ($pair in $queryText.TrimStart("?") -split "&") {
    if ([string]::IsNullOrWhiteSpace($pair)) {
      continue
    }

    $parts = $pair -split "=", 2
    $name = [System.Uri]::UnescapeDataString($parts[0])
    $value = if ($parts.Length -gt 1) { [System.Uri]::UnescapeDataString($parts[1]) } else { "" }
    $result[$name] = $value
  }

  return $result
}

function Read-LittleEndianUInt32 {
  param(
    [byte[]]$Bytes,
    [int]$Offset
  )

  return [System.BitConverter]::ToUInt32($Bytes, $Offset)
}

function Write-ByteRangeToFile {
  param(
    [string]$Path,
    [byte[]]$Bytes,
    [int]$Offset,
    [int]$Length
  )

  $fileStream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  try {
    if ($Length -gt 0) {
      $fileStream.Write($Bytes, $Offset, $Length)
    }
  } finally {
    $fileStream.Dispose()
  }
}

function Append-BytesToFile {
  param(
    [string]$Path,
    [byte[]]$Bytes
  )

  $directory = Split-Path -Path $Path -Parent
  if ($directory -and -not (Test-Path $directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }

  $fileStream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  try {
    if ($Bytes -and $Bytes.Length -gt 0) {
      $fileStream.Write($Bytes, 0, $Bytes.Length)
    }
  } finally {
    $fileStream.Dispose()
  }
}

function New-MuxUploadSession {
  param([object]$Metadata)

  $sessionId = [System.Guid]::NewGuid().ToString()
  $videoExtension = Get-FileExtension -FileName ([string]$Metadata.videoFileName) -FallbackExtension ".webm"
  $audioExtension = Get-FileExtension -FileName ([string]$Metadata.audioFileName) -FallbackExtension ".wav"
  $musicExtension = Get-FileExtension -FileName ([string]$Metadata.musicFileName) -FallbackExtension ".wav"
  $videoSegmentCount = [Math]::Max(1, [int]([double]$Metadata.videoSegmentCount))
  $videoPaths = @()
  for ($index = 0; $index -lt $videoSegmentCount; $index += 1) {
    $videoPaths += (Join-Path $env:TEMP ("mux-video-" + $sessionId + "-" + $index + $videoExtension))
  }
  $session = @{
    Id = $sessionId
    Metadata = $Metadata
    VideoPath = $videoPaths[0]
    VideoPaths = $videoPaths
    AudioPath = Join-Path $env:TEMP ("mux-audio-" + $sessionId + $audioExtension)
    MusicPath = Join-Path $env:TEMP ("mux-music-" + $sessionId + $musicExtension)
    VideoBytes = 0
    VideoSegmentBytes = @{}
    AudioBytes = 0
    MusicBytes = 0
  }
  $script:MuxUploadSessions[$sessionId] = $session
  return $session
}

function Remove-MuxUploadSession {
  param([string]$SessionId)

  if (-not $script:MuxUploadSessions.ContainsKey($SessionId)) {
    return
  }

  $session = $script:MuxUploadSessions[$SessionId]
  $videoPaths = @()
  if ($session.VideoPaths) {
    $videoPaths += @($session.VideoPaths)
  } elseif ($session.VideoPath) {
    $videoPaths += $session.VideoPath
  }
  foreach ($path in @($videoPaths + @($session.AudioPath, $session.MusicPath))) {
    if (-not [string]::IsNullOrWhiteSpace($path) -and (Test-Path $path)) {
      Remove-Item $path -Force -ErrorAction SilentlyContinue
    }
  }

  $script:MuxUploadSessions.Remove($SessionId)
}

function Read-MuxBinaryPayload {
  param([byte[]]$Bytes)

  $magicText = "LOMUX1"
  $magicLength = $magicText.Length
  $headerLength = $magicLength + 16

  if (-not $Bytes -or $Bytes.Length -lt $headerLength) {
    throw "The binary mux payload was incomplete."
  }

  $receivedMagic = [System.Text.Encoding]::ASCII.GetString($Bytes, 0, $magicLength)
  if ($receivedMagic -ne $magicText) {
    throw "The binary mux payload format was not recognized."
  }

  $metadataLength = [int](Read-LittleEndianUInt32 -Bytes $Bytes -Offset $magicLength)
  $videoLength = [int](Read-LittleEndianUInt32 -Bytes $Bytes -Offset ($magicLength + 4))
  $audioLength = [int](Read-LittleEndianUInt32 -Bytes $Bytes -Offset ($magicLength + 8))
  $musicLength = [int](Read-LittleEndianUInt32 -Bytes $Bytes -Offset ($magicLength + 12))

  if ($metadataLength -lt 0 -or $videoLength -lt 0 -or $audioLength -lt 0 -or $musicLength -lt 0) {
    throw "The binary mux payload contained invalid lengths."
  }

  $expectedLength = $headerLength + $metadataLength + $videoLength + $audioLength + $musicLength
  if ($Bytes.Length -lt $expectedLength) {
    throw "The binary mux payload ended before all declared file data was received."
  }

  $metadataBytes = New-Object byte[] $metadataLength
  if ($metadataLength -gt 0) {
    [System.Buffer]::BlockCopy($Bytes, $headerLength, $metadataBytes, 0, $metadataLength)
  }

  $metadataJson = [System.Text.Encoding]::UTF8.GetString($metadataBytes)
  $metadata = if ([string]::IsNullOrWhiteSpace($metadataJson)) {
    $null
  } else {
    $metadataJson | ConvertFrom-Json
  }

  $videoOffset = $headerLength + $metadataLength
  $audioOffset = $videoOffset + $videoLength
  $musicOffset = $audioOffset + $audioLength

  return @{
    Metadata = $metadata
    VideoOffset = $videoOffset
    VideoLength = $videoLength
    AudioOffset = $audioOffset
    AudioLength = $audioLength
    MusicOffset = $musicOffset
    MusicLength = $musicLength
  }
}

function Get-FFmpegPath {
  $command = Get-Command ffmpeg -ErrorAction SilentlyContinue
  if ($command -and $command.Source -and (Test-Path $command.Source)) {
    return $command.Source
  }

  $packageRoot = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
  if (Test-Path $packageRoot) {
    $match = Get-ChildItem $packageRoot -Filter ffmpeg.exe -Recurse -ErrorAction SilentlyContinue |
      Select-Object -First 1 -ExpandProperty FullName
    if ($match) {
      return $match
    }
  }

  throw "FFmpeg is not installed on this machine."
}

function Get-FFprobePath {
  $command = Get-Command ffprobe -ErrorAction SilentlyContinue
  if ($command -and $command.Source -and (Test-Path $command.Source)) {
    return $command.Source
  }

  try {
    $ffmpegPath = Get-FFmpegPath
    if (-not [string]::IsNullOrWhiteSpace($ffmpegPath)) {
      $ffprobeCandidate = Join-Path (Split-Path -Parent $ffmpegPath) "ffprobe.exe"
      if (Test-Path $ffprobeCandidate) {
        return $ffprobeCandidate
      }
    }
  } catch {
  }

  $packageRoot = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
  if (Test-Path $packageRoot) {
    $match = Get-ChildItem $packageRoot -Filter ffprobe.exe -Recurse -ErrorAction SilentlyContinue |
      Select-Object -First 1 -ExpandProperty FullName
    if ($match) {
      return $match
    }
  }

  throw "FFprobe is not installed on this machine."
}

function Get-MediaDurationSeconds {
  param([string]$MediaPath)
  if ([string]::IsNullOrWhiteSpace($MediaPath) -or -not (Test-Path $MediaPath)) { return 0.0 }
  try {
    $raw = & (Get-FFprobePath) -v error -show_entries format=duration -of "default=noprint_wrappers=1:nokey=1" $MediaPath 2>$null
    $value = 0.0
    if ([double]::TryParse(([string]$raw).Trim(), [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$value)) {
      return $value
    }
  } catch {
  }
  return 0.0
}

function Write-MuxDebugLog {
  param([string]$Message)
  try {
    $logDir = Join-Path $PSScriptRoot "logs"
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    Add-Content -LiteralPath (Join-Path $logDir "presentation-mux-debug.log") -Value ((Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff") + " " + $Message) -Encoding UTF8
  } catch {
  }
}

function Get-VideoDimensions {
  param([string]$VideoPath)

  if ([string]::IsNullOrWhiteSpace($VideoPath) -or -not (Test-Path $VideoPath)) {
    throw "Video dimensions could not be read because the file does not exist."
  }

  $ffprobePath = Get-FFprobePath
  $probeOutput = & $ffprobePath -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x $VideoPath 2>$null | Out-String
  $probeText = $probeOutput.Trim()
  if ([string]::IsNullOrWhiteSpace($probeText) -or ($probeText -notmatch '^\d+x\d+$')) {
    throw "FFprobe could not determine the video dimensions for '$VideoPath'."
  }

  $parts = $probeText.Split('x')
  $width = [int]$parts[0]
  $height = [int]$parts[1]
  if ($width -le 0 -or $height -le 0) {
    throw "FFprobe returned invalid video dimensions for '$VideoPath'."
  }

  return @{
    Width = $width
    Height = $height
  }
}

function Get-FileExtension {
  param(
    [string]$FileName,
    [string]$FallbackExtension
  )

  $extension = [System.IO.Path]::GetExtension($FileName)
  if ([string]::IsNullOrWhiteSpace($extension)) {
    return $FallbackExtension
  }

  return $extension
}

function Get-DefaultExportDirectory {
  $userProfile = [Environment]::GetFolderPath([System.Environment+SpecialFolder]::UserProfile)
  if (-not [string]::IsNullOrWhiteSpace($userProfile)) {
    $downloadsPath = Join-Path $userProfile "Downloads"
    if (Test-Path $downloadsPath) {
      return $downloadsPath
    }
  }

  $documentsPath = [Environment]::GetFolderPath([System.Environment+SpecialFolder]::MyDocuments)
  if (-not [string]::IsNullOrWhiteSpace($documentsPath)) {
    return $documentsPath
  }

  return $env:TEMP
}

function Get-SafeOutputFileName {
  param([string]$FileName)

  $requestedName = [string]$FileName
  if ([string]::IsNullOrWhiteSpace($requestedName)) {
    $requestedName = "learning-outcomes-video.mp4"
  }

  $baseName = [System.IO.Path]::GetFileNameWithoutExtension($requestedName)
  $extension = [System.IO.Path]::GetExtension($requestedName)
  if ([string]::IsNullOrWhiteSpace($baseName)) {
    $baseName = "learning-outcomes-video"
  }
  if ([string]::IsNullOrWhiteSpace($extension)) {
    $extension = ".mp4"
  }

  $invalidCharacters = [System.IO.Path]::GetInvalidFileNameChars()
  foreach ($character in $invalidCharacters) {
    $baseName = $baseName.Replace([string]$character, "-")
  }

  $baseName = $baseName.Trim()
  if ([string]::IsNullOrWhiteSpace($baseName)) {
    $baseName = "learning-outcomes-video"
  }

  return $baseName + $extension
}

function Get-UniqueOutputFilePath {
  param(
    [string]$Directory,
    [string]$FileName
  )

  if (-not (Test-Path $Directory)) {
    New-Item -ItemType Directory -Path $Directory -Force | Out-Null
  }

  $safeFileName = Get-SafeOutputFileName -FileName $FileName
  $baseName = [System.IO.Path]::GetFileNameWithoutExtension($safeFileName)
  $extension = [System.IO.Path]::GetExtension($safeFileName)
  $candidatePath = Join-Path $Directory $safeFileName
  $counter = 1

  while (Test-Path $candidatePath) {
    $candidatePath = Join-Path $Directory ("{0} ({1}){2}" -f $baseName, $counter, $extension)
    $counter += 1
  }

  return $candidatePath
}

function Save-MuxedVideoToDefaultPath {
  param(
    [string]$SourcePath,
    [string]$RequestedFileName
  )

  if (-not (Test-Path $SourcePath)) {
    throw "The muxed video file was not found."
  }

  $targetDirectory = Get-DefaultExportDirectory
  $targetPath = Get-UniqueOutputFilePath -Directory $targetDirectory -FileName $RequestedFileName
  Move-Item -LiteralPath $SourcePath -Destination $targetPath -Force
  return $targetPath
}

function Save-MuxedVideoToRequestedPath {
  param(
    [string]$SourcePath,
    [string]$RequestedPath
  )

  if (-not (Test-Path $SourcePath)) {
    throw "The muxed video file was not found."
  }

  if ([string]::IsNullOrWhiteSpace($RequestedPath)) {
    throw "The requested video save path was empty."
  }

  $targetPath = [System.IO.Path]::GetFullPath($RequestedPath)
  $targetDirectory = [System.IO.Path]::GetDirectoryName($targetPath)
  if ([string]::IsNullOrWhiteSpace($targetDirectory)) {
    throw "The requested video save folder was not valid."
  }

  if (-not (Test-Path $targetDirectory)) {
    New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
  }

  Move-Item -LiteralPath $SourcePath -Destination $targetPath -Force
  return $targetPath
}

function Join-VideoSegments {
  param(
    [string[]]$VideoPaths,
    $Metadata = $null
  )

  if (-not $VideoPaths -or -not $VideoPaths.Count) {
    throw "No rendered video parts were uploaded."
  }
  # A declared part is never optional: dropping one shifts every later visual
  # away from its narration while still producing an apparently valid video.
  $safeVideoPaths = @($VideoPaths)
  if (@($safeVideoPaths | Where-Object { [string]::IsNullOrWhiteSpace($_) -or -not (Test-Path -LiteralPath $_) }).Count) {
    throw "A rendered video part is missing. Export was stopped to preserve the complete narration timeline."
  }

  if ($safeVideoPaths.Count -eq 1) {
    return $safeVideoPaths[0]
  }

  $ffmpegPath = Get-FFmpegPath
  $includeIntroSegment = $false
  if ($Metadata -and $Metadata.PSObject.Properties.Name -contains "includeIntroSegment") {
    $includeIntroSegment = [bool]$Metadata.includeIntroSegment
  }

  if ($includeIntroSegment) {
    $outputPath = Join-Path $env:TEMP ("mux-concat-" + [System.Guid]::NewGuid().ToString() + ".mp4")
    try {
      $inputArgs = @("-y")
      $filterParts = @()
      $concatInputs = ""
      $targetDimensions = Get-VideoDimensions -VideoPath $safeVideoPaths[0]
      $targetWidth = [Math]::Max(2, [int]$targetDimensions.Width)
      $targetHeight = [Math]::Max(2, [int]$targetDimensions.Height)
      $lessonVideoSpeed = 1.0
      if ($Metadata -and $Metadata.PSObject.Properties.Name -contains "introSegmentVideoSpeed") {
        $lessonVideoSpeed = [Math]::Max(0.1, [double]$Metadata.introSegmentVideoSpeed)
      }
      for ($index = 0; $index -lt $safeVideoPaths.Count; $index += 1) {
        $inputArgs += @("-i", $safeVideoPaths[$index])
        $setPts = if ($index -gt 0 -and [Math]::Abs($lessonVideoSpeed - 1.0) -gt 0.001) {
          "setpts=$($lessonVideoSpeed.ToString([System.Globalization.CultureInfo]::InvariantCulture))*(PTS-STARTPTS)"
        } else {
          "setpts=PTS-STARTPTS"
        }
        $segmentFilter = "[{0}:v]{1},scale={2}:{3}:force_original_aspect_ratio=increase:flags=lanczos,crop={2}:{3},setsar=1,fps=30,format=yuv420p[v{0}]" -f $index, $setPts, $targetWidth, $targetHeight
        $filterParts += $segmentFilter
        $concatInputs += "[v$index]"
      }
      $filterParts += ("{0}concat=n={1}:v=1:a=0[vout]" -f $concatInputs, $safeVideoPaths.Count)
      $joinArgs = $inputArgs + @(
        "-filter_complex", ($filterParts -join ";"),
        "-map", "[vout]",
        "-an",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        $outputPath
      )
      $joinOutput = & $ffmpegPath @joinArgs 2>&1 | Out-String
      if ($LASTEXITCODE -ne 0 -or -not (Test-Path $outputPath)) {
        throw "FFmpeg could not normalize and join the rendered video parts. $joinOutput"
      }
      return $outputPath
    } catch {
      if (Test-Path -LiteralPath $outputPath) {
        Remove-Item -LiteralPath $outputPath -Force -ErrorAction SilentlyContinue
      }
      throw
    }
  }

  $listPath = Join-Path $env:TEMP ("mux-concat-" + [System.Guid]::NewGuid().ToString() + ".txt")
  $outputPath = Join-Path $env:TEMP ("mux-concat-" + [System.Guid]::NewGuid().ToString() + ".webm")
  $joinedSuccessfully = $false

  try {
    $listContent = ($safeVideoPaths | ForEach-Object {
      $escapedPath = $_.Replace("'", "''")
      "file '$escapedPath'"
    }) -join [Environment]::NewLine
    [System.IO.File]::WriteAllText($listPath, $listContent, [System.Text.Encoding]::ASCII)

    $concatOutput = & $ffmpegPath "-y" "-f" "concat" "-safe" "0" "-i" $listPath "-c" "copy" $outputPath 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $outputPath)) {
      throw "FFmpeg could not join the rendered video parts. $concatOutput"
    }

    $joinedSuccessfully = $true
    return $outputPath
  } finally {
    if (Test-Path -LiteralPath $listPath) {
      Remove-Item -LiteralPath $listPath -Force -ErrorAction SilentlyContinue
    }
    if (-not $joinedSuccessfully -and (Test-Path -LiteralPath $outputPath)) {
      Remove-Item -LiteralPath $outputPath -Force -ErrorAction SilentlyContinue
    }
  }
}

function Invoke-VideoMux {
  param(
    [string]$VideoPath,
    [string]$AudioPath,
    [string]$MusicPath = "",
    [double]$AudioSpeed = 1.0,
    [double]$VideoSpeed = 1.0,
    [string]$ExportQuality = "hd",
    [double]$MusicVolume = 0.18,
    [double]$TargetDurationMs = 0,
    [double]$HoldLastFrameMs = 0,
    [bool]$AudioDuckingEnabled = $true,
    [bool]$PdfExactTimeline = $false,
    [switch]$KeepOutputFile
  )

  $ffmpegPath = Get-FFmpegPath
  $outputPath = Join-Path $env:TEMP ("learning-outcomes-" + [System.Guid]::NewGuid().ToString() + ".mp4")

  try {
    $safeMusicVolume = [Math]::Min([Math]::Max($MusicVolume, 0.0), 1.0)
    # All playback controls support 2.5x, including PDF context export. Apply
    # the same pitch-preserving tempo whether or not visuals use exact frames.
    $safeAudioSpeed = [Math]::Min([Math]::Max($AudioSpeed, 0.5), 2.5)
    $safeVideoSpeed = [Math]::Min([Math]::Max($VideoSpeed, 1.0), 20.0)
    $safeTargetDurationMs = [Math]::Max([double]$TargetDurationMs, 0.0)
    $safeHoldLastFrameMs = [Math]::Max([double]$HoldLastFrameMs, 0.0)
    $volumeText = [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, "{0:0.00}", $safeMusicVolume)
    $audioSpeedText = [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, "{0:0.00}", $safeAudioSpeed)
    $audioTempoFilter = if ($safeAudioSpeed -gt 2.0) {
      "atempo=2.00,atempo=" + [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, "{0:0.000000}", ($safeAudioSpeed / 2.0))
    } else {
      "atempo=$audioSpeedText"
    }
    $videoSpeedText = [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, "{0:0.00}", $safeVideoSpeed)
    $targetDurationSecondsText = if ($safeTargetDurationMs -gt 0) {
      [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, "{0:0.000}", ($safeTargetDurationMs / 1000.0))
    } else {
      ""
    }
    $holdLastFrameSecondsText = if ($safeHoldLastFrameMs -gt 0) {
      [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, "{0:0.000}", ($safeHoldLastFrameMs / 1000.0))
    } else {
      ""
    }
    $is4k = $ExportQuality -eq "4k"
    $is2k = $ExportQuality -eq "2k"
    $scaleFilter = if ($is4k) { "scale=3840:2160:flags=lanczos" } elseif ($is2k) { "scale=2560:1440:flags=lanczos" } else { "" }
    $args = @("-y", "-i", $VideoPath, "-i", $AudioPath)
    $videoFilters = @()
    if ($safeVideoSpeed -ne 1.0) {
      # Export rendering can advance the lesson timeline faster than real playback.
      # Stretch the recorded video back to the narration timeline here so visuals stay natural.
      $videoFilters += "setpts=$videoSpeedText*PTS"
    }
    if (-not [string]::IsNullOrWhiteSpace($scaleFilter)) {
      $videoFilters += $scaleFilter
    }
    $videoFilters += "fps=30"
    if ($holdLastFrameSecondsText) {
      $videoFilters += "tpad=stop_mode=clone:stop_duration=$holdLastFrameSecondsText"
    }
    if ($targetDurationSecondsText) {
      $videoFilters += "trim=duration=$targetDurationSecondsText"
      $videoFilters += "setpts=PTS-STARTPTS"
    }
    $videoFilterInput = if ($videoFilters.Count -gt 0) {
      "[0:v]{0}[vout]" -f ($videoFilters -join ",")
    } else {
      "[0:v]null[vout]"
    }

    if (-not [string]::IsNullOrWhiteSpace($MusicPath) -and (Test-Path $MusicPath)) {
      $args += @("-stream_loop", "-1", "-i", $MusicPath)
      if ($AudioDuckingEnabled) {
          $audioFilterInput = if ($safeAudioSpeed -ne 1.0) { "[1:a]$audioTempoFilter,asplit[narr_out][narr_sc]" } else { "[1:a]anull,asplit[narr_out][narr_sc]" }
          $mixedAudioTail = if ($targetDurationSecondsText) {
            "amix=inputs=2:duration=first:dropout_transition=2,apad=whole_dur=$targetDurationSecondsText,atrim=duration=$targetDurationSecondsText[aout]"
          } else {
            "amix=inputs=2:duration=first:dropout_transition=2[aout]"
          }
          $args += @(
            "-filter_complex",
            "$videoFilterInput;$audioFilterInput;[2:a]volume=$volumeText[music];[music][narr_sc]sidechaincompress=threshold=0.08:ratio=4:attack=5:release=50[ducked_music];[narr_out][ducked_music]$mixedAudioTail",
            "-map", "[vout]",
            "-map", "[aout]"
          )
      } else {
          $audioFilterInput = if ($safeAudioSpeed -ne 1.0) { "[1:a]${audioTempoFilter}[narr]" } else { "[1:a]anull[narr]" }
          $mixedAudioTail = if ($targetDurationSecondsText) {
            "amix=inputs=2:duration=first:dropout_transition=2,apad=whole_dur=$targetDurationSecondsText,atrim=duration=$targetDurationSecondsText[aout]"
          } else {
            "amix=inputs=2:duration=first:dropout_transition=2[aout]"
          }
          $args += @(
            "-filter_complex",
            "$videoFilterInput;$audioFilterInput;[2:a]volume=$volumeText[music];[narr][music]$mixedAudioTail",
            "-map", "[vout]",
            "-map", "[aout]"
          )
      }
    } elseif ($safeAudioSpeed -ne 1.0 -or $videoFilters.Count -gt 0) {
      $audioFilterInput = if ($targetDurationSecondsText) {
        if ($safeAudioSpeed -ne 1.0) {
          "[1:a]$audioTempoFilter,apad=whole_dur=$targetDurationSecondsText,atrim=duration=$targetDurationSecondsText[aout]"
        } else {
          "[1:a]anull,apad=whole_dur=$targetDurationSecondsText,atrim=duration=$targetDurationSecondsText[aout]"
        }
      } else {
        if ($safeAudioSpeed -ne 1.0) { "[1:a]${audioTempoFilter}[aout]" } else { "[1:a]anull[aout]" }
      }
      $args += @(
        "-filter_complex",
        "$videoFilterInput;$audioFilterInput",
        "-map", "[vout]",
        "-map", "[aout]"
      )
    } else {
      $audioFilterInput = if ($targetDurationSecondsText) {
        "[1:a]anull,apad=whole_dur=$targetDurationSecondsText,atrim=duration=$targetDurationSecondsText[aout]"
      } else {
        "[1:a]anull[aout]"
      }
      $args += @(
        "-filter_complex",
        "$videoFilterInput;$audioFilterInput",
        "-map", "[vout]",
        "-map", "[aout]"
      )
    }

    $baseArgs = $args

    $encoderConfigs = @(
      @{
        Name = "CPU Fast (Universal Fallback)"
        Args = @("-c:v", "libx264", "-profile:v", "high", "-level", $(if ($is4k) { "5.1" } elseif ($is2k) { "5.0" } else { "4.1" }), "-pix_fmt", "yuv420p", "-preset", "ultrafast", "-crf", "17", "-maxrate", "60M", "-bufsize", "60M")
      },
      @{
        Name = "NVENC (Nvidia GPU - Ultra Fast)"
        Args = @("-c:v", "h264_nvenc", "-preset", "p2", "-cq", $(if ($is4k) { "19" } elseif ($is2k) { "21" } else { "23" }), "-b:v", "80M", "-pix_fmt", "yuv420p")
      },
      @{
        Name = "AMF (AMD GPU - Ultra Fast)"
        Args = @("-c:v", "h264_amf", "-quality", "speed", "-b:v", "80M", "-pix_fmt", "yuv420p")
      },
      @{
        Name = "QSV (Intel GPU - Fast)"
        Args = @("-c:v", "h264_qsv", "-preset", "veryfast", "-global_quality", "24", "-b:v", "80M", "-pix_fmt", "yuv420p")
      }
    )

    $audioArgs = @("-c:a", "aac", "-ar", "48000", "-b:a", "192k", "-movflags", "+faststart", "-shortest", $outputPath)
    
    $success = $false
    foreach ($config in $encoderConfigs) {
      if (Test-Path $outputPath) { Remove-Item $outputPath -Force }
      Write-Host "Trying video export with $($config.Name)..."
      $fullArgs = $baseArgs + $config.Args + $audioArgs
      
      $transcodeOutput = & $ffmpegPath @fullArgs 2>&1 | Out-String
      if ($LASTEXITCODE -eq 0 -and (Test-Path $outputPath)) {
        Write-Host "Success! Compiled with $($config.Name)."
        $success = $true
        break
      }
    }

    if (-not $success) {
      throw "All FFmpeg encoding methods failed. Last error: $transcodeOutput"
    }

    if ($KeepOutputFile) {
      $resultPath = $outputPath
      $outputPath = $null
      return $resultPath
    }

    return [System.IO.File]::ReadAllBytes($outputPath)
  } finally {
    if ($outputPath -and (Test-Path $outputPath)) {
      Remove-Item $outputPath -Force
    }
  }
}

function Handle-Request {
  param(
    [hashtable]$Request,
    [System.IO.Stream]$Stream
  )

  if ($Request.Method -eq "OPTIONS") {
    Write-HttpResponse -Stream $Stream -StatusCode 204 -BodyBytes ([byte[]]@()) -ContentType ""
    return
  }

  $uri = [System.Uri]::new("$baseUrl$($Request.RawUrl)")
  $path = $uri.AbsolutePath.TrimEnd("/")
  $query = Get-QueryParameters -Uri $uri

  if ($Request.Method -eq "GET" -and ($path -eq "" -or $path -eq "/health")) {
    try {
      $ffmpegPath = Get-FFmpegPath
      Write-JsonResponse -Stream $Stream -StatusCode 200 -Payload @{ ok = $true; ffmpegPath = $ffmpegPath; pdfExactTimeline = $true }
    } catch {
      Write-JsonResponse -Stream $Stream -StatusCode 500 -Payload @{ ok = $false; error = $_.Exception.Message }
    }
    return
  }

  if ($Request.Method -eq "POST" -and $path -eq "/api/convert-audio-mp3") {
    $inputPath = ""
    $outputPath = ""
    try {
      $payload = Read-JsonBody -Bytes $Request.BodyBytes
      if (-not $payload -or [string]::IsNullOrWhiteSpace([string]$payload.audioBase64)) {
        throw "No audio data was provided."
      }

      $ffmpegPath = Get-FFmpegPath
      $inputExtension = Get-FileExtension -FileName ([string]$payload.inputFileName) -FallbackExtension ".wav"
      $sessionId = [System.Guid]::NewGuid().ToString()
      $inputPath = Join-Path $env:TEMP ("narration-input-" + $sessionId + $inputExtension)
      $outputPath = Join-Path $env:TEMP ("narration-output-" + $sessionId + ".mp3")
      [System.IO.File]::WriteAllBytes($inputPath, [System.Convert]::FromBase64String([string]$payload.audioBase64))

      $ffmpegOutput = & $ffmpegPath "-y" "-i" $inputPath "-vn" "-codec:a" "libmp3lame" "-b:a" "192k" $outputPath 2>&1 | Out-String
      if ($LASTEXITCODE -ne 0 -or -not (Test-Path $outputPath)) {
        throw "FFmpeg could not convert narration to MP3. $ffmpegOutput"
      }

      $downloadName = Get-SafeOutputFileName -FileName ([string]$payload.outputFileName)
      if (-not $downloadName.ToLowerInvariant().EndsWith(".mp3")) {
        $downloadName = [System.IO.Path]::GetFileNameWithoutExtension($downloadName) + ".mp3"
      }
      Write-FileResponse -Stream $Stream -StatusCode 200 -FilePath $outputPath -ContentType "audio/mpeg" -ExtraHeaders @{
        "Content-Disposition" = "attachment; filename=`"$downloadName`""
      }
    } catch {
      Write-JsonResponse -Stream $Stream -StatusCode 500 -Payload @{ error = $_.Exception.Message }
    } finally {
      foreach ($pathToRemove in @($inputPath, $outputPath)) {
        if ($pathToRemove -and (Test-Path $pathToRemove)) {
          Remove-Item $pathToRemove -Force -ErrorAction SilentlyContinue
        }
      }
    }
    return
  }

  if ($Request.Method -eq "POST" -and $path -eq "/api/extract-audio-wav") {
    $inputPath = ""
    $outputPath = ""
    try {
      $payload = Read-JsonBody -Bytes $Request.BodyBytes
      if (-not $payload -or [string]::IsNullOrWhiteSpace([string]$payload.mediaBase64)) {
        throw "No media data was provided."
      }

      $ffmpegPath = Get-FFmpegPath
      $inputExtension = Get-FileExtension -FileName ([string]$payload.inputFileName) -FallbackExtension ".mp4"
      $sessionId = [System.Guid]::NewGuid().ToString()
      $inputPath = Join-Path $env:TEMP ("caption-media-input-" + $sessionId + $inputExtension)
      $outputPath = Join-Path $env:TEMP ("caption-audio-output-" + $sessionId + ".wav")
      [System.IO.File]::WriteAllBytes($inputPath, [System.Convert]::FromBase64String([string]$payload.mediaBase64))

      $ffmpegOutput = & $ffmpegPath "-y" "-i" $inputPath "-vn" "-ac" "1" "-ar" "16000" "-acodec" "pcm_s16le" $outputPath 2>&1 | Out-String
      if ($LASTEXITCODE -ne 0 -or -not (Test-Path $outputPath)) {
        throw "FFmpeg could not extract audio from the media file. $ffmpegOutput"
      }

      Write-FileResponse -Stream $Stream -StatusCode 200 -FilePath $outputPath -ContentType "audio/wav" -ExtraHeaders @{
        "Content-Disposition" = "attachment; filename=`"caption-audio.wav`""
      }
    } catch {
      Write-JsonResponse -Stream $Stream -StatusCode 500 -Payload @{ error = $_.Exception.Message }
    } finally {
      foreach ($pathToRemove in @($inputPath, $outputPath)) {
        if ($pathToRemove -and (Test-Path $pathToRemove)) {
          Remove-Item $pathToRemove -Force -ErrorAction SilentlyContinue
        }
      }
    }
    return
  }

  if ($Request.Method -eq "POST" -and $path -eq "/api/sing-song-safe") {
    $inputPath = ""
    $instrumentalPath = ""
    $outputPath = ""
    try {
      $payload = Read-JsonBody -Bytes $Request.BodyBytes
      if (-not $payload -or [string]::IsNullOrWhiteSpace([string]$payload.audioBase64)) {
        throw "No song audio was provided."
      }

      $ffmpegPath = Get-FFmpegPath
      $inputExtension = Get-FileExtension -FileName ([string]$payload.inputFileName) -FallbackExtension ".mp3"
      $sessionId = [System.Guid]::NewGuid().ToString()
      $inputPath = Join-Path $env:TEMP ("sing-song-input-" + $sessionId + $inputExtension)
      $instrumentalPath = Join-Path $env:TEMP ("sing-song-instrumental-" + $sessionId + ".wav")
      $outputPath = Join-Path $env:TEMP ("sing-song-output-" + $sessionId + ".mp3")
      [System.IO.File]::WriteAllBytes($inputPath, [System.Convert]::FromBase64String([string]$payload.audioBase64))

      $vocalReduceFilter = "pan=stereo|c0=0.5*c0-0.5*c1|c1=0.5*c1-0.5*c0,highpass=f=80,lowpass=f=15000,dynaudnorm=f=150:g=15"
      $ffmpegOutput = & $ffmpegPath "-y" "-i" $inputPath "-vn" "-af" $vocalReduceFilter "-ar" "44100" "-ac" "2" $instrumentalPath 2>&1 | Out-String
      if ($LASTEXITCODE -ne 0 -or -not (Test-Path $instrumentalPath)) {
        throw "FFmpeg could not prepare the vocal-reduced song bed. $ffmpegOutput"
      }

      $ffmpegEncodeOutput = & $ffmpegPath "-y" "-i" $instrumentalPath "-vn" "-codec:a" "libmp3lame" "-b:a" "192k" $outputPath 2>&1 | Out-String
      if ($LASTEXITCODE -ne 0 -or -not (Test-Path $outputPath)) {
        throw "FFmpeg could not encode the Sing Song result. $ffmpegEncodeOutput"
      }

      $downloadName = Get-SafeOutputFileName -FileName ([string]$payload.outputFileName)
      if (-not $downloadName.ToLowerInvariant().EndsWith(".mp3")) {
        $downloadName = [System.IO.Path]::GetFileNameWithoutExtension($downloadName) + ".mp3"
      }
      Write-FileResponse -Stream $Stream -StatusCode 200 -FilePath $outputPath -ContentType "audio/mpeg" -ExtraHeaders @{
        "Content-Disposition" = "attachment; filename=`"$downloadName`""
        "X-Output-File" = $downloadName
        "X-Sing-Song-Mode" = "safe-vocal-reduced"
      }
    } catch {
      Write-JsonResponse -Stream $Stream -StatusCode 500 -Payload @{ error = $_.Exception.Message }
    } finally {
      foreach ($pathToRemove in @($inputPath, $instrumentalPath, $outputPath)) {
        if ($pathToRemove -and (Test-Path $pathToRemove)) {
          Remove-Item $pathToRemove -Force -ErrorAction SilentlyContinue
        }
      }
    }
    return
  }

  if ($Request.Method -eq "POST" -and $path -eq "/api/sing-song-mix-sc3") {
    $instrumentalPath = ""
    $vocalPath = ""
    $outputPath = ""
    try {
      $payload = Read-JsonBody -Bytes $Request.BodyBytes
      if (-not $payload -or [string]::IsNullOrWhiteSpace([string]$payload.instrumentalBase64) -or [string]::IsNullOrWhiteSpace([string]$payload.vocalBase64)) {
        throw "Instrumental and sc3 vocal audio are both required."
      }

      $ffmpegPath = Get-FFmpegPath
      $sessionId = [System.Guid]::NewGuid().ToString()
      $instrumentalExtension = Get-FileExtension -FileName ([string]$payload.instrumentalFileName) -FallbackExtension ".mp3"
      $vocalExtension = Get-FileExtension -FileName ([string]$payload.vocalFileName) -FallbackExtension ".wav"
      $instrumentalPath = Join-Path $env:TEMP ("sing-song-bed-" + $sessionId + $instrumentalExtension)
      $vocalPath = Join-Path $env:TEMP ("sing-song-sc3-" + $sessionId + $vocalExtension)
      $outputPath = Join-Path $env:TEMP ("sing-song-sc3-output-" + $sessionId + ".mp3")
      [System.IO.File]::WriteAllBytes($instrumentalPath, [System.Convert]::FromBase64String([string]$payload.instrumentalBase64))
      [System.IO.File]::WriteAllBytes($vocalPath, [System.Convert]::FromBase64String([string]$payload.vocalBase64))

      $filter = "[0:a]volume=0.88,highpass=f=40,lowpass=f=16000[bed];[1:a]volume=1.20,dynaudnorm=f=150:g=15,adelay=0|0[vox];[bed][vox]amix=inputs=2:duration=longest:dropout_transition=0,alimiter=limit=0.98[out]"
      $ffmpegOutput = & $ffmpegPath "-y" "-i" $instrumentalPath "-i" $vocalPath "-filter_complex" $filter "-map" "[out]" "-vn" "-codec:a" "libmp3lame" "-b:a" "192k" $outputPath 2>&1 | Out-String
      if ($LASTEXITCODE -ne 0 -or -not (Test-Path $outputPath)) {
        throw "FFmpeg could not mix the sc3 vocal into the song. $ffmpegOutput"
      }

      $downloadName = Get-SafeOutputFileName -FileName ([string]$payload.outputFileName)
      if (-not $downloadName.ToLowerInvariant().EndsWith(".mp3")) {
        $downloadName = [System.IO.Path]::GetFileNameWithoutExtension($downloadName) + ".mp3"
      }
      Write-FileResponse -Stream $Stream -StatusCode 200 -FilePath $outputPath -ContentType "audio/mpeg" -ExtraHeaders @{
        "Content-Disposition" = "attachment; filename=`"$downloadName`""
        "X-Output-File" = $downloadName
        "X-Sing-Song-Mode" = "sc3-vocal-mix"
      }
    } catch {
      Write-JsonResponse -Stream $Stream -StatusCode 500 -Payload @{ error = $_.Exception.Message }
    } finally {
      foreach ($pathToRemove in @($instrumentalPath, $vocalPath, $outputPath)) {
        if ($pathToRemove -and (Test-Path $pathToRemove)) {
          Remove-Item $pathToRemove -Force -ErrorAction SilentlyContinue
        }
      }
    }
    return
  }

  if ($Request.Method -eq "POST" -and $path -eq "/api/mux-upload-session") {
    try {
      $payload = Read-JsonBody -Bytes $Request.BodyBytes
      $session = New-MuxUploadSession -Metadata $payload
      Write-JsonResponse -Stream $Stream -StatusCode 200 -Payload @{ ok = $true; sessionId = $session.Id }
    } catch {
      Write-JsonResponse -Stream $Stream -StatusCode 500 -Payload @{ error = $_.Exception.Message }
    }
    return
  }

  if ($Request.Method -eq "POST" -and $path -eq "/api/mux-upload-cancel") {
    try {
      $payload = Read-JsonBody -Bytes $Request.BodyBytes
      $sessionId = if ($payload) { [string]$payload.sessionId } else { "" }
      if ([string]::IsNullOrWhiteSpace($sessionId)) {
        Write-JsonResponse -Stream $Stream -StatusCode 400 -Payload @{ error = "An upload session ID is required." }
        return
      }
      # Idempotent cleanup uses only server-owned paths from this exact session.
      # It never runs the encoder and never accepts a client filesystem path.
      $existed = $script:MuxUploadSessions.ContainsKey($sessionId)
      Remove-MuxUploadSession -SessionId $sessionId
      Write-JsonResponse -Stream $Stream -StatusCode 200 -Payload @{ ok = $true; removed = $existed }
    } catch {
      Write-JsonResponse -Stream $Stream -StatusCode 500 -Payload @{ error = $_.Exception.Message }
    }
    return
  }

  if ($Request.Method -eq "POST" -and $path -eq "/api/mux-upload-chunk") {
    try {
      $sessionId = [string]$query["sessionId"]
      $target = [string]$query["target"]
      if ([string]::IsNullOrWhiteSpace($sessionId) -or -not $script:MuxUploadSessions.ContainsKey($sessionId)) {
        Write-JsonResponse -Stream $Stream -StatusCode 400 -Payload @{ error = "The chunked upload session was not found." }
        return
      }

      $session = $script:MuxUploadSessions[$sessionId]
      $videoSegmentIndex = -1
      if ($target -match '^video-(\d+)$') {
        $videoSegmentIndex = [int]$matches[1]
      }

      $targetPath = switch ($target) {
        "audio" { $session.AudioPath; break }
        "music" { $session.MusicPath; break }
        { $videoSegmentIndex -ge 0 } {
          if (-not $session.VideoPaths -or $videoSegmentIndex -ge $session.VideoPaths.Count) {
            throw "The requested video segment upload target was not recognized."
          }
          $session.VideoPaths[$videoSegmentIndex]
          break
        }
        default { $session.VideoPath; break }
      }

      Append-BytesToFile -Path $targetPath -Bytes $Request.BodyBytes
      switch ($target) {
        "audio" { $session.AudioBytes += $Request.BodyBytes.Length; break }
        "music" { $session.MusicBytes += $Request.BodyBytes.Length; break }
        default {
          $session.VideoBytes += $Request.BodyBytes.Length
          if ($videoSegmentIndex -ge 0) {
            $existingBytes = if ($session.VideoSegmentBytes.ContainsKey($videoSegmentIndex)) { [int]$session.VideoSegmentBytes[$videoSegmentIndex] } else { 0 }
            $session.VideoSegmentBytes[$videoSegmentIndex] = $existingBytes + $Request.BodyBytes.Length
          }
          break
        }
      }
      $script:MuxUploadSessions[$sessionId] = $session
      Write-JsonResponse -Stream $Stream -StatusCode 200 -Payload @{
        ok = $true
        sessionId = $sessionId
        target = $target
        receivedBytes = switch ($target) {
          "audio" { $session.AudioBytes; break }
          "music" { $session.MusicBytes; break }
          { $videoSegmentIndex -ge 0 } { [int]$session.VideoSegmentBytes[$videoSegmentIndex]; break }
          default { $session.VideoBytes; break }
        }
      }
    } catch {
      Write-JsonResponse -Stream $Stream -StatusCode 500 -Payload @{ error = $_.Exception.Message }
    }
    return
  }

  if ($Request.Method -eq "POST" -and $path -eq "/api/mux-upload-complete") {
    $sessionId = ""
    $joinedVideoPath = ""
    $muxedVideoPath = ""
    try {
      $payload = Read-JsonBody -Bytes $Request.BodyBytes
      $sessionId = if ($payload) { [string]$payload.sessionId } else { "" }
      if ([string]::IsNullOrWhiteSpace($sessionId) -or -not $script:MuxUploadSessions.ContainsKey($sessionId)) {
        Write-JsonResponse -Stream $Stream -StatusCode 400 -Payload @{ error = "The chunked upload session was not found." }
        return
      }

      $session = $script:MuxUploadSessions[$sessionId]
      if ($session.VideoBytes -le 0 -or $session.AudioBytes -le 0) {
        Write-JsonResponse -Stream $Stream -StatusCode 400 -Payload @{ error = "Video and audio are both required." }
        return
      }

      $metadata = $session.Metadata
      $musicPath = if ($session.MusicBytes -gt 0 -and (Test-Path $session.MusicPath)) { $session.MusicPath } else { "" }
      $joinedVideoPath = ""
      $videoInputPath = $session.VideoPath
      if ($session.VideoPaths -and $session.VideoPaths.Count -gt 1) {
        $joinedVideoPath = Join-VideoSegments -VideoPaths $session.VideoPaths -Metadata $metadata
        $videoInputPath = $joinedVideoPath
      }
      $strictVisualSync = $metadata -and $metadata.PSObject.Properties.Name -contains "strictVisualSync" -and [bool]$metadata.strictVisualSync
      if ($strictVisualSync) {
        $targetSeconds = if ($metadata.PSObject.Properties.Name -contains "targetDurationMs") { [double]$metadata.targetDurationMs / 1000.0 } else { 0.0 }
        $reportedVideoSeconds = if ($metadata.PSObject.Properties.Name -contains "recordedVideoDurationMs") { [double]$metadata.recordedVideoDurationMs / 1000.0 } else { 0.0 }
        $probedVideoSeconds = Get-MediaDurationSeconds -MediaPath $videoInputPath
        $videoSeconds = if ($probedVideoSeconds -gt 0) { $probedVideoSeconds } else { $reportedVideoSeconds }
        $allowedTailSeconds = if ($metadata.PSObject.Properties.Name -contains "holdLastFrameMs") { [Math]::Max(0.25, [double]$metadata.holdLastFrameMs / 1000.0) } else { 0.25 }
        if ($targetSeconds -gt 0 -and $videoSeconds -gt 0 -and ($videoSeconds + $allowedTailSeconds) -lt $targetSeconds) {
          $detail = "Rejecting short presentation visuals. video=$([Math]::Round($videoSeconds, 3)) sec target=$([Math]::Round($targetSeconds, 3)) sec allowedTailPad=$([Math]::Round($allowedTailSeconds, 3)) sec videoPath=$videoInputPath audioPath=$($session.AudioPath)"
          Write-MuxDebugLog -Message $detail
          throw "The recorded presentation visuals ended early ($([Math]::Round($videoSeconds, 3))s for a $([Math]::Round($targetSeconds, 3))s narration). Export was stopped to prevent an inaccurate video."
        }
      }
      $muxedVideoPath = Invoke-VideoMux `
        -VideoPath $videoInputPath `
        -AudioPath $session.AudioPath `
        -MusicPath $musicPath `
        -AudioSpeed $(if ($metadata) { [double]$metadata.audioSpeed } else { 1.0 }) `
        -VideoSpeed $(if ($metadata) { [double]$metadata.videoSpeed } else { 1.0 }) `
        -ExportQuality $(if ($metadata) { [string]$metadata.exportQuality } else { "hd" }) `
        -MusicVolume $(if ($metadata) { [double]$metadata.musicVolume } else { 0.18 }) `
        -TargetDurationMs $(if ($metadata) { [double]$metadata.targetDurationMs } else { 0.0 }) `
        -HoldLastFrameMs $(if ($metadata -and $metadata.PSObject.Properties.Name -contains "holdLastFrameMs") { [double]$metadata.holdLastFrameMs } else { 0.0 }) `
        -AudioDuckingEnabled $(if ($metadata -and $metadata.audioDuckingEnabled -ne $null) { [bool]$metadata.audioDuckingEnabled } else { $true }) `
        -PdfExactTimeline $(if ($metadata -and $metadata.PSObject.Properties.Name -contains "pdfExactTimeline") { [bool]$metadata.pdfExactTimeline } else { $false }) `
        -KeepOutputFile
      try {
        $shouldSaveToDefaultPath = $metadata -and $metadata.saveToDefaultPath -eq $true
        $requestedOutputPath = if ($metadata -and $metadata.PSObject.Properties.Name -contains "outputPath") { [string]$metadata.outputPath } else { "" }
        if (-not [string]::IsNullOrWhiteSpace($requestedOutputPath)) {
          $savedPath = Save-MuxedVideoToRequestedPath -SourcePath $muxedVideoPath -RequestedPath $requestedOutputPath
          $muxedVideoPath = ""
          Write-JsonResponse -Stream $Stream -StatusCode 200 -Payload @{
            ok = $true
            savedPath = $savedPath
            fileName = [System.IO.Path]::GetFileName($savedPath)
          }
        } elseif ($shouldSaveToDefaultPath) {
          $savedPath = Save-MuxedVideoToDefaultPath -SourcePath $muxedVideoPath -RequestedFileName ([string]$metadata.outputFileName)
          $muxedVideoPath = ""
          Write-JsonResponse -Stream $Stream -StatusCode 200 -Payload @{
            ok = $true
            savedPath = $savedPath
            fileName = [System.IO.Path]::GetFileName($savedPath)
          }
        } else {
          Write-FileResponse -Stream $Stream -StatusCode 200 -FilePath $muxedVideoPath -ContentType "video/mp4" -ExtraHeaders @{
            "Cache-Control" = "no-store, no-cache, must-revalidate, max-age=0"
            "Pragma" = "no-cache"
            "Expires" = "0"
            "X-Content-Type-Options" = "nosniff"
          }
        }
      } finally {
        if ($joinedVideoPath -and (Test-Path $joinedVideoPath)) {
          Remove-Item $joinedVideoPath -Force -ErrorAction SilentlyContinue
        }
        if ($muxedVideoPath -and (Test-Path $muxedVideoPath)) {
          Remove-Item $muxedVideoPath -Force -ErrorAction SilentlyContinue
        }
      }
    } catch {
      Write-JsonResponse -Stream $Stream -StatusCode 500 -Payload @{ error = $_.Exception.Message }
    } finally {
      # Joining can succeed before strict-sync validation or encoding fails.
      # These outputs are owned by this request, not by the upload session.
      if ($joinedVideoPath -and (Test-Path -LiteralPath $joinedVideoPath)) {
        Remove-Item -LiteralPath $joinedVideoPath -Force -ErrorAction SilentlyContinue
      }
      if ($muxedVideoPath -and (Test-Path -LiteralPath $muxedVideoPath)) {
        Remove-Item -LiteralPath $muxedVideoPath -Force -ErrorAction SilentlyContinue
      }
      if ($sessionId) {
        Remove-MuxUploadSession -SessionId $sessionId
      }
    }
    return
  }

  if ($Request.Method -eq "POST" -and ($path -eq "/api/mux" -or $path -eq "/api/mux-binary")) {
    $isBinaryUpload = $path -eq "/api/mux-binary"
    $videoFileName = ""
    $audioFileName = ""
    $musicFileName = ""
    $exportQuality = "hd"
    $audioSpeed = 1.0
    $videoSpeed = 1.0
    $musicVolume = 0.18
    $targetDurationMs = 0.0
    $holdLastFrameMs = 0.0
    $pdfExactTimeline = $false
    $outputFileName = "learning-outcomes-video.mp4"
    $outputPath = ""
    $saveToDefaultPath = $false
    $musicLength = 0
    $videoBytes = $null
    $audioBytes = $null
    $musicBytes = $null
    $binaryPayload = $null

    if ($isBinaryUpload) {
      $binaryPayload = Read-MuxBinaryPayload -Bytes $Request.BodyBytes
      $metadata = $binaryPayload.Metadata
      $videoFileName = if ($metadata) { [string]$metadata.videoFileName } else { "" }
      $audioFileName = if ($metadata) { [string]$metadata.audioFileName } else { "" }
      $musicFileName = if ($metadata) { [string]$metadata.musicFileName } else { "" }
      $exportQuality = if ($metadata) { [string]$metadata.exportQuality } else { "hd" }
      $audioSpeed = if ($metadata) { [double]$metadata.audioSpeed } else { 1.0 }
      $videoSpeed = if ($metadata) { [double]$metadata.videoSpeed } else { 1.0 }
      $musicVolume = if ($metadata) { [double]$metadata.musicVolume } else { 0.18 }
      $targetDurationMs = if ($metadata) { [double]$metadata.targetDurationMs } else { 0.0 }
      $holdLastFrameMs = if ($metadata -and $metadata.PSObject.Properties.Name -contains "holdLastFrameMs") { [double]$metadata.holdLastFrameMs } else { 0.0 }
      $outputFileName = if ($metadata) { [string]$metadata.outputFileName } else { "learning-outcomes-video.mp4" }
      $outputPath = if ($metadata -and $metadata.PSObject.Properties.Name -contains "outputPath") { [string]$metadata.outputPath } else { "" }
      $saveToDefaultPath = if ($metadata -and $metadata.saveToDefaultPath -ne $null) { [bool]$metadata.saveToDefaultPath } else { $false }
      $audioDuckingEnabled = if ($metadata -and $metadata.audioDuckingEnabled -ne $null) { [bool]$metadata.audioDuckingEnabled } else { $true }
      $pdfExactTimeline = $metadata -and $metadata.PSObject.Properties.Name -contains "pdfExactTimeline" -and [bool]$metadata.pdfExactTimeline

      if ($binaryPayload.VideoLength -le 0 -or $binaryPayload.AudioLength -le 0) {
        Write-JsonResponse -Stream $Stream -StatusCode 400 -Payload @{ error = "Video and audio are both required." }
        return
      }

      $musicLength = $binaryPayload.MusicLength
    } else {
      $payload = Read-JsonBody -Bytes $Request.BodyBytes
      $videoBase64 = if ($payload) { [string]$payload.videoBase64 } else { "" }
      $audioBase64 = if ($payload) { [string]$payload.audioBase64 } else { "" }
      $musicBase64 = if ($payload) { [string]$payload.musicBase64 } else { "" }
      $videoFileName = if ($payload) { [string]$payload.videoFileName } else { "" }
      $audioFileName = if ($payload) { [string]$payload.audioFileName } else { "" }
      $musicFileName = if ($payload) { [string]$payload.musicFileName } else { "" }
      $exportQuality = if ($payload) { [string]$payload.exportQuality } else { "hd" }
      $audioSpeed = if ($payload) { [double]$payload.audioSpeed } else { 1.0 }
      $videoSpeed = if ($payload) { [double]$payload.videoSpeed } else { 1.0 }
      $musicVolume = if ($payload) { [double]$payload.musicVolume } else { 0.18 }
      $targetDurationMs = if ($payload) { [double]$payload.targetDurationMs } else { 0.0 }
      $holdLastFrameMs = if ($payload -and $payload.PSObject.Properties.Name -contains "holdLastFrameMs") { [double]$payload.holdLastFrameMs } else { 0.0 }
      $outputFileName = if ($payload) { [string]$payload.outputFileName } else { "learning-outcomes-video.mp4" }
      $outputPath = if ($payload -and $payload.PSObject.Properties.Name -contains "outputPath") { [string]$payload.outputPath } else { "" }
      $saveToDefaultPath = if ($payload -and $payload.saveToDefaultPath -ne $null) { [bool]$payload.saveToDefaultPath } else { $false }
      $audioDuckingEnabled = if ($payload -and $payload.audioDuckingEnabled -ne $null) { [bool]$payload.audioDuckingEnabled } else { $true }
      $pdfExactTimeline = $payload -and $payload.PSObject.Properties.Name -contains "pdfExactTimeline" -and [bool]$payload.pdfExactTimeline

      if ([string]::IsNullOrWhiteSpace($videoBase64) -or [string]::IsNullOrWhiteSpace($audioBase64)) {
        Write-JsonResponse -Stream $Stream -StatusCode 400 -Payload @{ error = "Video and audio are both required." }
        return
      }

      $videoBytes = [System.Convert]::FromBase64String($videoBase64)
      $audioBytes = [System.Convert]::FromBase64String($audioBase64)
      if (-not [string]::IsNullOrWhiteSpace($musicBase64)) {
        $musicBytes = [System.Convert]::FromBase64String($musicBase64)
        $musicLength = $musicBytes.Length
      }
    }

    $videoExtension = Get-FileExtension -FileName $videoFileName -FallbackExtension ".webm"
    $audioExtension = Get-FileExtension -FileName $audioFileName -FallbackExtension ".wav"
    $musicExtension = Get-FileExtension -FileName $musicFileName -FallbackExtension ".wav"
    $tempVideo = Join-Path $env:TEMP ("canvas-" + [System.Guid]::NewGuid().ToString() + $videoExtension)
    $tempAudio = Join-Path $env:TEMP ("narration-" + [System.Guid]::NewGuid().ToString() + $audioExtension)
    $tempMusic = if ($musicLength -gt 0) {
      Join-Path $env:TEMP ("music-" + [System.Guid]::NewGuid().ToString() + $musicExtension)
    } else {
      ""
    }

    $muxedVideoPath = ""

    try {
      if ($isBinaryUpload) {
        Write-ByteRangeToFile -Path $tempVideo -Bytes $Request.BodyBytes -Offset $binaryPayload.VideoOffset -Length $binaryPayload.VideoLength
        Write-ByteRangeToFile -Path $tempAudio -Bytes $Request.BodyBytes -Offset $binaryPayload.AudioOffset -Length $binaryPayload.AudioLength
        if ($tempMusic) {
          Write-ByteRangeToFile -Path $tempMusic -Bytes $Request.BodyBytes -Offset $binaryPayload.MusicOffset -Length $binaryPayload.MusicLength
        }
      } else {
        [System.IO.File]::WriteAllBytes($tempVideo, $videoBytes)
        [System.IO.File]::WriteAllBytes($tempAudio, $audioBytes)
        if ($tempMusic) {
          [System.IO.File]::WriteAllBytes($tempMusic, $musicBytes)
        }
      }

      $muxedVideoPath = Invoke-VideoMux `
        -VideoPath $tempVideo `
        -AudioPath $tempAudio `
        -MusicPath $tempMusic `
        -AudioSpeed $audioSpeed `
        -VideoSpeed $videoSpeed `
        -ExportQuality $exportQuality `
        -MusicVolume $musicVolume `
        -TargetDurationMs $targetDurationMs `
        -HoldLastFrameMs $holdLastFrameMs `
        -AudioDuckingEnabled $audioDuckingEnabled `
        -PdfExactTimeline $pdfExactTimeline `
        -KeepOutputFile
      if (-not [string]::IsNullOrWhiteSpace($outputPath)) {
        $savedPath = Save-MuxedVideoToRequestedPath -SourcePath $muxedVideoPath -RequestedPath $outputPath
        $muxedVideoPath = ""
        Write-JsonResponse -Stream $Stream -StatusCode 200 -Payload @{
          ok = $true
          savedPath = $savedPath
          fileName = [System.IO.Path]::GetFileName($savedPath)
        }
      } elseif ($saveToDefaultPath) {
        $savedPath = Save-MuxedVideoToDefaultPath -SourcePath $muxedVideoPath -RequestedFileName $outputFileName
        $muxedVideoPath = ""
        Write-JsonResponse -Stream $Stream -StatusCode 200 -Payload @{
          ok = $true
          savedPath = $savedPath
          fileName = [System.IO.Path]::GetFileName($savedPath)
        }
      } else {
        Write-FileResponse -Stream $Stream -StatusCode 200 -FilePath $muxedVideoPath -ContentType "video/mp4" -ExtraHeaders @{
          "Cache-Control" = "no-store, no-cache, must-revalidate, max-age=0"
          "Pragma" = "no-cache"
          "Expires" = "0"
          "X-Content-Type-Options" = "nosniff"
        }
      }
    } catch {
      Write-JsonResponse -Stream $Stream -StatusCode 500 -Payload @{ error = $_.Exception.Message }
    } finally {
      if ($muxedVideoPath -and (Test-Path $muxedVideoPath)) {
        Remove-Item $muxedVideoPath -Force
      }
      if (Test-Path $tempVideo) {
        Remove-Item $tempVideo -Force
      }
      if (Test-Path $tempAudio) {
        Remove-Item $tempAudio -Force
      }
      if ($tempMusic -and (Test-Path $tempMusic)) {
        Remove-Item $tempMusic -Force
      }
    }

    return
  }

  Write-JsonResponse -Stream $Stream -StatusCode 404 -Payload @{ error = "Route not found." }
}

function Start-VideoExportListener {
  param($Listener, [int]$Port)

  try {
    $Listener.Start()
  } catch {
    # A port may belong to an active export or an unrelated application. Only
    # the owner of that process may decide to stop it; startup must not do so.
    throw "Video export server could not listen on 127.0.0.1:$Port. The port may already be in use. No existing process was stopped. Reuse the running export server or stop it explicitly before retrying. $($_.Exception.Message)"
  }
}

try {
  Start-VideoExportListener -Listener $listener -Port $port
  Write-Host "Video export server listening on $baseUrl"

  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $request = Read-HttpRequest -Stream $stream
      Handle-Request -Request $request -Stream $stream
    } catch {
      try {
        $stream = $client.GetStream()
        Write-JsonResponse -Stream $stream -StatusCode 500 -Payload @{ error = $_.Exception.Message }
      } catch {
      }
    } finally {
      $client.Close()
    }
  }
} finally {
  $listener.Stop()
}

