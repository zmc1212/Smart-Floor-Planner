from pathlib import Path

from PIL import Image
from reportlab.lib.colors import HexColor, white
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject


ROOT = Path(r"G:\workspace\向总\Smart-Floor-Planner")
OUT = ROOT / "output" / "pdf" / "家客来-产品说明书-内容优化版-16比9横版-2026-08.pdf"
OUT.parent.mkdir(parents=True, exist_ok=True)

FONT = r"C:\Windows\Fonts\NotoSansSC-VF.ttf"
pdfmetrics.registerFont(TTFont("NotoSC", FONT))
pdfmetrics.registerFont(TTFont("NotoSC-Bold", FONT))

W, H = 1920, 1080
GREEN = HexColor("#22C55E")
DEEP = HexColor("#14342A")
INK = HexColor("#17352C")
MUTED = HexColor("#63756E")
PALE = HexColor("#EAF8EC")
LINE = HexColor("#D6E5DB")
BLUE = HexColor("#3B82F6")
ORANGE = HexColor("#F59E0B")
PURPLE = HexColor("#8B5CF6")


def asset(path):
    return ROOT / path


def rect(c, x, y, w, h, fill, radius=0, stroke=None):
    c.setFillColor(fill)
    c.setStrokeColor(stroke or fill)
    if radius:
        c.roundRect(x, y, w, h, radius, stroke=1 if stroke else 0, fill=1)
    else:
        c.rect(x, y, w, h, stroke=1 if stroke else 0, fill=1)


def text(c, value, x, y, size=30, color=INK, bold=False, leading=None):
    font = "NotoSC-Bold" if bold else "NotoSC"
    c.setFillColor(color)
    c.setFont(font, size)
    if "\n" not in value:
        c.drawString(x, y, value)
        return
    block = c.beginText(x, y)
    block.setFont(font, size)
    block.setFillColor(color)
    block.setLeading(leading or size * 1.35)
    for line in value.split("\n"):
        block.textLine(line)
    c.drawText(block)


def wrap(c, value, x, y, width, size=24, color=MUTED, leading=36, bold=False, max_lines=None):
    font = "NotoSC-Bold" if bold else "NotoSC"
    c.setFont(font, size)
    lines, line = [], ""
    for char in value:
        candidate = line + char
        if line and c.stringWidth(candidate, font, size) > width:
            lines.append(line)
            line = char
        else:
            line = candidate
    if line:
        lines.append(line)
    if max_lines:
        lines = lines[:max_lines]
    block = c.beginText(x, y)
    block.setFont(font, size)
    block.setFillColor(color)
    block.setLeading(leading)
    for line in lines:
        block.textLine(line)
    c.drawText(block)


def draw_cover(c, path, x, y, width, height, position="center"):
    image = Image.open(path)
    iw, ih = image.size
    scale = max(width / iw, height / ih)
    nw, nh = iw * scale, ih * scale
    px = x + (width - nw) / 2
    py = y + (height - nh) / 2
    if position == "top":
        py = y + height - nh
    c.saveState()
    clip = c.beginPath()
    clip.rect(x, y, width, height)
    c.clipPath(clip, stroke=0, fill=0)
    c.drawImage(ImageReader(image), px, py, nw, nh, mask="auto")
    c.restoreState()


def draw_contain(c, path, x, y, width, height):
    image = Image.open(path)
    iw, ih = image.size
    scale = min(width / iw, height / ih)
    nw, nh = iw * scale, ih * scale
    c.drawImage(ImageReader(image), x + (width - nw) / 2, y + (height - nh) / 2, nw, nh, mask="auto")


def page_header(c, number, heading, subtitle):
    rect(c, 82, 984, 10, 10, GREEN, 5)
    text(c, f"{number:02d} / 产品说明", 112, 970, 18, GREEN, True)
    text(c, heading, 82, 854, 54, INK, True)
    wrap(c, subtitle, 82, 792, 1480, 24, MUTED, 36, max_lines=2)


def page_footer(c, number):
    c.setStrokeColor(LINE)
    c.setLineWidth(1)
    c.line(82, 54, W - 82, 54)
    text(c, "家客来 JIAKELAI", 82, 24, 15, MUTED, True)
    text(c, f"{number:02d}", W - 122, 24, 17, GREEN, True)


def card(c, x, y, w, h, number, heading, body, color=GREEN):
    rect(c, x, y, w, h, white, 20, LINE)
    rect(c, x + 26, y + h - 72, 58, 46, color, 14)
    text(c, number, x + 41, y + h - 58, 18, white, True)
    text(c, heading, x + 26, y + h - 126, 29, INK, True)
    wrap(c, body, x + 26, y + h - 174, w - 52, 20, MUTED, 31)


def feature(c, x, y, number, heading, body, color=GREEN, width=580):
    rect(c, x, y - 8, 56, 56, color, 17)
    text(c, number, x + 14, y + 10, 19, white, True)
    text(c, heading, x + 78, y + 11, 28, INK, True)
    wrap(c, body, x + 78, y - 30, width - 78, 19, MUTED, 29, max_lines=3)


def note(c, heading, body, x=82, y=102, w=1756, color=PALE):
    rect(c, x, y, w, 128, color, 20)
    text(c, heading, x + 34, y + 78, 24, GREEN, True)
    wrap(c, body, x + 34, y + 38, w - 68, 19, INK, 28, max_lines=2)


def phone(c, path, x, y, w, h):
    rect(c, x - 10, y - 10, w + 20, h + 20, white, 24, LINE)
    draw_contain(c, path, x, y, w, h)


def label(c, x, y, number, heading, color=GREEN):
    rect(c, x, y - 8, 56, 56, color, 17)
    text(c, number, x + 14, y + 10, 19, white, True)
    text(c, heading, x + 78, y + 11, 27, INK, True)


def cover(c):
    draw_cover(c, asset("miniprogram/images/generated-hero-bleed-v2.png"), 0, 0, W, H)
    c.setFillColor(HexColor("#09271C"))
    c.setFillAlpha(0.82)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setFillAlpha(1)
    rect(c, 86, 954, 11, 11, GREEN, 5)
    text(c, "家客来 JIAKELAI", 116, 940, 22, white, True)
    text(c, "把客户、量房和设计，\n放进同一条业务链路", 86, 700, 78, white, True, 106)
    wrap(c, "面向家装团队的客户项目、正式量房、AI 设计与经营协作工作台。", 90, 480, 900, 30, HexColor("#DDF7E4"), 44)
    rect(c, 90, 270, 770, 116, HexColor("#1F4938"), 18)
    text(c, "小程序业务端 + 管理后台", 126, 330, 25, white, True)
    text(c, "客户项目 / 正式量房 / AI 方案 / 团队协作", 126, 292, 19, HexColor("#BFE4CC"))
    text(c, "产品说明书 · 16:9 演示版", 90, 72, 19, HexColor("#BFE4CC"), True)
    text(c, "2026.08", W - 200, 72, 19, HexColor("#BFE4CC"), True)
    c.showPage()


def journey(c):
    page_header(c, 1, "家装项目为什么需要一条统一的数据链路", "客户信息、现场尺寸、设计方案和团队跟进一旦分散，项目就容易反复确认。家客来用同一份客户档案和正式户型承接后续工作。")
    items = [
        ("01", "线索不丢", "客户、房屋和需求进入统一档案，后续量房、设计与跟进都有明确入口。", GREEN),
        ("02", "尺寸可信", "墙体、门窗、空间和测量记录沉淀为正式户型，减少重复转述与二次录入。", BLUE),
        ("03", "方案有据", "AI 设计从已完成的正式户型和客户目标出发，方案更容易解释和继续优化。", ORANGE),
        ("04", "协作可追", "不同角色围绕同一项目查看任务、进展与经营记录，下一步更清楚。", PURPLE),
    ]
    for i, item in enumerate(items):
        card(c, 82 + i * 450, 334, 410, 350, *item)
    text(c, "核心不是多一个工具，而是少一次信息断点。", 82, 262, 30, INK, True)
    wrap(c, "客户档案是项目入口，正式户型是空间依据，设计结果和团队跟进继续回到项目中。业务过程因此可以被查看、延续和管理。", 82, 214, 1580, 21, MUTED, 31)
    page_footer(c, 1)
    c.showPage()


def roles(c):
    page_header(c, 2, "为一线执行者和经营管理者各自提供工作台", "不同岗位使用同一套项目数据，但只处理与自己职责相关的客户、户型、任务和经营信息。")
    scene = asset("miniprogram/images/home-ip-v1/hero-scene-wechat-safe-overscan.png")
    rect(c, 1140, 246, 650, 510, white, 28, LINE)
    draw_cover(c, scene, 1160, 266, 610, 470)
    feature(c, 82, 650, "A", "量房师", "接收或创建项目，进入唯一正式量房入口，手工录入或连接已授权的兼容测距设备。", GREEN, 900)
    feature(c, 82, 500, "B", "设计师", "从有权限的客户与正式户型发起整屋或单空间设计，查看结果并继续优化。", BLUE, 900)
    feature(c, 82, 350, "C", "推广与管理", "推广人员跟进企业报备；管理者在后台维护成员、客户、户型、配置与运营流程。", ORANGE, 900)
    note(c, "角色不同，项目上下文保持一致", "权限和可见范围由企业及员工身份控制。团队成员围绕同一个客户项目协作，不需要各自维护一份互不相通的资料。")
    page_footer(c, 2)
    c.showPage()


def foundation(c):
    page_header(c, 3, "从客户线索到正式户型，先建立可信的项目底座", "量房从客户项目进入，以毫米制墙体图保存，继续服务查看、导出和 AI 设计。")
    hero = asset("design-references/surveying/surveying-editor-v3.png")
    if not hero.exists():
        hero = asset("miniprogram/images/home-v5/plan-preview.jpg")
    rect(c, 1090, 246, 700, 510, white, 28, LINE)
    draw_cover(c, hero, 1110, 266, 660, 470)
    feature(c, 82, 650, "01", "项目先建档", "记录客户、小区、面积与需求，建立量房、设计和后续跟进共同使用的项目入口。", GREEN, 850)
    feature(c, 82, 500, "02", "现场形成正式户型", "以毫米为单位绘制墙体、门窗和封闭空间；支持手工输入及已授权兼容设备读数。", BLUE, 850)
    feature(c, 82, 350, "03", "成果回到云端项目", "保存后可继续量房、查看项目，并作为后台 2D/3D、DXF 和 AI 设计的空间依据。", ORANGE, 850)
    note(c, "一份正式户型，多处复用", "正式户型采用统一墙图数据。查看、导出、3D 与 AI 等能力从这份数据派生，不再为不同工具维护多份互相偏离的户型副本。")
    page_footer(c, 3)
    c.showPage()


def ai_intro(c):
    page_header(c, 4, "AI 设计不是孤立生图，而是项目的下一步", "设计任务关联客户、正式户型和目标空间，结果回到项目中继续查看、比较、分享与优化。")
    rect(c, 1090, 246, 700, 510, white, 28, LINE)
    draw_cover(c, asset("miniprogram/images/generated-hero-bleed-v2.png"), 1110, 266, 660, 470)
    feature(c, 82, 650, "01", "先确认空间依据", "选择当前角色可见、已经完成且包含有效封闭空间的正式户型。", GREEN, 850)
    feature(c, 82, 500, "02", "再明确创作目标", "选择整屋或单个空间，补充参考图、风格和本次沟通重点。", ORANGE, 850)
    feature(c, 82, 350, "03", "结果持续沉淀", "任务进度、生成结果和历史记录集中呈现，支持保存、比较、分享与继续优化。", BLUE, 850)
    note(c, "使用前提要明确", "AI 设计需要企业已开通相应能力、具备可用点数和服务配置。户型不完整、没有封闭空间或无权限时，不创建任务。")
    page_footer(c, 4)
    c.showPage()


def collaboration(c):
    page_header(c, 5, "同一项目，不同角色都能看到自己的下一步", "协作不是把所有功能堆给每个人，而是让量房、设计、推广和管理在权限范围内接续完成工作。")
    rect(c, 1120, 246, 670, 510, white, 28, LINE)
    draw_contain(c, asset("miniprogram/images/leads-ip-v1/client-concierge-scene.png"), 1145, 270, 620, 460)
    feature(c, 82, 650, "A", "项目流转", "客户阶段统一为新线索、量房中、方案设计、已签约；已关闭作为终止状态单独查看。", GREEN, 870)
    feature(c, 82, 500, "B", "任务与提醒", "企业报备、待办和通知把关键进展带回对应工作页面，减少依赖口头转达。", PURPLE, 870)
    feature(c, 82, 350, "C", "经营记录", "推广、获客确认和提成记录按角色呈现；小程序提供查询，结算以企业订单及后台流程为准。", ORANGE, 870)
    note(c, "协作建立在权限边界之内", "企业数据按租户隔离，普通员工仅访问自己被授权的客户、户型和任务；管理员在企业范围内完成分配与管理。")
    page_footer(c, 5)
    c.showPage()


def admin(c):
    page_header(c, 6, "小程序跑现场，管理后台看全局", "业务端服务高频执行，管理端负责组织、配置、审核和数据查看，两端共享企业与项目上下文。")
    items = [
        ("01", "组织与权限", "维护企业成员、岗位与菜单权限，让每个角色只看到需要处理的工作。", GREEN),
        ("02", "客户与户型资产", "集中查看客户和正式户型；完整户型可按支持情况查看 2D/3D 并下载 DXF。", BLUE),
        ("03", "AI 与服务配置", "管理 AI 能力、点数、素材及外部服务配置，并查看任务和使用记录。", ORANGE),
        ("04", "业务与运营", "处理报备分配、通知提醒、订单提成和平台运营等后台流程。", PURPLE),
    ]
    positions = [(82, 500), (970, 500), (82, 260), (970, 260)]
    for (x, y), item in zip(positions, items):
        card(c, x, y, 800, 190, *item)
    note(c, "两端分工，不重复建档", "现场产生的客户、正式户型、测量记录和设计任务进入同一企业数据范围；管理人员无需重新收集一套脱离现场的资料。", y=94)
    page_footer(c, 6)
    c.showPage()


def overview(c):
    page_header(c, 7, "四个工作面，共同完成一条业务主线", "下面用真实页面说明项目工作台、现场量房、AI 设计和经营协作分别解决什么问题，以及它们如何接续。")
    items = [
        ("01", "项目工作台", "客户、户型、进度与下一步动作汇在同一个项目视角。", GREEN),
        ("02", "测量编辑器", "墙体、开口、尺寸、空间闭合与设备读数服务于正式户型。", BLUE),
        ("03", "设计创作", "灵感、风格、方案、结果与继续优化，围绕客户项目持续推进。", ORANGE),
        ("04", "经营协作", "线索、推广、通知、获客确认和提成记录，让团队协作更有节奏。", PURPLE),
    ]
    for i, item in enumerate(items):
        card(c, 82 + i * 450, 328, 410, 356, *item)
    note(c, "先建立项目，再沉淀户型，然后设计与协作", "四个工作面不是并列菜单：项目工作台承接客户，正式量房形成空间依据，AI 设计输出方案，经营协作推动任务和结果继续流转。", y=120)
    page_footer(c, 7)
    c.showPage()


def screenshot_page(c, number, heading, subtitle, screens, features, note_heading, note_body):
    page_header(c, number, heading, subtitle)
    count = len(screens)
    screen_w = 250 if count == 3 else 360
    screen_h = 470
    gap = 210 if count == 3 else 180
    total = count * screen_w + (count - 1) * gap
    start_x = (W - total) / 2
    for i, path in enumerate(screens):
        phone(c, asset(path), start_x + i * (screen_w + gap), 310, screen_w, screen_h)
    if features:
        label(c, 82, 242, features[0][0], features[0][1], features[0][3])
        label(c, 970, 242, features[1][0], features[1][1], features[1][3])
    note(c, note_heading, note_body, y=76)
    page_footer(c, number)
    c.showPage()


def project(c):
    screenshot_page(
        c, 8, "01  项目工作台：从客户信息找到下一步",
        "首页、客户列表与客户详情逐层连接线索、正式户型和项目进度，帮助业务人员快速回到正在推进的工作。",
        ["design-references/all-pages-ip-v1/01-home-v2.png", "design-references/all-pages-ip-v1/02-leads-management.png", "design-references/all-pages-ip-v1/08-lead-detail.png"],
        [("A", "项目一览", "首页汇集近期项目与户型进度，随时进入量房、设计或客户跟进。", GREEN), ("B", "客户四阶段", "新建线索、量房中、设计方案、已签约提供统一筛选和下一步判断。", BLUE)],
        "可用能力", "客户档案集中记录姓名、电话、小区、面积与偏好，并关联正式户型和后续服务。通过搜索和阶段筛选，快速找到正在推进的项目。"
    )


def survey(c):
    screenshot_page(
        c, 9, "02  现场量房：把一条墙链变成正式户型",
        "现场围绕下一个点、当前尺寸、空间闭合、墙体编辑和门窗开口展开；手工或设备读数最终都进入同一份正式测量成果。",
        ["design-references/surveying/v8/surveying-state-02-preview-length-input-v8.png", "design-references/surveying/v8/surveying-state-05-opening-selected-v8.png", "design-references/surveying/v8/surveying-state-10-space-closed-v8.png"],
        [("01", "量与画同步", "以毫米为单位记录与修正墙体尺寸，门窗与空间关系在图纸中清晰呈现。", GREEN), ("02", "工具按时机出现", "选中墙体后可复测、继续墙链或编辑开口；引导层只辅助现场操作。", BLUE)],
        "让现场测量更顺手", "无需设备也可手工录入；使用蓝牙时，设备必须已分配并通过授权校验。首次云端保存前的有效读数会在保存成功后补写测量审计。"
    )


def ai_detail(c):
    screenshot_page(
        c, 10, "03  AI 设计：从明确目标到持续优化",
        "从客户项目中选择完整户型或单个空间，再补充参考图与风格；任务、结果和历史记录持续保留在设计工作台。",
        ["design-references/all-pages-ip-v3/14-ai-design-create-v3.png", "design-references/all-pages-ip-v3/15-ai-design-result-v3.png", "design-references/all-pages-ip-v3/16-ai-design-history-v3.png"],
        [("A", "四类创作方式", "参考图复刻、整屋风格、户型概念渲染与软装优化，对应不同沟通目标。", GREEN), ("B", "方案持续进化", "从上传素材到查看结果，从保存分享再到继续优化。", ORANGE)],
        "设计成果，沉淀在项目中", "生成结果用于概念表达与客户沟通，不替代施工图或工程交付。创建任务前，系统会再次校验企业权限、点数和正式户型资格。"
    )


def operations(c):
    screenshot_page(
        c, 11, "04  经营协作：让报备、任务和记录连续流转",
        "推广、设计、量房与管理角色在各自权限范围内处理企业报备、任务分配、客户跟进、通知和经营记录。",
        ["design-references/all-pages-ip-v1/09-promotion-records.png", "design-references/all-pages-ip-v1/12-commission-records.png", "design-references/all-pages-ip-v1/05-mine.png"],
        [("01", "推广协同", "企业报备支持创建、搜索、公海认领、分配、跟进、到期提醒与冲突归属。", PURPLE), ("02", "获客确认与提成", "提成记录按待结算、已结算和已作废状态查询。", ORANGE)],
        "重要进展，及时看见", "操作入口由员工角色和服务端工作流状态决定。小程序中的提成页面为只读查询，最终结算由企业订单和后台流程完成。"
    )


def start(c):
    page_header(c, 12, "首次演示：用一个真实项目验证完整闭环", "先完成账号、角色与服务配置，再用一条真实客户线索走通量房、设计和协作，避免只展示彼此孤立的页面。")
    steps = [
        ("01", "准备企业与角色", "确认账号、企业归属和岗位权限；按需配置 AI、通知和设备。", GREEN),
        ("02", "建立客户项目", "创建真实客户线索，补齐客户、小区、面积与需求。", BLUE),
        ("03", "完成正式量房", "形成至少一个有效封闭空间并保存到云端。", ORANGE),
        ("04", "发起一次 AI 设计", "检查任务、结果与历史记录是否完整。", PURPLE),
        ("05", "验证协作闭环", "切换角色检查可见性、待办、后台和经营记录。", GREEN),
    ]
    for i, item in enumerate(steps):
        card(c, 82 + i * 360, 316, 324, 374, *item)
    note(c, "闭环验收标准", "同一客户项目下能连续看到客户信息、正式户型、设计任务和角色跟进；受限能力应明确提示配置、权限或数据条件，而不是显示为无条件可用。", y=120)
    page_footer(c, 12)
    c.showPage()


def back(c):
    rect(c, 0, 0, W, H, DEEP)
    logo = asset("miniprogram/images/home-ip-v1/brand-logo.png")
    if logo.exists():
        draw_contain(c, logo, 96, 850, 250, 100)
    text(c, "从一条客户线索开始，\n让每一步都有依据。", 96, 650, 72, white, True, 100)
    rect(c, 96, 458, 520, 7, GREEN, 3)
    wrap(c, "家客来连接客户项目、现场测量、设计表达与团队协作，帮助家装团队围绕同一份正式户型持续推进业务。", 96, 388, 930, 27, HexColor("#CDE7D6"), 41)
    text(c, "家客来 JIAKELAI", 96, 82, 20, HexColor("#BFE4CC"), True)
    text(c, "PRODUCT GUIDE / 16:9 / 2026.08", 96, 48, 16, HexColor("#7FB590"))
    c.showPage()


def main():
    pdf = canvas.Canvas(str(OUT), pagesize=(W, H), pageCompression=1)
    pdf.setTitle("家客来 产品说明书 16:9 横版")
    pdf.setAuthor("家客来")
    cover(pdf)
    journey(pdf)
    roles(pdf)
    foundation(pdf)
    ai_intro(pdf)
    collaboration(pdf)
    admin(pdf)
    overview(pdf)
    project(pdf)
    survey(pdf)
    ai_detail(pdf)
    operations(pdf)
    start(pdf)
    back(pdf)
    pdf.save()

    temp = OUT.with_suffix(".fullscreen.pdf")
    reader = PdfReader(str(OUT))
    writer = PdfWriter()
    writer.append_pages_from_reader(reader)
    writer.add_metadata(reader.metadata or {})
    writer._root_object.update({
        NameObject("/PageMode"): NameObject("/FullScreen"),
        NameObject("/PageLayout"): NameObject("/SinglePage"),
    })
    with temp.open("wb") as handle:
        writer.write(handle)
    temp.replace(OUT)
    print(OUT)


if __name__ == "__main__":
    main()
