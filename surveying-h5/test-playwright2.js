const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:4173/');

  // Wait for the canvas to load
  await page.waitForSelector('.grid-canvas');

  // To test manual drawing, we can dispatch mouse events to the canvas wrapper.
  const canvasShell = await page.evaluateHandle('document.querySelector(".grid-canvas")');
  if (!canvasShell) {
    console.log('No canvasShell found!');
    await browser.close();
    return;
  }
  const box = await canvasShell.boundingBox();
  
  // Click (x, y) relative to canvas center
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  
  await page.mouse.click(box.x + 100, box.y + 100);
  await page.waitForTimeout(200);
  await page.mouse.click(box.x + 100, box.y + 300);
  await page.waitForTimeout(200);
  await page.mouse.click(box.x + 300, box.y + 300);
  await page.waitForTimeout(200);
  await page.mouse.click(box.x + 300, box.y + 100);
  await page.waitForTimeout(200);
  // Close Room 1
  await page.mouse.click(box.x + 100, box.y + 100); 
  await page.waitForTimeout(500);

  // Draw Room 2, attach to right wall of Room 1
  await page.mouse.move(box.x + 300, box.y + 150);
  await page.waitForTimeout(500); // wait for snap
  await page.mouse.click(box.x + 300, box.y + 150);
  await page.waitForTimeout(200);
  await page.mouse.click(box.x + 500, box.y + 150); // Right
  await page.waitForTimeout(200);
  await page.mouse.click(box.x + 500, box.y + 250); // Down
  await page.waitForTimeout(200);
  await page.mouse.click(box.x + 300, box.y + 250); // Left to right wall
  
  // Close Room 2
  await page.mouse.move(box.x + 300, box.y + 250);
  await page.waitForTimeout(500);
  await page.mouse.dblclick(box.x + 300, box.y + 250); 
  await page.waitForTimeout(500);

  // Click on the shared wall
  await page.mouse.click(box.x + 300, box.y + 200);
  await page.waitForTimeout(500);

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
    return window.__surveyingH5.getDraft().floors[0].spaces.length;
  });
  console.log('Spaces after delete:', spaces);

  await page.screenshot({ path: 'playwright_test.png' });
  await browser.close();
})();
