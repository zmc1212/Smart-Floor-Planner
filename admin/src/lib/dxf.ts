/**
 * A lightweight DXF generator for Smart Floor Planner.
 * DXF is a bit-tagged data format. Minimal structure: HEADER, TABLES (Layers), BLOCKS, ENTITIES, EOF.
 */

export class DXFGenerator {
  private content: string[] = [];

  constructor(private name: string = 'SmartFloorPlan') {
    this.init();
  }

  private init() {
    this.addHeader();
    this.addLayers();
  }

  private addHeader() {
    this.content.push('0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015'); // AutoCAD 2000
    this.content.push('9\n$INSUNITS\n70\n4'); // 4 = Millimeters
    this.content.push('0\nENDSEC');
  }

  private addLayers() {
    this.content.push('0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLTYPE\n70\n1\n0\nLTYPE\n2\nCONTINUOUS\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n0\nENDTAB');
    
    this.content.push('0\nTABLE\n2\nLAYER\n70\n3');
    
    // Layer 0
    this.addLayerDef('0', 7);
    // Walls
    this.addLayerDef('WALLS', 7); // white
    // Openings
    this.addLayerDef('OPENINGS', 5); // blue
    // Annotations
    this.addLayerDef('ANNOTATIONS', 2); // yellow
    
    this.content.push('0\nENDTAB\n0\nENDSEC');
  }

  private addLayerDef(name: string, color: number) {
    this.content.push(`0\nLAYER\n2\n${name}\n70\n0\n62\n${color}\n6\nCONTINUOUS`);
  }

  public startEntities() {
    this.content.push('0\nSECTION\n2\nENTITIES');
  }

  public addLine(x1: number, y1: number, x2: number, y2: number, layer: string = 'WALLS') {
    // 1px in our system = 100mm
    const scale = 100; 
    this.content.push('0\nLINE');
    this.content.push(`8\n${layer}`);
    this.content.push(`10\n${x1 * scale}\n20\n${y1 * scale}\n30\n0.0`); // Start point
    this.content.push(`11\n${x2 * scale}\n21\n${y2 * scale}\n31\n0.0`); // End point
  }

  public addText(x: number, y: number, text: string, height: number = 2, layer: string = 'ANNOTATIONS') {
    const scale = 100;
    this.content.push('0\nTEXT');
    this.content.push(`8\n${layer}`);
    this.content.push(`10\n${x * scale}\n20\n${y * scale}\n30\n0.0`);
    this.content.push(`40\n${height * scale}`); // Text height
    this.content.push(`1\n${text}`);
  }

  public end() {
    this.content.push('0\nENDSEC\n0\nEOF');
    return this.content.join('\n');
  }

  /**
   * Main entry point to convert FloorPlan model data to DXF string
   */
  public generateFromData(rooms: any[]) {
    this.startEntities();

    rooms.forEach(room => {
      const rx = room.x || 0;
      const ry = room.y || 0;
      const rw = room.width || 0;
      const rh = room.height || 0;

      if (room.polygon && room.polygon.length >= 2) {
        // Draw Polygon Walls
        const pts = room.polygon;
        for (let i = 0; i < pts.length; i++) {
          const p1 = pts[i];
          const p2 = pts[(i + 1) % pts.length];
          // Skip closing line if not closed
          if (i === pts.length - 1 && !room.polygonClosed) continue;
          
          this.addLine(rx + p1.x, ry + p1.y, rx + p2.x, ry + p2.y, 'WALLS');
        }
      } else {
        // Draw Rectangular Walls (Fallback)
        this.addLine(rx, ry, rx + rw, ry, 'WALLS');
        this.addLine(rx + rw, ry, rx + rw, ry + rh, 'WALLS');
        this.addLine(rx + rw, ry + rh, rx, ry + rh, 'WALLS');
        this.addLine(rx, ry + rh, rx, ry, 'WALLS');
      }

      // Draw Openings (Doors/Windows)
      if (room.openings && room.openings.length > 0) {
        room.openings.forEach((op: any) => {
          const absX = rx + op.x;
          const absY = ry + op.y;
          const ow = op.width || 10;
          
          if (op.rotation === 90) {
            // Vertical opening
            this.addLine(absX, absY - ow/2, absX, absY + ow/2, 'OPENINGS');
          } else {
            // Horizontal opening
            this.addLine(absX - ow/2, absY, absX + ow/2, absY, 'OPENINGS');
          }
        });
      }

      // Add Labels
      this.addText(rx + rw/2, ry + rh/2, room.name || 'Room', 1.5, 'ANNOTATIONS');
    });

    return this.end();
  }
}
