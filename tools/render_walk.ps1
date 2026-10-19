param(
  [string]$PartDir = (Join-Path $PSScriptRoot '..\psd\raw\gen\puppet'),
  [string]$OutDir = (Join-Path $PSScriptRoot '..\psd\raw\gen\puppet\frames')
)
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
$W = 1152; $H = 2048
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$body = [System.Drawing.Bitmap]::FromFile((Join-Path $PartDir 'body.png'))
$near = [System.Drawing.Bitmap]::FromFile((Join-Path $PartDir 'leg_near.png'))
$pivF = @(495, 1465)
$pivN = @(610, 1465)
$amp = 11.0

# Far leg = shifted copy of the complete near leg, slightly darker for depth.
$far = New-Object System.Drawing.Bitmap -ArgumentList $W, $H
$fg = [System.Drawing.Graphics]::FromImage($far)
$fg.Clear([System.Drawing.Color]::Transparent)
$cm = New-Object System.Drawing.Imaging.ColorMatrix
$cm.Matrix00 = 0.84; $cm.Matrix11 = 0.82; $cm.Matrix22 = 0.84; $cm.Matrix33 = 1.0; $cm.Matrix44 = 1.0
$ia = New-Object System.Drawing.Imaging.ImageAttributes
$ia.SetColorMatrix($cm)
$dest = New-Object System.Drawing.Rectangle -ArgumentList 0, 0, $W, $H
$fg.DrawImage($near, $dest, -115, 0, $W, $H, [System.Drawing.GraphicsUnit]::Pixel, $ia)
$fg.Dispose()

function Draw-Rotated($g, $img, $px, $py, $deg) {
  $g.TranslateTransform($px, $py)
  $g.RotateTransform($deg)
  $g.TranslateTransform(-$px, -$py)
  $g.DrawImage($img, 0, 0, $img.Width, $img.Height)
  $g.ResetTransform()
}

for ($p = 0; $p -lt 8; $p++) {
  $t = $p / 8.0 * 2 * [Math]::PI
  $a = $amp * [Math]::Cos($t)
  $bob = [Math]::Round(5.0 * (1 - [Math]::Cos(2 * $t)) / 2)
  $cv = New-Object System.Drawing.Bitmap -ArgumentList $W, $H, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($cv)
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  Draw-Rotated $g $far $pivF[0] $pivF[1] $a
  Draw-Rotated $g $near $pivN[0] $pivN[1] (-$a)
  $sway = 0.9 * [Math]::Sin($t)
  $g.TranslateTransform(580, 1460 - $bob)
  $g.RotateTransform($sway)
  $g.TranslateTransform(-580, -1460)
  $g.DrawImage($body, 0, 0, $W, $H)
  $g.ResetTransform()
  $g.Dispose()
  $cv.Save((Join-Path $OutDir ("frame_{0}.png" -f $p)), [System.Drawing.Imaging.ImageFormat]::Png)
  $cv.Dispose()
  "frame $p angle=$([Math]::Round($a,1)) bob=$bob"
}
$body.Dispose(); $near.Dispose(); $far.Dispose()

$sc = 0.5; $cw = [int]($W * $sc); $ch = [int]($H * $sc)
$sheet = New-Object System.Drawing.Bitmap -ArgumentList ([int]($cw * 4)), ([int]($ch * 2))
$sg = [System.Drawing.Graphics]::FromImage($sheet)
$sg.Clear([System.Drawing.Color]::FromArgb(255, 40, 44, 52))
$sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
for ($p = 0; $p -lt 8; $p++) {
  $img = [System.Drawing.Bitmap]::FromFile((Join-Path $OutDir ("frame_{0}.png" -f $p)))
  $x = ($p % 4) * $cw; $y = [Math]::Floor($p / 4) * $ch
  $sg.DrawImage($img, $x, $y, $cw, $ch)
  $img.Dispose()
}
$sg.Dispose()
$sheet.Save((Join-Path $OutDir 'preview.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$sheet.Dispose()
'preview -> ' + (Join-Path $OutDir 'preview.png')

