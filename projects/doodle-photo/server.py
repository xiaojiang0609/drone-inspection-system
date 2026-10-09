"""
Doodle Photo — FastAPI 后端（SAM 像素级分割版）
流程：大模型 → box_2d + caption → SAM 分割 → findContours → 不规则 shape_points
"""

import base64
import json
import os
import io
import re
import math
import logging
import threading
from contextlib import asynccontextmanager
from typing import TypedDict

import numpy as np
import cv2
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRoute
from fastapi.exceptions import RequestValidationError
from starlette.formparsers import MultiPartParser, MultiPartException
from fastapi.responses import FileResponse, JSONResponse
from openai import OpenAI
from PIL import Image, ImageOps
from starlette.concurrency import run_in_threadpool
from dotenv import dotenv_values
from detection_geometry import normalize_subject_geometry
from sam_segmentation import predict_subject_mask, mask_to_contour_rings
from image_cutouts import (
    CutoutError, decode_cutout_image, validate_cutout_subject, encode_vision_image,
    prepare_cutout_crop, merge_region_masks, encode_cutout_png,
)
from subject_refinement import (
    make_subject_crop, encode_crop_jpeg, build_refinement_prompt,
    apply_vision_refinement, global_geometry_to_crop_region, crop_contour_to_global,
)

logger = logging.getLogger("doodle-photo")

# ─── 配置 ────────────────────────────────────────────────
def load_api_config(directory):
    """项目目录配置文件作为默认值，服务器环境变量始终优先。"""
    settings = {}
    for filename in (".env", ".env.local"):
        settings.update(dotenv_values(os.path.join(directory, filename), interpolate=False))
    settings.update(os.environ)
    return settings


API_SETTINGS = load_api_config(os.path.dirname(os.path.abspath(__file__)))
API_KEY = (API_SETTINGS.get("DOODLE_API_KEY") or "").strip()
API_BASE = (API_SETTINGS.get("DOODLE_API_BASE") or "https://api.moonshot.cn/v1").strip()
MODEL = (API_SETTINGS.get("DOODLE_MODEL") or "kimi-k2.6").strip()

# SAM 权重路径：环境变量指定，或自动查找同目录下的 sam_vit_b.pth
SAM_CHECKPOINT = API_SETTINGS.get(
    "SAM_CHECKPOINT",
    os.path.join(os.path.dirname(__file__), "sam_vit_b_01ec64.pth"),
)
SAM_MODEL_TYPE = API_SETTINGS.get("SAM_MODEL_TYPE", "vit_b")

# ─── SAM 全局实例 ────────────────────────────────────────
_sam_predictor = None
_sam_available = False
_sam_lock = threading.Lock()
MAX_SEGMENT_REGIONS = 48


def load_sam():
    """启动时加载 SAM 模型（如果权重文件存在）"""
    global _sam_predictor, _sam_available

    if not os.path.isfile(SAM_CHECKPOINT):
        logger.warning(
            f"SAM 权重文件不存在: {SAM_CHECKPOINT}\n"
            "将跳过主体描边。下载地址：\n"
            "  vit_b: https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth"
        )
        return

    try:
        from segment_anything import SamPredictor, sam_model_registry
        import torch
        torch.set_num_threads(min(4, os.cpu_count() or 1))

        logger.info(f"正在加载 SAM 模型 ({SAM_MODEL_TYPE}) ...")
        sam = sam_model_registry[SAM_MODEL_TYPE](checkpoint=SAM_CHECKPOINT)
        sam.eval()
        _sam_predictor = SamPredictor(sam)
        _sam_available = True
        logger.info("SAM 模型加载完成 ✓")
    except Exception as e:
        logger.warning(f"SAM 加载失败: {e}，将跳过主体描边")


# ─── 轮廓提取（SAM + OpenCV）─────────────────────────────

def extract_contour_rings_with_sam(
    image_rgb: np.ndarray,
    box_xyxy: list[int],
    img_w: int,
    img_h: int,
    image_ready: bool = False,
    positive_points=None,
    negative_points=None,
    quality_out=None,
) -> list[list[list[float]]]:
    """
    给定原图和 box_2d（像素坐标），用 SAM 提取真实轮廓点。
    返回归一化外轮廓环，保留分离部分，忽略表面纹理空洞（0-1000）。
    分割失败返回空轮廓，不用虚构的矩形或椭圆代替真实主体。
    """
    global _sam_predictor, _sam_available

    # SAM 不可用时不虚构边界。
    if not _sam_available or _sam_predictor is None:
        logger.info("SAM 不可用，跳过主体轮廓")
        return []

    try:
        selected_mask, quality = predict_subject_mask(
            _sam_predictor, image_rgb, box_xyxy, image_ready=image_ready,
            positive_points=positive_points, negative_points=negative_points,
        )
        if quality_out is not None:
            quality_out.update(quality)
        if selected_mask is None:
            logger.info("主体分割不可靠，跳过轮廓: %s", quality.get("reason"))
            return []
        return mask_to_contour_rings(selected_mask, img_w, img_h)

    except Exception as e:
        logger.warning(f"SAM/OpenCV 处理异常: {e}，跳过主体描边")
        return []


def extract_contours_with_sam(image_rgb, box_xyxy, img_w, img_h, image_ready=False):
    """Backward-compatible primary outer contour."""
    rings = extract_contour_rings_with_sam(image_rgb, box_xyxy, img_w, img_h, image_ready)
    return rings[0] if rings else []


def segment_detections(image_rgb, detections, img_w, img_h):
    """Encode once per image; protect the stateful predictor across requests."""
    for det in detections:
        count = len((det.get("segmentation_regions") or [{"box_2d": det["box_2d"]}])[:8])
        det.update(shape_contours=[], shape_points=[], shape_contours_by_region=[[] for _ in range(count)],
                   outline_status="unavailable", segmentation_quality=[{"outline_ready": False} for _ in range(count)])
    if not _sam_available or _sam_predictor is None or not detections:
        return
    with _sam_lock:
        try:
            _sam_predictor.set_image(image_rgb)
            processed_regions = 0
            for det in detections:
                regions = det.get("segmentation_regions") or [{"box_2d": det["box_2d"]}]
                rings, seen, successful = [], set(), 0
                for region_index, region in enumerate(regions[:8]):
                    if processed_regions >= MAX_SEGMENT_REGIONS:
                        det["segmentation_quality"][region_index] = {"outline_ready": False, "reason": "segmentation_budget"}
                        continue
                    processed_regions += 1
                    y1, x1, y2, x2 = region["box_2d"]
                    box = [round(x1 / 1000 * img_w), round(y1 / 1000 * img_h),
                           round(x2 / 1000 * img_w), round(y2 / 1000 * img_h)]
                    def pixel_points(name):
                        return [[min(img_w - 1, round(x / 1000 * img_w)), min(img_h - 1, round(y / 1000 * img_h))]
                                for x, y in region.get(name, [])]
                    quality = {}
                    parts = extract_contour_rings_with_sam(image_rgb, box, img_w, img_h, image_ready=True,
                        positive_points=pixel_points("positive_points"), negative_points=pixel_points("negative_points"),
                        quality_out=quality)
                    quality["outline_ready"] = bool(parts)
                    det["segmentation_quality"][region_index] = quality
                    det["shape_contours_by_region"][region_index] = parts
                    successful += bool(parts)
                    for ring in parts:
                        signature = tuple(map(tuple, ring))
                        if signature not in seen and len(rings) < 32:
                            rings.append(ring)
                            seen.add(signature)
                det["shape_contours"] = rings
                det["shape_points"] = rings[0] if rings else []
                det["outline_status"] = "ready" if successful == len(regions[:8]) else "partial" if rings else "uncertain"
        except Exception as exc:
            logger.warning("主体轮廓暂不可用: %s", exc)


def _hand_drawn_fallback(
    x1: int, y1: int, x2: int, y2: int,
    img_w: int, img_h: int,
) -> list[list[int]]:
    """
    终极兜底：在矩形框内生成一个手绘风格的圆角轮廓。
    模拟人手涂鸦的不规则感，比纯矩形更自然。
    """
    cx = (x1 + x2) / 2
    cy = (y1 + y2) / 2
    rx = (x2 - x1) / 2
    ry = (y2 - y1) / 2
    # 稍微扩大一点，让轮廓更自然
    rx *= 1.05
    ry *= 1.05

    n_points = 36  # 足够平滑
    shape_points = []
    for i in range(n_points):
        angle = 2 * math.pi * i / n_points
        # 添加手绘抖动：±3% 的随机偏移
        jitter_x = 1.0 + (hash(str(i) + "x") % 7 - 3) * 0.01
        jitter_y = 1.0 + (hash(str(i) + "y") % 7 - 3) * 0.01
        px = cx + rx * math.cos(angle) * jitter_x
        py = cy + ry * math.sin(angle) * jitter_y
        nx = max(0, min(1000, round(px / img_w * 1000)))
        ny = max(0, min(1000, round(py / img_h * 1000)))
        shape_points.append([nx, ny])

    return shape_points


def _box_to_contour(x1, y1, x2, y2, img_w, img_h):
    """矩形框退化：沿框边均匀采样 16 个点"""
    pts = []
    steps = 5
    for i in range(steps):
        pts.append([x1 + (x2 - x1) * i / (steps - 1), y1])
    for i in range(1, steps):
        pts.append([x2, y1 + (y2 - y1) * i / (steps - 1)])
    for i in range(1, steps):
        pts.append([x2 - (x2 - x1) * i / (steps - 1), y2])
    for i in range(1, steps - 1):
        pts.append([x1, y2 - (y2 - y1) * i / (steps - 1)])
    return [
        [max(0, min(1000, round(x / img_w * 1000))),
         max(0, min(1000, round(y / img_h * 1000)))]
        for x, y in pts
    ]


def _resample_contour(pts: np.ndarray, min_points: int = 40, max_points: int = 150) -> np.ndarray:
    """等距重采样轮廓点到目标密度范围"""
    n = len(pts)
    if n < 2:
        return pts

    # 累计弧长
    diffs = np.diff(pts, axis=0)
    seg_lens = np.sqrt((diffs ** 2).sum(axis=1))
    cum_len = np.concatenate([[0], np.cumsum(seg_lens)])
    total = cum_len[-1]
    if total < 1:
        return pts[:max_points]

    # 自适应目标点数：轮廓越长越多点，但不超过上限
    target = int(total / 3.0)  # 每 3 像素一个点
    target = max(min_points, min(max_points, target))

    targets = np.linspace(0, total, target)
    indices = np.searchsorted(cum_len, targets, side="right") - 1
    indices = np.clip(indices, 0, n - 2)

    result = []
    for t, idx in zip(targets, indices):
        seg = cum_len[idx + 1] - cum_len[idx]
        frac = (t - cum_len[idx]) / seg if seg > 0 else 0
        pt = pts[idx] + (pts[idx + 1] - pts[idx]) * frac
        result.append(pt)

    return np.array(result, dtype=np.int32)


# ─── 大模型调用 ───────────────────────────────────────────

AI_PROMPT = """\
你是一个视觉观察与布局工程师。先完整盘点照片中的可辨认物体，再返回日系手绘照片标注方案。
识别清单与文字排版是两件事：不能因为背景留白少、文案放不下，就省略已经看清的主体。

核心原则：
1. 主体区域（人脸、宠物头部、产品主体）绝对不能放装饰
2. 装饰只出现在背景空旷区域（天空、草地、墙面、桌面等）
3. 文字放在主体旁边有空间的方向

只返回纯 JSON，不要任何 Markdown 标记或其他文字：
{
  "theme": "人物|旅行|美食|宠物|风景|建筑|静物|其他",
  "emotion": "温暖|活力|治愈|文艺|清新|浪漫|有趣|宁静",
  "headline": {"text": "贴合照片的场景短标题", "x": 780, "y": 140, "width": 360, "fontSize": 34, "rotation": -2},
  "ambientCaptions": [{"text": "背景氛围短句", "x": 150, "y": 200, "width": 260, "fontSize": 24, "rotation": 2}],
  "detections": [
    {
      "label": "物体名称",
      "box_2d": [y1, x1, y2, x2],
      "segmentation_regions": [{"box_2d": [y1, x1, y2, x2], "positive_points": [[x, y]], "negative_points": []}],
      "caption": "治愈系短文案",
      "textPlacement": "right",
      "layout": {"type": "text", "x": 800, "y": 200, "width": 260, "fontSize": 28, "rotation": -3}
    }
  ],
  "safeZone": {"x1": 0, "y1": 0, "x2": 0, "y2": 0},
  "decorationZones": [
    {"x1": 0, "y1": 0, "x2": 1000, "y2": 200, "label": "天空"}
  ],
  "decorations": [
    {"type": "star", "x": 150, "y": 100, "scale": 1.0}
  ]
}

字段说明：

- 本次风格以照片上的白色手写短句、细白色轮廓、线稿气泡和弯曲箭头为主，留住照片本身。
  不推荐纸框、胶带、纸夹或邮戳。文案不做成统一大小的卡片，围绕对应主体在留白中错落排布。
- headline: 最多一个场景标题，12-24字；用未填充的白色线稿气泡表示，建议放在最大的背景留白。
  坐标按0-1000归一化，width建议300-380、fontSize30-36。标题贴合可见场景，不猜地点或日期。
  留白不足时可返回null，前端也会自动省略无法安全放置的气泡。
- ambientCaptions: 0-2条补充背景或情绪的短句，每条8-18字，直接白色手写在背景留白。
  包含text,x,y,width,fontSize,rotation；字号22-28，宽度180-300；不重复主体caption或遮挡主体。

- layout: 每个主体文案的设计建议，最终由前端测量手写字体并避让主体。
  - type: 使用text（直接在照片上绘制白色手写字），不要用带胶带的note纸框。
  - x,y: 文案中心，按图片宽高各自归一化到0-1000，选附近实际留白。
  - width: 文案宽度占图片宽度的千分比，180-380。
  - fontSize: 图片宽度为1000时的字号，22-36；rotation 为 -8 到8度。
  - 不要生成额外文字、空白纸框或重复标题，文字内容只使用同一主体 caption。
  - 一个主体只提供一个 layout，给每个主体留出清楚独立的文字区域。

- detections: 按实际画面返回最多20组可辨认主体；场景简单时按实际数量返回，不为凑数添加物体。
  先按左上、上中、右上、左中、中部、右中、左下、下中、右下逐区扫视，再核对前景、中景、后景。
  除主要物体，也检查角落、画面边缘、后排、小尺寸和被部分遮挡但类别仍可辨认的物体。
  不要仅选最醒目的几个。美食场景同时检查不同水果盘、各组包装点心、不同托盘的甜点杯、
  前后排小食和绿色甜点、花束、花瓶、餐盘、餐巾及有独立视觉意义的器具。
  静物同时检查主体附近清楚可见的书本、杯碟、小灯、花环和配件；风景检查树干、长椅、灯柱、
  石块、灌木等有独立形状的对象；不要把纹理、阴影、普通墙面或每片叶子都当成独立主体。
  同类相邻小物可按同一个托盘或相邻位置组成一组，前后两排或不同托盘分别返回。
  不同名称、形状或位置的主体不要吞并成一个泛称；同一物体不要重复识别。
  看不清的远处物体用保守的可见类别，不猜具体食材、品牌或口味。
  - label: 简短中文名（如"小猫咪"、"摩天轮"，不要用泛称）
  - box_2d: [y1, x1, y2, x2] 归一化0-1000，仅包围目标本身，不包含桌面、展示台、支架或相邻物体。
  - segmentation_regions: 主体分割提示，尤其用于自助餐、多层展示架、多个相邻甜点等复杂场景。
    每个区域有独立的紧贴物体的box_2d、positive_points、negative_points。
    同类相邻食物可以使用一个caption，但每个独立小蛋糕/甜点杯分别提供区域，每组最多8个。
    超过8个时拆成多组（如前排/后排、左盘/右盘），不要漏掉第9个及后面的可见物体。
    整张照片的分割区域建议不超过48个；优先按自然托盘、果盘和物体整体分组，不逐颗水果分割。
    positive_points 是1-3个明确位于实际可见主体内部的[x,y]点，不是框中心；避开空隙、反光和遮挡。
    negative_points 是1-5个展示台/支架/桌面/相邻主体上的[x,y]点，指导分割排除这些区域。
    点坐标归一化0-1000；看不清的位置不要编造。大物体通常1个区域即可，宠物的耳朵身体属于同一主体。
    水果盘按整盘可见水果/盘子的整体描边，不逐颗葡萄分割；甜点杯不要把后方展示台圈进来。
  - 名称只使用有把握的可见类别，例如包装点心、杯装甜点、绿色甜点；不要猜品种、口味、品牌。
  - caption: 贴合这个具体物体的手写短句（8-16字，可以分成两行）。
    食物可描写可见颜色、形状和搭配，但不臆测实际口味、价格或未出现的食材。
    不要凭外观断定饮品是咖啡还是可可，不臆测书籍语言、故事内容或不可见的气味。
  - textPlacement: 文字放主体哪侧 "left"|"right"|"above"|"below"
    选择主体旁边有空旷区域的方向，不要选画面边缘

- safeZone: 主体安全区（最重要的字段）
  - 包含所有主体的最小矩形，外扩10%确保覆盖
  - 这个区域内禁止出现任何装饰和文字
  - 坐标 {x1,y1,x2,y2} 归一化 0-1000

- decorationZones: 适合放装饰的背景区域（第二重要的字段）
  - 精确标注画面中的空旷区域，如天空、草地、墙面
  - 每个区域 {x1,y1,x2,y2,label}
  - 不要返回覆盖整个画面的大区域
  - 应该是 safeZone 之外的具体区域

- decorations: 手绘元素方案（背景充足时建议12-18个，最多18个；狭窄背景减少数量），
  以白色细线小光芒rays、小圆点dots、小爱心smallHeart、星光sparkle等微元素穿插，疏密和大小有变化。
  微元素可以适当丰富，沿多处真实背景留白分布；不要为了数量挤进主体、文案或箭头的区域。
  与照片相关的较大线稿最多1-2个，大小有变化，避免抢走主体和手写短句的注意力。
  - type: heart, star, music, flower, cloud, smallHeart, sparkle, leaf, butterfly, smiley,
    cup, cutlery, chefHat, cake, camera, paperPlane, sun, rainbow, paw, cat, sprout, book, headphones, bow,
    fruit, berry, bread, steam, rays, wave, dots。
  - x,y 归一化 0-1000，必须在 decorationZones 内
  - scale 范围0.6-1.2；rotation 为-15到15度；主题线稿会比星光爱心更大，要为它留出实际空间。
  - 实物线稿根据照片真实可辨认的内容和主体label选择：水果→fruit，浆果→berry，面包→bread，
    杯子或确定的饮品→cup，实际餐具→cutlery，实际蛋糕→cake，实际猫咪→paw/cat，
    绿植→sprout/leaf，书本→book；其他具体图标也必须有对应的可见物体，不仅根据宽泛theme猜物件。
  - steam只点缀明确的热食、热饮或可见热气，不给冰饮或无法判断温度的物体加热气；
    wave适合可见水面或海浪，rays/dots可以作为通用的小光芒和圆点点缀。
  - 所有元素保持白色细线和空心自然手绘，不使用文字作图标；不要添加胶带或纸框。
    让元素与可见内容相关，避免所有照片都用同一批星星爱心；同种较大线稿最多一次。
  - 素材库不能表达某个可见物体时，可以生成最多2个 custom 简单线稿（不要每次强行生成）。
    custom 项包括 label（短中文名）与 paths（1-8条折线，每条2-48个点）。
    每个点是图标自身画布中0-1000的[x,y]，和整张照片的位置x,y是两套坐标。
    建议2-5条简洁折线、每条4-12个点，保持物体容易辨认；只返回数值，不返回SVG、代码或URL。
    例如杯中吸管的 paths 可为 [[[250,300],[320,900],[700,900],[770,300]],[[200,300],[800,300]],[[500,300],[600,80]]]。
  - 这些坐标仅供参考，前端会自动调整
"""


def _clean_json_text(raw: str) -> str:
    """终极 JSON 文本清洗：剥离所有 Markdown 标记、注释、多余空白"""
    s = raw.strip()
    # 去除 Markdown 代码块包裹 ```json ... ``` 或 ``` ... ```
    s = re.sub(r'^```(?:json|JSON)?\s*', '', s)
    s = re.sub(r'\s*```$', '', s)
    # 去除行内 `json` 标记
    s = re.sub(r'^json\s*', '', s, flags=re.IGNORECASE)
    # 去除行注释
    s = re.sub(r'//.*?$', '', s, flags=re.MULTILINE)
    # 去除首尾非 JSON 字符（中文解释性文字等）
    # 找到第一个 { 或 [ ，最后一个 } 或 ]
    start = None
    end = None
    for i, ch in enumerate(s):
        if ch in ('{', '[') and start is None:
            start = i
        if ch in ('}', ']'):
            end = i
    if start is not None and end is not None and end > start:
        s = s[start : end + 1]
    return s.strip()


def _extract_json_fallback(raw: str) -> dict | None:
    """正则兜底：尝试从乱文本中提取 JSON 结构"""
    # 尝试匹配最大的 {...} 块
    m = re.search(r'\{[\s\S]*\}', raw)
    if m:
        try:
            return json.loads(m.group())
        except json.JSONDecodeError:
            pass
    # 尝试匹配 [...] 并包装
    m = re.search(r'\[[\s\S]*\]', raw)
    if m:
        try:
            arr = json.loads(m.group())
            if isinstance(arr, list):
                return {"detections": arr, "decorations": []}
        except json.JSONDecodeError:
            pass
    return None


def _build_fallback_response() -> dict:
    """当所有解析都失败时，返回空但合法的结构"""
    return {"detections": [], "decorations": []}


def call_vision_api(image_b64: str, prompt=None, max_tokens=12000) -> dict:
    """返回真实视觉分析；服务失败或结果不可解析时明确报错。"""
    if not API_KEY:
        raise HTTPException(status_code=503, detail="未配置 DOODLE_API_KEY，请在服务器环境变量或项目 .env 文件中配置后重启服务")
    client = OpenAI(api_key=API_KEY, base_url=API_BASE, timeout=60.0, max_retries=0)

    try:
        completion = client.chat.completions.create(
            model=MODEL,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{image_b64}",
                            "detail": "high",
                        },
                    },
                    {"type": "text", "text": AI_PROMPT if prompt is None else prompt},
                ],
            }],
            max_tokens=max_tokens,
            timeout=60,
            extra_body={"thinking": {"type": "disabled"}},
        )
        raw = completion.choices[0].message.content.strip()
    except Exception as e:
        logger.error("AI 请求失败: %s", type(e).__name__)
        raise HTTPException(status_code=502, detail="照片识别失败，请检查视觉模型配置或稍后重试") from e

    if getattr(completion.choices[0], "finish_reason", None) == "length":
        raise HTTPException(status_code=502, detail="识别结果尚未完整输出，请重新分析照片")

    # 第一轮：强清洗后直接解析
    cleaned = _clean_json_text(raw)
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, list):
            parsed = {"detections": parsed, "decorations": []}
        if isinstance(parsed, dict) and (prompt is not None or "detections" in parsed or "data" in parsed):
            return parsed
    except json.JSONDecodeError:
        pass

    # 第二轮：正则兜底提取
    fallback = _extract_json_fallback(cleaned)
    if fallback is not None:
        if isinstance(fallback, list):
            fallback = {"detections": fallback, "decorations": []}
        return fallback

    # 第三轮：对原始文本再试一次正则
    fallback = _extract_json_fallback(raw)
    if fallback is not None:
        if isinstance(fallback, list):
            fallback = {"detections": fallback, "decorations": []}
        return fallback

    # 彻底失败 → 返回空结构，前端仍可正常工作
    logger.warning(f"AI 返回内容无法解析为 JSON: {raw[:200]}")
    raise HTTPException(status_code=502, detail="识别结果无法解析，请重新分析照片")


# ─── 图片处理 ─────────────────────────────────────────────

def normalize_layout_suggestion(value):
    """Treat model layout as optional bounded advice, never as rendering instructions."""
    if not isinstance(value, dict) or value.get("type") not in ("note", "text"):
        return None
    result = {"type": value["type"]}
    limits = {"x": (0, 1000), "y": (0, 1000), "width": (180, 380),
              "fontSize": (22, 36), "rotation": (-8, 8)}
    defaults = {"width": 260, "fontSize": 28, "rotation": 0}
    try:
        for name, (low, high) in limits.items():
            number = float(value.get(name, defaults.get(name)))
            if not math.isfinite(number):
                return None
            result[name] = max(low, min(high, number))
    except (TypeError, ValueError, OverflowError):
        return None
    return result


def normalize_scene_caption(value, headline=False):
    if not isinstance(value, dict) or not isinstance(value.get("text"), str) or not value["text"].strip():
        return None
    layout = normalize_layout_suggestion({"type": "text", "x": value.get("x", 760 if headline else None),
        "y": value.get("y", 130 if headline else None), "width": value.get("width", 360 if headline else 250),
        "fontSize": value.get("fontSize", 34 if headline else 24), "rotation": value.get("rotation", 0)})
    if layout is None:
        return None
    return {**layout, "text": value["text"].strip()[:48 if headline else 36]}


DOODLE_TYPES = {
    "heart", "star", "music", "flower", "cloud", "smallHeart", "sparkle", "leaf", "butterfly", "smiley",
    "cup", "cutlery", "chefHat", "cake", "camera", "paperPlane", "sun", "rainbow", "paw", "cat",
    "sprout", "book", "headphones", "bow", "fruit", "berry", "bread", "steam", "rays", "wave", "dots", "custom",
}


def normalize_decorations(items):
    if not isinstance(items, list):
        return []
    decorations = []
    custom_count = 0
    custom_shapes = set()
    for item in items[:36]:
        if len(decorations) >= 18:
            break
        if not isinstance(item, dict) or not isinstance(item.get("type"), str) or item["type"] not in DOODLE_TYPES:
            continue
        try:
            values = {name: float(item.get(name, default)) for name, default in
                      (("x", 500), ("y", 500), ("scale", 1), ("rotation", 0))}
            if not all(math.isfinite(value) for value in values.values()):
                continue
            decoration = {"type": item["type"], "x": max(0, min(1000, values["x"])),
                          "y": max(0, min(1000, values["y"])), "scale": max(.6, min(1.2, values["scale"])),
                          "rotation": max(-15, min(15, values["rotation"]))}
            if item["type"] == "custom":
                paths = item.get("paths")
                if custom_count >= 2 or not isinstance(paths, list) or not 1 <= len(paths) <= 8:
                    continue
                validated = []
                for path in paths:
                    if not isinstance(path, list) or not 2 <= len(path) <= 48:
                        raise ValueError("invalid path")
                    points = []
                    for point in path:
                        if not isinstance(point, list) or len(point) != 2:
                            raise ValueError("invalid point")
                        x, y = map(float, point)
                        if not (math.isfinite(x) and math.isfinite(y) and 0 <= x <= 1000 and 0 <= y <= 1000):
                            raise ValueError("invalid coordinates")
                        points.append([x, y])
                    validated.append(points)
                signature = tuple(tuple(tuple(point) for point in path) for path in validated)
                if signature in custom_shapes or len({point for path in signature for point in path}) < 2:
                    continue
                custom_shapes.add(signature)
                decoration.update(label=str(item.get("label", "AI 线稿"))[:24], paths=validated)
                custom_count += 1
            decorations.append(decoration)
        except (TypeError, ValueError, OverflowError):
            continue
    return decorations


def preprocess_image(image_bytes: bytes, max_size: int = 1536):
    """
    返回 (image_rgb_np, image_b64, orig_w, orig_h)
    image_rgb_np 用于 SAM 推理（已缩放）
    """
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes))).convert("RGB")
    orig_w, orig_h = img.size

    if max(orig_w, orig_h) > max_size:
        scale = max_size / max(orig_w, orig_h)
        new_w, new_h = int(orig_w * scale), int(orig_h * scale)
        img = img.resize((new_w, new_h), Image.LANCZOS)
    else:
        new_w, new_h = orig_w, orig_h

    arr = np.array(img)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    b64 = base64.b64encode(buf.getvalue()).decode()

    return arr, b64, new_w, new_h


# ─── FastAPI 应用 ─────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    load_sam()
    yield


app = FastAPI(title="Doodle Photo API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """全局兜底：任何未捕获的异常都返回友好的 JSON，绝不返回 HTML 500 页"""
    logger.error(f"未捕获异常: {exc}", exc_info=True)
    return JSONResponse(
        status_code=200,
        content={
            "status": "error",
            "message": "服务暂时不可用，请稍后重试",
            "data": [],
            "decorations": [],
        },
    )


MAX_SCENE_SUBJECTS = 20


def collect_scene_subjects(raw_items):
    """Keep a complete bounded inventory independently of masks and caption space."""
    items = raw_items if isinstance(raw_items, list) else []
    summary = {"returned_subjects": len(items), "accepted_subjects": 0,
               "rejected_geometry": 0, "duplicates": 0, "limited_subjects": 0}
    subjects, seen = [], set()
    for item in items[:100]:
        geometry = normalize_subject_geometry(item)
        if geometry is None:
            summary["rejected_geometry"] += 1
            continue
        label = item.get("label")
        label = label.strip()[:80] if isinstance(label, str) and label.strip() else "物体"
        signature = (label.casefold(), tuple(geometry["box_2d"]),
                     tuple(tuple(region["box_2d"]) for region in geometry["segmentation_regions"]))
        if signature in seen:
            summary["duplicates"] += 1
            continue
        seen.add(signature)
        if len(subjects) >= MAX_SCENE_SUBJECTS:
            summary["limited_subjects"] += 1
            continue
        caption = item.get("caption")
        caption = caption.strip()[:160] if isinstance(caption, str) else ""
        placement = item.get("textPlacement")
        subjects.append({"label": label, **geometry, "shape_points": [], "caption": caption,
                         "textPlacement": placement if placement in ("left", "right", "above", "below") else "right",
                         "layout": normalize_layout_suggestion(item.get("layout"))})
    summary["limited_subjects"] += max(0, len(items) - 100)
    summary["accepted_subjects"] = len(subjects)
    return subjects, summary


@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...)):
    # ── 0) 读取文件 ──
    try:
        image_bytes = await file.read()
        if not image_bytes:
            return JSONResponse(
                status_code=200,
                content={"status": "error", "message": "空文件", "data": [], "decorations": []},
            )
    except Exception as e:
        return JSONResponse(
            status_code=200,
            content={"status": "error", "message": f"文件读取失败: {e}", "data": [], "decorations": []},
        )

    # ── 1) 预处理图片 ──
    try:
        image_rgb, image_b64, img_w, img_h = await run_in_threadpool(preprocess_image, image_bytes)
    except Exception as e:
        logger.error(f"图片预处理失败: {e}")
        return JSONResponse(
            status_code=200,
            content={"status": "error", "message": f"图片格式不支持: {e}", "data": [], "decorations": []},
        )

    # ── 2) 大模型 → 结构化视觉数据（内部已有完整容错，永不抛异常）──
    parsed = await run_in_threadpool(call_vision_api, image_b64)

    # ── 3) 对每个 box 调 SAM → shape_points ──
    raw_dets = parsed.get("detections", parsed.get("data", []))
    if not isinstance(raw_dets, list):
        raw_dets = []

    detections, recognition_summary = collect_scene_subjects(raw_dets)

    await run_in_threadpool(segment_detections, image_rgb, detections, img_w, img_h)
    if not detections:
        raise HTTPException(status_code=422, detail="没有识别到明确主体，请换一张主体更清晰的照片")

    # ── 4) 装饰贴纸 ──
    decorations = normalize_decorations(parsed.get("decorations", parsed.get("stickers", [])))

    # ── 5) 提取布局元数据 ──
    def _safe_area(val):
        """安全提取区域坐标"""
        if isinstance(val, dict):
            try:
                return {
                    "x1": max(0, min(1000, int(float(val.get("x1", 0))))),
                    "y1": max(0, min(1000, int(float(val.get("y1", 0))))),
                    "x2": max(0, min(1000, int(float(val.get("x2", 1000))))),
                    "y2": max(0, min(1000, int(float(val.get("y2", 1000))))),
                }
            except (ValueError, TypeError):
                pass
        return None

    theme = str(parsed.get("theme", "其他"))
    emotion = str(parsed.get("emotion", "治愈"))

    # safeZone: 主体安全区（禁止装饰进入）
    raw_safe = parsed.get("safeZone")
    if isinstance(raw_safe, list) and len(raw_safe) == 4:
        try:
            sy1, sx1, sy2, sx2 = [max(0, min(1000, int(float(v)))) for v in raw_safe]
            safeZone = {"x1": sx1, "y1": sy1, "x2": sx2, "y2": sy2}
        except (ValueError, TypeError):
            safeZone = None
    else:
        safeZone = _safe_area(raw_safe)

    # decorationZones: 推荐装饰区域
    decorationZones = []
    for item in (parsed.get("decorationZones") or []):
        area = _safe_area(item)
        if area:
            decorationZones.append(area)

    # 兼容旧字段
    if not safeZone:
        raw_subject = parsed.get("subjectArea")
        if isinstance(raw_subject, list) and len(raw_subject) == 4:
            try:
                sy1, sx1, sy2, sx2 = [max(0, min(1000, int(float(v)))) for v in raw_subject]
                safeZone = {"x1": sx1, "y1": sy1, "x2": sx2, "y2": sy2}
            except (ValueError, TypeError):
                pass
        else:
            safeZone = _safe_area(raw_subject)

    if not decorationZones:
        for item in (parsed.get("stickerArea") or []):
            area = _safe_area(item)
            if area:
                decorationZones.append(area)

    return {
        "status": "success",
        "data": detections,
        "recognition_summary": recognition_summary,
        "decorations": decorations,
        "headline": normalize_scene_caption(parsed.get("headline"), headline=True),
        "ambientCaptions": [caption for item in (parsed.get("ambientCaptions") if isinstance(parsed.get("ambientCaptions"), list) else [])[:2]
                            if (caption := normalize_scene_caption(item)) is not None],
        "theme": theme,
        "emotion": emotion,
        "safeZone": safeZone,
        "decorationZones": decorationZones,
        "sam_used": any(bool(d["shape_points"]) for d in detections),
    }


def parse_correction_subject(raw, region_index):
    """Accept geometry and bounded display fields, never posted contours."""
    try:
        if not isinstance(raw, str) or len(raw) > 50000:
            raise ValueError("payload size")
        posted = json.loads(raw)
        geometry = normalize_subject_geometry(posted)
        if geometry is None or isinstance(region_index, bool) or not isinstance(region_index, int):
            raise ValueError("invalid geometry")
        if not 0 <= region_index < len(geometry["segmentation_regions"]):
            raise ValueError("invalid region")
    except (ValueError, TypeError, OverflowError):
        raise HTTPException(status_code=422, detail="主体区域或点位无效，请重新框选")
    def text(name, default, limit):
        value = posted.get(name)
        return value.strip()[:limit] if isinstance(value, str) else default
    detection = {**geometry, "label": text("label", "物体", 80),
                 "caption": text("caption", "", 200),
                 "textPlacement": posted.get("textPlacement") if posted.get("textPlacement") in
                 ("top", "bottom", "left", "right") else "top"}
    layout = normalize_layout_suggestion(posted.get("layout"))
    if layout is not None:
        detection["layout"] = layout
    flags = posted.get("manual_hint_regions")
    flags = flags if isinstance(flags, list) else []
    detection["manual_hint_regions"] = [
        {key: index < len(flags) and isinstance(flags[index], dict) and flags[index].get(key) is True
         for key in ("positive", "negative")}
        for index in range(len(geometry["segmentation_regions"]))]
    hints = posted.get("manual_hints")
    hints = {key: isinstance(hints, dict) and hints.get(key) is True for key in ("positive", "negative")}
    detection["manual_hint_regions"][region_index] = hints
    return detection, hints


def require_segmentation():
    if not _sam_available or _sam_predictor is None:
        raise HTTPException(status_code=503, detail="主体分割模型未加载，请检查服务器 SAM 权重配置")


def require_corrected_outline(detection, region_index):
    quality = detection.get("segmentation_quality", [])
    if not (region_index < len(quality) and quality[region_index].get("outline_ready") is True):
        raise HTTPException(status_code=422, detail="这次轮廓仍不可靠，已保留原结果；请缩紧主体框并点选主体和要排除的背景")


async def read_correction_image(file):
    try:
        content = await file.read()
        if not content:
            raise ValueError("empty image")
        return content
    except Exception as exc:
        raise HTTPException(status_code=422, detail="图片读取失败，请重新上传照片") from exc


def redraw_corrected_subject(content, detection, region_index):
    try:
        image_rgb, _, width, height = preprocess_image(content)
    except Exception as exc:
        raise HTTPException(status_code=422, detail="图片格式不支持，请重新上传照片") from exc
    segment_detections(image_rgb, [detection], width, height)
    require_corrected_outline(detection, region_index)
    return detection


def refine_corrected_subject(content, detection, region_index, manual_hints):
    """Review only the chosen crop; segment it with more image detail."""
    try:
        original = ImageOps.exif_transpose(Image.open(io.BytesIO(content))).convert("RGB")
        crop, metadata = make_subject_crop(original, detection, region_index)
    except Exception as exc:
        raise HTTPException(status_code=422, detail="无法放大该主体区域，请重新框选") from exc
    selected = detection["segmentation_regions"][region_index]
    prompt = build_refinement_prompt(detection["label"], global_geometry_to_crop_region(selected, metadata))
    answer = call_vision_api(encode_crop_jpeg(crop), prompt=prompt, max_tokens=2048)
    try:
        refinement = apply_vision_refinement(answer, detection, metadata, region_index)
        geometry = refinement["geometry"]
        region = geometry["segmentation_regions"][region_index]
        for name, flag in (("positive_points", "positive"), ("negative_points", "negative")):
            if manual_hints[flag]:
                region[name] = selected.get(name, [])
        if (manual_hints["positive"] or manual_hints["negative"]) and any(
                math.hypot(px - nx, py - ny) < 1
                for px, py in region["positive_points"] for nx, ny in region["negative_points"]):
            raise ValueError("refinement contradicts human point class")
        y1, x1, y2, x2 = region["box_2d"]
        if any(not (x1 <= x <= x2 and y1 <= y <= y2) for x, y in region["positive_points"]):
            raise ValueError("refinement contradicts human foreground")
        geometry = normalize_subject_geometry(geometry)
        detection.update(geometry)
        if refinement.get("label"):
            detection["label"] = refinement["label"]
    except (ValueError, TypeError, KeyError) as exc:
        raise HTTPException(status_code=422, detail="局部复核未确认主体或与手动点位冲突，已保留原结果；请调整框和点位") from exc

    # Preserve other regions using the full photo, then replace only the selected
    # region with its crop result. Normalized coordinates map back through metadata.
    image_rgb, _, width, height = preprocess_image(content)
    segment_detections(image_rgb, [detection], width, height)
    local = global_geometry_to_crop_region(detection["segmentation_regions"][region_index], metadata)
    local_detection = {"box_2d": local["box_2d"], "segmentation_regions": [local]}
    crop.thumbnail((1536, 1536), Image.Resampling.LANCZOS)
    segment_detections(np.array(crop), [local_detection], *crop.size)
    require_corrected_outline(local_detection, 0)
    parts = [crop_contour_to_global(ring, metadata) for ring in local_detection["shape_contours"]]
    detection["shape_contours_by_region"][region_index] = parts
    detection["segmentation_quality"][region_index] = {
        **local_detection["segmentation_quality"][0], "source": "local_crop", "outline_ready": bool(parts)}
    rings, seen = [], set()
    for region_parts in detection["shape_contours_by_region"]:
        for ring in region_parts:
            signature = tuple(map(tuple, ring))
            if signature not in seen and len(rings) < 32:
                rings.append(ring)
                seen.add(signature)
    detection["shape_contours"] = rings
    detection["shape_points"] = rings[0] if rings else []
    ready = sum(bool(quality.get("outline_ready")) for quality in detection["segmentation_quality"])
    detection["outline_status"] = "ready" if ready == len(detection["segmentation_regions"]) else "partial"
    return detection


# Cutout processing uses the same predictor and lock as legacy outlines.
CUTOUT_UPLOAD_LIMIT = 20 * 1024 * 1024
CUTOUT_SUBJECT_LIMIT = 64 * 1024
CUTOUT_REQUEST_LIMIT = 21 * 1024 * 1024
CUTOUT_HEADER_LIMIT = 8 * 1024


class CutoutMultipartLimit(MultiPartException):
    pass


class CutoutMultipartParser(MultiPartParser):
    """Route-local, bounded memory uploads; never change shared parser defaults."""
    def __init__(self, headers, stream):
        super().__init__(headers, stream, max_files=1, max_fields=1)
        # Starlette renamed max_file_size to spool_max_size; set both on this
        # instance so accepted uploads stay in memory on either interface.
        self.spool_max_size = CUTOUT_UPLOAD_LIMIT + 1
        self.max_file_size = CUTOUT_UPLOAD_LIMIT + 1
        self.max_part_size = CUTOUT_SUBJECT_LIMIT
        self.complete = False

    def on_end(self):
        self.complete = True
        super().on_end()

    def on_part_begin(self):
        super().on_part_begin()
        self._cutout_file_bytes = 0
        self._cutout_header_bytes = 0

    def _check_header_size(self, size):
        self._cutout_header_bytes += size
        if self._cutout_header_bytes > CUTOUT_HEADER_LIMIT:
            raise CutoutMultipartLimit('Multipart headers exceed 8 KiB')

    def on_header_field(self, data, start, end):
        self._check_header_size(end - start)
        super().on_header_field(data, start, end)

    def on_header_value(self, data, start, end):
        self._check_header_size(end - start)
        super().on_header_value(data, start, end)

    def on_headers_finished(self):
        super().on_headers_finished()
        part = self._current_part
        if ((part.file is not None and part.field_name != 'file')
                or (part.file is None and part.field_name != 'subject')):
            raise MultiPartException('Only one file and optional subject field are accepted')

    def on_part_data(self, data, start, end):
        size = end - start
        if self._current_part.file is not None:
            self._cutout_file_bytes += size
            if self._cutout_file_bytes > CUTOUT_UPLOAD_LIMIT:
                raise CutoutMultipartLimit('Image exceeds 20 MiB')
        elif len(self._current_part.data) + size > CUTOUT_SUBJECT_LIMIT:
            raise CutoutMultipartLimit('Subject field exceeds 64 KiB')
        super().on_part_data(data, start, end)


class CutoutRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def memory_upload(request):
            if request.headers.get('content-type', '').split(';', 1)[0].strip().lower() != 'multipart/form-data':
                return await handler(request)
            parser, form = None, None
            try:
                declared = request.headers.get('content-length')
                if declared is not None:
                    try:
                        length = int(declared)
                    except ValueError as exc:
                        raise HTTPException(400, 'Invalid content length') from exc
                    if length < 0:
                        raise HTTPException(400, 'Invalid content length')
                    if length > CUTOUT_REQUEST_LIMIT:
                        raise CutoutMultipartLimit('Request exceeds 21 MiB')
                if len(request.headers.get('content-type', '')) > CUTOUT_HEADER_LIMIT:
                    raise CutoutMultipartLimit('Multipart headers exceed 8 KiB')

                async def bounded_stream():
                    total = 0
                    async for chunk in request.stream():
                        total += len(chunk)
                        if total > CUTOUT_REQUEST_LIMIT:
                            raise CutoutMultipartLimit('Request exceeds 21 MiB')
                        yield chunk

                parser = CutoutMultipartParser(request.headers, bounded_stream())
                form = await parser.parse()
                if not parser.complete:
                    raise MultiPartException('Incomplete multipart upload')
                # FastAPI reuses this parsed form and retains the handler's
                # UploadFile/Form signature and normal validation behavior.
                request._form = form
                return await handler(request)
            except CutoutMultipartLimit as exc:
                raise HTTPException(413, exc.message) from exc
            except MultiPartException as exc:
                raise HTTPException(400, exc.message) from exc
            except (HTTPException, RequestValidationError):
                raise
            except Exception as exc:
                logger.error('Cutout upload failed: %s', type(exc).__name__)
                raise HTTPException(500, 'Unable to read cutout upload') from exc
            finally:
                if form is not None:
                    await form.close()
                if parser is not None:
                    # Also close partial uploads on older Starlette versions
                    # that only clean up MultiPartException parsing failures.
                    for upload in parser._files_to_close_on_error:
                        upload.close()

        return memory_upload


CUTOUT_PROMPT = """请从照片中选择一个最主要、最适合做透明贴纸的真实主体，只返回一个 JSON 对象。
返回字段为 found、subject、caption、theme、emotion；found 必须是布尔值。

所有框和提示点都以完整照片为基准，使用 0–1000 整数标尺：
x = 横向位置 / 照片宽度 * 1000，y = 纵向位置 / 照片高度 * 1000。
照片中心点为 [500,500]，40% 的位置写作 400。不是 0–1 比例，也不是百分比数值。
主体框及区域框的 box_2d 固定顺序是上边 y_min、左边 x_min、下边 y_max、右边 x_max（YXYX）。
每个提示点固定顺序是先横坐标 x、再纵坐标 y（XY）。不要混用这两个顺序。

subject 包含 label、box_2d、segmentation_regions。同一主体最多 8 个分离区域，每个区域都要紧贴真实主体。
每个区域的 positive_points 和 negative_points 必须是嵌套二维 JSON 数组：外层是点列表，每个点是两个数字组成的数组。
positive_points 优先只给一个确实位于真实主体内部的前景点，最多 4 个。每个前景点必须同时满足本区域框的
x_min <= x <= x_max 和 y_min <= y <= y_max，不能把盘子、托盘、底座或背景当作前景。
negative_points 只给能确定的背景点，最多 8 个，也可以是空数组 []。
不能确认前景点或背景点时，相应字段必须为 []。不要输出 null、对象、扁平数组或字符串；不要凑满点数或猜测前景。

输出前自查每个区域：坐标标尺为 0–1000、框为 YXYX、点为 XY；点列表是二维数组；
前景点数量不超过 4、背景点数量不超过 8；每个前景点都在自己的区域框内，并属于真实主体。

下面只演示合法格式和数字，主体名称、框、点和文案必须根据当前照片填写：
{"found":true,"subject":{"label":"主体名称","box_2d":[200,100,800,700],
"segmentation_regions":[{"box_2d":[200,100,800,700],"positive_points":[[400,500]],"negative_points":[]}]},
"caption":"简短文案","theme":"主题或空字符串","emotion":"情绪或空字符串"}
没有可确认的主要主体时返回 {"found":false,"subject":null,"caption":"","theme":"","emotion":""}。
只选择一个主主体，不要按检测清单第一项选择。文案使用简短纯文本。不要返回检测清单、Markdown 或解释。"""


class CutoutData(TypedDict):
    image: str
    width: int
    height: int
    original_width: int
    original_height: int
    crop_box: list
    contours: list
    subject: dict
    caption: str
    theme: str
    emotion: str
    quality: list


def identify_cutout_subject(original_rgba):
    """One primary subject, preserving the legacy raw-base64 vision contract."""
    image_b64 = encode_vision_image(original_rgba).split(',', 1)[1]
    answer = call_vision_api(image_b64, prompt=CUTOUT_PROMPT, max_tokens=4096)
    if not isinstance(answer, dict) or not isinstance(answer.get('found'), bool):
        raise CutoutError(502, 'Vision response did not identify a primary subject')
    if answer['found'] is False:
        raise CutoutError(422, 'No reliable primary subject found; select it manually')
    if not isinstance(answer.get('subject'), dict):
        raise CutoutError(502, 'Vision response must contain a subject object')
    # Subject geometry has the same 422 validation contract in both modes.
    subject = validate_cutout_subject(answer['subject'])
    try:
        meta = _cutout_metadata(answer)
    except CutoutError as exc:
        raise CutoutError(502, 'Vision response contains invalid metadata') from exc
    return subject, meta


def _cutout_metadata(value):
    meta = {}
    for name in ('caption', 'theme', 'emotion'):
        text = value.get(name, '')
        if not isinstance(text, str):
            raise CutoutError(422, 'Cutout metadata must be text')
        meta[name] = text.strip()
    return meta


def segment_cutout_masks(rgb, pixel_regions):
    """Copy every reliable region mask before releasing predictor ownership."""
    require_segmentation()
    masks, qualities = [], []
    with _sam_lock:
        _sam_predictor.set_image(rgb)
        for region in pixel_regions:
            mask, quality = predict_subject_mask(
                _sam_predictor, rgb, region['box_xyxy'], image_ready=True,
                positive_points=region['positive_points'], negative_points=region['negative_points'],
            )
            if mask is None:
                raise CutoutError(422, 'Every subject region requires a reliable mask; adjust the box or hints')
            masks.append(np.array(mask, copy=True))
            qualities.append(dict(quality))
    return masks, qualities


def build_cutout(content, subject=None) -> CutoutData:
    """Synchronous, in-memory pipeline; the route runs it on a worker thread."""
    original = decode_cutout_image(content)
    if subject is None:
        require_segmentation()
        subject, meta = identify_cutout_subject(original)
    else:
        if isinstance(subject, str):
            try:
                subject = json.loads(subject)
            except (ValueError, RecursionError) as exc:
                raise CutoutError(422, 'Subject must be valid JSON') from exc
        validated = validate_cutout_subject(subject)
        meta = _cutout_metadata(subject)
        subject = validated
    rgb, metadata, regions = prepare_cutout_crop(original, subject)
    masks, qualities = segment_cutout_masks(rgb, regions)
    mask = merge_region_masks(masks)
    return {**encode_cutout_png(original, mask, metadata), 'subject': subject,
            **meta, 'quality': qualities}


async def cutout(file: UploadFile = File(...), subject: str | None = Form(None)):
    try:
        # Read at most limit + 1 bytes, including streams that return short chunks.
        content = bytearray()
        while len(content) <= CUTOUT_UPLOAD_LIMIT:
            chunk = await file.read(min(1024 * 1024, CUTOUT_UPLOAD_LIMIT + 1 - len(content)))
            if not chunk:
                break
            content.extend(chunk)
        if len(content) > CUTOUT_UPLOAD_LIMIT:
            raise CutoutError(413, 'Image exceeds 20 MiB')
        result = await run_in_threadpool(build_cutout, bytes(content), subject)
        return {'status': 'success', 'data': result}
    except CutoutError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.error('Cutout processing failed: %s', type(exc).__name__)
        raise HTTPException(status_code=500, detail='Cutout processing failed; please try again') from exc


app.router.add_api_route('/api/cutout', cutout, methods=['POST'], route_class_override=CutoutRoute)


@app.post("/api/segment")
async def correct_subject(file: UploadFile = File(...), subject: str = Form(...), region_index: int = Form(0)):
    detection, _ = parse_correction_subject(subject, region_index)
    require_segmentation()
    content = await read_correction_image(file)
    updated = await run_in_threadpool(redraw_corrected_subject, content, detection, region_index)
    return {"status": "success", "data": updated}


@app.post("/api/refine")
async def refine_subject(file: UploadFile = File(...), subject: str = Form(...), region_index: int = Form(0)):
    detection, hints = parse_correction_subject(subject, region_index)
    require_segmentation()
    content = await read_correction_image(file)
    updated = await run_in_threadpool(refine_corrected_subject, content, detection, region_index, hints)
    return {"status": "success", "data": updated}


@app.get("/health")
async def health():
    return {"status": "ok", "sam_loaded": _sam_available, "api_configured": bool(API_KEY)}


# ─── 前端静态文件挂载（必须在所有 API 路由之后）──────────────

DIST_DIR = os.path.join(os.path.dirname(__file__), "dist")


@app.get("/{catchall:path}")
async def serve_frontend(catchall: str):
    file_path = os.path.join(DIST_DIR, catchall)
    if os.path.isfile(file_path):
        return FileResponse(file_path)
    return FileResponse(os.path.join(DIST_DIR, "index.html"))
