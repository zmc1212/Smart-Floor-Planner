const fs = require('fs');
const path = require('path');
const sharp = require('./admin/node_modules/sharp');

const rootDir = __dirname;
const cutsDir = path.resolve(rootDir, 'design-references/miniprogram-airy-minimalist-v1/cuts');
const targetFile = path.resolve(rootDir, 'design-references/miniprogram-airy-minimalist-v1/06-promoter-workbench.jpg');

function toBase64Uri(filePath) {
  if (!fs.existsSync(filePath)) return '';
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  const buf = fs.readFileSync(filePath);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function renderDesign() {
  console.log('Compositing pixel-perfect 06-promoter-workbench.jpg...');

  const serviceCodeXiaoKUri = toBase64Uri(path.join(rootDir, 'miniprogram/packages/business/assets/referrer-workbench-v1/service-code-guide.png'));
  const thumbsUpXiaoKUri = toBase64Uri(path.join(rootDir, 'miniprogram/packages/business/assets/referral-service-v1/thumbs-up-xiao-k.png'));
  const leadsPhoneUri = toBase64Uri(path.join(cutsDir, 'leads-phone-3d.png'));
  const onsiteMeasUri = toBase64Uri(path.join(rootDir, 'miniprogram/packages/business/assets/referral-service-v1/onsite-measurement.png'));
  const designerServUri = toBase64Uri(path.join(rootDir, 'miniprogram/packages/business/assets/referral-service-v1/designer-service.png'));

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1376" viewBox="0 0 768 1376">
  <defs>
    <linearGradient id="heroGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#00C365" />
      <stop offset="100%" stop-color="#009E52" />
    </linearGradient>
    <linearGradient id="btnGradient" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="100%" stop-color="#F4FFF8" />
    </linearGradient>
    <filter id="cardShadow" x="-5%" y="-5%" width="110%" height="115%" filterUnits="userSpaceOnUse">
      <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#183426" flood-opacity="0.04" />
    </filter>
    <filter id="heroShadow" x="-5%" y="-5%" width="110%" height="115%" filterUnits="userSpaceOnUse">
      <feDropShadow dx="0" dy="8" stdDeviation="14" flood-color="#00C365" flood-opacity="0.22" />
    </filter>
    <filter id="btnShadow" x="-5%" y="-5%" width="110%" height="120%" filterUnits="userSpaceOnUse">
      <feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#005A2C" flood-opacity="0.16" />
    </filter>
  </defs>

  <style>
    text {
      font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
      -webkit-font-smoothing: antialiased;
    }
  </style>

  <!-- Background -->
  <rect width="768" height="1376" fill="#F8FAF9" />

  <!-- ==================== TOP NAVIGATION BAR ==================== -->
  <g transform="translate(40, 48)">
    <!-- JK Logo Squircle -->
    <rect x="0" y="0" width="52" height="52" rx="14" fill="#00C365" />
    <text x="26" y="34" font-size="22" font-weight="900" fill="#FFFFFF" text-anchor="middle">JK</text>

    <!-- Title -->
    <text x="68" y="36" font-size="28" font-weight="800" fill="#183426">家客来 · 推广端</text>

    <!-- User Badge -->
    <rect x="296" y="8" width="180" height="36" rx="18" fill="#EAF2EC" />
    <text x="386" y="32" font-size="16" font-weight="600" fill="#3B5A49" text-anchor="middle">张合伙 · 华美装饰</text>

    <!-- QR Scan Icon -->
    <g transform="translate(565, 14)">
      <path d="M0,6 L0,2 A2,2 0 0,1 2,0 L6,0 M18,0 L22,0 A2,2 0 0,1 24,2 L24,6 M24,18 L24,22 A2,2 0 0,1 22,24 L18,24 M6,24 L2,24 A2,2 0 0,1 0,22 L0,18" stroke="#183426" stroke-width="2.5" fill="none" stroke-linecap="round" />
      <rect x="6" y="6" width="12" height="12" rx="2" fill="#183426" />
    </g>

    <!-- Bell Icon -->
    <g transform="translate(625, 14)">
      <path d="M12,2 A7,7 0 0,0 5,9 C5,15 2,17 2,17 L22,17 C22,17 19,15 19,9 A7,7 0 0,0 12,2 Z" fill="none" stroke="#183426" stroke-width="2.5" stroke-linejoin="round" />
      <path d="M9.5,20 A2.5,2.5 0 0,0 14.5,20" fill="none" stroke="#183426" stroke-width="2.5" stroke-linecap="round" />
    </g>
  </g>

  <!-- ==================== HERO GREEN CARD ==================== -->
  <g transform="translate(40, 120)">
    <!-- Card Base -->
    <rect width="688" height="324" rx="28" fill="url(#heroGradient)" filter="url(#heroShadow)" />

    <!-- Subtle Background Accents -->
    <circle cx="610" cy="70" r="140" fill="rgba(255,255,255,0.06)" />
    <circle cx="100" cy="270" r="100" fill="rgba(0,0,0,0.03)" />

    <!-- Card Texts -->
    <text x="40" y="62" font-size="34" font-weight="900" fill="#FFFFFF" letter-spacing="0.5">推广专属服务 · 获客与收益</text>
    <text x="40" y="100" font-size="18" font-weight="500" fill="rgba(255,255,255,0.85)">出示服务码 · 客户扫码建档 · 自动结算提成</text>

    <!-- 3 Data Pills -->
    <g transform="translate(40, 134)">
      <!-- Pill 1 -->
      <rect x="0" y="0" width="120" height="42" rx="21" fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.35)" stroke-width="1.5" />
      <text x="60" y="27" font-size="16" font-weight="700" fill="#FFFFFF" text-anchor="middle">今日扫码 3</text>

      <!-- Pill 2 -->
      <rect x="132" y="0" width="120" height="42" rx="21" fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.35)" stroke-width="1.5" />
      <text x="192" y="27" font-size="16" font-weight="700" fill="#FFFFFF" text-anchor="middle">累计客户 18</text>

      <!-- Pill 3 -->
      <rect x="264" y="0" width="144" height="42" rx="21" fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.35)" stroke-width="1.5" />
      <text x="336" y="27" font-size="16" font-weight="700" fill="#FFFFFF" text-anchor="middle">待结收益 ¥1,200</text>
    </g>

    <!-- Large White Action Button -->
    <g transform="translate(40, 206)">
      <rect width="280" height="66" rx="33" fill="url(#btnGradient)" filter="url(#btnShadow)" />
      <!-- QR code mini icon inside button -->
      <g transform="translate(46, 23)">
        <path d="M0,5 L0,1 A1,1 0 0,1 1,0 L5,0 M15,0 L19,0 A1,1 0 0,1 20,1 L20,5 M20,15 L20,19 A1,1 0 0,1 19,20 L15,20 M5,20 L1,20 A1,1 0 0,1 0,19 L0,15" stroke="#009E52" stroke-width="2.5" fill="none" stroke-linecap="round" />
        <rect x="5" y="5" width="10" height="10" rx="2" fill="#009E52" />
      </g>
      <text x="165" y="42" font-size="20" font-weight="800" fill="#009E52" text-anchor="middle">出示推广服务码</text>
    </g>

    <!-- Xiao K Promoter Mascot 3D Official Asset -->
    <image href="${serviceCodeXiaoKUri}" x="435" y="30" width="245" height="260" preserveAspectRatio="xMidYMid meet" />
  </g>

  <!-- ==================== MIDDLE QUICK ENTRIES (2 COLUMNS) ==================== -->
  <g transform="translate(40, 474)">
    <!-- Left Card: 服务进度 -->
    <g transform="translate(0, 0)">
      <rect width="330" height="136" rx="24" fill="#FFFFFF" stroke="#E6EDE8" stroke-width="1.5" filter="url(#cardShadow)" />
      <text x="28" y="52" font-size="24" font-weight="800" fill="#183426">服务进度</text>
      <text x="28" y="86" font-size="16" font-weight="600" fill="#00C365">3条待跟进 →</text>
      <image href="${leadsPhoneUri}" x="195" y="10" width="115" height="115" />
    </g>

    <!-- Right Card: 我的收益 -->
    <g transform="translate(358, 0)">
      <rect width="330" height="136" rx="24" fill="#FFFFFF" stroke="#E6EDE8" stroke-width="1.5" filter="url(#cardShadow)" />
      <text x="28" y="52" font-size="24" font-weight="800" fill="#183426">我的收益</text>
      <text x="28" y="86" font-size="16" font-weight="600" fill="#00C365">提成结算明细 →</text>
      <image href="${thumbsUpXiaoKUri}" x="205" y="12" width="105" height="110" />
    </g>
  </g>

  <!-- ==================== CURRENT ENTERPRISE & BENEFITS ==================== -->
  <g transform="translate(40, 642)">
    <!-- Section Title with Mini Icon -->
    <g transform="translate(0, 0)">
      <path d="M2,22 L2,2 L14,2 L14,22 M14,8 L22,8 L22,22 M6,6 L10,6 M6,11 L10,11 M6,16 L10,16 M17,12 L19,12 M17,17 L19,17" stroke="#183426" stroke-width="2.5" fill="none" stroke-linecap="round" />
      <text x="32" y="20" font-size="24" font-weight="800" fill="#183426">当前推广企业</text>
      <rect x="200" y="0" width="88" height="28" rx="14" fill="#EAF8F1" />
      <text x="244" y="19" font-size="14" font-weight="700" fill="#009E52" text-anchor="middle">已加入2家</text>
    </g>

    <!-- Enterprise Switcher Pills -->
    <g transform="translate(0, 42)">
      <!-- Tab 1 Active -->
      <rect x="0" y="0" width="220" height="46" rx="23" fill="#EAF8F1" stroke="#00C365" stroke-width="2" />
      <text x="110" y="29" font-size="16" font-weight="700" fill="#009E52" text-anchor="middle">华美装饰 (生效中) ✓</text>

      <!-- Tab 2 Inactive -->
      <rect x="232" y="0" width="180" height="46" rx="23" fill="#FFFFFF" stroke="#E2EAE5" stroke-width="1.5" />
      <text x="322" y="29" font-size="16" font-weight="600" fill="#5F7568" text-anchor="middle">美居空间设计</text>

      <!-- Tab 3 Add New -->
      <rect x="424" y="0" width="150" height="46" rx="23" fill="#FFFFFF" stroke="#D3DFD8" stroke-width="1.5" stroke-dasharray="4 4" />
      <text x="499" y="29" font-size="15" font-weight="600" fill="#8E9E94" text-anchor="middle">+ 加入企业</text>
    </g>

    <!-- White Card for Benefits -->
    <g transform="translate(0, 104)">
      <rect width="688" height="190" rx="24" fill="#FFFFFF" stroke="#E6EDE8" stroke-width="1.5" filter="url(#cardShadow)" />
      <text x="28" y="38" font-size="18" font-weight="700" fill="#183426">当前企业推广专属权益</text>

      <!-- Benefit 1 -->
      <g transform="translate(28, 54)">
        <image href="${onsiteMeasUri}" x="0" y="4" width="50" height="50" />
        <text x="64" y="28" font-size="18" font-weight="700" fill="#183426">免费上门量房</text>
        <text x="64" y="48" font-size="14" font-weight="500" fill="#8E9E94">专业测量员持激光测距仪实地毫米级复核</text>
      </g>

      <!-- Divider -->
      <line x1="28" y1="120" x2="660" y2="120" stroke="#F0F4F1" stroke-width="1" />

      <!-- Benefit 2 -->
      <g transform="translate(28, 126)">
        <image href="${designerServUri}" x="0" y="4" width="50" height="50" />
        <text x="64" y="28" font-size="18" font-weight="700" fill="#183426">免费全屋设计</text>
        <text x="64" y="48" font-size="14" font-weight="500" fill="#8E9E94">资深设计师 1对1 快速出全景效果图方案</text>
      </g>
    </g>
  </g>

  <!-- ==================== RECENT PROMOTION MILESTONES ==================== -->
  <g transform="translate(40, 974)">
    <!-- Section Title with Clipboard Icon -->
    <g transform="translate(0, 0)">
      <rect x="2" y="2" width="18" height="22" rx="3" fill="none" stroke="#183426" stroke-width="2.5" />
      <line x1="7" y1="8" x2="15" y2="8" stroke="#183426" stroke-width="2" stroke-linecap="round" />
      <line x1="7" y1="13" x2="15" y2="13" stroke="#183426" stroke-width="2" stroke-linecap="round" />
      <line x1="7" y1="18" x2="11" y2="18" stroke="#183426" stroke-width="2" stroke-linecap="round" />
      <text x="32" y="20" font-size="24" font-weight="800" fill="#183426">最新推广记录 (脱敏里程碑)</text>
    </g>

    <!-- Milestone Item 1 -->
    <g transform="translate(0, 38)">
      <rect width="688" height="96" rx="20" fill="#FFFFFF" stroke="#E6EDE8" stroke-width="1.5" filter="url(#cardShadow)" />
      
      <text x="28" y="38" font-size="18" font-weight="800" fill="#183426">万科·未来之光 1202室 · 108m²</text>
      <text x="28" y="70" font-size="14" font-weight="500" fill="#8E9E94">客户: 李女士 · 08-19 14:30 扫码授权</text>

      <rect x="375" y="18" width="120" height="28" rx="14" fill="#EAF8F1" />
      <text x="435" y="37" font-size="14" font-weight="700" fill="#009E52" text-anchor="middle">已出图·待确认</text>

      <text x="660" y="54" font-size="18" font-weight="800" fill="#00C365" text-anchor="end">预估 +¥200</text>
    </g>

    <!-- Milestone Item 2 -->
    <g transform="translate(0, 146)">
      <rect width="688" height="96" rx="20" fill="#FFFFFF" stroke="#E6EDE8" stroke-width="1.5" filter="url(#cardShadow)" />
      
      <text x="28" y="38" font-size="18" font-weight="800" fill="#183426">保利·天汇 804室 · 125m²</text>
      <text x="28" y="70" font-size="14" font-weight="500" fill="#8E9E94">客户: 王先生 · 08-18 10:15 方案已交付</text>

      <rect x="375" y="18" width="120" height="28" rx="14" fill="#EBF3FE" />
      <text x="435" y="37" font-size="14" font-weight="700" fill="#2563EB" text-anchor="middle">已结算收益</text>

      <text x="660" y="54" font-size="18" font-weight="800" fill="#009E52" text-anchor="end">已到账 ¥300</text>
    </g>
  </g>

  <!-- ==================== BOTTOM TAB BAR (4 TABS) ==================== -->
  <g transform="translate(0, 1260)">
    <!-- Bar Base -->
    <rect width="768" height="116" fill="#FFFFFF" stroke="#E6EDE8" stroke-width="1.5" />

    <!-- Tab 1: 推广 (Active Green) -->
    <g transform="translate(96, 20)">
      <path d="M0,10 L16,-4 L32,10 L32,26 A4,4 0 0,1 28,30 L4,30 A4,4 0 0,1 0,26 Z" fill="#00C365" />
      <path d="M10,30 L10,18 L22,18 L22,30" fill="#FFFFFF" />
      <text x="16" y="52" font-size="16" font-weight="800" fill="#00C365" text-anchor="middle">推广</text>
    </g>

    <!-- Tab 2: 进度 -->
    <g transform="translate(288, 20)">
      <rect x="4" y="0" width="24" height="28" rx="4" fill="none" stroke="#8E9E94" stroke-width="2.5" />
      <line x1="10" y1="8" x2="22" y2="8" stroke="#8E9E94" stroke-width="2" stroke-linecap="round" />
      <line x1="10" y1="14" x2="22" y2="14" stroke="#8E9E94" stroke-width="2" stroke-linecap="round" />
      <line x1="10" y1="20" x2="18" y2="20" stroke="#8E9E94" stroke-width="2" stroke-linecap="round" />
      <text x="16" y="52" font-size="16" font-weight="600" fill="#8E9E94" text-anchor="middle">进度</text>
    </g>

    <!-- Tab 3: 收益 -->
    <g transform="translate(480, 20)">
      <rect x="2" y="4" width="28" height="22" rx="4" fill="none" stroke="#8E9E94" stroke-width="2.5" />
      <circle cx="16" cy="15" r="4" fill="none" stroke="#8E9E94" stroke-width="2" />
      <text x="16" y="52" font-size="16" font-weight="600" fill="#8E9E94" text-anchor="middle">收益</text>
    </g>

    <!-- Tab 4: 我的 -->
    <g transform="translate(672, 20)">
      <circle cx="16" cy="8" r="7" fill="none" stroke="#8E9E94" stroke-width="2.5" />
      <path d="M3,28 C3,20 9,18 16,18 C23,18 29,20 29,28" fill="none" stroke="#8E9E94" stroke-width="2.5" stroke-linecap="round" />
      <text x="16" y="52" font-size="16" font-weight="600" fill="#8E9E94" text-anchor="middle">我的</text>
    </g>
  </g>
</svg>
`;

  await sharp(Buffer.from(svg.trim()))
    .jpeg({ quality: 95, progressive: true })
    .toFile(targetFile);

  const stats = fs.statSync(targetFile);
  console.log(`Rendered and saved ${targetFile}, size: ${stats.size} bytes`);
}

renderDesign().catch(err => {
  console.error(err);
  process.exit(1);
});
