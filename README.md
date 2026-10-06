# Stowed

Home inventory app: what's in each room, where it should go, and searchable in a hurry. Installable web app (PWA), all data stored on the device, with backup files for safekeeping and sharing.

Version 0.6.0: listing, locations, planned moves and suggestions.

## Put it online (GitHub Pages)

1. Create a new GitHub repository (e.g. `stowed`).
2. Upload every file in this folder to the repository root.
3. Settings → Pages → Source: "Deploy from a branch", branch `main`, folder `/ (root)`. Save.
4. Open the address GitHub gives you (e.g. `https://<you>.github.io/stowed/`) on your phone.
5. Install it: Settings (⚙︎) → Install app, or Chrome menu ⋮ → Install app. On iPhone: Share → Add to Home Screen.

**If Chrome says it's already installed but you can't find it:** an earlier install is still registered. Removing a home-screen icon on Android doesn't uninstall the app.
1. Back up first (Settings → Download backup).
2. Look for Stowed in your app drawer. If it's there, open it from there.
3. Otherwise, go to Android Settings → Apps → Stowed → Uninstall, then reload the page in Chrome and install again.

If Android asks whether to also clear Chrome's data for the site, say no, or import your backup afterwards.

After uploading a new version, close and reopen the app (sometimes twice) to pick it up. Your data stays as it is; back up first anyway. The version number is at the bottom of the room list and in Settings.

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
- **Planned moves:** the item stays greyed in its current spot and appears dotted at its destination. Confirm or cancel from either chip, or in the Tasks tab.
- **Tasks** tab: to-dos plus planned moves.
  - Add a task from the tab (+ Task, or the round + button), or from any item, container or room's details ("+ Add task"). A task is your text plus what it's attached to, e.g. "Buy a folder for these" on the Paperwork group.
  - Filter: All, To do, or Moves.
  - Sort to-dos by My order (drag the ≡ handle to reorder) or By room.
  - Tick to mark done; done tasks are hidden behind "Show done", where they can be cleared.
  - Tap a task to edit its text, change or remove what it's attached to, jump to it (Show), or delete it.
  - Items show ✎ and containers show "task" when they have open tasks.
  - If you delete the thing a task is attached to, the task stays, marked "no longer exists". If a group dissolves, its tasks move to the container it was in.
- **Select:** tap Select, then tap chips to pick several. Then set details for all of them, move them, group them, or delete them.
- **Groups:** a group needs at least 2 items. If it drops to 1, it's removed and its item stays where the group was.
- **Deleting a container:** its items go to Limbo; groups inside go to Limbo intact. Deleting a group returns its items to the container it was in. Every delete can be undone from the message that appears.
- **Used in:** leaving every room unselected means the item is used in any room (screwdrivers, say).
- **Needs info** lists items missing tags or a frequency. Items without a frequency aren't considered for suggestions.
- **Seasonal:** tick it under an item's frequency and choose the months it's in use (e.g. May to Sep). Outside those months it counts as rarely used, so it gets suggested for deep storage, as long as the off-season is at least the gap set in Settings (3 months by default). It keeps counting as rarely used until the start month comes round; nothing is suggested to come back early.
- **Suggestions** tab:
  - **Moving out:**
    - The room counts first. To be in a prime room, an item must be used at least weekly, even if that's the room it's used in.
    - To be in prime storage (any room), an item must be used at least daily. A weekly cake tin can stay in the kitchen, just not on the prime shelf; the suggestion points at ordinary storage in the same room.
  - **Moving in:** for anything used at least weekly:
    - The rooms it's used in are its ideal rooms, whatever their primeness. Soap used daily in a normal bathroom stays put.
    - If it's kept in a different room, it's suggested to move to the room it's used in.
    - If it's used in any room, it's suggested to move to a prime room (as long as it's used often enough for one).
    - If it's in an awkward spot, it's suggested to move somewhere easier.
  - All three frequencies, the seasonal gap, the minimum sizes for group suggestions and the backup reminder are in Settings › Suggestions. Changing a suggestion setting clears dismissed suggestions and works them out again.
  - Emergency items are never flagged for being in a prime or awkward spot, but they are matched with groups and items sharing their tags, whatever their frequency (burn gel with the first aid group, say).
  - Where to move to comes from a matching group (same frequency, a shared tag, a compatible room), or from a tag home.
  - *Split group*: a group with some members suited to its spot and some not. Tap or drag items between the two sides; for a container like a pouch, drag the container to the side that keeps it.
  - *Create group*, *Merge groups*, *Doesn't fit its group* and *Tag home* (set in a container's ⋯ settings under "Home for tags").
  - Suggestions are stacked under the container they're about.
  - **For:** at the top of the tab, choose the whole house, or one room or container. Each room, container (⋯) and item also has a "Suggestions for…" button. This picks which things get suggestions; where they're suggested to go can be anywhere in the house.
  - **Accept** creates planned moves.
  - **Dismiss** rejects that one suggestion: if there's another good place, it's offered next.
  - **Dismiss all for this item / group** stops all suggestions for it.
  - Both kinds of dismissal last until that item's tags, rooms or frequency change.
  - **Reset suggestions** forgets every dismissal and works suggestions out again from scratch.
- Arrows on chips mark items with a suggestion: ↓ to move out of prime space, ↑ to move closer to where it's used or out of an awkward spot.

## Not built yet

Read-only shared export, printable emergency sheet, intentional duplicates, frequency review, "where did you expect it?" prompt, setting a group's criteria by hand.

## Files

`index.html`, `style.css`, `app.js` (the app), `sw.js` (offline support), `manifest.json` and the icons (installing).
