# Caption Fonts

Nunito Regular (400) and Black (900) are static instances of the upstream
[Nunito variable font](https://github.com/googlefonts/nunito/blob/main/fonts/variable/Nunito%5Bwght%5D.ttf).
Both the canvas preview and FFmpeg export load these files; no system installation
or network request is required. The SIL Open Font License is in `OFL.txt`.

Generated with FontTools 4.62.1:

```powershell
python -m fontTools.varLib.instancer Nunito-variable.ttf wght=400 --update-name --output Nunito-Regular.ttf
python -m fontTools.varLib.instancer Nunito-variable.ttf wght=900 --update-name --output Nunito-Black.ttf
```

Both faces have unitsPerEm=1000, usWinAscent=1077, usWinDescent=300.
libass's ASS fontsize is therefore 1.377 times the CSS pixel/em size.
