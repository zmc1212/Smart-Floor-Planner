const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:4173/');

  // Wait for the scenario button to load
  await page.waitForSelector('button[data-scenario="outer-face-mid-wall-closure"]');

  // Click the scenario button to construct the room
  await page.click('button[data-scenario="outer-face-mid-wall-closure"]');
  await page.waitForTimeout(1000);

  const canvasShell = await page.evaluateHandle('document.querySelector(".grid-canvas")');
  if (!canvasShell) {
    console.log('No canvasShell found!');
    await browser.close();
    return;
  }
  const box = await canvasShell.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // The shared wall is the right wall of room 1.
  // Room 1 is 4000x3000, Room 2 is attached to the right wall.
  // So the shared wall is somewhere around cx + 2000 * scale?
  // Let's just click near the center right.
  // Actually, wait, outerFaceMidWallClosure draws Room 1 at (0, -4000), Room 2 at (4000, -2000).
  // The shared wall is around x=4000, y=-2000.
  // We can just click around there, or we can just fetch the exact coordinates of the shared wall from the graph!
  
  const sharedWallCenter = await page.evaluate(() => {
    const draft = window.__surveyingH5.getDraft();
    const floor = draft.floors[0];
    const spaces = floor.spaces;
    if (spaces.length !== 2) return null;
    
    // Find the shared wall
    for (const w1 of spaces[0].wallIds) {
      if (spaces[1].wallIds.includes(w1)) {
        const wall = floor.walls.find(w => w.id === w1);
        const sn = floor.nodes.find(n => n.id === wall.startNodeId);
        const en = floor.nodes.find(n => n.id === wall.endNodeId);
        return { x: (sn.xMm + en.xMm) / 2, y: (sn.yMm + en.yMm) / 2 };
      }
    }
    return null;
  });

  if (!sharedWallCenter) {
    console.log('Could not find shared wall in draft!');
    await browser.close();
    return;
  }

  // Convert graph coordinates to screen coordinates
  const screenPos = await page.evaluate((pos) => {
    const draft = window.__surveyingH5.getDraft();
    const floor = draft.floors[0];
    const { scale, offsetX, offsetY } = floor.viewport;
    
    const canvas = document.querySelector('.grid-canvas');
    const box = canvas.getBoundingClientRect();
    
    // Viewport formula: 
    // viewX = canvasWidth / 2 + offsetX + xMm * scale
    // viewY = canvasHeight / 2 + offsetY + yMm * scale
    const cx = box.width / 2;
    const cy = box.height / 2;
    
    return {
      x: box.x + cx + offsetX + pos.x * scale,
      y: box.y + cy + offsetY + pos.y * scale
    };
  }, sharedWallCenter);

  // Click the shared wall
  await page.mouse.click(screenPos.x, screenPos.y);
  await page.waitForTimeout(1000);

  // Click delete
  const delBtn = await page.getByText('删除', { exact: true });
  if (await delBtn.count() > 0) {
    await delBtn.click();
    console.log('Clicked Delete');
  } else {
    console.log('Delete button not found. Maybe the wall was not selected.');
  }

  await page.waitForTimeout(1000);

  // Check state
  const spaces = await page.evaluate(() => {
    return window.__surveyingH5.getDraft().floors[0].spaces.filter(s => s.closed).length;
  });
  console.log('Spaces after delete:', spaces);

  await page.screenshot({ path: 'playwright_test.png' });
  await browser.close();
})();
