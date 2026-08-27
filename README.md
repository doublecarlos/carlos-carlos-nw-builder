# Carlos Carlos' NW Builder

Web app to plan builds for the game Neverwinter.
Areas of focus:

- Ability to easily compare multiple builds and see the differences between them, both item-wise and with damage calculations.
- Ability to easily define new items, bonuses and item sets to use in builds.

## Current status

- Build calculation engine: works fairly well.
- Gear database: very incomplete, was done mostly on the go to calculate my current builds.
- UI usability: not great, not terrible. Definitly can use a lot of work.

## History

Initially, this project was a hand-crafted Google Sheets spreadsheet, abusing LAMBDA() and related formulas to implement dynamic bonuses, set bonuses, etc. It worked well but had some rough edges, specially around creating/editing items and bonuses.

So I decided to ask a clanker to create a web app for the same purpose, and use the spreadsheet results to compare against.
And here we are!

## hey-clanker issues

Github issues are being used to coordinate/request stuff to clankers.
These are tagged "hey-clanker" to differentiate them from "real" issues.
To hide all of them in the issue list, add "-label:hey-clanker" on the search bar.

## Development

```sh
npm install # Install dependencies

npm run dev # Dev server with auto-reload

npm run build # Build final static web-app, save to dist/
npm run preview # Preview final static web-app

npm run test # Run tests
npm run typecheck # Run type-checking
```
