# Stowed

Home inventory app: what's in each room, where it should go, and searchable in a hurry. Installable web app (PWA), all data stored on the device, with backup files for safekeeping and sharing.

Version 0.1.0 (stage 1: listing, locations, planned moves).

## Put it online (GitHub Pages)

1. Create a new GitHub repository (e.g. `stowed`).
2. Upload every file in this folder to the repository root.
3. Settings → Pages → Source: "Deploy from a branch", branch `main`, folder `/ (root)`. Save.
4. Open the address GitHub gives you (e.g. `https://<you>.github.io/stowed/`) on your phone.
5. Install it: Chrome on Android → menu → "Add to Home screen" / "Install app". Safari on iPhone → Share → "Add to Home Screen".

After uploading a new version, close and reopen the app once to pick it up. The version number is at the bottom of the room list and in Settings.

## Where your data lives

Everything is stored in the browser's storage on that phone. Nothing is sent anywhere. The hosted page only delivers the app itself.

- **Back up regularly:** Settings → Download backup (or Share backup… to save it to Drive, email, etc.). A yellow banner appears when the last backup is 7 or more days old.
- **Restore or share:** Settings → Import backup… replaces everything on that device with the backup's contents. This is also how your partner gets a copy.
- Uninstalling the app or clearing site data for its address deletes the data on that device. Back up first.

## Using it

- **Rooms:** "+ Add room" at the bottom of the list. Limbo is a built-in room for anything without a place.
- **Adding things:** the **+** on any room or container opens a box where you type one item per line ("head torch x2" for a quantity). Tick "Add as containers" to create storage instead. The round **+** button adds to Limbo.
- **Optional details while adding:** tags, which rooms the items are used in, and how often.
- **Item details:** tap a chip to edit name, quantity, tags, usage rooms, frequency, or move it.
- **Containers:** the **⋯** button edits name, emoji, colour (rooms), accessibility, fixed/mobile, and "treat as a group".
- **Accessibility:** tap the star on a room or storage row to cycle normal → prime → awkward (ladder).
- **Moving:** long-press a chip or container row, drag it onto a room or container, then choose Move or Propose move. Hovering over a closed row opens it.
- **Planned moves:** the item stays greyed in its current spot and appears dotted at its destination. Confirm or cancel from either chip, or from the Planned moves tab.
- **Select:** tap Select, then tap chips to pick several. Then set details for all of them, move them, group them, or delete them.
- **Groups:** a group needs at least 2 items. If it drops to 1, it's removed and its item stays where the group was.
- **Deleting a container:** its items go to Limbo; groups inside go to Limbo intact. Deleting a group returns its items to the container it was in. Every delete can be undone from the message that appears.
- **Needs info** lists items missing tags, usage rooms or frequency.

## Not built yet

Suggestions (thresholds, group matching, splits), read-only shared export, printable emergency sheet.

## Files

`index.html`, `style.css`, `app.js` (the app), `sw.js` (offline support), `manifest.json` and the icons (installing).
