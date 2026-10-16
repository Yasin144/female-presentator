param([Parameter(Mandatory = $true)][string]$ManifestPath)

# One native OCR process for all sampled frames; no network/model download.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding

function Await-CaptionOcr($Operation, [Type]$ResultType) {
    $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
        $_.IsGenericMethodDefinition -and $_.GetGenericArguments().Count -eq 1
    } | Select-Object -First 1
    $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    $task.Wait()
    return $task.Result
}

try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] > $null
    [Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime] > $null
    [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] > $null
    [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime] > $null
    [Windows.Graphics.Imaging.BitmapPixelFormat, Windows.Graphics.Imaging, ContentType = WindowsRuntime] > $null
    [Windows.Graphics.Imaging.BitmapAlphaMode, Windows.Graphics.Imaging, ContentType = WindowsRuntime] > $null
    [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] > $null
    [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime] > $null
    [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime] > $null

    $engine = $null
    foreach ($languageTag in @('en-US', 'en-GB')) {
        $language = New-Object Windows.Globalization.Language $languageTag
        if ([Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($language)) {
            $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
            if ($engine) { break }
        }
    }
    if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
    if (-not $engine) { throw 'Windows OCR has no installed recognition language. Install a Windows OCR language pack.' }

    $manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($item in $manifest.frames) {
        $stream = $null
        $bitmap = $null
        try {
            $file = Await-CaptionOcr ([Windows.Storage.StorageFile]::GetFileFromPathAsync([string]$item.path)) ([Windows.Storage.StorageFile])
            $stream = Await-CaptionOcr ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
            $decoder = Await-CaptionOcr ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
            if ($decoder.PixelWidth -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension -or $decoder.PixelHeight -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension) {
                throw 'A sampled frame exceeds the Windows OCR image limit.'
            }
            $bitmap = Await-CaptionOcr ($decoder.GetSoftwareBitmapAsync(
                [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,
                [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied
            )) ([Windows.Graphics.Imaging.SoftwareBitmap])
            $result = Await-CaptionOcr ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
            $lines = New-Object 'System.Collections.Generic.List[object]'
            foreach ($line in $result.Lines) {
                $words = New-Object 'System.Collections.Generic.List[object]'
                foreach ($word in $line.Words) {
                    $box = $word.BoundingRect
                    $words.Add([pscustomobject]@{
                        text = [string]$word.Text
                        x = [double]$box.X; y = [double]$box.Y
                        w = [double]$box.Width; h = [double]$box.Height
                    })
                }
                $lines.Add([pscustomobject]@{ text = [string]$line.Text; words = @($words.ToArray()) })
            }
            [pscustomobject]@{ type = 'frame'; index = [int]$item.index; ok = $true; lines = @($lines.ToArray()) } | ConvertTo-Json -Depth 7 -Compress
        } finally {
            if ($bitmap) { $bitmap.Dispose() }
            if ($stream) { $stream.Dispose() }
        }
    }
    [pscustomobject]@{ type = 'complete'; ok = $true; engine = 'Windows OCR' } | ConvertTo-Json -Compress
} catch {
    [pscustomobject]@{ type = 'error'; ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    exit 1
}
