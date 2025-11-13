$juliaArgs = $args[1..($args.Length - 1)]
$juliaArgs2 = @()

ForEach ($arg in $juliaArgs) {
    $juliaArgs2 += "`"$arg`""
}
$proc = Start-Process "$($args[0])" -ArgumentList $juliaArgs2  -PassThru -NoNewWindow
$handle = $proc.Handle
$proc.WaitForExit()

$status = $proc.ExitCode
$esc = "$([char]0x1b)"

if ( $status -ne 0) {
    Write-Output "$esc[30;47m * $esc[0m The process '$($args[0])' terminated with exit code: $status."
    Write-Output "$esc[30;47m * $esc[0m Press any key to close this terminal"
    $key = [System.Console]::ReadKey();
}

exit $status
