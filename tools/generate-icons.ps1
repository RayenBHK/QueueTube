param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\assets")
)

Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Drawing

function New-RoundedRectanglePath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $diameter = $Radius * 2
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

$colors = @{
  Ink = [System.Drawing.ColorTranslator]::FromHtml("#122423")
  Short = [System.Drawing.ColorTranslator]::FromHtml("#F26B3A")
  Video = [System.Drawing.ColorTranslator]::FromHtml("#6F8CFF")
  Paper = [System.Drawing.ColorTranslator]::FromHtml("#F4F7F6")
}

foreach ($size in @(16, 32, 48, 128)) {
  $scale = $size / 128.0
  $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $backgroundPath = New-RoundedRectanglePath -X 0 -Y 0 -Width ($size - 1) -Height ($size - 1) -Radius (28 * $scale)
  $backgroundBrush = [System.Drawing.SolidBrush]::new($colors.Ink)
  $graphics.FillPath($backgroundBrush, $backgroundPath)

  $shortPen = [System.Drawing.Pen]::new($colors.Short, [Math]::Max(1.2, 10 * $scale))
  $videoPen = [System.Drawing.Pen]::new($colors.Video, [Math]::Max(1.2, 10 * $scale))
  $rungPen = [System.Drawing.Pen]::new($colors.Paper, [Math]::Max(0.8, 5 * $scale))
  foreach ($pen in @($shortPen, $videoPen, $rungPen)) {
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  }

  foreach ($x in @(38, 53)) {
    $graphics.DrawLine($shortPen, $x * $scale, 24 * $scale, $x * $scale, 104 * $scale)
  }
  foreach ($x in @(76, 91)) {
    $graphics.DrawLine($videoPen, $x * $scale, 24 * $scale, $x * $scale, 104 * $scale)
  }
  foreach ($y in @(43, 66, 89)) {
    $graphics.DrawLine($rungPen, 32 * $scale, $y * $scale, 59 * $scale, $y * $scale)
    $graphics.DrawLine($rungPen, 70 * $scale, $y * $scale, 97 * $scale, $y * $scale)
  }

  $target = Join-Path $OutputDirectory "icon$size.png"
  $bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)

  $rungPen.Dispose()
  $videoPen.Dispose()
  $shortPen.Dispose()
  $backgroundBrush.Dispose()
  $backgroundPath.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}
