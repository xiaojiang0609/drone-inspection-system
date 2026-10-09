# Sticker Collage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 上传多张照片，真实抠出主要主体，自动生成可编辑、可导出的手绘贴纸拼贴海报。

**Architecture:** 独立 `CollageStudio` 管理多图工作流，复用现有字体、线稿和几何工具。无全局状态的图片处理模块生成透明 PNG，FastAPI 负责视觉识别和共享 SAM 锁；前端以普通数据描述作品，图像缓存独立存放，预览与导出使用同一个绘制器。

**Tech Stack:** 现有 React 19、Vite 8、Canvas 2D、FastAPI、Pillow、NumPy、OpenCV、SAM 和 Moonshot；测试沿用 node:test、unittest 和本机 Edge／bundled Playwright，不新增产品依赖。

**Spec:** [已确认设计](D:/claude/projects/doodle-photo/docs/superpowers/specs/2026-10-07-sticker-collage-design.md)

## Global Constraints

- 单个作品最多 16 张静态 JPG／PNG／WebP（包含处理中与失败的素材，删除素材卡后释放名额），每张最多 20 MiB，解码像素最多 4000 万。
- 背景照片单独上传，适用相同文件限制，不消耗贴纸名额。导出尺寸为 1080 × 1440 像素。
- 默认 3:4 竖版；每张照片默认提取一个主要主体，同一主体最多 8 个分割区域、每区域最多 4 个主体点和 8 个背景点。
- 输出贴纸最长边最多 1536；视觉工作图与 SAM 局部裁切最长边最多 1536，联合主体框外扩约 20%。
- 贴纸支持白色实线／虚线／无描边，描边宽度 0–16 个导出像素，默认实线 6 像素。
- 自动生成一个可编辑标题、最多四条短句和最多八个手绘装饰；无可靠主题时标题为「把日常，贴成一页」。
- 最近 20 步撤销；一次拖拽或连续输入算一次操作。前端最多同时发出两个抠图请求。
- 不从外轮廓重建 alpha，不伪造分割成功，不将上传照片或透明 PNG 保存到服务器磁盘。
- 继续使用已有 Moonshot 配置与 SAM 权重；不提交密钥、模型权重、虚拟环境或父仓库中其他项目的改动。

## Review Focus

1. 同名照片、重试与取消交错：每个素材使用稳定 ID、请求版本与作品 epoch，迟到结果不能串图。Task 4 测试。
2. 有孔洞、细小分离部件或原始透明度的 PNG：真实 alpha 保留，边框不会补实主体。Task 1、3、7 测试。
3. EXIF 旋转、多个分离区域及裁切外排除点：纠正坐标必须映射到同一张转正原图，不能将外部点夹到裁切边缘。Task 1、6、7 测试。
4. 替换／删除资产后撤销、撤销记录溢出：能恢复仍被历史引用的图像，未引用缓存得到释放。Task 5 测试。
5. 导出时图片／字体尚未解码，或编辑中切换模式：使用完整状态快照，完成作品保留，未完成请求可重试。Task 5、6、7 测试。

## 文件边界与公共数据

| 文件 | 职责 |
| --- | --- |
| `sam_segmentation.py` | predictor 参数注入、真实 mask 选择、旧描边轮廓转换 |
| `image_cutouts.py` | 文件验证、严格几何、联合裁切、mask 合并、PNG 编码 |
| `server.py` | 保留旧调用入口，新增视觉主主体识别和 `/api/cutout` |
| `src/utils/collage-config.js` | 画布、张数、描边、撤销和并发常量 |
| `src/utils/image-stickers.js` | 图片解码、独立资产存储、描边缓存与释放 |
| `src/utils/collage-layout.js` | 贴纸边界、完整自动布局与安全追加 |
| `src/utils/collage-renderer.js` | 纸张／纯色／照片背景与逐层绘制 |
| `src/utils/collage-files.js` | 静态格式、字节／像素检查和缩略图解码 |
| `src/utils/cutout-client.js` | multipart、HTTP 错误、超时和响应验证 |
| `src/utils/cutout-queue.js` | 最多两个并发请求，逐素材取消和作品取消 |
| `src/utils/collage-state.js` | 可克隆作品数据、20 步历史、版本判断与资产引用 |
| `src/hooks/useCollageSession.js` | 连接队列、文件存储、资产缓存与 React 状态 |
| `src/components/MultiImageUploader.jsx` | 多选／拖入，逐文件错误与名额提示 |
| `src/components/CorrectionGeometryPanel.jsx` | 共享框选、区域、正负点和草稿操作 |
| `src/components/CollageSubjectCorrection.jsx` | 当前素材纠正弹窗及手动抠图提交 |
| `src/components/CollageCanvas.jsx` | 画布、选择、拖拽及背景裁切操作 |
| `src/components/CollageStudio.jsx` | 素材卡、编辑工具、背景、模式生命周期和导出 |

`CutoutData` 与设计中响应 `data` 一致；`image` 是 PNG data URL，`contours` 是 PNG 局部像素坐标，`crop_box` 是 EXIF 转正后的原图像素坐标。主体框顺序为 `[y1,x1,y2,x2]`，提示点为 `[x,y]`。

`ImageSticker` 使用设计中的 `assetId/sourceId/x/y/width/height/rotation/aspect/borderStyle/borderWidth` 字段；所有元素的 `aspect=1440/1080`。`Project={sourceIds,elements,background,ink}` 可 structuredClone；`Background={kind,color,assetId?,offsetX,offsetY}`，`kind` 为 `paper-dark/paper-light/solid/photo`，偏移是 cover 多余尺寸的 0–1 裁切比例，默认 `.5`。`ink` 为 `auto/light/dark`。

文件与浏览器图像对象放在独立 Map 中。`SourceMeta={id,name,status,version,assetId?,subject?,caption?,theme?,error?}` 不含 File／Image；「待放置」由当前成功素材是否有画布元素推导。源素材和历史所引用的旧资产都要保留。

## 依赖与执行环境

Task 1 与 Task 3 无共享修改文件，可以独立开发；Task 2 依赖 1，Task 4 消费 2 的接口，Task 5 消费 3、4，Task 6 接入 2–5，Task 7 验证全部任务。各任务交接使用下列 Interfaces，不另造同义字段。

当前 Git 根目录实际为 `D:/claude`，本项目现有运行源码尚未被该仓库追踪，只有设计文档已提交。实现开始时先按 using-git-worktrees 技能检查已有附件与隔离方案；在任何产品修改前，仅为本项目的运行源码、测试和必要 fixture 保存基线，避免评审混入已有实现。明确基线清单如下（工作目录为本项目）：

```powershell
$baselinePaths = @(
  'src', 'public', 'index.html', 'package.json', 'package-lock.json',
  'vite.config.js', 'eslint.config.js', 'requirements.txt', '.gitignore', 'README.md',
  'server.py', 'segmentation_masks.py', 'detection_geometry.py', 'subject_refinement.py',
  'test-evidence/*.test.mjs', 'test-evidence/test_*.py',
  'test-evidence/verify-subject-correction.mjs', 'test-evidence/verify-rich-editor.mjs',
  'test-evidence/white-doodle-cat-live.json', 'test-evidence/custom-sketch-coffee-live.json',
  'test-evidence/cat.jpg', 'test-evidence/coffee.jpg', 'test-evidence/buffet.jpg'
)
git add -- $baselinePaths
git diff --cached --name-only -- $baselinePaths
git commit --only -m 'chore: snapshot doodle photo baseline' -- $baselinePaths
```

核对本次选定路径均属于 `projects/doodle-photo` 后保存基线，已有其他暂存文件不纳入提交。隔离工作区从该基线提交出发；分支默认使用 `codex/` 前缀。已有用户改动不清理、不 stash。使用原项目 `.test-venv` 的 Python；SAM_CHECKPOINT 指向原项目权重绝对路径。真实接口启动时安全复用原项目已有配置，配置值不进入命令输出或文档。

所有下面的测试命令在实施工作区项目目录运行；`.test-venv` 命令在隔离目录执行时改用原项目 Python 的绝对路径，不重装现有环境。git 提交使用各任务显式文件列表和 `--only`，不得提交父仓库其他文件。

## Task 1: 真实掩膜与透明 PNG 处理

**Files:** Create `sam_segmentation.py`, `image_cutouts.py`, `test-evidence/test_sam_segmentation.py`, `test-evidence/test_image_cutouts.py`; Modify `server.py` 的 `extract_contour_rings_with_sam()`。

**Interfaces:**

- `predict_subject_mask(predictor,image_rgb,box_xyxy,*,image_ready=False,positive_points=None,negative_points=None)->(mask|None,quality)`；不持有全局 predictor，不吞掉模型异常。
- `mask_to_contour_rings(mask,img_w,img_h)->rings`；保留旧轮廓筛选、简化和归一化行为。
- `CutoutError(status_code:int,detail:str)`；纯图片模块抛该异常，HTTP 映射由 Task 2 处理。
- `decode_cutout_image(content:bytes)->Image.Image` 返回转正 RGBA；`validate_cutout_subject(value:dict)->dict` 返回严格验证的标签与几何。
- `encode_vision_image(original_rgba,max_size=1536)->str`；`prepare_cutout_crop(original_rgba,subject,max_size=1536,padding=.2)->(rgb,metadata,pixel_regions)`。
- `metadata={original_size,crop_bounds,working_size}`，`pixel_regions` 含 `box_xyxy/positive_points/negative_points`；`merge_region_masks(masks)->np.ndarray`。
- `encode_cutout_png(original_rgba,mask,metadata,max_size=1536,max_contour_points=16384)->dict` 返回 PNG、尺寸、原图 crop_box 和局部 contours。

- [ ] **Step 1: 保存上述基线、确定隔离工作区，并记录既有后端测试结果。** Run `python -B -m unittest discover -s test-evidence -p "test_*.py" -v`，使用已配置的测试解释器；已有失败单独记录。
- [ ] **Step 2: 写失败测试。** `test_alpha_preserves_hole_and_detached_pixel` 使用 8×8 原图、主体 `[1:7,1:7]`、孔洞 `(3,3)` 和分离点 `(7,7)`，核心断言如下。

```python
result = encode_cutout_png(original_rgba, mask, metadata)
png = Image.open(io.BytesIO(base64.b64decode(result['image'].split(',', 1)[1])))
assert result['crop_box'] == [1, 1, 8, 8]
assert png.getpixel((2, 2))[3] == 0
assert png.getpixel((6, 6))[3] == 255
assert png.getpixel((0, 0))[:3] == original_rgba.getpixel((1, 1))[:3]
```

另外测试原 alpha 相交；EXIF 6 的转正尺寸及原图 crop_box；两个分离 region 的联合裁切；裁切外负点被明确排除而非夹边；任一 mask 为 None 即 422。验证 20 MiB、4000 万像素和动画拒绝、布尔／NaN／越界／超量／冲突提示点拒绝；最长边 1536 和轮廓点预算 16384。fake predictor 验证每图一次 set_image、每 region 两次 predict，原 mask 不被轮廓处理修改。
- [ ] **Step 3: 运行新增测试确认失败。** Run 两次 `python -B -m unittest discover -s test-evidence -p test_sam_segmentation.py -v`、同命令的 `test_image_cutouts.py`；预期新模块未定义导致失败。
- [ ] **Step 4: 实现 Interfaces。** 二值工作 mask 用最近邻映射到原图裁切，再与原 alpha 相交；最终缩放只做常规插值。旧 server wrapper 保留签名、异常降级和动态全局读取，`segment_detections` 继续通过该 wrapper 调用，避免破坏旧 patch 位置。
- [ ] **Step 5: 重跑新增测试和完整后端测试。** 预期新测试及既有覆盖预算／纠正／预测计数测试通过，无新增失败。
- [ ] **Step 6: 仅提交本任务的两个模块、server 修订和两个新测试。** Commit message: `feat: preserve SAM masks for transparent stickers`。

## Task 2: 自动与手动抠图接口

**Files:** Modify `server.py`; Create `test-evidence/test_cutout_endpoints.py`。

**Interfaces:** Consumes Task 1。新增 `identify_cutout_subject(original_rgba)->(subject,meta)`、`segment_cutout_masks(rgb,pixel_regions)->(masks,qualities)`、`build_cutout(content,subject=None)->CutoutData`；路由 `async cutout(file:UploadFile,subject:str|None=None)` 对外返回 `{status:'success',data:CutoutData}`。

- [ ] **Step 1: 写失败测试。** 用 ASGI TestClient 与 fake predictor（同时 patch `load_sam`）验证以下核心结果，避免只测 Python 异常而漏掉 HTTP 状态。

```python
response = client.post('/api/cutout', files=photo_upload, data={'subject': valid_subject_json})
assert response.status_code == 200
assert response.json()['data']['image'].startswith('data:image/png;base64,')
vision.assert_not_called()
assert client.post('/api/cutout', files=photo_upload,
                   data={'subject': outside_box_json}).status_code == 422
```

另测自动识别只调用一次视觉模型，返回一个主主体而非清单第一项；全部 region 质量必须可靠；400/413/422/503/502/500 真实状态；两个不同图像请求与旧 segment 请求交错时 predictor 不混图；视觉与 PNG 编码不占 SAM 锁。
- [ ] **Step 2: 运行 `python -B -m unittest discover -s test-evidence -p test_cutout_endpoints.py -v`。** 预期路由不存在／接口断言失败。
- [ ] **Step 3: 实现接口。** 专用提示词返回 `{found,subject,caption,theme,emotion}`，最多 4096 输出 tokens；`found:false` 为 422。复用 `call_vision_api` 配置与入口，所有同步处理经线程池；锁内 set_image、所有预测、mask 复制，锁外视觉和编码。按字节上限读取上传，局部捕获未知错误返回 HTTP 500；手动主体不要求视觉密钥。
- [ ] **Step 4: 新接口和完整后端测试通过。** 保留 `server._sam_predictor/_sam_available/MAX_SEGMENT_REGIONS/call_vision_api/segment_detections` 旧测试查找位置。
- [ ] **Step 5: 仅提交 server 和端点测试。** Commit message: `feat: add automatic and manual cutout API`。

## Task 3: 拼贴布局、资产缓存与共用绘制

**Files:** Create `src/utils/collage-config.js`, `image-stickers.js`, `collage-layout.js`, `collage-renderer.js`, `test-evidence/collage-layout.test.mjs`, `test-evidence/image-stickers.test.mjs`; Modify `src/utils/journal.js`。

**Interfaces:**

- `createStickerAssetStore({decodeImage,revokeUrl,idFactory}={})->store`；`store.load({src,sourceId,meta})->Promise<assetId>`、`get(assetId)`、`collect(liveIds:Set)`、`dispose()`。浏览器解码对象和 URL 留在 store，描边缓存每资产最多保留三种最近样式。
- `collageElementBounds(element)->{x1,y1,x2,y2}` 与 `constrainCollageElement(element)->Element` 计入旋转与描边导出像素。
- `createCollageLayout(assets,{title,ink,seed,measureText})->Element[]`；`placeAdditionalSticker(asset,elements,options)->ImageSticker|null` 不修改原元素。
- `drawJournalElement(ctx,width,height,element,{elements=[],detections=[]}={})` 支持明确颜色；旧 `drawJournal()` 继续调用它。
- `drawCollage(ctx,project,assetStore)->void` 固定 1080×1440；`exportCollage(project,assetStore)->Promise<Blob>` 等待图片、字体并冻结快照。

- [ ] **Step 1: 写失败测试。** `layout_keeps_every_sticker_inside_rotated_border_bounds` 覆盖 1/2/4/9/16 张及 10:1、1:10 主体；核心断言如下。

```javascript
const elements = createCollageLayout(assets16, options)
assert.equal(elements.filter(e => e.type === 'imageSticker').length, 16)
assert.ok(elements.every(e => { const b = collageElementBounds(e)
  return b.x1 >= 0 && b.y1 >= 0 && b.x2 <= 1000 && b.y2 <= 1000 }))
assert.deepEqual(createCollageLayout(assets16, options), elements)
```

另断言贴纸／标题不重叠，caption≤4、doodle≤8；安全追加失败返回 null 且已有位置不变；缓存仅释放无引用资产，解码失败不能登记成功。实际 alpha、边框和导出像素由 Task 7 浏览器测试覆盖。
- [ ] **Step 2: Run `node --test --test-isolation=none test-evidence/collage-layout.test.mjs test-evidence/image-stickers.test.mjs`。** 预期新函数缺失而失败。
- [ ] **Step 3: 实现缓存和几何／布局。** 在 x=30–970、y=180–950 内按素材长宽比选择行列，单元内等比放入、稳定偏移及 ±8° 旋转；缩放检查完整边框，标题占顶部，文字／线稿只占剩余安全空位。不得省略成功素材或裁图填格。
- [ ] **Step 4: 实现共享元素绘制、背景与 export。** 实线边框从真实 alpha 生成，只在与画布边缘连通的外部透明背景上绘制，不填入封闭孔洞；虚线从局部外轮廓绘制，覆盖前均绘制在主体背后，透明 PNG 原图不修改。纸张纹理使用固定种子，照片 cover 按 offset 裁切，浅深文字按设计切换；元素数组决定层级。
- [ ] **Step 5: 重跑新增测试及 `node --test --test-isolation=none test-evidence/*.test.mjs`。** 预期全部通过，旧文字／箭头／轮廓测试无新增失败。
- [ ] **Step 6: 仅提交本任务列出的文件。** Commit message: `feat: render and arrange editable sticker collages`。

## Task 4: 多图上传与可取消处理队列

**Files:** Create `src/utils/collage-files.js`, `cutout-client.js`, `cutout-queue.js`, `src/components/MultiImageUploader.jsx`, `test-evidence/collage-files.test.mjs`, `test-evidence/cutout-client.test.mjs`, `test-evidence/cutout-queue.test.mjs`。

**Interfaces:**

- `inspectImageMetadata(bytes:Uint8Array)->{format,width,height,animated}` 检查真实格式和动画标记；`validateUploadMetadata(file,metadata,currentCount)->{ok,reason?}`；`decodeSourcePreview(file)->Promise<{file,thumbnailUrl,width,height}>` 转正、生成最长边 320 缩略图并释放临时解码图像。
- `requestCutout(file,subject=null,{signal,fetchImpl=fetch,timeoutMs=150000}={})->Promise<CutoutData>`；验证成功状态、PNG 类型、有效尺寸和主体几何。
- `createCutoutQueue({worker,concurrency=2})->{enqueue(job),cancel(sourceId),cancelAll(),dispose()}`，`job={sourceId,version,epoch,file,subject}`；concurrency 不得超过 2。
- `MultiImageUploader({count,busy,onFiles})` 交付独立 File 列表，不用文件名作素材 ID；合法项继续，非法项逐个提示。

- [ ] **Step 1: 写失败测试。** `queue_never_exceeds_two_and_ignores_cancelled_job` 使用可控 promise 验证下列结果，并测试同名文件不合并。

```javascript
assert.equal(maxRunning, 2)
assert.ok(startedIds.includes('photo-a') && startedIds.includes('photo-b'))
assert.equal(cancelledResultApplied, false)
assert.equal(validateUploadMetadata(file20MiBPlusOne, pngMeta, 0).ok, false)
assert.equal(validateUploadMetadata(validFile, pngMeta, 16).ok, false)
```

补充验证 4000 万像素上限、静态格式真实签名、动画 PNG/WebP、损坏头、错误 MIME、部分批次非法；413/422/502 可读错误、请求超时、坏成功 JSON、PNG 解码失败和等待中取消不会执行 worker。
- [ ] **Step 2: Run `node --test --test-isolation=none test-evidence/collage-files.test.mjs test-evidence/cutout-client.test.mjs test-evidence/cutout-queue.test.mjs`。** 预期新模块缺失而失败。
- [ ] **Step 3: 实现 Interfaces。** 原 File 留给后端，不把缩略图当原图上传；每个请求独立 AbortController，外部取消与超时都清除定时器。UI 增加 `multiple`，支持拖入，不依赖单图 ImageUploader 的第一个文件逻辑。
- [ ] **Step 4: 重跑本任务测试，并运行 lint/build。** 预期无新增错误；界面验收留给 Task 7。
- [ ] **Step 5: 仅提交本任务列出的文件。** Commit message: `feat: process multiple cutout sources with cancellation`。

## Task 5: 作品状态、素材替换与撤销

**Files:** Create `src/utils/collage-state.js`, `src/hooks/useCollageSession.js`, `test-evidence/collage-state.test.mjs`。

**Interfaces:** Consumes Tasks 3、4。`createCollageState()->State`、`commitProjectEdit(state,nextProject)->State`、`undoProjectEdit(state)->State`、`collectReferencedAssetIds(state)->Set`、`isCurrentCutout(state,{sourceId,version,epoch})->boolean`。`State={project,history,sources,epoch}`；源文件与缩略图存储独立，保留当前和历史 sourceIds 的引用。

`useCollageSession({active,assetStore,request=requestCutout,buildLayout})` 提供 `state/addFiles/removeSource/retrySource/correctSource/commitProject/undo/reset`。`buildLayout` 在字体加载后调用 Task 3；所有结果在请求与解码两个异步边界都验证 version/epoch。

- [ ] **Step 1: 写失败测试。** `undo_restores_replaced_asset_after_source_removal`、`history_limit_is_twenty`、`stale_epoch_cannot_apply` 的关键断言如下。

```javascript
assert.equal(restored.project.elements[0].assetId, 'asset-before-correction')
assert.ok(collectReferencedAssetIds(restored).has('asset-before-correction'))
assert.equal(afterTwentyOneEdits.history.length, 20)
assert.equal(isCurrentCutout(state, { sourceId: 's1', version: 1, epoch: oldEpoch }), false)
```

另测删除 source 后撤销恢复素材卡和名额；删除 sticker 仍可从可用素材卡添加；超过历史上限释放旧 URL；替换保留中心、宽度、角度、层级并重算比例；一次拖动／连续文本编辑只有一条历史；所有异步状态不把 File/Image 放入 project/history。
- [ ] **Step 2: Run `node --test --test-isolation=none test-evidence/collage-state.test.mjs`。** 预期新函数缺失而失败。
- [ ] **Step 3: 实现纯状态与 React 适配。** 初次批次结束后仅生成一次布局；新增素材只安全追加，无空位显示待放置。重试成功替换对应 asset，失败保留上一版。离开模式递增未完成素材版本并取消请求，完成作品与历史保留；reset 更换 epoch 并释放旧存储。
- [ ] **Step 4: 重跑状态／队列／缓存／布局测试及 lint/build。** 预期通过，无无效图像引用和旧结果污染。
- [ ] **Step 5: 仅提交两个模块及状态测试。** Commit message: `feat: manage collage edits and undoable sticker assets`。

## Task 6: 拼贴界面与主体纠正

**Files:** Create `src/components/CorrectionGeometryPanel.jsx`, `CollageSubjectCorrection.jsx`, `CollageCanvas.jsx`, `CollageStudio.jsx`, `test-evidence/verify-collage.mjs`, `test-evidence/create-collage-fixtures.py`; Modify `src/components/SubjectCorrection.jsx`, `src/App.jsx`, `src/index.css`。

**Interfaces:**

- `CorrectionGeometryPanel({image,draft,onDraftChange,locked})` 复用现有几何工具与区域选择；draft 维持现有 geometry/manual/history/regionIndex 结构。
- `CollageSubjectCorrection({source,image,initialSubject,busy,onSubmit,onClose})`，提交完整主体几何到 `correctSource(sourceId,subject)`；已有单图 submit 索引及 API 回调保留。
- `CollageCanvas({project,assetStore,selectedId,onSelect,onElementsPreview,onElementsCommit,onBackgroundCommit,editable})`；preview 是拖动期间的临时数据，结束提交一次，取消丢弃 preview。
- `CollageStudio({active})` 消费 Task 5。App 使用稳定挂载的模式面板，不能用卸载重挂载来丢弃已完成作品。

- [ ] **Step 1: 创建基础 fixture 和浏览器验证脚本，写界面失败场景。** 先生成三张小型 PNG 和 EXIF 6 JPEG，再让 `mode_switch_preserves_completed_project`、`manual_correction_uses_original_exif_coordinates`、`drag_and_text_edit_each_undo_once`、`background_cover_offset_survives_export` 验证完整用户操作及结果，mock 所有 API。
- [ ] **Step 2: 启动当前 Vite 并运行 `node test-evidence/verify-collage.mjs --mock-only`。** 预期缺少拼贴入口／控件而失败，保存失败原因。
- [ ] **Step 3: 抽取几何面板并接入纠正。** 主体列表、提交与弹窗焦点／Escape／滚动锁留给适配层。纠正图片按 EXIF 转正，保留多区域框与正负点；关闭弹窗不取消同素材的有效提交，切换模式则取消。
- [ ] **Step 4: 实现 Studio、Canvas 与 App 模式入口。** 添加素材卡进度与重试、待放置选择、背景控件、实线／虚线／无描边和 0–16 滑杆、文字／线稿工具、缩放、旋转、置顶／置底、删除、撤销、重新排版和导出。全部失败不能显示生成成功；部分失败不阻止可用作品编辑。背景拖动与贴纸拖动使用不同工具，避免误操作。
- [ ] **Step 5: 新 mock 浏览器检查、`verify-subject-correction.mjs`、`verify-rich-editor.mjs` 和 lint/build 通过。** 旧验证在原单图默认模式运行；检查焦点、窄屏、鼠标和触摸指针，收集 pageerror。
- [ ] **Step 6: 仅提交本任务列出的组件与样式、App 修订及基础验证脚本。** Commit message: `feat: add sticker collage studio and subject correction`。

## Task 7: 端到端、像素证据与使用说明

**Files:** Create `test-evidence/sticker-collage-verification.md`; Modify `test-evidence/verify-collage.mjs`, `test-evidence/create-collage-fixtures.py`, `README.md`。任务 6 的基础浏览器脚本与 fixture 在这里完善。

**Interfaces:** 验证脚本默认访问 `http://127.0.0.1:8879`，`--mock-only` 拦截所有 `/api/**`，`--live` 才允许真实接口；fixture 在 `test-evidence/collage-fixtures` 生成，证据写入 `test-evidence/sticker-collage-*`。Playwright 读取已有 bundled runtime，Edge 使用 headless；不新增项目运行依赖。

- [ ] **Step 1: 实现 fixture 生成和完整 mock 断言。** 生成有孔洞／分离部分的透明 PNG、EXIF 6 JPEG、横长／竖长和动画／损坏案例；16 张、三张中一张失败、全部失败、同名文件、排队取消／迟到重试覆盖均需真实 UI 断言。导出 PNG 解码检查 1080×1440，孔洞处与背景一致、分离部件可见、描边样式可辨；选框和工具不进入图片。
- [ ] **Step 2: 验证预览与导出像素一致。** 在字体和资产完成后读取同状态 preview PNG 与下载 PNG；对比解码后的像素而非 PNG 编码字节，四种背景均覆盖。检查在解码受控延迟时导出等待，快照不被后续编辑改变。
- [ ] **Step 3: 执行全套离线检查。** 以下命令均须退出 0、报告无新增失败；Vite 与测试分别启动。

```powershell
npm.cmd run lint
npm.cmd run build
node --test --test-isolation=none test-evidence/*.test.mjs
.\.test-venv\Scripts\python.exe -B -m unittest discover -s test-evidence -p "test_*.py" -v
npm.cmd run dev -- --host 127.0.0.1 --port 8879 --strictPort
node test-evidence/verify-collage.mjs --mock-only
node test-evidence/verify-subject-correction.mjs
node test-evidence/verify-rich-editor.mjs
```

- [ ] **Step 4: 验证三张真实照片。** 使用项目已有 coffee.jpg、cat.jpg、buffet.jpg，确认 `/health` 配置与 SAM 后通过 `--live` 逐张记录真实结果、耗时、手动调整和导出。不暴露配置值；服务不可用时保留已验证成果并明确真实接口未验证，不把 mock 当真实抠图成功。
- [ ] **Step 5: 在 1200px 与 390px 窗口生成截图和导出证据，检查布局。** 检查贴纸完整、文字可见、16 张无遗漏、控件易选、照片背景裁切与参考的白色手绘效果；发现问题回到所属任务修复并只重跑受影响检查。
- [ ] **Step 6: 更新 README 和验证记录。** 说明入口、格式／数量／尺寸、处理进度、手动纠正、背景与描边、撤销和导出；诚实记录二值 SAM、细边界、半透明和不跨刷新保存的限制。运行 `git diff --check`，审查实际变更与本设计是否一致。
- [ ] **Step 7: 仅提交验证脚本、说明与选定证据，完成独立整体审查。** Commit message: `test: verify sticker collage workflow and exports`。不自动发布／部署；提供可运行结果、截图、测试结论和剩余限制。

## 执行交接

计划状态：待用户审核计划并选择执行方式。推荐子代理逐任务实施与复核，后端 alpha／锁和前端坐标／资产历史分属不同边界，独立检查可更早发现接口偏差。也可选择由主代理在本会话直接实施，末尾进行一次独立整体审查。
