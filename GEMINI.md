# Smart Floor Planner (智能量房大师) - Project Context

## Project Overview
Smart Floor Planner is a comprehensive digital solution for renovation companies and homeowners. It enables precise floor plan measurement using Bluetooth laser distance meters, AI-powered interior design visualization, and lead management for renovation businesses.

The project is structured into two main components:
1.  **Admin Dashboard (`/admin`)**: A management portal for enterprises to track leads, manage user data, and oversee floor plans.
2.  **Mini Program (`/miniprogram`)**: A WeChat Mini Program for on-site measurement, 3D floor plan visualization, and AI style generation.

## Technical Stack
- **Admin**:
  - **Framework**: Next.js 16 (React 19)
  - **Styling**: Tailwind CSS 4, Lucide Icons
  - **Database**: MongoDB via Mongoose
  - **Components**: Radix UI, Shadcn/UI (customized for Vercel design system)
- **Mini Program**:
  - **Framework**: WeChat Native Mini Program
  - **3D Engine**: Three.js (`threejs-miniprogram`)
  - **Hardware**: Bluetooth API for laser distance meter integration
- **Design System**: Vercel-inspired (Geist Sans/Mono, shadow-as-border technique, minimal monochrome aesthetic).

## Directory Structure
- `/admin`: Next.js project.
  - `src/app`: App Router (Admins, Leads, FloorPlans, etc.).
  - `src/components`: UI components including 3D viewers.
  - `src/models`: Mongoose schemas (Lead, User, FloorPlan, Enterprise).
  - `src/lib`: Shared utilities (database connection, auth).
- `/miniprogram`: WeChat Mini Program source.
  - `pages/editor`: The core floor plan drawing/measurement tool.
  - `components/canvas`: Three.js rendering logic.
  - `utils/bluetooth.js`: Laser distance meter protocol handling.
- `/docs`: Project roadmaps and design specifications.

## Core Domain Models
- **Lead**: Sales leads captured from the Mini Program (Name, Phone, Style Preference, Budget).
- **FloorPlan**: Digital blueprints containing layout data (nodes, walls, measurements).
- **User**: End-users (homeowners) using the Mini Program.
- **Enterprise**: Renovation companies using the platform.
- **AdminUser**: Staff members (designers, sales) of enterprises.

## Development Workflow

### Admin Dashboard
- **Install**: `cd admin && npm install`
- **Development**: `npm run dev` (Runs on `http://localhost:3002`)
- **Build**: `npm run build`
- **Lint**: `npm run lint`
- **Docker**: `npm run docker:up` (Starts the admin app and MongoDB)

### Mini Program
- Open the `/miniprogram` folder in **WeChat DevTools**.
- Ensure "Enable npm rendering" is checked in project settings.
- Build NPM if new dependencies are added.

## Design Principles (Mandatory)
Follow the guidelines in `DESIGN.md`:
- **Typography**: Geist Sans for headings (with negative letter-spacing), Geist Mono for technical data.
- **Borders**: Avoid traditional CSS borders. Use `box-shadow: 0px 0px 0px 1px rgba(0,0,0,0.08)`.
- **Palette**: Achromatic (#ffffff and #171717). Use workflow accents (Blue/Pink/Red) only for specific states.
- **Depth**: Layered shadows for elevation.

## Business Roadmap
Prioritize "Lead Conversion Optimization" as per `PRODUCT_ROADMAP.md`:
1.  Capture high-quality leads from measurements.
2.  Provide AI-generated "Inspirations" to drive intent.
3.  Support professional export formats (PDF, DXF) for designers.

## Core Workflow Upgrades (Lead Conversion)
- [x] **地推与设计师的自动指派逻辑**:
  - [x] 员工绑定：在“员工管理”中，企业管理员现在可以将多个地推人员（销售顾问）绑定到特定的设计师。
  - [x] 线索自动流转：地推量房后生成的客资线索自动推送到绑定的设计师账号下。
- [x] **企业微信自动化集成**:
  - [x] 自动拉群架构：在 `admin/src/lib/wecom.ts` 中封装了企微集成服务，预留建群逻辑（包含老板、设计师、地推、客户）。
- [x] **设计师 AI 工作台增强**:
  - [x] 信息全同步：设计师在户型图查看器中直接看到关联客户的小区、意向风格等背景资料。
  - [x] AI 方案生成：在户型图中新增“AI 风格生成”按钮，辅助出图。
  - [x] 一键分享闭环：设计师生成效果图后，可通过“同步至企微群”按钮发送至微信群。

## 🚀 深度优化计划 (Workflow & Conversion)
- [ ] **设计师 AI 工作台深度优化**:
  - [x] AI 生成预设：支持选择风格与空间类型以提高生成准确度。
  - [x] 企微集成落地：正式对接企微消息发送接口，实现方案一键实时推送。
  - [ ] 方案存为灵感：AI 生成的优质方案支持一键同步至“装修灵感库”。
- [ ] **客资转化引擎增强**:
  - [ ] 渐进式留资：下载 PDF 报告等高价值动作强制手机号校验。
  - [ ] 真实推荐逻辑：对接真实的推荐引擎，基于 Inspiration 库匹配案例。
  - [ ] 客户意向足迹：Admin 后台展示客户在小程序端的交互行为轨迹。
- [ ] **量房工具专业化**:
  - [ ] 标准户型模板：内置矩形、L型等常用模版一键快速导入。
  - [ ] 蓝牙自动重连：优化蓝牙连接逻辑，提升现场测量稳定性。
- [ ] **营销与运营支持**:
  - [ ] AI 方案海报：生成包含 2D/3D 对比与小程序码的分享海报。
  - [ ] 转化漏斗看板：Admin 后台新增全链路转化率统计报表。
