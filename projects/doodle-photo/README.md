# Doodle Photo · 日系手账

上传照片，由 Moonshot 视觉模型识别主体与文案，SAM 提取多个主体的真实外轮廓，再在浏览器绘制手写短句、弯曲箭头、星光、爱心等手绘点缀，并辅以纸框、胶带、纸夹和邮戳。

## 本地运行（Windows PowerShell）

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm install
npm run build
$env:DOODLE_API_KEY = '你的 Moonshot API 密钥'
.\.venv\Scripts\python.exe -m uvicorn server:app --host 127.0.0.1 --port 8767
```

打开 http://127.0.0.1:8767 。本次测试环境已安装在 `.test-venv` 中，可以用该目录的 Python 启动。

开发前端：先启动同端口后端，再执行 `npm run dev`；Vite 将 `/api` 和 `/health` 代理到 8767。

若系统上的 PyTorch 下载失败，可以从官方 CPU 源安装后再安装其他依赖：

```powershell
.\.venv\Scripts\python.exe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
```

## 配置

- `DOODLE_API_KEY`：Moonshot API 密钥。
- `DOODLE_API_BASE`：默认 `https://api.moonshot.cn/v1`。
- `DOODLE_MODEL`：默认 `kimi-k2.6`，关闭思考模式以减少等待。
- `SAM_CHECKPOINT`：默认项目目录下 `sam_vit_b_01ec64.pth`。
- `SAM_MODEL_TYPE`：默认 `vit_b`。

配置优先级为：进程环境变量 > 项目目录 `.env.local` > 项目目录 `.env`。文件路径按 `server.py` 所在目录解析，不受启动目录影响。修改配置后需要重启后端。`.env` 和 `.env.local` 已排除在 Git 之外；源码中不包含默认密钥。本地可以将密钥放在 `.env.local`，不必每次启动都设置 PowerShell 环境变量。

## 服务器部署（Linux）

需要同时部署 Python 后端和构建后的 `dist`，只上传前端静态文件无法完成 AI 分析。以下命令在项目目录执行：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm ci
npm run build
cp .env.example .env
chmod 600 .env
```

编辑 `.env`，填入有效的 `DOODLE_API_KEY`；也可使用部署平台的环境变量或密钥管理功能提供该值。不要上传本机 `.env.local`：它的优先级高于服务器 `.env`。服务器必须能通过 HTTPS 访问配置的视觉服务，密钥需有对应模型的权限和可用额度。

启动服务：

```bash
.venv/bin/python -m uvicorn server:app --host 0.0.0.0 --port 8767
```

生产环境使用进程管理器保持后端运行。域名反向代理到该服务；若单独托管前端，必须将同域 `/api` 和 `/health` 转发到后端。分析请求可能耗时较长，代理读取超时建议至少 120 秒，上传大小限制应覆盖允许的照片大小。

检查 `GET /health` 中的 `api_configured` 是否为 `true`，然后通过页面上传一张测试照片，确认 `/api/analyze` 返回 `status: "success"`。健康检查只确认密钥存在，不代表服务商鉴权、网络或额度验证通过。缺少密钥时分析接口返回 503 和配置提示；服务商调用失败返回 502。

如需主体描边，还需将 SAM 权重单独部署并设置 `SAM_CHECKPOINT`；健康检查的 `sam_loaded: true` 表示权重已加载。缺少权重不会影响 AI 识别和文案生成，但不会产生主体真实轮廓。

SAM 权重及 Python 虚拟环境不纳入 Git。SAM 不可用时跳过描边，保留手账编辑；视觉识别失败会明确报错，支持重新分析。照片会发送到配置的视觉服务，SAM 在本地运行，服务不将上传照片保存到磁盘。

## 编辑与导出

默认样式参考照片上的白色手绘标注：细白色主体描边、白色手写短句、弯曲实线/虚线箭头、小爱心和星光；留白充足时最多一个未填充的线稿气泡标题。自动排版不添加纸框、胶带、纸夹或邮戳，保留照片本身；这些素材仍可手动添加。API可以同时提供场景标题 `headline` 和最多两条 `ambientCaptions` 背景短句，均经过文字尺寸、边界和主体避让检查。

识别清单最多保留20组可辨认主体，按画面区域以及前、中、后景核对，不再仅选择六个重点。相邻同类物体可以按自然托盘或位置成组；一组可能包含多个物体，因此页面计数使用“组”。API为每组提供文案，前端对每组都尝试安全放置，留白不足时保留在“查看全部主体”清单中。清单显示当前编辑文案以及已放置文字、已有描边的数量；识别成功但分割失败的主体仍保留。`recognition_summary` 明确报告无效坐标、重复结果与超出清单上限的结果。

密集照片在常规字号无法放下文案时，继续尝试较窄的文字框和18–20的归一化字号，仍经过边界与避让检查。删除画布上的文字只移除其位置，清单保留最近编辑的文字；清空文字则保留空值，撤销也会同步。实际自助餐原图对照从6组增加到17组，但仍有后排杯装甜点和餐盘分类等漏项或混淆，不能把返回数量当作准确率。

每组最多8个独立分割区域，超过时提示模型拆组；每次SAM处理最多48个区域，未处理部分保留识别和几何范围，可单独纠错。API输出预算增加到12000 tokens，截断输出明确报错；视觉请求超时60秒，页面整图分析等待最多150秒。数量较多的场景可能耗时更长，生产反向代理的读取超时建议至少180秒。

支持修改纸框和手写标注文字、拖拽、缩放、旋转、删除、撤销，以及添加手写文字、星光、爱心、纸框、邮戳、胶带。连接箭头跟随对应文字移动；删除文字会同时移除箭头。切换滤镜不会重置编辑。点击“生成图片”查看结果，再导出原图尺寸 PNG。

主体分割返回 `shape_contours`（多个外轮廓），同时保留 `shape_points`（主外轮廓）兼容旧数据。只绘制可见外边缘，忽略分割中的表面纹理空洞；裁切边缘不补画虚构封口。布局按真实轮廓避让，缺少轮廓时使用主体框；没有空位时省略相应装饰，不覆盖主体。

复杂场景可返回 `segmentation_regions`：同一类食物的多个独立物体各有紧贴主体的框、主体内部前景点和展示台/背景排除点。无效框直接舍弃，不会在图片中央补造主体。SAM保留默认候选并比较另外三个候选，按稳定性、边界外泄及明确的前景/背景提示选择真实掩膜；不平滑或裁剪掩膜来制造轮廓。不可靠区域跳过描边，返回 `outline_status` 和区域质量数据；页面提示部分轮廓已跳过。模型分数不是物体名称识别准确率，复杂遮挡和细小物体仍需要实际照片验证。

识别或描边不准时，点击“纠正主体”，在原照片上选择主体及分割区域。用“框选主体”拖出紧贴真实物体的框；“点选主体”点击物体内部（绿色，最多4点），用“排除背景”点击误纳入的展示台、托盘或邻近物体（红色，最多8点）。首次手动点选会替换该类别的 API 建议点，可撤销点位或清空；重新框选会清除当前区域旧点位。

“重新描边”调用同域 `POST /api/segment`，只运行服务器的 SAM，无额外视觉 API 请求，即使未配置视觉密钥也可用。“局部放大复核”调用 `POST /api/refine`，从原照片裁出所选区域并留约20%上下文，额外进行一次视觉分析，再对放大区域运行 SAM。局部坐标映射回完整照片，手动标注的点位优先于模型建议；复核无法确认或与手动主体点冲突时明确报错并保留原结果。两条路都需要服务器 `sam_loaded: true`。

纠错保留现有文案、装饰和编辑位置，箭头跟随新的主体位置。关闭纠错窗口后正在处理的请求仍会完成；换照片会取消前端请求并忽略旧结果。相对路径接口和本地字体随现有后端部署，不依赖本机地址。点选与局部放大改善可控性，但不保证所有遮挡、细枝或透明物体都能精确描边。

每个主体可携带 `layout` 排版建议（文字或纸框、中心位置、宽度、字号、旋转角度），与识别和文案在同一次 API 请求中返回。后端校验数值并限定范围；前端等待手写字体加载后测量实际文字宽度与行数，重新计算元素高度，检查旋转后的边界、主体轮廓和元素间重叠。建议不安全时按距离搜索安全位置，再尝试缩小；无法使用或旧接口没有建议时回退到规则排版。所有纸框与文字都使用同一主体的文案，避免空纸框与重复文字。

手绘库包含 24 种元素：原有星光、爱心、叶子等，以及杯子、餐具、厨师帽、蛋糕、相机、纸飞机、太阳、彩虹、爪印、猫咪、嫩芽、书本、耳机、蝴蝶结。API 根据照片选材，较大的主题线稿与小点缀混排；自动布局按可用留白调整数量，最多 16 个。编辑区可从“手绘元素”下拉框选择并手动添加。

素材库不够贴切时，API 可在同一次分析中提供最多 2 个 `custom` 线稿：`label` 是名称，`paths` 是图标局部0-1000坐标的折线数组。后端与前端都限制路径数量、点数和数值范围，只接受简单数值线稿。自定义线稿也参与主体避让、边界与重叠检查，可拖拽、缩放、旋转、删除、撤销并导出；不需要额外图像生成服务。

预览与导出都使用 `src/utils/journal.js` 的 `drawJournal()`。日系手账的颜色、布局限制和系列名称集中在 `JOURNAL_STYLE`；以后扩充其他系列时可在此基础上增加风格预设和相应的绘制/布局规则。

手绘线条由前端确定性绘制，不增加API请求。轮廓采用细白线、轻微笔压变化和按路径长度分布的小留口，少量主体使用不等长虚线；展示偏移限制在真实轮廓附近，保留尖角、耳尖、分离部分与裁切开口，不修改SAM数据。箭头使用短弯线、轻回弯、细小的不对称开放箭头头部，投向最近可见边界；检查文字、其他元素与主体遮挡，过长或拥挤的连线暂不绘制。拖动文字后会重新计算可用路线。

文字先尝试各主体附近的安全空位和紧凑字号，再统一处理远处的回退位置，避免前一个主体的远处文案抢占下一个主体的近处空间。密集照片先留主体文案位置，场景标题有空位时再放置。识别错误的轮廓仍需要纠正主体，手绘处理只改善显示质感。

## 贴纸拼贴

顶部切换到「贴纸拼贴」，一次添加或分批添加照片。每个作品最多 16 张静态 JPG / PNG / WebP，每张最多 20 MiB、解码最多 4000 万像素；动画图片会明确拒绝。处理中、失败和暂停的素材卡也占名额，移除素材卡后释放。后台最多同时处理两张；页面分别显示可用、失败和等待空位的数量，全部失败时可重试或纠正主体。切回单张模式保留已完成作品，暂停未完成请求。

每张照片默认提取一个主要主体。点素材卡「纠正主体」可在原图上框选，并添加主体点和背景排除点，重新提取仅运行本地 SAM。同一主体最多 8 个区域，每个区域最多 4 个主体点和 8 个背景点。透明 PNG 保留孔洞与分离部分，不从轮廓重建遮罩。

作品固定为 3:4、1080 × 1440。背景可选择深色纹理纸、浅色纹理纸、纯色，或单独上传背景照片；背景不占 16 张名额。选择「移动背景」调整照片取景。贴纸可拖动、缩放、旋转、置顶、置底、删除，白色描边支持实线、虚线和无描边，宽度 0–16 导出像素。标题与短句可编辑，也可添加手绘线稿；重新排版保留编辑过的标题。最近 20 步可撤销，一次拖动或连续输入算一步。

「查看作品」隐藏编辑控件；「导出图片」等待字体和图片完成后，导出 PNG，编辑控件不会进入图片。导出使用点击时的作品快照。作品保存在当前页面会话中，刷新后不保留；没有账号、云端存储或自动保存。SAM 当前生成二值遮罩，细枝、毛发、透明或半透明物体和复杂遮挡仍可能需要手动纠正；模型分数和 HTTP 成功不代表主体识别准确。

拼贴浏览器验证需要现有 bundled Playwright 与 Edge，不新增项目运行依赖。先生成技术 fixture，再分别启动 Vite 与运行测试：

```powershell
.\.test-venv\Scripts\python.exe -B test-evidence/create-collage-fixtures.py
npm.cmd run dev -- --host 127.0.0.1 --port 8879 --strictPort
# 另一个 PowerShell 窗口
node test-evidence/verify-collage.mjs --mock-only
node test-evidence/verify-collage.mjs --mock-only --range-only
node test-evidence/verify-subject-correction.mjs
node test-evidence/verify-rich-editor.mjs
```

`--mock-only` 在上传前拦截全部 `/api/**`，覆盖真实 UI、模块与像素，完全不调用视觉服务；不带参数或未知参数会拒绝运行。真实验证必须显式使用 `--live` 与 `COLLAGE_URL` 指向已构建的后端，不能依赖指向旧后端的 Vite 代理。该模式仅逐张上传项目已有 `coffee.jpg`、`cat.jpg`、`buffet.jpg` 各一次，需事先获得将这三张照片发送给已配置视觉服务的授权。随后对咖啡照片进行一次本地 SAM 手动纠正并导出；不自动重试失败的视觉请求。

```powershell
npm.cmd run build
$env:COLLAGE_URL = 'http://127.0.0.1:18767/' # 替换为实际已启动后端
node test-evidence/verify-collage.mjs --live
Remove-Item Env:COLLAGE_URL
```

完整验证来源、像素指标、截图与实际接口局限见 [拼贴验证记录](test-evidence/sticker-collage-verification.md)。

## 自动检查

中文文案使用龙藏手写体（Long Cang），英文纸框文字与邮戳使用 Caveat。字体及开源许可证保存在 `src/assets/fonts`，随前端构建部署，不依赖 Google Fonts 在线地址。预览与导出绘制前都会等待这两套字体加载。

```powershell
npm run lint
npm run build
node --test --test-isolation=none test-evidence/*.test.mjs
.\.test-venv\Scripts\python.exe -m unittest discover -s test-evidence -p 'test_*.py'
```

真实接口测试使用公开的咖啡和猫咪照片。测试结果、截图及导出图片保存在 `test-evidence`。原编辑器备份为 `test-evidence/CanvasEditor.before.jsx`。

升级 FastAPI、Starlette 或 python-multipart 前后，必须运行 `python -B -m unittest discover -s test-evidence -p 'test_cutout_endpoints.py' -v` 作为依赖升级门槛。拼贴上传适配器依赖 Starlette 的 multipart 回调、内部清理列表及 `request._form`；该真实 ASGI 路由套件检查 8 KiB 分片头部边界、文件／字段／请求上限、内存上传禁止落盘、异常清理、HTTP 状态和共享 SAM 锁。依赖版本变更后不能仅凭安装成功判断兼容。

照片来源：
- https://www.pexels.com/photo/coffee-cup-on-table-10684685/
- https://www.pexels.com/photo/nature-summer-animal-pet-12985952/
