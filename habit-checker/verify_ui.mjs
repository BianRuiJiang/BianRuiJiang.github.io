import { chromium } from "/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/playwright/index.mjs";
import fs from "node:fs";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const pageUrl = "file:///Users/bianruijiang/Desktop/ChatGPT/index.html";
const outDir = "/Users/bianruijiang/.codex/visualizations/2026/07/31/019fb747-4288-7953-9ba4-17f8909837d4";

const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const results = [];

async function check(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) console.log("FAIL: " + name + (detail ? " -> " + detail : ""));
}

async function newPage(viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(pageUrl);
  await page.waitForLoadState("domcontentloaded");
  return { context, page };
}

// 1. Fresh desktop: defaults, toggle, add, persistence, delete.
{
  const { context, page } = await newPage({ width: 900, height: 1000 });

  const title = await page.title();
  await check("页面标题", title === "习惯打卡", title);

  const habitNames = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".habit-name")).map((el) => el.textContent)
  );
  await check("默认习惯", habitNames.join("|") === "喝水|运动|读书", habitNames.join("|"));

  await page.evaluate(() => {
    window.__rowRef = document.querySelectorAll(".habit-row")[1];
  });
  await page.locator(".habit-row").first().click();
  let doneCount = await page.locator("#doneCount").innerText();
  await check("点击后计数为 1", doneCount === "1", doneCount);
  await check(
    "点击后列表不整页重建",
    await page.evaluate(() => document.querySelectorAll(".habit-row")[1] === window.__rowRef),
    ""
  );

  const progress = await page.locator("#progressFill").getAttribute("style");
  await check("进度条为 33%", /33/.test(progress), progress);

  await page.locator("#habitInput").fill("早睡");
  await page.locator("#addForm button[type=submit]").click();
  const namesAfterAdd = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".habit-name")).map((el) => el.textContent)
  );
  await check("新增习惯成功", namesAfterAdd.includes("早睡"), namesAfterAdd.join("|"));
  await check("总数变为 4", (await page.locator("#totalCount").innerText()) === "4", "");

  const rows = page.locator(".habit-row");
  const rowCount = await rows.count();
  for (let i = 0; i < rowCount; i++) {
    const pressed = await rows.nth(i).getAttribute("aria-pressed");
    if (pressed !== "true") await rows.nth(i).click();
  }
  doneCount = await page.locator("#doneCount").innerText();
  await check("全部完成后计数为 4", doneCount === "4", doneCount);
  await check(
    "全部完成提示",
    (await page.locator("#listHint").innerText()) === "全部完成，太棒了",
    ""
  );

  await page.reload();
  await check("刷新后数据保留", (await page.locator("#doneCount").innerText()) === "4", "");

  await page.locator(".delete-btn").first().click();
  await check("删除后总数为 3", (await page.locator("#totalCount").innerText()) === "3", "");

  await page.screenshot({ path: outDir + "/habit-checker-desktop.png", fullPage: true });
  await context.close();
}

// 2. Mobile viewport: layout and no horizontal overflow.
{
  const { context, page } = await newPage({ width: 390, height: 844 });
  await page.locator(".habit-row").nth(1).click();
  await page.screenshot({ path: outDir + "/habit-checker-mobile.png", fullPage: true });

  const layout = await page.evaluate(() => {
    const doc = document.documentElement;
    const rows = Array.from(document.querySelectorAll(".habit-row"));
    const body = document.body;
    const overflow = doc.scrollWidth > doc.clientWidth;
    const rowOverflow = rows.some((row) => row.scrollWidth > row.clientWidth + 1);
    const overlap = rows.some((row) => {
      const r1 = row.getBoundingClientRect();
      return rows.some((other) => {
        if (other === row) return false;
        const r2 = other.getBoundingClientRect();
        return !(
          r1.right <= r2.left ||
          r1.left >= r2.right ||
          r1.bottom <= r2.top ||
          r1.top >= r2.bottom
        );
      });
    });
    return {
      overflow,
      rowOverflow,
      overlap,
      bodyWidth: body.scrollWidth,
      viewport: doc.clientWidth,
      rowCount: rows.length
    };
  });
  await check("移动端无横向溢出", layout.overflow === false, JSON.stringify(layout));
  await check("习惯行无内容溢出", layout.rowOverflow === false, JSON.stringify(layout));
  await check("习惯行无重叠", layout.overlap === false, JSON.stringify(layout));
  await context.close();
}

// 3. Empty state recovery.
{
  const { context, page } = await newPage({ width: 900, height: 900 });
  const deleteButtons = page.locator(".delete-btn");
  while ((await deleteButtons.count()) > 0) {
    await deleteButtons.first().click();
  }
  const emptyText = await page.locator(".empty").innerText();
  await check("空状态提示", emptyText.includes("先在上面添加一个吧"), emptyText);
  await context.close();
}

// 4. Legacy corrupt data (object names) gets repaired.
{
  const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
  await context.addInitScript(({ storageKey, data }) => {
    localStorage.setItem(storageKey, JSON.stringify(data));
  }, {
    storageKey: "habit-checker-v1",
    data: {
      habits: [
        { name: { broken: true }, emoji: 0 },
        { name: { broken: true }, emoji: 1 },
        { name: { broken: true }, emoji: 2 }
      ],
      records: {}
    }
  });
  const page = await context.newPage();
  await page.goto(pageUrl);
  await page.waitForLoadState("domcontentloaded");

  const habitNames = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".habit-name")).map((el) => el.textContent)
  );
  await check(
    "旧损坏数据恢复为默认习惯",
    habitNames.join("|") === "喝水|运动|读书",
    habitNames.join("|")
  );

  await page.locator("#habitInput").fill("早睡");
  await page.locator("#addForm button[type=submit]").click();
  const namesAfterAdd = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".habit-name")).map((el) => el.textContent)
  );
  await check("旧数据下新增习惯正常", namesAfterAdd.includes("早睡"), namesAfterAdd.join("|"));
  await context.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? "ALL PASS" : failed.length + " FAILURES");
fs.writeFileSync(outDir + "/verify-results.json", JSON.stringify(results, null, 2));
