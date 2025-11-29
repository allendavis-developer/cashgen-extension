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

function clearState() {
  chrome.storage.local.remove(["sessionId", "barcodesToProcess", "currentIndex"]);
  currentSessionId = null;
  barcodesToProcess = [];
  currentIndex = 0;
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
        // Optionally wait until #stock-name has content
        try {
          await waitForSelector("#stock-name", 10000);
          const nameInput = document.querySelector("#stock-name");
          if (nameInput && nameInput.value.trim().length > 0) {
            return resolve();
          }
        } catch {
          console.log("couldn't get to edit page!");
        }
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

// ---------- Promise wrappers for chrome.storage ----------
function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}
function storageSet(obj) {
  return new Promise(resolve => chrome.storage.local.set(obj, resolve));
}
function storageRemove(keys) {
  return new Promise(resolve => chrome.storage.local.remove(keys, resolve));
}

// ----- Message handlers (keep as you had them) -----
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {


  // NEW: Handle abort from background
  if (message.action === "abortScraping") {
    console.log("[NOSPOS] Received abort signal - clearing state");
    clearState(); // This clears chrome.storage.local
    currentSessionId = null;
    barcodesToProcess = [];
    currentIndex = 0;
    sendResponse({ aborted: true });
    return true;
  }

  if (message.action === "updateExternallyListed") {
    handleExternallyListedUpdate(message.data.serial_number, sendResponse);
    return true;
  }

  // The initScraping message is handled in background -> sends initScraping to content script
  if (message.action === "initScraping") {
    // Defensive: ensure we don't stomp an already-running session
    if (message.sessionId && message.barcodes) {
      currentSessionId = message.sessionId;
      barcodesToProcess = message.barcodes.slice(); // clone
      currentIndex = 0;
      saveState();
      chrome.runtime.sendMessage({ action: "nosposReady", data: { sessionId: currentSessionId } });
      // If not on search page, navigate there; resumeAfterNavigation will pick it up.
      if (!window.location.href.includes("/stock/search")) {
        window.location.href = SEARCH_PAGE;
      } else {
        // Start first search
        processNextBarcode();
      }
      sendResponse({ received: true });
      return true;
    }
  }

  return false;
});

// ----- Externally listed update flow (unchanged) -----
async function handleExternallyListedUpdate(serial_number) {
  console.log(`[NOSPOS] Updating externally listed for ${serial_number}`);
  await storageSet({ pendingExternallyListed: serial_number });

  try {
    await waitForLoad();
    await sleep(500);

    if (!/\/stock\/\d+\/edit/.test(window.location.pathname)) {
      const searchInput = document.querySelector("#stocksearchandfilter-query");
      if (!searchInput) throw new Error("Search input not found");

      searchInput.value = serial_number;
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));

      const form = searchInput.closest("form");
      if (form) form.submit();
      else searchInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, bubbles: true }));

      const previousUrl = window.location.href;
      await waitForEditPage(previousUrl);
      console.log("[NOSPOS] Edit page loaded after search");
    } else {
      console.log("[NOSPOS] Already on edit page, skipping search");
      await waitForEditPage();
    }

    // Wait for checkbox to be available and enabled
    await waitForSelector("#stock-externally_listed_at", 5000);
    const checkbox = document.querySelector("#stock-externally_listed_at");
    const checkboxLabel = document.querySelector("label[for='stock-externally_listed_at']");
    if (!checkbox || !checkboxLabel) throw new Error("Externally Listed checkbox not found");

    await new Promise(resolve => {
      const interval = setInterval(() => {
        if (!checkbox.disabled) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });

    let changed = false;
    if (!checkbox.checked) {
      checkboxLabel.click();
      console.log("[NOSPOS] Externally Listed checkbox clicked");
      changed = true;
      await sleep(300);
    } else {
      console.log("[NOSPOS] Already marked as externally listed");
    }

    if (changed) {
      const saveButton = document.querySelector("button.btn.btn-blue[type='submit']");
      if (!saveButton) throw new Error("Save button not found");
      saveButton.click();
      console.log("[NOSPOS] Save button clicked");

      await new Promise(resolve => {
        const checkInterval = setInterval(() => {
          if (document.querySelector(".alert-success") || !window.location.href.includes("/edit")) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 500);

        setTimeout(() => clearInterval(checkInterval) || resolve(), 5000);
      });
    } else {
      console.log("[NOSPOS] No change needed, skipping save");
    }

    console.log("[NOSPOS] Successfully updated externally listed status");
    await storageRemove("pendingExternallyListed");
    await sleep(1000);
    return { success: true };

  } catch (error) {
    console.error("[NOSPOS] Error updating externally listed:", error);
    return { success: false, error: error.message };
  }
}

// ----- Single unified resume logic (runs on every load) -----
(async function resumeAfterNavigation() {
  await waitForLoad();
  await sleep(150); // small debounce for UI work to settle

  // NEW: Stop if we're on a login page
  if (window.location.href.includes("login") || window.location.href.includes("tag-login")) {
    console.log("[NOSPOS] On login page - clearing state and stopping");
    await clearState();
    return;
  }


  // Load storage state
  const state = await storageGet(["sessionId", "barcodesToProcess", "currentIndex"]);
  if (!state.sessionId || !state.barcodesToProcess || state.currentIndex == null) {
    // No active session; but still check pendingExternallyListed
    const pending = await storageGet("pendingExternallyListed");
    if (pending && pending.pendingExternallyListed) {
      const serial = pending.pendingExternallyListed;
      if (/\/stock\/\d+\/edit/.test(window.location.pathname)) {
        console.log(`[NOSPOS] Resuming pending externally listed update for ${serial}`);
        handleExternallyListedUpdate(serial);
      } else {
        // if not on edit, let handleExternallyListedUpdate navigate/search when triggered by message
        // or clear if it's obviously irrelevant
      }
    }
    return;
  }

  // Populate memory
  currentSessionId = state.sessionId;
  barcodesToProcess = state.barcodesToProcess;
  currentIndex = state.currentIndex;

  // previousIndex is the barcode that triggered the navigation that produced the current page
  const previousIndex = currentIndex - 1;

  // If previousIndex is valid, interpret the current page as the result of that previous search
  if (previousIndex >= 0 && previousIndex < barcodesToProcess.length) {
    const prevBarcode = barcodesToProcess[previousIndex];

    // If we're on an edit page -> previous barcode was found
    if (/\/stock\/\d+\/edit/.test(window.location.pathname)) {
      try {
        const data = await extractStockData(prevBarcode);
        data.url = window.location.href;
        chrome.runtime.sendMessage({ action: "nosposData", data: { sessionId: currentSessionId, result: data } });
      } catch (err) {
        console.error("[NOSPOS] Error extracting after navigation:", err);
        chrome.runtime.sendMessage({ action: "nosposData", data: { sessionId: currentSessionId, result: { barcode: prevBarcode, error: err.message } } });
      }

      // After sending success, continue to next
      await sleep(200);
      // don't increment here — currentIndex was already incremented by the code that initiated the search
    }
    // If we're on the search page -> previous barcode not found
    else if (window.location.href.includes("/search")) {
      const notFound = {
        barcode: prevBarcode,
        barserial: "",
        name: "",
        description: "couldn't find on nospos -- please double-check barcode",
        cost_price: "",
        retail_price: "",
        created_at: "",
        bought_by: "",
        quantity: "",
        type: "",
        specifications: {},
        branch: "",
        url: window.location.href,
        not_found: true
      };

      chrome.runtime.sendMessage({ action: "nosposData", data: { sessionId: currentSessionId, result: notFound } });
      await sleep(200);
      // don't increment here either — previous run already advanced currentIndex
    }
    // else: we're on some other page (login/home); let background handle login flows or navigate to search
  }

  // Now check whether the session is done (currentIndex points to the next barcode to search)
  if (currentIndex >= barcodesToProcess.length) {
    console.log("[NOSPOS] All barcodes processed");
    await storageRemove(["sessionId", "barcodesToProcess", "currentIndex"]);
    return;
  }

  // If we are on the search page, start the next search.
  if (window.location.href.includes("/stock/search")) {
    // start next search
    processNextBarcode();
    return;
  }

  // If we are on an edit page (maybe user didn't trigger next search), we can still trigger a new search from here
  if (/\/stock\/\d+\/edit/.test(window.location.pathname)) {
    // Start next search from edit page's search input
    processNextBarcode();
    return;
  }

  // Otherwise, navigate to the search page so processNextBarcode can find the right input
  window.location.href = SEARCH_PAGE;
})();

// ----- Initiates a search for currentIndex barcode (does NOT expect to survive navigation) -----
async function processNextBarcode() {
  if (!barcodesToProcess || currentIndex >= barcodesToProcess.length) {
    console.log("[NOSPOS] Nothing to process or all barcodes processed");
    await storageRemove(["sessionId", "barcodesToProcess", "currentIndex"]);
    return;
  }

  const barcode = barcodesToProcess[currentIndex];
  console.log(`[NOSPOS] [${currentIndex + 1}/${barcodesToProcess.length}] Searching: ${barcode}`);

  await waitForLoad();
  await sleep(300);

  let searchInput = null;

  if (/\/stock\/\d+\/edit/.test(window.location.pathname)) {
    searchInput = document.querySelector("#searchform-query");
  } else if (window.location.href.includes("/stock/search")) {
    searchInput = document.querySelector("#stocksearchandfilter-query");
  }

  if (!searchInput) {
    console.warn("[NOSPOS] No search input found; navigating to search page");
    // try to salvage by navigating to the search page
    if (!window.location.href.includes("/stock/search")) {
      window.location.href = SEARCH_PAGE;
    }
    return;
  }

  // Fill input, trigger input event
  searchInput.value = barcode;
  searchInput.dispatchEvent(new Event("input", { bubbles: true }));

  // Advance the logical pointer (this is important: we store the "next" index so resume interprets page as result of previousIndex)
  currentIndex++;
  saveState();

  // Submit
  const form = searchInput.closest("form");
  if (form) form.submit();
  else {
    const searchBtn = document.querySelector('button[type="submit"], .btn-search');
    if (searchBtn) searchBtn.click();
    else {
      // fallback: press Enter on input
      searchInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, bubbles: true }));
    }
  }

  // Execution ends here — navigation will reload the page and the unified resumeAfterNavigation will handle the result.
}

// ----- Restore pending externally listed update on content script reload -----
// note: we already check pendingExternallyListed in resume flow, but keep this as an additional safety net
(async function restorePendingExternallyListed() {
  const pending = await storageGet("pendingExternallyListed");
  if (pending && pending.pendingExternallyListed) {
    const serial = pending.pendingExternallyListed;
    if (/\/stock\/\d+\/edit/.test(window.location.pathname)) {
      console.log(`[NOSPOS] Resuming pending externally listed update for ${serial}`);
      handleExternallyListedUpdate(serial);
    } else {
      // leave it in storage for resume logic or other triggers
    }
  }
})();
