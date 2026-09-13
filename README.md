<!-- meta.contentType: Landing -->
<!-- content plan: docs/plans/documentation-plan.md -->

# Queue YouTube picks without opening more tabs

QueueTube turns Ctrl-click into a deliberate YouTube queue. Shorts and long videos stay organized as lightweight local records, then play in one reusable tab only when you choose them.

![QueueTube Queue Room](store-assets/screenshot-queue-room-1280x800.png)

## What QueueTube changes

QueueTube keeps your existing collection gesture and removes the expensive part: every selected video no longer needs its own YouTube page.

- **Queue Room**: separates Shorts from long videos in a persistent side panel
- **One-tab player**: reuses one YouTube tab across the queue
- **Manual playback**: keeps queued and background media paused until you press play
- **Zero-memory videos**: stores long videos as links until you select one
- **Focused Shorts run**: converts Shorts to the regular player and loads the next pick without playing it
- **Focus Shield**: hides related videos, comments, merchandise, and end cards on player pages
- **Time budgets**: starts a 10, 20, or 30 minute viewing session
- **Local history**: records watched and skipped picks on your device
- **Classic tabs**: preserves the original grouped-tab workflow as an optional mode

QueueTube has no server, account, analytics, ads, or external JavaScript.

## Install the local build

Use an unpacked extension while QueueTube is in development:

1. Download or clone this repository
2. Open `chrome://extensions` in Chrome
3. Turn on **Developer mode**
4. Click **Load unpacked**
5. Select the repository folder
6. Refresh any YouTube tab that was already open

Chrome 116 or newer is required.

## Collect and watch picks

Queue Room mode is enabled by default:

1. Browse YouTube Home or Subscriptions
2. Ctrl-click, Command-click, or middle-click a video or Short
3. Click the QueueTube toolbar button
4. Click **Queue Room**
5. Choose a pick, then press play in YouTube

QueueTube marks queued thumbnails on YouTube. It also blocks duplicate picks by default.

Inside a QueueTube player page, use these keys:

- `N`: load the next pick without recording an outcome
- `P`: restore and open the latest history item
- `X`: skip the current pick and load the next one

Chrome-wide shortcuts are available at `chrome://extensions/shortcuts`:

- `Alt+Shift+Q`: open the Queue Room
- `Alt+Shift+S`: open the next Short
- `Alt+Shift+V`: open the next long video
- `Alt+Shift+X`: skip the current pick

## Gather existing YouTube tabs

Open **Queue tools**, then click **Import open tabs**. You can keep the original tabs or close only the tabs that QueueTube imports.

## Use Classic tabs

Open **Controls & protection**, then change **Collecting mode** to **Classic tabs**. Shorts open in an orange tab group. Long videos open in a collapsed blue group and become discardable while inactive.

## Develop and verify QueueTube

QueueTube uses browser-native JavaScript and has no runtime dependencies. Run the release checks with Node.js 22 or newer:

```powershell
node tools/check-extension.mjs
```

Build the Chrome Web Store ZIP on Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/package-extension.ps1
```

Read [how to test QueueTube](docs/TESTING.md), [how QueueTube works](ARCHITECTURE.md), [QueueTube's accessibility support](docs/ACCESSIBILITY.md), and [how to contribute](CONTRIBUTING.md).

## Privacy and support

Queue data, settings, session budgets, and QueueTube history stay in local Chrome extension storage. Read the [privacy policy](PRIVACY.md) and report defects through [GitHub Issues](https://github.com/RayenBHK/QueueTube/issues).

QueueTube is an independent project. It is not affiliated with or endorsed by YouTube or Google.

## License

QueueTube is available under the [MIT License](LICENSE).
