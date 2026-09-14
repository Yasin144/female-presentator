param([Parameter(Mandatory = $true)][string]$ImagePath)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$stream = $null
$bitmap = $null

function Await-PdfOcr($Operation, [Type]$ResultType) {
    $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
        $_.IsGenericMethodDefinition -and $_.GetGenericArguments().Count -eq 1
    } | Select-Object -First 1
    $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    $task.Wait()
    return $task.Result
}

try {
    # This worker is intentionally Windows PowerShell 5.1, not PowerShell 7.
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

    $file = Await-PdfOcr ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
    $stream = Await-PdfOcr ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await-PdfOcr ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    if ($decoder.PixelWidth -lt 1 -or $decoder.PixelHeight -lt 1 -or
        $decoder.PixelWidth -gt 3000 -or $decoder.PixelHeight -gt 3000) {
        throw 'Decoded OCR images must be between 1 and 3000 pixels on each side.'
    }
    $bitmap = Await-PdfOcr ($decoder.GetSoftwareBitmapAsync(
        [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,
        [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied
    )) ([Windows.Graphics.Imaging.SoftwareBitmap])

    $engine = $null
    foreach ($languageTag in @('en-US', 'en-GB')) {
        $language = New-Object Windows.Globalization.Language $languageTag
        if ([Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($language)) {
            $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
            if ($engine) { break }
        }
    }
    if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
    if (-not $engine) { throw 'Windows OCR has no usable installed recognition language.' }

    $result = Await-PdfOcr ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $items = New-Object 'System.Collections.Generic.List[object]'
    foreach ($line in $result.Lines) {
        foreach ($word in $line.Words) {
            $box = $word.BoundingRect
            $height = [double]$box.Height
            $items.Add([pscustomobject]@{
                str = [string]$word.Text
                transform = @(1, 0, 0, $height, [double]$box.X, -[double]$box.Y)
                height = $height
                width = [double]$box.Width
            })
        }
    }
    [pscustomobject]@{
        ok = $true
        text = [string]$result.Text
        items = @($items.ToArray())
        engine = 'Windows OCR'
    } | ConvertTo-Json -Depth 5 -Compress
} catch {
    [pscustomobject]@{ ok = $false; text = ''; items = @(); engine = 'Windows OCR'; error = $_.Exception.Message } |
        ConvertTo-Json -Depth 5 -Compress
} finally {
    if ($bitmap) { $bitmap.Dispose() }
    if ($stream) { $stream.Dispose() }
}
