// nospos-scraper.js - Content script for NOSPOS scraping

console.log("📦 NOSPOS scraper loaded");

// ----- Persistent state -----
let currentSessionId = null;
let barcodesToProcess = [];
let currentIndex = 0;

// Check if the script is running on /stock/search already
const SEARCH_PAGE = "https://nospos.com/stock/search";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "initScraping") {
    console.log("Init scraping for barcodes:", message.barcodes);

    currentSessionId = message.sessionId;
    barcodesToProcess = message.barcodes;
    currentIndex = 0;

    chrome.runtime.sendMessage({
      action: "nosposReady",
      data: { sessionId: currentSessionId }
    });

    // Only start processing if we're already on the search page
    if (!window.location.href.includes("/stock/search")) {
      console.log("[NOSPOS] Navigating to /stock/search...");
      window.location.href = SEARCH_PAGE;
      return; // The script will be re-injected after page load
    }

    processNextBarcode();
    sendResponse({ received: true });
  }
  return true;
});

// ----- Main barcode processing -----
async function processNextBarcode() {
  if (currentIndex >= barcodesToProcess.length) {
    console.log("[NOSPOS] All barcodes processed");
    return;
  }

  const barcode = barcodesToProcess[currentIndex];
  console.log(`[NOSPOS] [${currentIndex + 1}/${barcodesToProcess.length}] Processing: ${barcode}`);

  try {
    await waitForLoad();
    await sleep(1000);

    // Fill search input
    const searchInput = document.querySelector("input#stocksearchandfilter-query");
    if (!searchInput) throw new Error("Search input not found");

    searchInput.value = barcode;
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));

    // Try form submit or search button
    const form = searchInput.closest('form');
    if (form) {
      form.submit();
    } else {
      const searchBtn = document.querySelector('button[type="submit"], .btn-search');
      if (searchBtn) searchBtn.click();
      else window.location.href = `${SEARCH_PAGE}?query=${encodeURIComponent(barcode)}`;
    }

    await waitForNavigation();
    await sleep(1500);

    // Check if on edit page
    const currentUrl = window.location.href;
    let isEditPage = false;

    if (currentUrl.includes("/stock/") && currentUrl.includes("/edit")) {
      isEditPage = true;
    } else if (currentUrl.includes("/stock/")) {
      try {
        await waitForSelector("#stock-name, .detail-view", 3000);
        isEditPage = true;
      } catch {
        isEditPage = false;
      }
    }

    if (!isEditPage) {
      console.warn(`[NOSPOS] No exact match for ${barcode}`);
      sendNoMatch(barcode);
    } else {
      console.log(`[NOSPOS] Found edit page for ${barcode}`);
      const data = await extractStockData(barcode);
      chrome.runtime.sendMessage({
        action: "nosposData",
        data: { sessionId: currentSessionId, result: data }
      });
    }

    // Move to next barcode
    currentIndex++;
    if (currentIndex < barcodesToProcess.length) {
      const delay = 1000 + Math.random() * 1000;
      console.log(`[NOSPOS] Waiting ${(delay/1000).toFixed(1)}s before next...`);
      setTimeout(() => processNextBarcode(), delay);
    }

  } catch (error) {
    console.error(`[NOSPOS] Error processing ${barcode}:`, error);
    chrome.runtime.sendMessage({
      action: "nosposData",
      data: { sessionId: currentSessionId, result: { barcode, error: error.message } }
    });

    currentIndex++;
    if (currentIndex < barcodesToProcess.length) setTimeout(() => processNextBarcode(), 1000);
  }
}

// ----- Helper: Extract stock data -----
async function extractStockData(barcode) {
  await Promise.all([
    waitForSelector("#stock-name", 5000),
    waitForSelector(".detail-view", 5000)
  ]);

  return {
    barcode,
    barserial: await getSummaryDetail("Barserial"),
    name: await getInputValue("#stock-name"),
    description: await getInputValue("#stock-description"),
    cost_price: await getInputValue("#stock-cost_price"),
    retail_price: await getInputValue("#stock-retail_price"),
    created_at: await getSummaryDetail("Created"),
    bought_by: await getSummaryDetail("Bought By"),
    quantity: await getSummaryDetail("Total Quantity"),
    type: await getSummaryDetail("Type"),
    specifications: await getSpecifications(),
    branch: await getBranchName()
  };
}

// ----- Helper: Send no-match data -----
function sendNoMatch(barcode) {
  chrome.runtime.sendMessage({
    action: "nosposData",
    data: {
      sessionId: currentSessionId,
      result: {
        barcode,
        barserial: "N/A",
        name: "N/A",
        description: "N/A",
        cost_price: "N/A",
        retail_price: "N/A",
        created_at: "N/A",
        bought_by: "N/A",
        quantity: "N/A",
        type: "N/A",
        specifications: {},
        branch: "N/A",
        error: "No exact match found"
      }
    }
  });
}

// ----- Other helpers remain largely unchanged -----
async function getInputValue(selector) {
  try {
    await waitForSelector(selector, 3000);
    const el = document.querySelector(selector);
    return el?.value?.trim() || "N/A";
  } catch { return "N/A"; }
}

async function getSummaryDetail(label) {
  try {
    await waitForSelector('.detail-view', 3000);
    const details = document.querySelectorAll('.detail-view .detail');
    for (const detail of details) {
      const strong = detail.querySelector('strong');
      if (strong && strong.textContent.includes(label)) {
        let value = detail.textContent.replace(label, '').trim();
        return value.replace(/^[:;-\s]+/, '').trim() || "N/A";
      }
    }
    return "N/A";
  } catch { return "N/A"; }
}

async function getSpecifications() {
  const specs = {};
  try {
    await waitForSelector('#w3 table.table tbody', 3000);
    const rows = document.querySelectorAll('#w3 table.table tbody tr');
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 2) continue;
      const field = cells[0]?.textContent?.trim() || "N/A";
      const value = row.querySelector('td:nth-child(2) a')?.textContent?.trim() || cells[1]?.textContent?.trim() || "N/A";
      const status = row.querySelector('td.status')?.textContent?.trim() || "N/A";
      const last_checked = row.querySelector('td.last-checked')?.textContent?.trim() || "N/A";
      specs[field] = { value: String(value), status: String(status), last_checked: String(last_checked) };
    }
  } catch { }
  return specs;
}

async function getBranchName() {
  try {
    await waitForSelector('a[href="#select-branch-modal"] span', 3000);
    return document.querySelector('a[href="#select-branch-modal"] span')?.textContent?.trim() || "N/A";
  } catch { return "N/A"; }
}

// ----- Generic helpers -----
function waitForLoad() {
  return new Promise(resolve => {
    if (document.readyState === 'complete') resolve();
    else window.addEventListener('load', resolve, { once: true });
  });
}

function waitForNavigation(timeout = 10000) {
  return new Promise(resolve => {
    const startUrl = window.location.href;
    const startTime = Date.now();

    const interval = setInterval(() => {
      if (window.location.href !== startUrl || Date.now() - startTime > timeout) {
        clearInterval(interval);
        if (document.readyState === 'complete') resolve();
        else window.addEventListener('load', resolve, { once: true });
      }
    }, 100);
  });
}

function waitForSelector(selector, timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(selector)) return resolve();
    const observer = new MutationObserver(() => {
      if (document.querySelector(selector)) {
        observer.disconnect();
        resolve();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timeout waiting for ${selector}`));
    }, timeout);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
