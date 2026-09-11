const { execSync } = require('child_process');

try {
  const output = execSync(
    'powershell -Command "Get-CimInstance Win32_Process -Filter \\"Name like \'%node%\'\\" | ForEach-Object { Write-Output (\'PID:\' + $_.ProcessId + \' | CMD:\' + $_.CommandLine) }"',
    { encoding: 'utf-8' }
  );
  console.log(output);
} catch (e) {
  console.error(e);
}
