# Local automatic PDF counting

Upload a PDF and keep **Realistic objects + number words** selected. Clear English
count-and-object headings from one through twenty are matched to local pictures.
The same measured narration cues reveal the picture, numeral and spelling in
playback and export. Original PDF coordinates are never guessed for new books.

The built-in library includes dogs, books, candies, birds, bananas, butterflies,
gifts, ants, leaves and stars. A new category needs one user-supplied whole-object
transparent PNG, added under **Local object picture library**. Enter exact aliases
(for example `cats` and `cat`) explicitly. Once saved, matching future headings
can use it without code changes. Pictures are not generated or semantically
verified by this local feature; inspect the preview before using a new picture.

Each page shows **Auto-ready**, **Needs review**, or **Original page**. Expand
**Review counting setup** to choose a count and picture, or keep the original
page. Decisions are stored in IndexedDB on this device, keyed to the exact PDF
fingerprint and page number. Clearing app data can remove this local library and
the saved choices; the original PDFs and lessons are never modified.

Scanned pages with little/no embedded text use a dedicated Windows OCR worker
when available. Recognition can be imperfect; check the page preview and the
extracted text. English US/UK are preferred if installed. Unsupported languages,
multiple activities, uncertain headings and missing pictures require review.
This feature does not independently count pixels, reconstruct hidden body parts,
or create arbitrary new photorealistic images. No model downloads, API keys,
cloud generation, or old AI-agent/image-service calls are used.

Setup changes are blocked during playback, narration preparation and export.
An asynchronous saved choice never replaces an in-progress page's setup. If work
starts while saving, that choice applies on the next PDF load.
