$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$iconDirectory=Join-Path (Split-Path $PSScriptRoot -Parent) 'icons'
[IO.Directory]::CreateDirectory($iconDirectory) | Out-Null
function RoundedPath([single]$x,[single]$y,[single]$w,[single]$h,[single]$radius) {
  $p=[Drawing.Drawing2D.GraphicsPath]::new()
  $d=$radius*2
  $p.AddArc($x,$y,$d,$d,180,90)
  $p.AddArc($x+$w-$d,$y,$d,$d,270,90)
  $p.AddArc($x+$w-$d,$y+$h-$d,$d,$d,0,90)
  $p.AddArc($x,$y+$h-$d,$d,$d,90,90)
  $p.CloseFigure()
  return ,$p
}
$canvas=[Drawing.Bitmap]::new(512,512)
$g=[Drawing.Graphics]::FromImage($canvas)
try {
  $g.Clear([Drawing.Color]::Transparent)
  $g.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.ScaleTransform(4,4)
  $paper=RoundedPath 5 5 118 118 25
  $fill=[Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#f8fafc'))
  $outline=[Drawing.Pen]::new([Drawing.ColorTranslator]::FromHtml('#b7c4d6'),2)
  $g.FillPath($fill,$paper);$g.DrawPath($outline,$paper)
  $fill.Dispose();$outline.Dispose();$paper.Dispose()
  foreach($bar in @(@(20,61,20,47,'#3b5998'),@(47,43,20,65,'#e8b545'),@(74,25,20,83,'#d95d63'))) {
    $shape=RoundedPath $bar[0] $bar[1] $bar[2] $bar[3] 4
    $brush=[Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml($bar[4]))
    $g.FillPath($brush,$shape);$brush.Dispose();$shape.Dispose()
  }
  $brush=[Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#304f86'))
  $g.FillEllipse($brush,78,78,44,44);$brush.Dispose()
  $check=[Drawing.Pen]::new([Drawing.Color]::White,7)
  $check.StartCap=[Drawing.Drawing2D.LineCap]::Round
  $check.EndCap=[Drawing.Drawing2D.LineCap]::Round
  $check.LineJoin=[Drawing.Drawing2D.LineJoin]::Round
  $points=[Drawing.PointF[]]@([Drawing.PointF]::new(89,100),[Drawing.PointF]::new(97,109),[Drawing.PointF]::new(111,94))
  $g.DrawLines($check,$points);$check.Dispose()
  foreach($size in @(16,32,48,128)) {
    $bitmap=[Drawing.Bitmap]::new($size,$size)
    $scaled=[Drawing.Graphics]::FromImage($bitmap)
    try {
      $scaled.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $scaled.CompositingQuality=[Drawing.Drawing2D.CompositingQuality]::HighQuality
      $scaled.PixelOffsetMode=[Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $scaled.DrawImage($canvas,[Drawing.Rectangle]::new(0,0,$size,$size))
      $bitmap.Save((Join-Path $iconDirectory "icon$size.png"),[Drawing.Imaging.ImageFormat]::Png)
    } finally {$scaled.Dispose();$bitmap.Dispose()}
  }
} finally {$g.Dispose();$canvas.Dispose()}
