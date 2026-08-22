PiPedal MultiFX - Controller + Theme Settings
================================================

Copy/extract all files in this archive into:

C:\Users\ross7\Documents\GitHub\PiPedal-MultiFX\vite\src\pipedal\

Overwrite existing files when prompted.

New MultiFX Settings structure:

MFX -> Settings
  Controller
  Theme
  PiPedal / System

Controller settings:
- Add/remove switch tiles.
- Drag/swap switch positions on a rows/columns grid.
- Assign physical switch inputs 1-8.
- Assign Preset Slot, Bank Up, Bank Down, or Unused.
- Save from the UI.
- Restore controller-config.json / defaults.
- Performance View reloads the saved layout immediately.

Theme manager:
- MultiFX Purple
- Midnight Blue
- Amber Stage
- Crimson Stage
- High Contrast
- Live custom color preview.
- Save custom theme.
- Import/export shareable JSON theme files.
- Unsaved previews are reverted when leaving Theme Manager.

Persistence:
Controller and theme overrides are stored in browser localStorage.
The existing controller-config.json remains the fallback/default.
This means settings are local to the browser/device where they are changed.
For the floor unit, configure them in the Pi's kiosk browser.

Current physical switch protocol:
Hardware switch identities 1-8 are supported by the current bridge.
