# QueueTube

QueueTube turns the way you already collect YouTube videos into two deliberate queues:

- **Shorts** are opened, loaded, and held paused in an orange tab group so they are ready for a quick viewing run.
- **Videos** are opened in a blue tab group and immediately discarded from memory. Chrome reloads one only when you select it.

Ctrl-click or middle-click any video on YouTube. QueueTube catches the gesture, identifies the format, and places the tab in the correct lane while preserving the order in which you picked it.

## Install the local build

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Choose **Load unpacked**.
4. Select this `Extension_Project` folder.
5. Refresh any YouTube page that was already open.

The QueueTube button shows the total number of queued tabs. Its popup lets you open the next Short or video, sleep all inactive long videos again, clear the queues, and change the capture and playback settings.

## Default behavior

- Ctrl / Command-click and middle-click are captured on YouTube video, live, and Shorts links.
- Shorts use YouTube's regular `/watch` player instead of the vertical Shorts feed.
- Nothing in a queued or hidden YouTube tab plays until you interact with its player.
- Long videos are marked auto-discardable and discarded while inactive.
- Playlist parameters are removed so one queued pick cannot roll into a playlist.
- Duplicate picks in the same lane are ignored.

Keyboard shortcuts: `Alt+Shift+S` opens the next Short and `Alt+Shift+V` opens the next long video. Chrome can change these at `chrome://extensions/shortcuts`.

## Privacy

QueueTube has no server, analytics, account, or external dependencies. It only reads YouTube links you click and Chrome's tabs, groups, and local extension settings.

## Verify the project

With Node.js installed, run:

```text
node --test
```

The automated checks cover URL classification, Shorts conversion, playlist isolation, duplicate keys, and the manifest's local entry points.
