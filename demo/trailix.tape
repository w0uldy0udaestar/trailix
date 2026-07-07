# Demo GIF recipe for trailix. Generate with:
#   go install github.com/charmbracelet/vhs@latest   # needs ttyd + ffmpeg
#   vhs demo/trailix.tape                             # writes demo/trailix.gif
#
# Uses the built-in `trailix demo` so it renders without any real session data.

Output demo/trailix.gif

Set FontSize 20
Set Width 1100
Set Height 640
Set Padding 24
Set Theme "Catppuccin Mocha"

Type "npx trailix demo"
Sleep 500ms
Enter
Sleep 3s

Type "npx trailix demo --lang ko"
Sleep 500ms
Enter
Sleep 3s
