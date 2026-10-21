# Terminal demo for the landing page and the launch posts, recorded with VHS (https://github.com/charmbracelet/vhs):
#   cd examples/demo && vhs ../../docs/launch/demo.tape
# Uses the published package; until it is published, replace `npx -y landmines` with `node ../../dist/cli.js`.
Output landmine-demo.gif
Set FontSize 18
Set Width 1280
Set Height 760
Set Theme "Builtin Dark"
Set TypingSpeed 35ms

Type "npx -y landmines scan"
Enter
Sleep 16s
Type "npx -y landmines install --rules"
Enter
Sleep 3s
Type "head -12 CLAUDE.md"
Enter
Sleep 5s
Type "npx -y landmines share"
Enter
Sleep 5s
