# Terminal opener for the hero GIF (vhs). Run from the repo root:
#   vhs docs/demo-term.tape
# The typed command is exactly the README quick start. A hidden shell function
# maps `npx @jnmetacode/tracelet` to this checkout and adds --no-open so no
# browser pops up while recording.
Output term.mp4
Set FontSize 17
Set Width 1100
Set Height 620
Set Theme "Catppuccin Mocha"
Set Padding 12
Set TypingSpeed 35ms
Hide
Type `npx() { shift; node src/cli.js "$@" --no-open; }; export PS1='$ ' && clear`
Enter
Show
Type "# what changed between two agent runs? — locally, no account"
Sleep 800ms
Enter
Type "npx @jnmetacode/tracelet --demo"
Sleep 400ms
Enter
Sleep 3s
