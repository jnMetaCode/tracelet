# Terminal opener for the hero GIF (vhs). Run from the repo root:
#   vhs docs/demo-term.tape
Output term.mp4
Set FontSize 17
Set Width 1100
Set Height 620
Set Theme "Catppuccin Mocha"
Set Padding 12
Set TypingSpeed 35ms
Hide
Type `tracelet() { node src/cli.js "$@"; }; npx() { shift; tracelet "$@"; }; export PS1='$ ' && clear`
Enter
Show
Type "# what changed between two agent runs? — locally, no account"
Sleep 800ms
Enter
Type "npx @jnmetacode/tracelet --no-open &"
Sleep 300ms
Enter
Sleep 2s
Type "node examples/demo.js --compare"
Sleep 300ms
Enter
Sleep 2.8s
