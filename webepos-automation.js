// webepos-automation.js - Chrome Extension Content Script for WebEpos
console.log("📦 WebEpos automation script loaded");

const BRANCH_TO_STORE = {
  "Warrington": "4157a468-0220-45a4-bd51-e3dffe2ce7f0",
  "Netherton": "604d760c-7742-4861-ae64-344c3a343b07",
  "Wythenshawe": "2124b7c4-5013-424f-ad03-f49b0d2f4efa",
  "Toxteth": "289123c4-d483-4fc1-b36f-8c6534121f0d"
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForSelector(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(selector)) return resolve(document.querySelector(selector));
    
    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector);
      if (element) {
        observer.disconnect();
        resolve(element);
      }
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
    
    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timeout waiting for ${selector}`));
    }, timeout);
  });
}

function waitForNavigationAway(currentUrl, timeout = 0) {
  return new Promise((resolve) => {
    const check = () => {
      if (!window.location.href.includes(currentUrl)) {
        resolve();
      } else if (timeout > 0) {
        setTimeout(check, 500);
      } else {
        requestAnimationFrame(check);
      }
    };
    check();
  });
}

async function fillProductForm(data) {
  const { item_name, description, price, serial_number, branch } = data;

  console.log("[WebEpos] Filling product form...");

  // Toggle "Normal" switch OFF
  try {
    const normalSwitch = await waitForSelector("#normal-switch", 5000);
    const isChecked = normalSwitch.getAttribute('aria-checked') === 'true';
    
    if (isChecked) {
      const bg = normalSwitch.parentElement.querySelector('.react-switch-bg');
      const checkIcon = bg?.children[0];
      const crossIcon = bg?.children[1];
      
      normalSwitch.setAttribute('aria-checked', 'false');
      normalSwitch.style.transform = 'translateX(0px)';
      if (bg) bg.style.background = '#ccc';
      if (checkIcon) checkIcon.style.opacity = '0';
      if (crossIcon) crossIcon.style.opacity = '1';
      
      console.log("[WebEpos] Normal switch toggled OFF");
    }
  } catch (error) {
    console.warn("[WebEpos] Could not toggle normal switch:", error);
  }

  // Fill title
  try {
    const titleInput = await waitForSelector("#title", 5000);
    titleInput.value = item_name;
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    titleInput.dispatchEvent(new Event('change', { bubbles: true }));
    console.log("[WebEpos] Title filled");
  } catch (error) {
    throw new Error("Could not find title field");
  }

  // Select store
  try {
    const storeSelect = await waitForSelector("#storeId", 5000);

    // Wait until the dropdown actually has all its options
    let attempts = 0;
    while (storeSelect.options.length < 4 && attempts < 10) {
      console.log(`[WebEpos] Waiting for store options to load... (${attempts + 1})`);
      await sleep(300);
      attempts++;
    }

    const storeId = BRANCH_TO_STORE[branch] || BRANCH_TO_STORE["Warrington"];
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      'value'
    ).set;

    // Ensure the desired store option actually exists
    const optionExists = [...storeSelect.options].some(opt => opt.value === storeId);
    if (!optionExists) {
      console.warn(`[WebEpos] Store ID ${storeId} not found in dropdown after waiting`);
    } else {
      // Use native setter so React picks it up
      nativeInputValueSetter.call(storeSelect, storeId);
      storeSelect.dispatchEvent(new Event('input', { bubbles: true }));
      storeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      console.log(`[WebEpos] Store set to ${branch} (${storeId})`);
    }

    console.log(`[WebEpos] Store set to ${branch} (${storeId})`);
  } catch (error) {
    console.warn("[WebEpos] Could not set store:", error);
  }

  // Fill description
  try {
    const descTextarea = await waitForSelector('textarea[name="intro"]', 5000);
    descTextarea.value = description;
    descTextarea.dispatchEvent(new Event('input', { bubbles: true }));
    descTextarea.dispatchEvent(new Event('change', { bubbles: true }));
    console.log("[WebEpos] Description filled");
  } catch (error) {
    console.warn("[WebEpos] Could not fill description:", error);
  }

  // Fill price
  try {
    if (price && price.replace('.', '', 1).match(/^\d+$/)) {
      const priceInput = await waitForSelector("#price", 5000);
      priceInput.value = price;
      priceInput.dispatchEvent(new Event('input', { bubbles: true }));
      priceInput.dispatchEvent(new Event('change', { bubbles: true }));
      console.log("[WebEpos] Price filled");
    } else {
      console.warn(`[WebEpos] Invalid price: ${price}`);
    }
  } catch (error) {
    console.warn("[WebEpos] Could not fill price:", error);
  }

  // Fill barcode (serial number)
  if (serial_number) {
    try {
      const barcodeInput = await waitForSelector("#barcode", 5000);
      barcodeInput.value = serial_number;
      barcodeInput.dispatchEvent(new Event('input', { bubbles: true }));
      barcodeInput.dispatchEvent(new Event('change', { bubbles: true }));
      console.log("[WebEpos] Barcode filled");
    } catch (error) {
      console.warn("[WebEpos] Could not fill barcode:", error);
    }
  }

  // Select fulfilment option
  try {
    const fulfilmentSelect = await waitForSelector("#fulfilmentOption", 5000);
    fulfilmentSelect.value = "anyfulfilment";
    fulfilmentSelect.dispatchEvent(new Event('change', { bubbles: true }));
    console.log("[WebEpos] Fulfilment option set");
  } catch (error) {
    console.warn("[WebEpos] Could not set fulfilment:", error);
  }

  // Select condition
  try {
    const conditionSelect = await waitForSelector("#condition", 5000);
    conditionSelect.value = "used";
    conditionSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(500); // Wait for grade to appear
    console.log("[WebEpos] Condition set to used");
  } catch (error) {
    console.warn("[WebEpos] Could not set condition:", error);
  }

  // Select grade
  try {
    const gradeSelect = await waitForSelector("#grade", 5000);
    gradeSelect.value = "B";
    gradeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    console.log("[WebEpos] Grade set to B");
  } catch (error) {
    console.warn("[WebEpos] Could not set grade:", error);
  }

  console.log("[WebEpos] Form filled successfully. Waiting for user to save...");
}

async function waitForSaveCompletion() {
  console.log("[WebEpos] Monitoring for save completion...");

  return new Promise((resolve, reject) => {
    let savingDetected = false;

    const checkSaving = setInterval(() => {
      const savingText = Array.from(document.querySelectorAll('*'))
        .find(el => el.textContent.includes('Saving...'));
      
      if (savingText && !savingDetected) {
        savingDetected = true;
        console.log("[WebEpos] Saving detected...");
      }
      
      if (savingDetected && !savingText) {
        clearInterval(checkSaving);
        clearInterval(checkNavigation);
        console.log("[WebEpos] Save completed!");
        
        // Send signal to background script
        chrome.runtime.sendMessage({
          action: "webEposSaveCompleted",
          data: { timestamp: new Date().toISOString() }
        });


        resolve({ success: true, navigated: false });
      }
    }, 200);

    const checkNavigation = setInterval(() => {
      if (!window.location.href.includes('/products/new')) {
        clearInterval(checkSaving);
        clearInterval(checkNavigation);
        
        if (savingDetected) {
          console.log("[WebEpos] Save completed (detected via navigation)");
          resolve({ success: true, navigated: true });
        } else {
          console.warn("[WebEpos] User navigated away without saving");
          resolve({ success: false, navigated: true });
        }
      }
    }, 500);

    // Timeout after 5 minutes
    setTimeout(() => {
      clearInterval(checkSaving);
      clearInterval(checkNavigation);
      reject(new Error("Timeout waiting for save"));
    }, 300000);
  });
}

async function updateNosposItem(serial_number) {
  console.log(`[WebEpos] Opening NOSPOS for barcode ${serial_number}...`);

  try {
    // Open NOSPOS in a new tab
    const nosposWindow = window.open("https://nospos.com/stock/search", "_blank");
    
    if (!nosposWindow) {
      throw new Error("Failed to open NOSPOS window - popup might be blocked");
    }

    // Send message to background script to handle NOSPOS automation
    chrome.runtime.sendMessage({
      action: "updateNosposCheckbox",
      data: { serial_number }
    });

    console.log("[WebEpos] NOSPOS update initiated");
    return true;
  } catch (error) {
    console.error("[WebEpos] Error opening NOSPOS:", error);
    return false;
  }
}

// Listen for automation requests
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.action === "startWebEposListing") {
    console.log("[WebEpos] Received listing request:", message.data);

    // Immediately acknowledge request
    sendResponse({ success: true, message: "Listing started" });

    try {
      // Fill the form
      await fillProductForm(message.data);
      
      // Wait for user to save
      const result = await waitForSaveCompletion();
      
      // If saved successfully and has serial number, update NOSPOS
      if (result.success && message.data.serial_number) {
        await sleep(2000);
        await updateNosposItem(message.data.serial_number);
      }

      // Send a separate "completion" message back to background
      chrome.runtime.sendMessage({
        action: "listingCompleted",
        data: {
          success: result.success,
          navigated: result.navigated,
          serial_number: message.data.serial_number || null
        }
      });


    } catch (error) {
      console.error("[WebEpos] Error:", error);
      sendResponse({
        success: false,
        error: error.message
      });
    }
  }

  return true; // Keep channel open for async response
});

console.log("[WebEpos] Ready to receive automation requests");