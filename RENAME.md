# LumenDeck folder rename fallback

The project folder was created as `sticker` because the running agent session
held a lock on it (`Device or resource busy`). Everything inside already uses
the **LumenDeck** identity (product name, config path `%APPDATA%/LumenDeck`,
identifier `dev.lumendeck.app`, tray tooltip).

## Finish the rename

Close any editor/terminal whose working directory is inside the folder, then
run from a PowerShell prompt **outside** it (e.g. `C:\Users\Gabriel\Desktop\Gabriel\dev`):

```powershell
Rename-Item -Path .\sticker -NewName LumenDeck
```

Or simply run the helper script from the parent folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\sticker\scripts\rename-to-lumendeck.ps1
```

Afterwards: `cd LumenDeck` and everything continues to work — no paths inside
the repo are affected by the folder name.
