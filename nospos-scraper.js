// nospos-scraper.js - Robust NOSPOS scraper (Chrome extension)
console.log("📦 NOSPOS scraper loaded");

// ----- Persistent state -----
let currentSessionId = null;
let barcodesToProcess = [];
let currentIndex = 0;

const SEARCH_PAGE = "https://nospos.com/stock/search";

// ----- Helpers -----
function saveState() {
  chrome.storage.local.set({
    sessionId: currentSessionId,
    barcodesToProcess,
    currentIndex
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForLoad() {
  return new Promise(resolve => {
    if (document.readyState === "complete") resolve();
    else window.addEventListener("load", resolve, { once: true });
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

async function waitForEditPage(previousUrl = null, timeout = 20000) {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const check = async () => {
      const currentUrl = window.location.href;
      const urlChanged = previousUrl ? currentUrl !== previousUrl : /\/stock\/\d+\/edit/.test(window.location.pathname);

      if (urlChanged && /\/stock\/\d+\/edit/.test(window.location.pathname)) {
        // Optionally wait until #stock-name or .detail-view has new content
        try {
          await waitForSelector("#stock-name", 10000);
          const nameInput = document.querySelector("#stock-name");
          if (nameInput && nameInput.value.trim().length > 0) {
            return resolve();
          }
        } catch {}
      }

      if (Date.now() - start > timeout) {
        return reject(new Error("Timeout waiting for edit page to fully load"));
      }

      requestAnimationFrame(check);
    };
    check();
  });
}


async function getInputValue(selector) {
  try {
    await waitForSelector(selector, 3000);
    return document.querySelector(selector)?.value?.trim() || "N/A";
  } catch {
    return "N/A";
  }
}

async function getSummaryDetail(label) {
  try {
    await waitForSelector(".detail-view", 3000);
    const details = document.querySelectorAll(".detail-view .detail");
    for (const detail of details) {
      const strong = detail.querySelector("strong");
      if (strong && strong.textContent.includes(label)) {
        let value = detail.textContent.replace(label, "").trim();
        return value.replace(/^[:;-\s]+/, "").trim() || "N/A";
      }
    }
    return "N/A";
  } catch {
    return "N/A";
  }
}

async function getSpecifications() {
  const specs = {};
  try {
    await waitForSelector("#w3 table.table tbody", 3000);
    const rows = document.querySelectorAll("#w3 table.table tbody tr");
    for (const row of rows) {
      const cells = row.querySelectorAll("td");
      if (cells.length < 2) continue;
      const field = cells[0]?.textContent?.trim() || "N/A";
      const value = row.querySelector("td:nth-child(2) a")?.textContent?.trim() || cells[1]?.textContent?.trim() || "N/A";
      const status = row.querySelector("td.status")?.textContent?.trim() || "N/A";
      const last_checked = row.querySelector("td.last-checked")?.textContent?.trim() || "N/A";
      specs[field] = { value: String(value), status: String(status), last_checked: String(last_checked) };
    }
  } catch {}
  return specs;
}

async function getBranchName() {
  try {
    await waitForSelector('a[href="#select-branch-modal"] span', 3000);
    return document.querySelector('a[href="#select-branch-modal"] span')?.textContent?.trim() || "N/A";
  } catch {
    return "N/A";
  }
}

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

// ----- Process barcodes -----
async function processNextBarcode() {
  if (currentIndex >= barcodesToProcess.length) {
    console.log("[NOSPOS] All barcodes processed");
    chrome.storage.local.remove(["sessionId", "barcodesToProcess", "currentIndex"]);
    return;
  }

  const barcode = barcodesToProcess[currentIndex];
  console.log(`[NOSPOS] [${currentIndex + 1}/${barcodesToProcess.length}] Processing: ${barcode}`);

  try {
    await waitForLoad();
    await sleep(500);

    // Decide which input to use based on page type let searchInput = null; 
    if (/\/stock\/\d+\/edit/.test(window.location.pathname)) { 
        // Edit page search input 
        searchInput = document.querySelector("#searchform-query"); 
    } else if (window.location.href.includes("/stock/search")) { 
        // Main search page 
        searchInput = document.querySelector("#stocksearchandfilter-query"); }

    searchInput.value = barcode;
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));

    currentIndex++;
    saveState();

    const form = searchInput.closest("form");
    if (form) form.submit();
    else {
      const searchBtn = document.querySelector('button[type="submit"], .btn-search');
      if (searchBtn) searchBtn.click();
    }
    
    const previousUrl = window.location.href;

    // Wait until edit page loads
    await waitForEditPage(previousUrl);

    const data = await extractStockData(barcode);
    console.log("[NOSPOS] Extracted data:", data);

    chrome.runtime.sendMessage({
      action: "nosposData",
      data: { sessionId: currentSessionId, result: data }
    });

    // Small delay before next barcode
    await sleep(1000);
    processNextBarcode();
  } catch (error) {
    console.error(`[NOSPOS] Error processing ${barcode}:`, error);
    chrome.runtime.sendMessage({
      action: "nosposData",
      data: { sessionId: currentSessionId, result: { barcode, error: error.message } }
    });
    await sleep(1000);
    processNextBarcode();
  }
}

// ----- Listen for new scraping session -----
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "initScraping") {
    currentSessionId = message.sessionId;
    barcodesToProcess = message.barcodes;
    currentIndex = 0;
    saveState();

    chrome.runtime.sendMessage({
      action: "nosposReady",
      data: { sessionId: currentSessionId }
    });

    if (!window.location.href.includes("/stock/search")) {
      window.location.href = SEARCH_PAGE;
      return;
    }

    processNextBarcode();
    sendResponse({ received: true });
  }
  return true;
});

// ----- Restore previous session on reload -----
chrome.storage.local.get(["sessionId", "barcodesToProcess", "currentIndex"], (state) => {
  if (state.sessionId && state.barcodesToProcess?.length) {
    currentSessionId = state.sessionId;
    barcodesToProcess = state.barcodesToProcess;
    currentIndex = state.currentIndex || 0;

    console.log(`[NOSPOS] Resuming session ${currentSessionId}, barcode ${currentIndex + 1}/${barcodesToProcess.length}`);

    if (/\/stock\/\d+\/edit/.test(window.location.pathname)) {
      const barcode = barcodesToProcess[currentIndex - 1];
      extractStockData(barcode).then(data => {
        console.log("[NOSPOS] Extracted after reload:", data);
        chrome.runtime.sendMessage({ action: "nosposData", data: { sessionId: currentSessionId, result: data } });
        processNextBarcode();
      });
    } else if (window.location.href.includes("/stock/search")) {
      processNextBarcode();
    } else {
      window.location.href = SEARCH_PAGE;
    }
  }
});
