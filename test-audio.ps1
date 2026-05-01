$url = "https://omnirouterai-production.up.railway.app/v1/audio/transcriptions"
$apiKey = "AxzcsaFSAZxsaxczv_AsdxcaXxdax12scfdsaczxv131xzvgdzvqwdqwdxzcdfaczxvgfaA22"
$audioFile = "E:\ambitious projects\OmniRouteAI2\t.mp3"

$headers = @{
    "Authorization" = "Bearer $apiKey"
}

Add-Type -AssemblyName System.Net.Http

$client = New-Object System.Net.Http.HttpClient
$client.Timeout = [TimeSpan]::FromSeconds(30)

$content = New-Object System.Net.Http.MultipartFormDataContent

$fileStream = [System.IO.File]::OpenRead($audioFile)
$fileContent = New-Object System.Net.Http.StreamContent($fileStream)
$fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse("audio/mpeg")
$content.Add($fileContent, "file", (Split-Path $audioFile -Leaf))

$modelContent = New-Object System.Net.Http.StringContent("whisper-1")
$content.Add($modelContent, "model")

$request = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Post, $url)
$request.Content = $content
$request.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::Parse("Bearer $apiKey")

try {
    Write-Host "Testing audio transcription (30s timeout)..."
    $task = $client.SendAsync($request)
    $task.Wait(30000)

    if ($task.IsCompleted) {
        $response = $task.Result
        $responseBody = $response.Content.ReadAsStringAsync().Result

        Write-Host "Status Code: $($response.StatusCode)"
        Write-Host "Response: $responseBody"
    } else {
        Write-Host "TIMEOUT - Request did not complete in 30 seconds"
    }
} catch [AggregateException] {
    foreach ($e in $_.Exception.InnerExceptions) {
        Write-Host "Exception: $($e.Message)"
    }
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
} finally {
    $fileStream.Dispose()
    $client.Dispose()
}