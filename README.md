# Softboard Web

A private, device-local whiteboard and PDF annotation workspace. Built with React, TypeScript, PDF.js and pdf-lib. No documents, handwriting, images or backups are sent to a backend server. The server only delivers app files; IndexedDB is the local document database.

## Use

Open the web link online once. Wait for **Ready offline**, then the app can reopen, import files, edit, save and export with no internet. On iPad, open in Safari and choose Share > Add to Home Screen. Open that installed window once online too. Each browser/device has its own library. Use editable backups to transfer work.

Available updates show **Softboard update ready**. In an open board, **Save and reload** saves the document before loading the update; finish any text dialog or drawing gesture first. Updates never automatically reload an active board or clear local projects. If an older release still shows a bounded whiteboard rectangle, save your work and press Ctrl+Shift+R once to load the current app.

- **New whiteboard** opens an infinite canvas in every direction. Use Pan, Space + drag, or two fingers to move around; Fit brings the content into view. Templates include brainstorm, weekly planner and lined notes. Add pages from the Pages panel.
- **Open PDF** imports the original PDF locally and opens a continuous reader: pages stack vertically and initially fit the available width. Scroll down through the document. **+ / −** enlarge or shrink all pages; **Fit** returns to fit width. Page thumbnails and the bottom arrows jump to a page in the scroll view. Only nearby pages are rendered, and the original PDF stays in your project.
- **Pen** offers Raw ink and the course's natural smoothing without shape recognition. Raw ink is the default for new settings; saved preferences are respected. Coalesced pen samples are retained. Final ink uses the same path as live ink.
- **Highlight** draws freely. On PDFs, **More → Text highlight** selects actual PDF text and highlights the selected lines. On touch devices, select text and tap Highlight selected text. Scanned PDFs without a text layer support freehand highlighting, not text selection or OCR.
- **Text** and **Sticky note** place text wherever you tap. Double-click with Select to edit. Arabic/Kurdish and other Unicode writing are rendered using local system fonts.
- **Image** inserts a local PNG/JPEG/WebP/GIF/BMP/AVIF. Use Select to move it and its lower-right handle to resize. The selection toolbar rotates, locks, duplicates and changes stacking order.
- **More** contains pan, sticky notes, rectangles, ellipses, lines, arrows, laser and lasso.
- **Eraser** supports whole-stroke and precision modes. Precision cuts writing, preserving the remaining pieces. Use Select + Delete for text, images and shapes.
- On whiteboards, two fingers zoom and pan. On PDFs, two fingers scroll without changing page size; use + / − to resize pages. In pen-only mode, one finger moves the board or scrolls the PDF while the pen writes. More → Pan and Space + drag also move through a PDF. Drawing temporarily fixes the view so size controls cannot shift a stroke halfway through it.
- Use Workspace settings for theme, pen-only input, paper pattern and color, fullscreen and hiding the top bar. Hiding toolbars does not change your zoom.

Canvas, Pan and Add link are in the top bar. Two small buttons on the canvas toggle the Pages sidebar and the top bar independently. The top-bar button switches between Hide top bar and Show top bar. On small screens the top-bar controls use a second row.

The compact charcoal drawing toolbar uses icon buttons with hover names: Select, Pen, Highlight, Text, Eraser, Image, More and Favorite. More retains the additional drawing tools and PDF text highlighting. Color swatches scroll horizontally without a native scrollbar; use the mouse wheel, touch swipe, keyboard focus/arrows, or desktop palette chevron to reach additional colors. Thickness and style keep their own rounded groups beside the palette.

Double-click a color swatch to save it as a favorite. The heart in the drawing toolbar switches between all colors and favorites; the custom color picker remains available in both views. To save a custom color, choose it with the picker, then double-click its swatch in All colors. Hover over a favorite for one second to reveal its minus button. On touchscreens, double-tap to favorite and hold for one second to reveal removal. Keyboard users can press Shift+Enter on a swatch to favorite it, or Delete in the favorites view to remove it. Favorites stay on this browser/device and survive reloads.

## Saving and files

Refreshing an open whiteboard or PDF reopens that document at the same page and view, with the same sidebar/top-bar/tool visibility. PDFs restore their reading position and page size, including fit-width mode; whiteboards restore pan and zoom. Each browser tab remembers its own location. Choosing Library intentionally clears that tab's open-document location. This navigation state is separate from saved document content, and restoration also works offline.

Unsaved changes save locally every five minutes, measured from the first unsaved edit. Further edits do not postpone that deadline. If a stroke is active when saving is due, its completed content saves when the gesture ends. The visible **Save** button in the top navigation bar and Ctrl/Cmd+S save immediately. Leaving for the library also saves first; hiding the tab attempts an earlier background save. The status only says Saved after the database transaction succeeds. Interrupted saves and conflicting tabs report errors. Keep an editable backup before resolving a conflict.

Export PDF keeps original PDF page content and selectable source text, adding a flattened high-resolution annotation layer. This retains added handwriting, text, highlights, notes and images. Added text/ink is not independently editable in the finished PDF. **Editable backup** preserves the full editable project, raw ink samples, original PDF and images. **PNG** exports the current page. Whiteboard PDF/PNG exports fit all content, including writing left or above the starting point; large boards are scaled to safe output dimensions. PDF pages retain their original boundaries.

Back up important projects. Clearing site data, using private browsing, or device/browser storage removal can delete local work. Requesting persistent storage helps when the browser grants it but does not replace a backup. Local libraries are not automatically synchronized between devices.

PDF limit: 150 MB. The UI image limit is 40 MB. The backup import limit is 250 MB. Very complex or large PDFs may require more time and memory. Encrypted PDFs must be saved as an unlocked copy first. Exports may lower bitmap resolution to stay within device memory limits.

## Desktop Softboard compatibility

Import project accepts ordinary exported `softboard/1` desktop JSON with ink, notes, text, images, basic shapes and links. Pressure-variable native ink is converted to constant-width course-style writing. Unsupported legacy polygon or double-ended arrow types are rejected with an explanation; exporting them as PDF from the desktop app preserves their appearance. This browser version does not include the desktop app's real-time local-network sharing protocol. Transfer an editable backup instead.

## Development

Node 22.12+ (tested Node 24). `npm ci`, `npm run dev`, `npm test`, `npm run build`. `node scripts/serve.mjs` serves the production app at http://localhost:4175. `npm run build` creates a complete static offline package in dist, including the PDF worker, fonts, CMaps and WASM; none is loaded from a CDN.

The tests cover geometry, low/high zoom handwriting, fast erasing, atomic storage, revision conflicts, save/undo races, portable backups and PDF coordinates. Browser tests use Playwright for real UI flows, offline reload, desktop/tablet/phone layouts and PDF export. Physical Apple Pencil/Huion testing is still required for hardware-specific latency and palm behavior.

## Structure

- src/lib/ink.ts and DrawingSurface: input, curves, hit-testing and gestures.
- src/lib/storage.ts and backup.ts: validated atomic local storage and portability.
- src/lib/session.ts: serial saves, immutable history and conflict handling.
- src/lib/pdf.ts, pdfCoordinates.ts, export.ts: PDF input, placement and output.
- PdfReader and pdfReaderLayout.ts: continuous PDF scrolling, nearby-page rendering, page sizing and shared touch navigation.
- Library, Editor and Toolbar: accessible responsive UI.
- scripts/offline-build.mjs: versioned app-shell cache generation.
