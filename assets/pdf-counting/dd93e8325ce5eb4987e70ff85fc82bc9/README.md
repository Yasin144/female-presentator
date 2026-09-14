# Reviewed nursery counting cutouts

This fixed profile applies only to PDF.js fingerprint
`dd93e8325ce5eb4987e70ff85fc82bc9`, printed/PDF pages 26–35 of the
user-provided Nursery Course Book, Volume 2. It contains 155 ordered transparent
PNG assets: 11 dogs, 12 books, 13 candies, 14 birds, 15 bananas, 16 butterflies,
17 gifts, 18 ants, 19 leaves, and 20 stars.

The presenter loads only these small PNGs and the verified manifest. It does not
load a model, run segmentation, or download anything during narration or export.
The profile is not a generic detector for other books or PDFs.

All RGB pixels come directly from rendered source pages. Masks isolate the
visible illustrations; portions hidden behind other objects remain absent.
Books, crowded gifts, and a rear banana use reviewed visible-outline polygons.
Gift masks assign overlapping artwork to the foreground gift and conservatively
discard a two-source-pixel ambiguous occlusion edge instead of duplicating it.
The white stars use a pale-color mask to exclude the surrounding blue sky.
Other objects use locally prepared MobileSAM masks with reviewed point and box
prompts. Subpixel alpha feathering softens edges without changing source colors.

`segmentation-prompts.json` records the final boxes, positive points, and polygon
refinements. `sourceBounds` in `manifest.json` is normalized x, y, width, height,
including the PNG's small transparent padding. `maskScore` is a raw preparation
score, not a calibrated accuracy probability. A value of 1 on deterministic
polygon/color masks is a sentinel, not a model-confidence claim.

The source PDF and lesson directory are not modified. Original illustrations
remain the property of their original rights holders; these locally derived
assets do not confer redistribution rights. Model attribution and isolated
preparation-runtime details are in `vendor/pdf-cutouts/NOTICE.md`.
