# Azeroth Skylines

A World of Warcraft themed city builder that compiles to a single
self-contained `dist/index.html`.

## The runner tests, we do not

**Do not run the test suite, the typecheck or the linter yourself.** No
`npm test`, no `npm run typecheck`, no `npm run lint`, and no building
merely to see whether a change holds together. The workflow in
`.github/workflows/build.yml` runs all of it on every push and every pull
request, and that run is the answer. Make the change, push it, read the run.

This is safe rather than careless. The Pages deploy is gated on those checks
— `deploy` declares `needs: build` — so a push that fails them never reaches
the live site. The worst case is a red `master` with the previous deploy
still serving.

When the runner comes back red, fix what it found and push again. Read the
failing step's log rather than reproducing the failure locally.

## The build is not in the repository

`dist/` is ignored. The runner builds it, attaches `index.html` to the run
as a downloadable artifact, and publishes it to
<https://raidandfade.github.io/AzerothSkylines/> on every push to `master`.
Never commit a built file.

Building locally is still fine when you genuinely need the file in hand —
the browser scripts in `tools/` load `dist/index.html`, and `npm run dev`
serves it with live reload. Just do not build as a way of checking your work.
