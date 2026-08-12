from pathlib import Path
from reportlab.lib.colors import HexColor, white
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from PIL import Image


ROOT = Path(r"G:\workspace\向总\Smart-Floor-Planner")
OUT = ROOT / "output" / "pdf" / "家客来-产品说明书-内容优化版-2026-08.pdf"
OUT.parent.mkdir(parents=True, exist_ok=True)

FONT = r"C:\Windows\Fonts\NotoSansSC-VF.ttf"
FONT_BOLD = r"C:\Windows\Fonts\NotoSansSC-VF.ttf"
pdfmetrics.registerFont(TTFont("NotoSC", FONT))
pdfmetrics.registerFont(TTFont("NotoSC-Bold", FONT_BOLD))

W, H = 1440, 1920
GREEN = HexColor("#22C55E")
DEEP = HexColor("#14342A")
INK = HexColor("#17352C")
MUTED = HexColor("#63756E")
PALE = HexColor("#EAF8EC")
LINE = HexColor("#D6E5DB")
YELLOW = HexColor("#FFC857")
BLUE = HexColor("#3B82F6")
ORANGE = HexColor("#F59E0B")


def asset(path):
    return ROOT / path


def draw_image_cover(c, path, x, y, width, height, alpha=1.0):
    im = Image.open(path)
    iw, ih = im.size
    scale = max(width / iw, height / ih)
    nw, nh = iw * scale, ih * scale
    px, py = x + (width - nw) / 2, y + (height - nh) / 2
    c.saveState()
    c.rect(x, y, width, height, stroke=0, fill=0)
    c.clipPath(c.beginPath(), stroke=0, fill=0)
    if alpha < 1:
        c.setFillAlpha(alpha)
    c.drawImage(ImageReader(im), px, py, nw, nh, mask="auto")
    c.restoreState()


def rect(c, x, y, w, h, fill, r=0, stroke=None):
    c.setFillColor(fill)
    c.setStrokeColor(stroke or fill)
    if r:
        c.roundRect(x, y, w, h, r, stroke=1 if stroke else 0, fill=1)
    else:
        c.rect(x, y, w, h, stroke=1 if stroke else 0, fill=1)


def text(c, value, x, y, size=30, color=INK, bold=False, leading=None):
    c.setFillColor(color)
    c.setFont("NotoSC-Bold" if bold else "NotoSC", size)
    if "\n" in value:
        t = c.beginText(x, y)
        t.setFont("NotoSC-Bold" if bold else "NotoSC", size)
        t.setFillColor(color)
        t.setLeading(leading or size * 1.45)
        for line in value.split("\n"):
            t.textLine(line)
        c.drawText(t)
    else:
        c.drawString(x, y, value)


def wrap(c, value, x, y, width, size=26, color=MUTED, leading=40, bold=False):
    c.setFont("NotoSC-Bold" if bold else "NotoSC", size)
    words, lines, line = list(value), [], ""
    for char in words:
        candidate = line + char
        if c.stringWidth(candidate, "NotoSC-Bold" if bold else "NotoSC", size) > width and line:
            lines.append(line)
            line = char
        else:
            line = candidate
    if line:
        lines.append(line)
    c.setFillColor(color)
    t = c.beginText(x, y)
    t.setFont("NotoSC-Bold" if bold else "NotoSC", size)
    t.setLeading(leading)
    for line in lines:
        t.textLine(line)
    c.drawText(t)
    return y - len(lines) * leading


def page_num(c, n, label="家客来 JIAKELAI"):
    c.setStrokeColor(LINE)
    c.line(96, 74, W - 96, 74)
    text(c, label, 96, 40, 16, MUTED, True)
    text(c, f"{n:02d}", W - 140, 40, 18, GREEN, True)


def eyebrow(c, label, x=96, y=1740):
    rect(c, x, y - 11, 10, 10, GREEN, 5)
    text(c, label.upper(), x + 26, y - 18, 18, GREEN, True)


def title(c, heading, sub, n, sub_width=960):
    eyebrow(c, f"{n:02d} / 产品说明")
    text(c, heading, 96, 1580, 62, INK, True, 82)
    wrap(c, sub, 96, 1460, sub_width, 27, MUTED, 44)


def feature(c, x, y, number, heading, body, color=GREEN):
    rect(c, x, y - 8, 64, 64, color, 20)
    text(c, number, x + 17, y + 12, 23, white, True)
    text(c, heading, x + 88, y + 18, 31, INK, True)
    wrap(c, body, x + 88, y - 28, 440, 22, MUTED, 34)


def bullet(c, x, y, heading, body, color=GREEN):
    rect(c, x, y + 5, 14, 14, color, 7)
    text(c, heading, x + 30, y, 25, INK, True)
    wrap(c, body, x + 30, y - 38, 525, 21, MUTED, 31)


def device_frame(c, image_path, x, y, w, h):
    rect(c, x - 16, y - 16, w + 32, h + 32, white, 42)
    c.setStrokeColor(HexColor("#D9E7DE"))
    c.setLineWidth(4)
    c.roundRect(x - 16, y - 16, w + 32, h + 32, 42, stroke=1, fill=0)
    draw_image_cover(c, image_path, x, y, w, h)


def cover(c):
    rect(c, 0, 0, W, H, DEEP)
    hero = asset("miniprogram/images/generated-hero-bleed-v2.png")
    draw_image_cover(c, hero, 0, 0, W, H)
    c.setFillColor(HexColor("#0A241A"))
    c.setFillAlpha(0.78)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setFillAlpha(1)
    rect(c, 96, 1678, 12, 12, GREEN, 6)
    text(c, "家客来 JIAKELAI", 126, 1660, 23, white, True)
    text(c, "把客户、量房和设计，\n放进同一条业务链路", 96, 1320, 92, white, True, 132)
    wrap(c, "面向家装团队的客户项目、正式量房、AI 设计与经营协作工作台。", 96, 1070, 820, 32, HexColor("#DDF7E4"), 50)
    rect(c, 96, 770, 636, 126, HexColor("#1F4938"), 20)
    text(c, "小程序业务端 + 管理后台", 132, 836, 28, white, True)
    text(c, "客户项目 / 正式量房 / AI 方案 / 团队协作", 132, 796, 21, HexColor("#BFE4CC"))
    text(c, "产品说明书", 96, 182, 24, HexColor("#BFE4CC"), True)
    text(c, "2026.08", W - 245, 182, 24, HexColor("#BFE4CC"), True)
    c.showPage()


def journey(c):
    title(c, "家装项目为什么需要一条统一的数据链路", "客户信息、现场尺寸、设计方案和团队跟进一旦分散，项目就容易反复确认。家客来用同一份客户档案和正式户型承接后续工作。", 1)
    stages = [
        ("01", "线索不丢", "客户、房屋和需求进入统一档案，后续量房、设计与跟进都有明确入口。", GREEN),
        ("02", "尺寸可信", "墙体、门窗、空间和测量记录沉淀为正式户型，减少重复转述与二次录入。", BLUE),
        ("03", "方案有据", "AI 设计从已完成的正式户型和客户目标出发，方案更容易解释和继续优化。", ORANGE),
        ("04", "协作可追", "不同角色围绕同一项目查看任务、进展与经营记录，下一步更清楚。", HexColor("#8B5CF6")),
    ]
    for i, (no, head, body, color) in enumerate(stages):
        x = 96 + i * 322
        rect(c, x, 860, 282, 410, white, 24)
        c.setStrokeColor(LINE); c.roundRect(x, 860, 282, 410, 24, stroke=1, fill=0)
        rect(c, x + 28, 1170, 74, 74, color, 22)
        text(c, no, x + 48, 1194, 23, white, True)
        text(c, head, x + 28, 1106, 33, INK, True)
        wrap(c, body, x + 28, 1048, 222, 21, MUTED, 34)
        if i < 3:
            c.setStrokeColor(HexColor("#A8DDB4")); c.setLineWidth(3); c.line(x + 286, 1065, x + 318, 1065)
    text(c, "核心不是多一个工具，而是少一次信息断点。", 96, 700, 32, INK, True)
    wrap(c, "客户档案是项目入口，正式户型是空间依据，设计结果和团队跟进继续回到项目中。业务过程因此可以被查看、延续和管理。", 96, 640, 1060, 25, MUTED, 41)
    page_num(c, 1)
    c.showPage()


def home_and_leads(c):
    title(c, "为一线执行者和经营管理者各自提供工作台", "不同岗位使用同一套项目数据，但只处理与自己职责相关的客户、户型、任务和经营信息。", 2)
    device_frame(c, asset("miniprogram/images/home-ip-v1/hero-scene-wechat-safe-overscan.png"), 845, 820, 400, 610)
    feature(c, 96, 1230, "A", "量房师", "接收或创建项目，进入唯一正式量房入口，手工录入或连接已授权的兼容测距设备。")
    feature(c, 96, 1000, "B", "设计师", "从有权限的客户与正式户型发起整屋或单空间设计，查看结果并继续优化。", BLUE)
    feature(c, 96, 770, "C", "推广与管理", "推广人员跟进企业报备；管理者在后台维护成员、客户、户型、配置与运营流程。", ORANGE)
    rect(c, 96, 430, 1140, 172, PALE, 22)
    text(c, "角色不同，项目上下文保持一致", 132, 540, 25, GREEN, True)
    wrap(c, "权限和可见范围由企业及员工身份控制。团队成员围绕同一个客户项目协作，不需要各自维护一份互不相通的资料。", 132, 492, 990, 22, INK, 33)
    page_num(c, 2)
    c.showPage()


def surveying(c):
    title(c, "从客户线索到正式户型，先建立可信的项目底座", "量房从客户项目进入，以毫米制墙体图保存，继续服务查看、导出和 AI 设计。", 3, 610)
    hero = asset("design-references/surveying/surveying-editor-v3.png")
    if not hero.exists():
        hero = asset("miniprogram/images/home-v5/plan-preview.jpg")
    device_frame(c, hero, 826, 735, 430, 760)
    bullet(c, 96, 1260, "项目先建档", "记录客户、小区、面积与需求，建立量房、设计和后续跟进共同使用的项目入口。")
    bullet(c, 96, 1020, "现场形成正式户型", "以毫米为单位绘制墙体、门窗和封闭空间；支持手工输入及已授权兼容设备读数。", BLUE)
    bullet(c, 96, 780, "成果回到云端项目", "保存后可继续量房、查看项目，并作为后台 2D/3D、DXF 和 AI 设计的空间依据。", ORANGE)
    rect(c, 96, 420, 1120, 188, HexColor("#F8FBF8"), 22, LINE)
    text(c, "一份正式户型，多处复用", 132, 538, 24, INK, True)
    wrap(c, "正式户型采用统一墙图数据。查看、导出、3D 与 AI 等能力从这份数据派生，不再为不同工具维护多份互相偏离的户型副本。", 132, 490, 990, 22, MUTED, 34)
    page_num(c, 3)
    c.showPage()


def ai(c):
    title(c, "AI 设计不是孤立生图，而是项目的下一步", "设计任务关联客户、正式户型和目标空间，结果回到项目中继续查看、比较、分享与优化。", 4)
    device_frame(c, asset("miniprogram/images/generated-hero-bleed-v2.png"), 790, 875, 470, 560)
    feature(c, 96, 1230, "01", "先确认空间依据", "选择当前角色可见、已经完成且包含有效封闭空间的正式户型。")
    feature(c, 96, 990, "02", "再明确创作目标", "选择整屋或单个空间，补充参考图、风格和本次沟通重点。", ORANGE)
    feature(c, 96, 750, "03", "结果持续沉淀", "任务进度、生成结果和历史记录集中呈现，支持保存、比较、分享与继续优化。", BLUE)
    rect(c, 96, 430, 1140, 172, PALE, 22)
    text(c, "使用前提要明确", 132, 540, 25, GREEN, True)
    wrap(c, "AI 设计需要企业已开通相应能力、具备可用点数和服务配置。户型不完整、没有封闭空间或无权限时，只提示返回正式量房完善资料，不创建任务。", 132, 492, 1000, 22, INK, 33)
    page_num(c, 4)
    c.showPage()


def collaboration(c):
    title(c, "同一项目，不同角色都能看到自己的下一步", "协作不是把所有功能堆给每个人，而是让量房、设计、推广和管理在权限范围内接续完成工作。", 5)
    device_frame(c, asset("miniprogram/images/leads-ip-v1/client-concierge-scene.png"), 814, 860, 420, 560)
    feature(c, 96, 1260, "A", "项目流转", "客户阶段统一为新线索、量房中、方案设计、已签约；已关闭作为终止状态单独查看。")
    feature(c, 96, 1020, "B", "任务与提醒", "企业报备、待办和通知把关键进展带回对应工作页面，减少依赖口头转达。", HexColor("#8B5CF6"))
    feature(c, 96, 780, "C", "经营记录", "推广、获客确认和提成记录按角色呈现；小程序提供查询，结算以企业订单及后台流程为准。", ORANGE)
    rect(c, 96, 430, 1130, 176, HexColor("#F8FBF8"), 22, LINE)
    text(c, "协作建立在权限边界之内", 132, 542, 24, INK, True)
    wrap(c, "企业数据按租户隔离，普通员工仅访问自己被授权的客户、户型和任务；管理员在企业范围内完成分配与管理。", 132, 494, 990, 22, MUTED, 34)
    page_num(c, 5)
    c.showPage()


def admin(c):
    title(c, "小程序跑现场，管理后台看全局", "业务端服务高频执行，管理端负责组织、配置、审核和数据查看，两端共享企业与项目上下文。", 6)
    features = [
        ("组织与权限", "维护企业成员、岗位与菜单权限，让每个角色只看到需要处理的工作。", GREEN),
        ("客户与户型资产", "集中查看客户和正式户型；完整户型可按支持情况查看 2D/3D 并下载 DXF。", BLUE),
        ("AI 与服务配置", "管理 AI 能力、点数、素材及外部服务配置，并查看任务和使用记录。", ORANGE),
        ("业务与运营", "处理报备分配、通知提醒、订单提成和平台运营等后台流程。", HexColor("#8B5CF6")),
    ]
    for i, (h, b, color) in enumerate(features):
        col, row = i % 2, i // 2
        x, y = 96 + col * 600, 1100 - row * 330
        rect(c, x, y, 540, 250, white, 24)
        c.setStrokeColor(LINE); c.roundRect(x, y, 540, 250, 24, stroke=1, fill=0)
        rect(c, x + 34, y + 164, 14, 14, color, 7)
        text(c, h, x + 66, y + 150, 31, INK, True)
        wrap(c, b, x + 34, y + 96, 450, 22, MUTED, 34)
    rect(c, 96, 380, 1130, 206, DEEP, 24)
    text(c, "两端分工，不重复建档", 136, 502, 28, white, True)
    wrap(c, "现场产生的客户、正式户型、测量记录和设计任务进入同一企业数据范围；管理人员无需重新收集一套脱离现场的资料。", 136, 450, 970, 22, HexColor("#CDE7D6"), 34)
    page_num(c, 6)
    c.showPage()


def screen(c, image_path, x, y, w, h, caption, accent=GREEN):
    rect(c, x - 12, y - 12, w + 24, h + 24, white, 32)
    c.setStrokeColor(HexColor("#D9E7DE")); c.setLineWidth(3)
    c.roundRect(x - 12, y - 12, w + 24, h + 24, 32, stroke=1, fill=0)
    draw_image_cover(c, image_path, x, y, w, h)


def capability_overview(c):
    title(c, "四个工作面，共同完成一条业务主线", "下面用真实页面说明项目工作台、现场量房、AI 设计和经营协作分别解决什么问题，以及它们如何接续。", 7)
    items = [
        ("项目工作台", "客户、户型、进度与下一步动作汇在同一个项目视角。", GREEN),
        ("测量编辑器", "墙体、开口、尺寸、空间闭合与设备读数服务于正式户型。", BLUE),
        ("设计创作", "灵感、风格、方案、结果与继续优化，围绕客户项目持续推进。", ORANGE),
        ("经营协作", "线索、推广、通知、获客确认和佣金记录，让团队协作更有节奏。", HexColor("#8B5CF6")),
    ]
    for i, (h, b, color) in enumerate(items):
        x, y = (96 + (i % 2) * 582), (1100 - (i // 2) * 300)
        rect(c, x, y, 540, 234, HexColor("#F8FBF8"), 22, LINE)
        rect(c, x + 34, y + 154, 72, 48, color, 16)
        text(c, f"0{i+1}", x + 54, y + 169, 18, white, True)
        text(c, h, x + 34, y + 104, 31, INK, True)
        wrap(c, b, x + 34, y + 60, 445, 21, MUTED, 32)
    rect(c, 96, 402, 1136, 178, DEEP, 22)
    text(c, "先建立项目，再沉淀户型，然后设计与协作", 132, 518, 26, white, True)
    wrap(c, "四个工作面不是并列菜单：项目工作台承接客户，正式量房形成空间依据，AI 设计输出方案，经营协作推动任务和结果继续流转。", 132, 466, 980, 22, HexColor("#CDE7D6"), 34)
    page_num(c, 7)
    c.showPage()


def capability_project(c):
    title(c, "01  项目工作台：从客户信息找到下一步", "首页、客户列表与客户详情逐层连接线索、正式户型和项目进度，帮助业务人员快速回到正在推进的工作。", 8)
    screen(c, asset("design-references/all-pages-ip-v1/01-home-v2.png"), 100, 610, 400, 580, "首页 / 项目提醒")
    screen(c, asset("design-references/all-pages-ip-v1/02-leads-management.png"), 620, 610, 400, 580, "客户列表 / 阶段筛选", BLUE)
    screen(c, asset("design-references/all-pages-ip-v1/08-lead-detail.png"), 1140, 610, 205, 580, "详情", ORANGE)
    feature(c, 96, 385, "A", "项目一览", "首页汇集近期项目与户型进度，随时进入量房、设计或客户跟进。")
    feature(c, 670, 385, "B", "客户四阶段", "新建线索、量房中、设计方案、已签约提供统一的业务筛选和下一步判断。", BLUE)
    rect(c, 96, 135, 1140, 156, PALE, 22)
    text(c, "可用能力", 132, 227, 23, GREEN, True)
    wrap(c, "客户档案集中记录姓名、电话、小区、面积与偏好，并关联正式户型和后续服务。通过搜索和阶段筛选，快速找到每一个正在推进的项目。", 132, 183, 1000, 21, INK, 31)
    page_num(c, 8)
    c.showPage()


def capability_survey(c):
    title(c, "02  现场量房：把一条墙链变成正式户型", "现场围绕下一个点、当前尺寸、空间闭合、墙体编辑和门窗开口展开；手工或设备读数最终都进入同一份正式测量成果。", 9)
    screen(c, asset("design-references/surveying/v8/surveying-state-02-preview-length-input-v8.png"), 96, 620, 350, 550, "长度输入 / 墙链预览")
    screen(c, asset("design-references/surveying/v8/surveying-state-05-opening-selected-v8.png"), 540, 620, 350, 550, "门窗开口 / 对象编辑", BLUE)
    screen(c, asset("design-references/surveying/v8/surveying-state-10-space-closed-v8.png"), 984, 620, 350, 550, "空间闭合 / 正式成果", ORANGE)
    feature(c, 96, 390, "01", "量与画同步", "以毫米为单位记录与修正墙体尺寸，门窗与空间关系在图纸中清晰呈现。")
    feature(c, 670, 390, "02", "工具在正确的时机出现", "选中墙体后可复测、继续墙链或编辑开口；引导层只辅助现场操作，不拦截画布手势。", BLUE)
    rect(c, 96, 125, 1140, 170, HexColor("#F8FBF8"), 22, LINE)
    text(c, "让现场测量更顺手", 132, 227, 23, INK, True)
    wrap(c, "无需设备也可手工录入；使用蓝牙时，设备必须已分配并通过授权校验。首次云端保存前的有效读数会在保存成功后补写测量审计。", 132, 182, 1000, 21, MUTED, 31)
    page_num(c, 9)
    c.showPage()


def capability_ai(c):
    title(c, "03  AI 设计：从明确目标到持续优化", "从客户项目中选择完整户型或单个空间，再补充参考图与风格；任务、结果和历史记录持续保留在设计工作台。", 10)
    screen(c, asset("design-references/all-pages-ip-v3/14-ai-design-create-v3.png"), 96, 610, 370, 570, "创建 / 范围、素材与样式")
    screen(c, asset("design-references/all-pages-ip-v3/15-ai-design-result-v3.png"), 530, 610, 370, 570, "结果 / 对比、保存与继续", ORANGE)
    screen(c, asset("design-references/all-pages-ip-v3/16-ai-design-history-v3.png"), 964, 610, 370, 570, "历史 / 复用与删除", BLUE)
    feature(c, 96, 380, "A", "四类创作方式", "参考图复刻、整屋风格、户型概念渲染与软装优化，对应不同的客户沟通目标。")
    feature(c, 670, 380, "B", "方案持续进化", "从上传素材到查看结果，从保存分享再到继续优化，让每次灵感都能继续生长。", ORANGE)
    rect(c, 96, 125, 1140, 158, PALE, 22)
    text(c, "设计成果，沉淀在项目中", 132, 217, 23, GREEN, True)
    wrap(c, "生成结果用于概念表达与客户沟通，不替代施工图或工程交付。创建任务前，系统会再次校验企业权限、点数和正式户型资格。", 132, 173, 990, 21, INK, 31)
    page_num(c, 10)
    c.showPage()


def capability_operations(c):
    title(c, "04  经营协作：让报备、任务和记录连续流转", "推广、设计、量房与管理角色在各自权限范围内处理企业报备、任务分配、客户跟进、通知和经营记录。", 11)
    screen(c, asset("design-references/all-pages-ip-v1/09-promotion-records.png"), 96, 610, 360, 570, "推广记录 / 跟进与认领", HexColor("#8B5CF6"))
    screen(c, asset("design-references/all-pages-ip-v1/12-commission-records.png"), 540, 610, 360, 570, "佣金记录 / 待结算与已结算", ORANGE)
    screen(c, asset("design-references/all-pages-ip-v1/05-mine.png"), 984, 610, 360, 570, "我的 / 角色待办与通知", GREEN)
    feature(c, 96, 380, "01", "推广协同", "企业报备支持创建、搜索、公海认领、分配、跟进记录、到期提醒与冲突归属处理。", HexColor("#8B5CF6"))
    feature(c, 670, 380, "02", "获客确认与提成", "设计师和量房师围绕客户任务协作；提成记录按待结算、已结算和已作废状态查询。", ORANGE)
    rect(c, 96, 125, 1140, 158, HexColor("#F8FBF8"), 22, LINE)
    text(c, "重要进展，及时看见", 132, 217, 23, INK, True)
    wrap(c, "操作入口由员工角色和服务端工作流状态决定。小程序中的提成页面为只读查询，最终结算由企业订单和后台流程完成。", 132, 173, 990, 21, MUTED, 31)
    page_num(c, 11)
    c.showPage()


def start(c):
    title(c, "首次演示：用一个真实项目验证完整闭环", "先完成账号、角色与服务配置，再用一条真实客户线索走通量房、设计和协作，避免只展示彼此孤立的页面。", 12)
    steps = [
        ("01", "准备企业与角色", "确认员工账号、企业归属和岗位权限；按需配置 AI、通知和兼容测距设备。"),
        ("02", "建立客户项目", "创建一条真实客户线索，补齐客户、小区、面积与需求，并确认当前业务阶段。"),
        ("03", "完成正式量房", "绘制墙体和门窗，至少形成一个有效封闭空间，保存并确认项目可以继续进入。"),
        ("04", "发起一次 AI 设计", "选择整屋或单个空间，补充参考与目标，观察任务、结果和历史记录是否完整。"),
        ("05", "验证协作闭环", "切换对应角色检查项目可见性、待办通知、后台查看和经营记录是否符合权限。"),
    ]
    y = 1280
    for i, (no, h, b) in enumerate(steps):
        color = [GREEN, BLUE, ORANGE, HexColor("#8B5CF6"), GREEN][i]
        rect(c, 96, y - 36, 88, 88, color, 28)
        text(c, no, 120, y - 3, 25, white, True)
        text(c, h, 222, y + 12, 31, INK, True)
        wrap(c, b, 222, y - 34, 850, 22, MUTED, 33)
        if i < len(steps) - 1:
            c.setStrokeColor(LINE); c.setLineWidth(3); c.line(140, y - 92, 140, y - 152)
        y -= 210
    rect(c, 96, 218, 1120, 144, PALE, 22)
    text(c, "闭环验收标准", 132, 304, 22, GREEN, True)
    wrap(c, "同一客户项目下能连续看到客户信息、正式户型、设计任务和角色跟进；受限能力应明确提示配置、权限或数据条件，而不是显示为无条件可用。", 132, 264, 965, 20, INK, 30)
    page_num(c, 12)
    c.showPage()


def back(c):
    rect(c, 0, 0, W, H, DEEP)
    logo = asset("miniprogram/images/home-ip-v1/brand-logo.png")
    if logo.exists():
        c.drawImage(str(logo), 96, 1540, 250, 100, mask="auto", preserveAspectRatio=True)
    text(c, "从一条客户线索开始，\n让每一步都有依据。", 96, 1220, 72, white, True, 108)
    rect(c, 96, 930, 492, 8, GREEN, 4)
    wrap(c, "家客来连接客户项目、现场测量、设计表达与团队协作，帮助家装团队围绕同一份正式户型持续推进业务。", 96, 820, 730, 28, HexColor("#CDE7D6"), 44)
    text(c, "家客来 JIAKELAI", 96, 182, 23, HexColor("#BFE4CC"), True)
    text(c, "PRODUCT GUIDE / 2026.08", 96, 140, 18, HexColor("#7FB590"))
    c.showPage()


def main():
    c = canvas.Canvas(str(OUT), pagesize=(W, H), pageCompression=1)
    c.setTitle("家客来 产品说明书")
    c.setAuthor("家客来")
    cover(c); journey(c); home_and_leads(c); surveying(c); ai(c); collaboration(c); admin(c); capability_overview(c); capability_project(c); capability_survey(c); capability_ai(c); capability_operations(c); start(c); back(c)
    c.save()
    print(OUT)


if __name__ == "__main__":
    main()
