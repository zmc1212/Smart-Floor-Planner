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
