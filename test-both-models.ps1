Add-Type -AssemblyName System.Net.Http

$url = "https://omnirouterai-production.up.railway.app/v1/audio/transcriptions"
$apiKey = "AxzcsaFSAZxsaxczv_AsdxcaXxdax12scfdsaczxv131xzvgdzvqwdqwdxzcdfaczxvgfaA22"
$audioFile = "E:\ambitious projects\OmniRouteAI2\t.mp3"

function TestModel($model) {
    Write-Host "`n===== Testing $model =====" -ForegroundColor Cyan
    
    $client = New-Object System.Net.Http.HttpClient
    $client.Timeout = [TimeSpan]::FromSeconds(60)
    
    $content = New-Object System.Net.Http.MultipartFormDataContent
    
    $fileStream = [System.IO.File]::OpenRead($audioFile)
    $fileContent = New-Object System.Net.Http.StreamContent($fileStream)
    $fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse("audio/mpeg")
    $content.Add($fileContent, "file", "t.mp3")
    
    $modelContent = New-Object System.Net.Http.StringContent($model)
    $content.Add($modelContent, "model")
    
    $request = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Post, $url)
    $request.Content = $content
    $request.Headers.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", $apiKey)
    
    try {
        $task = $client.SendAsync($request)
        $task.Wait(60000)
        
        if ($task.IsCompleted) {
            $response = $task.Result
            $body = $response.Content.ReadAsStringAsync().Result
            Write-Host "Status: $($response.StatusCode)" -ForegroundColor Yellow
            Write-Host $body
        } else {
            Write-Host "TIMEOUT after 60 seconds!" -ForegroundColor Red
        }
    } catch {
        Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    } finally {
        $fileStream.Dispose()
        $client.Dispose()
    }
}

TestModel("whisper-1")
TestModel("whisper-large-v3")