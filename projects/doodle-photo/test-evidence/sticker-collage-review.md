# 拼贴功能最终独立复核

生产代码版本：df9ad8aeb2df103808476549128860a0b5735f4e。最后一次修复复核范围：7479b80..989f995。四项发现均已解决，未发现新的重要问题；263 项 Node、122 项 Python、lint/build 和完整模拟浏览器检查通过。真实照片与手动 SAM 验证的先前实测及限制见 sticker-collage-verification.md。

- **I1 — Async first placement and initial font completion lose completed stickers during cancel/Undo: ADDRESSED.** `src/hooks/useCollageSession.js:117–138,147–153` computes each placement once against the committed gesture baseline and applies the identical additions through `commitAsyncEdit` (`:81–86`). Current geometry remains visible; cancellation restores the rebased project; gesture commit records a separate baseline so its Undo retains the completed addition. Source-ready metadata is rebased before placement (`:72–76,182`), placement metadata uses each transaction's source map, and existing current/history/baseline collection retains the decoded asset (`:61–67`). The initial-font path preserves existing elements, uses safe append, deduplicates title roles and skips occupied decoration positions. Regressions at `test-evidence/collage-state.test.mjs:417,447,467,511` exercise cancel, preview Undo, committed gesture Undo, later placement Undo, first manual success, asset retention and occupied-page ready/waiting state.

- **I2 — Changed replacement aspect ratio clips the subject/border: ADDRESSED.** `src/utils/collage-state.js:69–76` constrains every matching duplicated sticker after recalculating its normalized height. The shared helper (`src/utils/collage-layout.js:18–30`) preserves fitting center/width, otherwise uniformly shrinks and clamps using rotated bounds including border. IDs, source, rotation, order and border settings remain intact; snapshots retain the old asset and geometry. The existing fit case (`test-evidence/collage-state.test.mjs:54`) and new matrix (`:490`) cover fitting geometry, three duplicates, extreme ratios, rotated edges, border widths and exact Undo restoration.

- **M1 — Fragmented multipart header-boundary coverage and dependency gate: ADDRESSED.** `test-evidence/test_cutout_endpoints.py:143–178` submits actual ASGI requests in 127-byte messages at aggregate header sizes 8191/8192/8193 and asserts 200/200/413, received fragments, exact uploaded-file byte count, closed upload ownership and zero predictor encoding on rejection. The existing spool instrumentation (`:74–86`) fails on rollover. Header padding uses multiple lines so the dependency's separate line limit cannot mask this boundary. `README.md:145` explicitly gates FastAPI/Starlette/python-multipart upgrades on the route suite.

- **M2 — Asymmetric YXYX box and XY point contract fixture: ADDRESSED.** `test-evidence/cutout-client.test.mjs:9–24` uses `[100,600,400,900]` and `[750,250]`, verifies serialized outbound and returned geometry, accepts the valid hint, rejects `[250,750]` in validation and inbound data, and proves malformed outbound input does not call fetch.

- **New breakage in the fix diff: None found.** No Critical or Important findings in `7479b80cdcd247ce714c0a2755c366048e487317..989f9956b88e56c7d35505ed57ce8bc21e69cbf8`.

- **Out-of-scope observations / deferred Minor findings: None newly identified.** The two prior Minor findings M1/M2 are resolved; documented SAM mask limitations remain the previously accepted scope boundary.

- **Checks:** Read the supplied nine-file diff once, both prior review/fix reports, global/shared contracts and relevant approved spec/plan clauses; traced the changed paths through existing transaction, history, asset collection and bounds helpers; inspected both changed 16-ready screenshots. The fix report names covering regressions and records RED/GREEN plus final 263 Node / 122 Python passes, lint/build, 44 mocked cutouts, zero page errors and exact preview/export pixels. These are implementer-recorded results, not reruns by this reviewer. No specific unresolved code risk required another probe. Public verification at `test-evidence/sticker-collage-verification.md:61–79` truthfully attributes fresh checks to production commit `df9ad8a` and preserves prior live/legacy provenance. No suites, provider requests or service/Git mutations were performed.

- **Fix round: All four findings addressed, no new Critical/Important breakage. Overall: Ready to merge.**

实施取舍（Rulings I made）：

- 上传解析也保持内存处理以满足不落盘要求；代价是有上限的额外内存占用和框架私有接口兼容性风险，依赖升级须运行 ASGI 回归测试。
- 真实界面验收记录脚本出错后，补测一次已授权的 coffee.jpg；代价是一次额外的视觉模型调用及同照片传输，未新增照片或目的服务。