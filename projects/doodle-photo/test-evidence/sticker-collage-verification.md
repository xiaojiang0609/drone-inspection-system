# Sticker collage verification — 2026-10-08

Verified production snapshot: `8123f2f701716e5d980a5744a5f75301e7b8997b`. Task 7 changes verification, fixtures, documentation and selected evidence only. No deployment or publication was performed.

## Fresh checks

| Command | Result |
| --- | --- |
| `npm.cmd run lint` | Exit 0, no diagnostics |
| `npm.cmd run build` | Exit 0, Vite 8.0.14, 49 modules |
| `node --test --test-isolation=none test-evidence/*.test.mjs` | Exit 0, 254 passed, 0 failed, 0 skipped, 14,567.7196 ms |
| `D:/claude/projects/doodle-photo/.test-venv/Scripts/python.exe -B -m unittest discover -s test-evidence -p "test_*.py" -v` | Exit 0, 121 passed, 1.133 s |
| `node test-evidence/verify-collage.mjs --mock-only` | Exit 0, preserved basic/range tests plus full matrix; no page errors |
| `node test-evidence/verify-subject-correction.mjs` | Exit 0, original correction assertions; no page errors |
| `node test-evidence/verify-rich-editor.mjs` | Exit 0, original rich-editor assertions; no page errors |
| `COLLAGE_URL=http://127.0.0.1:18767/ node test-evidence/verify-collage.mjs --live` | Exit 0, actual three-photo UI, manual SAM and decoded export checks |

The managed worktree uses the original Python environment and existing node_modules junction. Browser scripts use existing bundled Playwright at `C:/Users/xiaojiang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json`, with headless Edge. No package or runtime dependency was installed. Technical fixtures are reproducible with `python -B test-evidence/create-collage-fixtures.py`. Start Vite separately on 8879 for offline browser tests; live mode targets the built backend, because the Vite proxy targets the original 8767 backend.

## Mock coverage and pixels

All `/api/**` requests are intercepted before any upload, and unexpected endpoints fail closed. These tests use actual React UI, file inspection, session, queue, layout, browser Image decoding, canvas renderer, asset store and export modules. They establish UI and renderer behavior; they do not establish vision or SAM accuracy. `verify-collage-matrix.mjs` is the helper for the broad matrix and explicit live branch; the entry point preserves Task 6's original range, mouse/touch, correction, async-gesture and legacy-adapter assertions.

The matrix accepts 16 cards including a failed card, rejects a seventeenth before any API request, removes the failed card and adds a replacement to produce all 16 stickers. Background upload consumes no source slot. It checks two ready/one failed, three failed/no invented sticker, same-named independent files, two active requests with a third queued, queued removal, pause/cancel, and new retry results unaffected by old completions. APNG, animated WebP, damaged headers, MIME mismatch, more than 20 MiB and more than 40 million pixels are rejected before requests. Wide/tall images and static WebP are accepted. Existing EXIF 6 correction uses the full oriented 240×360 original and verifies normalized YXYX geometry.

For dark paper, light paper, solid and photo backgrounds, both the current preview and downloaded PNG are independently decoded with browser Image/canvas into RGBA. Each has **1080×1440 pixels, 0 differing channels and maximum channel delta 0**. Selected controls and hidden controls also produce identical canvas pixels. Photo cover offsets survive export. Results: [mock metrics](sticker-collage-mock-results.json); exports: [dark](sticker-collage-mock-paper-dark.png), [light](sticker-collage-mock-paper-light.png), [solid](sticker-collage-mock-solid.png), [photo](sticker-collage-mock-photo.png).

The deterministic transparent fixture has a sealed hole and a detached green piece. With the actual renderer, the hole remains `[32,48,64,255]`, exactly the solid background, for solid/dashed/no borders, including a sample near the hole's interior edge. The detached piece remains `[108,155,113,255]` for every style. Exterior white pixel counts are solid **2,684**, dashed **2,280**, none **0**, with **458 pixels** differing between solid and dashed. UI style selection also produces decoded pixel differences.

The export test holds the actual asset's ready boundary for at least 100 ms. Export remains pending. While it waits, the project is edited, the actual session is reset, and the store is disposed. Its blob URL is retained until the captured export finishes, then released exactly once. The frozen export differs from the pre-edit canvas by **0 channels**. This is an observable browser integration boundary, not a mirrored border/export implementation.

Existing checks retain grouped mouse drag/text/range Undo, modifier and repeated range keys, blur before keyup, text-to-drag separation, touch cancellation via actual Chromium touch events, Undo during transient drag, an async correction completing during drag with two independent Undo steps, modal focus/Tab/Escape, first manual asset after automatic failure, mode preservation/pause, missing-geometry legacy correction and zero browser errors.

The strengthened late-retry check holds the obsolete asset-store `Image.decode()` completion after the native browser has decoded an old 110×85 ellipse. Its client validation decode has already completed. After mode pause/reactivation, the actual UI retry receives a distinct 160×120 hole/fragment PNG and new caption. The new ready asset ID and canvas are observed **before** releasing the old decode. After release, an actual new UUID allocation proves the obsolete asset completed registration; the visible asset still has the new ID and caption, and its decoded canvas changes by **0 channels**. Thus the assertion detects an old asset replacing the new one; it does not merely count ready cards or assume an aborted network response was delivered. The separate queue test still holds only two requests and proves the removed queued source never starts. Final matrix-only rerun: exit 0, **35 mocked cutout requests**, no page errors; no live or other regression suites were repeated for this verification-only repair.

## Real API provenance

The human explicitly authorized sending the existing `coffee.jpg`, `cat.jpg`, and `buffet.jpg` to the project's already configured vision service for this verification. No other photos, provider destinations or configuration values were used. `/health` reported `api_configured: true` and `sam_loaded: true` on the existing built backend at 18767.

The first live harness attempt sent **one coffee automatic request**, then stopped on a verifier-only error: unmocked multipart `postDataBuffer()` was unavailable. Its result capture is incomplete; it is not counted as a verified successful result. The controller explicitly authorized **one additional coffee measurement** after repairing the instrumentation. There were no hidden retries. The successful run sent coffee once, cat once, buffet once, and coffee once with explicit manual subject geometry. Thus Task 7 incurred **four automatic vision calls total across both attempts**, plus one manual local SAM request. Historical earlier development calls are separate evidence and are not represented as this run.

| Actual UI request | HTTP | Elapsed to response | Cutout | Oriented original | Returned label |
| --- | ---: | ---: | --- | --- | --- |
| coffee automatic retest | 200 | 10,278 ms | 497×399 | 900×1350 | 咖啡杯 |
| cat automatic | 200 | 10,967 ms | 474×619 | 1000×683 | 小猫 |
| buffet automatic | 200 | 12,094 ms | 195×531 | 1707×1280 | 黑色花瓶 |
| coffee manual SAM | 200 | 7,185 ms | 497×399 | 900×1350 | 咖啡杯 |

Safe browser FormData instrumentation records filename and subject presence, never image bytes or configuration. The three automatic requests omit subject; the manual request includes subject and one positive point entered through the actual correction UI. The asset ID changes after its real response. The server's manual subject branch runs local SAM without a new vision call. All three cards are usable and no page errors occur. [Real metrics](sticker-collage-real-results.json) include actual returned mask-quality metadata; those scores describe model/mask selection, not label accuracy.

The real export is 1080×1440 and has **0 decoded channels different from the preview, max delta 0**. [Export](sticker-collage-real-export.png), [desktop 1200](sticker-collage-real-desktop.png), [mobile 390](sticker-collage-real-mobile.png). Automatic cutout artifacts: [coffee](sticker-collage-real-coffee.png), [cat](sticker-collage-real-cat.png), [buffet](sticker-collage-real-buffet.png); [manual coffee](sticker-collage-real-coffee-manual.png).

## Visual inspection and limits

Inspected the actual screenshots and exported PNGs. At 1200 px the source/tool columns flank the board; at 390 px the board and controls stack without horizontal page overflow. [16 ready desktop](sticker-collage-16-ready-desktop.png) and [16 ready mobile](sticker-collage-16-ready-mobile.png) show all 16 stickers and 16 cards. [16 cards with one failure](sticker-collage-16-mobile.png) shows the rejection notice and honest failure. [Technical desktop](sticker-collage-mock-desktop.png) and [technical mobile](sticker-collage-mock-mobile.png) show the visible hole, detached part, title, caption and white border.

The sequential real upload preserves the first sticker's large layout and safely appends cat/vase at smaller sizes; users can choose re-layout. Mask artifacts are visible and preserved: the mug interior is removed, its handle has gaps and small fragments; the cat includes nearby leaf pixels; the vase includes detached fragments. Buffet selects the vase, not the food. HTTP 200 and mask quality therefore do not prove accurate object selection or complete masks. The white borders faithfully follow the actual binary alpha, including its rough edges; no smoothing or fabricated success was introduced by verification. Manual point submission and asset replacement prove correction works, not that one point fixes every visual defect.

SAM produces binary alpha, so hair, thin boundaries, occlusion, glass and semitransparent objects can remain imperfect. This browser evidence does not establish every browser/device combination. The current page session stores edits; refresh discards them. Accounts, cloud storage and persistent projects remain outside scope.

## Final review fixes — 2026-10-08

Freshly verified production snapshot: `df9ad8aeb2df103808476549128860a0b5735f4e`, based on reviewed head `7479b80cdcd247ce714c0a2755c366048e487317`. First-time asynchronous placement and initial font completion now rebase the active gesture baseline/history. Existing user geometry survives; occupied initial pages use safe append and keep unplaced sources ready/waiting. Corrected assets constrain every duplicated instance using the shared rotated bounds, including the border.

| Final command | Fresh result |
| --- | --- |
| `node --test --test-isolation=none test-evidence/*.test.mjs` | Exit 0, 263 passed, 0 failed/skipped, 15,837.641 ms |
| `D:/claude/projects/doodle-photo/.test-venv/Scripts/python.exe -B -m unittest discover -s test-evidence -p "test_*.py" -v` | Exit 0, 122 passed, 1.474 s |
| `npm.cmd run lint` | Exit 0, no diagnostics |
| `npm.cmd run build` | Exit 0, Vite 8.0.14, 49 modules |
| `node test-evidence/verify-collage.mjs --mock-only` | Exit 0, basic/range checks (9 mocked cutouts) plus full matrix (35 mocked cutouts), no page errors |

New actual session/store/default-layout regressions cover first placement during cancel, preview Undo and commit/Undo, first manual success after automatic failure, initial font completion during a gesture, and occupied user geometry during font loading. These prove separate placement/gesture history and consistent ready/placed or ready/waiting source metadata. Replacement tests cover three source duplicates at page edges, rotations 0/37/90/-135 degrees, borders 0/6/16 pixels, and extreme aspect ratios; Undo restores old geometry/assets. The client test preserves asymmetric YXYX boxes and XY hints through validation and serialized request/response and rejects transposed hints. Actual fragmented ASGI requests cover 8191/8192/8193 aggregate multipart header bytes, with accepted/rejected statuses, closed uploads, no rollover, and no predictor work on rejection. README documents the route suite as a FastAPI/Starlette/python-multipart upgrade gate.

The final full browser matrix again has 0 differing preview/export channels for all four backgrounds, exact frozen export pixels, and retained newer retry pixels after obsolete decode completion. The regenerated [16-ready desktop](sticker-collage-16-ready-desktop.png) and [16-ready mobile](sticker-collage-16-ready-mobile.png) screenshots were visually inspected; mock metrics and other tracked generated evidence remained content-identical. Separate legacy browser scripts were not repeated in this fix wave because legacy production code was untouched; their earlier results above remain prior evidence.

No real photo, provider, live backend or manual SAM request was repeated for this deterministic frontend fix. The earlier three-photo/live/manual-SAM evidence remains evidence of its original snapshot and retains its documented mask limitations. API/model code is unchanged by this fix. Existing Vite 8879 and backend processes were reused/left running; no dependency, credential or model configuration changed.

## Exact baseline imports

Required previously untracked JSON inputs are imported unchanged rather than regenerated as new expected results. SHA256 matches the original project exactly:

| File | Bytes | SHA256 |
| --- | ---: | --- |
| coverage-buffet-analyzed.json | 1,168,258 | AE69C216E71436636E065FF411CF580546E4ECB27A24A18B948FC2C1FFAF43B6 |
| white-doodle-coffee-live.json | 232,608 | BC5874A0D1A15E0E665D371130E8BF742868A98ED8557E3041C95DC683DF1B82 |
| cat-contour-fixed.json | 178,388 | FD0AD731CB7C5168CDCCAAE9D2A273F76F38CC51749491D6C3F117EF2948DE6D |
| correction-coffee-after.json | 95,607 | D5E514F1EA5023E669E001ED8A3507865F7388754A94328EC6E177431AF5E8D6 |

The three JPEGs are already tracked and also byte-identical to their originals. `.env.example` is the exact original public template with a blank API key. No private environment, credential, model weight, virtual environment, process marker, service log or private helper is included.
