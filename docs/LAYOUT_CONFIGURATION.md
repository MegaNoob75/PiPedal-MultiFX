# Controller Layout

MultiFX has two presentation modes: **Grid** and **Freeform**. Neither mode changes preset assignments.

A preset assignment belongs to a **PiPedal bank + logical switch ID**. Moving SW1, resizing it, hiding it from Freeform, or switching between Grid and Freeform does not change the preset assigned to SW1.

## Grid

Grid automatically places configured switches using the selected rows/columns. Removing a switch compacts the grid. Grid geometry is presentation only.

## Freeform

Freeform changes geometry only when the user explicitly changes it. Existing controls do not move when another control is added or removed. Newly-added switches start as **UNPLACED** and can be placed from the Layout editor.

The Layout editor also contains status/dashboard elements such as Current Bank, Active Preset, CPU Usage, XRuns, temperature, audio status, Chain Bypass and Snapshot Mode. There is no Preset Page element because MultiFX no longer has virtual preset pages.

## Defaults

The user can save separate Grid and Freeform layout defaults. These defaults affect layout only; they do not copy, erase, resize or reorder musical preset assignments.
