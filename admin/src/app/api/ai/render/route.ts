import { NextResponse } from 'next/server';

/**
 * Proxy AI Rendering requests to keep prompt logic on the server.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { roomName, style, width, height, openings, mode, polygon } = body;

    if (!roomName || !style) {
      return NextResponse.json({ success: false, error: 'Missing required parameters' }, { status: 400 });
    }

    // --- Start of Prompt Construction (Moved from Client) ---
    let shapeDesc = '';
    if (polygon && polygon.length >= 4) {
      const edgeCount = polygon.length;
      if (edgeCount === 4) shapeDesc = 'rectangular ';
      else if (edgeCount === 6) shapeDesc = 'L-shaped ';
      else if (edgeCount === 8) shapeDesc = 'T-shaped or U-shaped ';
      else shapeDesc = `${edgeCount}-sided polygon-shaped `;
    }

    const wallMap: Record<string, string[]> = { 'Top': [], 'Right': [], 'Bottom': [], 'Left': [] };
    const ops = openings || [];

    ops.forEach((o: any) => {
      const type = o.type === 'DOOR' ? 'Door' : 'Window';
      const widthM = (o.width / 10).toFixed(1);
      const distFromStart = (o.rotation === 0) ? (o.x / 10).toFixed(1) : (o.y / 10).toFixed(1);
      let wallName = '';
      if (o.rotation === 0) {
        wallName = o.y < (height / 2) ? 'Top' : 'Bottom';
      } else {
        wallName = o.x < (width / 2) ? 'Left' : 'Right';
      }
      wallMap[wallName].push(`${type} [width: ${widthM}m, offset: ${distFromStart}m]`);
    });

    const layoutDetails = Object.keys(wallMap)
      .filter((w) => wallMap[w].length > 0)
      .map((w) => `${w} Wall: ${wallMap[w].join('; ')}`)
      .join(' | ');

    let prompt = '';
    if (mode === 'PLANE') {
      prompt = `2D technical floor plan, professional architectural drawing of ${shapeDesc}${roomName}, ${style} style. ` +
        `Dimensions: ${(width / 10).toFixed(2)}m x ${(height / 10).toFixed(2)}m. ` +
        `Layout: ${layoutDetails || 'Standard room'}. ` +
        `Style: Orthographic top-down, clean white background, drafting pen lines, strictly no text, no fonts, no numbers.`;
    } else {
      const wallDescriptions = [];
      if (wallMap['Top'].length > 0) wallDescriptions.push(`On the far wall (front): ${wallMap['Top'].join(', ')}`);
      if (wallMap['Left'].length > 0) wallDescriptions.push(`On the left wall: ${wallMap['Left'].join(', ')}`);
      if (wallMap['Right'].length > 0) wallDescriptions.push(`On the right wall: ${wallMap['Right'].join(', ')}`);
      if (wallMap['Bottom'].length > 0) wallDescriptions.push(`Note: ${wallMap['Bottom'].join(', ')} are behind the viewer.`);

      prompt = `Hyper-photorealistic interior rendering of a ${style} ${shapeDesc}${roomName}. ` +
        `View: Eye-level perspective looking straight at the far wall. ` +
        `Spatial Map: ${wallDescriptions.join('. ')}. ` +
        `Furniture: Modern sofa near window/far wall, TV console on side wall. ` +
        `Visuals: 8k resolution, cinematic lighting with sun-rays, high-end architectural photography, strictly NO text, NO numbers, NO dimension lines, NO labels, clean walls.`;
    }
    // --- End of Prompt Construction ---

    const encodedPrompt = encodeURIComponent(prompt);
    const seed = Math.floor(Math.random() * 1000000);
    const model = 'flux';
    const params = `model=${model}&width=1024&height=1024&nologo=true&enhance=true&seed=${seed}`;
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?${params}`;

    return NextResponse.json({ success: true, url });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
