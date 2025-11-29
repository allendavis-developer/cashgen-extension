// background.js - Service Worker for Chrome Extension

const SCRAPER_CONFIGS = {
  CashConverters: {
      baseUrl: "https://www.cashconverters.co.uk",

      // Use a function to generate the search URL
      searchUrl: ({ query, model, subcategory, category, attributes }) => {

        // Map category using   
        let categoryId = "all"; // default
        if (category) {
          switch (category.toLowerCase()) {
            case "smartphones and mobile":
              categoryId = "1073741966";
              break;
            case "games (discs & cartridges)":
              categoryId = "1073741887";
              break;  
            case "tablets":
              categoryId = "1073741998";
              break;
            case "laptops":
              categoryId = "1073742012";
              break;
            case "gaming consoles":
              categoryId = "1073741901";
              break;
            default:
              categoryId = "all";
          }
        }

        let url = `https://www.cashconverters.co.uk/search-results?Sort=default&page=1&query=${encodeURIComponent(query)}&f%5Bcategory%5D%5B0%5D=${categoryId}&f%5Blocations%5D%5B0%5D=all`;

        console.log(subcategory);

        return url;
    },
    
    selectors: {
      price: ".product-item__price",
      title: ".product-item__title__description",
      shop: ".product-item__title__location",
      url: ".product-item__title, .product-item__image a",
      container: ".product-item-wrapper"
    }
  },
  CashGenerator: {
    baseUrl: "https://cashgenerator.co.uk",
    searchUrl: "https://cashgenerator.co.uk/pages/search-results-page?q={query}&tab=products&sort_by=price&sort_order=asc&page=1",
    selectors: {
      price: ".snize-price.money",
      title: ".snize-title",
      shop: ".snize-attribute",
      url: ".snize-view-link"
    }
  },
  CEX: {
    baseUrl: "https://uk.webuy.com",
    searchUrl: ({ query, model,subcategory, category, attributes }) => {

      // Build base URL
      let url = `https://uk.webuy.com/search?stext=${encodeURIComponent(query)}`;

      // Append storage filter if exists
      if (attributes?.storage && category == "smartphones and mobile") {
        url += `&Capacity=${encodeURIComponent(attributes.storage)}`;
      }
      
      // Map category using switch
      if (category) {
        switch (category.toLowerCase()) {
          case "smartphones and mobile":
            url += '&superCatName=Phones';
            url += `&Grade=B`;
            break; 
          case "games (discs & cartridges)":
            url += "&superCatName=Gaming";
            if (subcategory.toLowerCase() === "switch games") {
              url += `&categoryFriendlyName=Switch+Games`;
            } 

            console.log(subcategory);
            break;
          default:
        }
      }

      // Add brand filter for ipads subcategory
      if (subcategory && subcategory.toLowerCase() === "ipads") {
        if (subcategory.toLowerCase() === "ipads") {
            url += `&categoryFriendlyName=Apple+iPad`;
        } 
      }


      return url;
    },
    selectors: {
      container: ".wrapper-box",
      title: ".content .card-title a",
      price: ".content .product-main-price",
      url: ".content .card-title a",
      grade: ".grade-letter"
    }
  },

  eBay: {
    baseUrl: "https://www.ebay.co.uk",
    searchUrl: "https://www.ebay.co.uk/sch/i.html?_nkw={query}&_sacat=0&_from=R40&LH_ItemCondition=3000&LH_PrefLoc=1&LH_Sold=1&LH_Complete=1",
    selectors: {
      price: ".s-card__price, .su-styled-text.primary.bold.large-1.s-card__price",
      title: ".s-card__title",
      url: ".su-card-container__content > a",
      container: "#srp-river-results > ul > li"
    }
  }
};

const activeSessions = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background received:", message);

  if (message.action === "scrape") {
    handleScrapeRequest(message.data, sendResponse);
    return true;
  }

  if (message.action === "scrapedData") {
    handleScrapedData(message.data, sender.tab.id);
    return false;
  }

  if (message.action === "scrapeNosposBarcodes") {
    handleNosposRequest(message.data, sendResponse);
    return true;
  }

  if (message.action === "nosposData") {
    handleNosposData(message.data);
    return false;
  }

  if (message.action === "nosposReady") {
    handleNosposReady(message.data, sender.tab.id);
    return false;
  }

  if (message.action === "createWebEposListing") {
    handleWebEposListing(message.data, sendResponse);
    return true;
  }

  if (message.action === "updateNosposCheckbox") {
    handleNosposCheckboxUpdate(message.data, sendResponse);
    return true;
  }

  if (message.action === "listingCompleted") {
    console.log("[Background] WebEpos listing completed:", message.data);
  }

  if (message.action === "webEposSaveCompleted") {
    // Send to all tabs
    // chrome.tabs.query({}, (tabs) => {
    //     tabs.forEach(tab => {
    //         chrome.tabs.sendMessage(tab.id, {
    //             action: "webEposSaveCompleted",
    //             data: message.data
    //         }, (response) => {
    //             if (chrome.runtime.lastError) {
    //                 // Ignore tabs without listener
    //                 return;
    //             }
    //         });
    //     });
    // });
  }
});

async function blockResourcesForTab(tabId) {
  const ruleId = tabId;
  
  const rules = [
    {
      id: ruleId,
      priority: 1,
      action: { type: "block" },
      condition: {
        resourceTypes: ["image", "stylesheet", "font"],
        tabIds: [tabId]
      }
    }
  ];

  await chrome.declarativeNetRequest.updateSessionRules({
    addRules: rules,
    removeRuleIds: [ruleId] // Remove existing rule for this tab first
  });
}


async function handleWebEposListing(data, sendResponse) {
  const { item_name, description, price, serial_number, branch } = data;

  console.log("[WebEpos] Starting listing automation...");

  // Validate required fields
  if (!item_name || !description || !price) {
    sendResponse({
      success: false,
      error: "Missing required fields: item_name, description, or price"
    });
    return;
  }

  try {
    // Find or create WebEpos tab
    const tabs = await chrome.tabs.query({ url: "https://webepos.cashgenerator.co.uk/*" });
    let webeposTab;

    if (tabs.length > 0) {
      webeposTab = tabs[0];
      await chrome.tabs.update(webeposTab.id, { 
        active: true, 
        url: "https://webepos.cashgenerator.co.uk/products/new" 
      });
    } else {
      webeposTab = await chrome.tabs.create({ 
        url: "https://webepos.cashgenerator.co.uk/products/new",
        active: true 
      });
    }

    // Track tab update to wait for page load
    const listener = async (tabId, changeInfo, tab) => {
      if (tabId !== webeposTab.id || changeInfo.status !== "complete") return;

      chrome.tabs.onUpdated.removeListener(listener);

      const currentUrl = tab.url || "";

      if (currentUrl.includes("/login")) {
        sendResponse({
          success: false,
          error: "Please log in to WebEpos before creating listings"
        });
        return;
      }

      // Send message to content script like NOSPOS
      chrome.tabs.sendMessage(webeposTab.id, {
        action: "startWebEposListing",
        data: { item_name, description, price, serial_number, branch }
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("[WebEpos] Error sending message:", chrome.runtime.lastError);
          sendResponse({
            success: false,
            error: chrome.runtime.lastError.message
          });
        } else {
          sendResponse(response);
        }
      });
    };

    chrome.tabs.onUpdated.addListener(listener);

  } catch (error) {
    console.error("[WebEpos] Error:", error);
    sendResponse({
      success: false,
      error: error.message
    });
  }
}


async function handleNosposCheckboxUpdate(data, sendResponse) {
  const { serial_number } = data;

  console.log(`[NOSPOS] Updating checkbox for barcode ${serial_number}...`);

  try {
    // Find or create NOSPOS tab
    const tabs = await chrome.tabs.query({ url: "https://nospos.com/*" });
    let nosposTab;

    if (tabs.length > 0) {
      nosposTab = tabs[0];
      await chrome.tabs.update(nosposTab.id, { 
        active: true,
        url: "https://nospos.com/stock/search"
      });
    } else {
      nosposTab = await chrome.tabs.create({ 
        url: "https://nospos.com/stock/search",
        active: true 
      });
    }

    // Wait for page load
    chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo, tab) {
      if (tabId === nosposTab.id && changeInfo.status === 'complete') {
        const currentUrl = tab.url || "";

        // 🔴 INSTANT CLOSE if login page detected
        if (currentUrl.includes("/site/standard-login") || currentUrl.includes("/login")) {
          console.warn("[NOSPOS] Login page detected - closing tab");
          chrome.tabs.onUpdated.removeListener(listener);
          chrome.tabs.remove(nosposTab.id);
          
          sendResponse({
            success: false,
            error: "Please log in to NOSPOS before updating listings"
          });
          return;
        }

        // Wait for intermediate redirects
        if (currentUrl === "https://nospos.com" || currentUrl === "https://nospos.com/") {
          // Will redirect, wait for next load
          return;
        }

        if (currentUrl.includes("/stock/search")) {
          chrome.tabs.onUpdated.removeListener(listener);
          
          setTimeout(() => {
            chrome.tabs.sendMessage(nosposTab.id, {
              action: "updateExternallyListed",
              data: { serial_number }
            }, (response) => {
              if (chrome.runtime.lastError) {
                console.error("[NOSPOS] Error:", chrome.runtime.lastError);
              }
              console.log("[NOSPOS] Checkbox update initiated");
            });
          }, 1500);
        }
      }
    });

  } catch (error) {
    console.error("[NOSPOS] Error:", error);
    sendResponse({
      success: false,
      error: error.message
    });
  }
}


async function handleScrapeRequest(data, sendResponse) {
  const { query, competitors, subcategory, category, model, attributes,  } = data;
  const sessionId = Date.now().toString();
  
  activeSessions.set(sessionId, {
    query,
    competitors,
    results: [],
    completed: 0,
    total: competitors.length
  });

  try {
    const tabPromises = competitors.map(async (competitor) => {
      const config = SCRAPER_CONFIGS[competitor];
      if (!config) {
        console.error(`No config found for ${competitor}`);
        return null;
      }
      
      const url = typeof config.searchUrl === 'function'
        ? config.searchUrl({ query, model, subcategory, category, attributes })
        : config.searchUrl.replace("{query}", encodeURIComponent(query)); 

      const tab = await chrome.tabs.create({ url: "about:blank", active: false });

      // Block resources BEFORE navigating to the actual URL
      // await blockResourcesForTab(tab.id);

      // Now navigate to the actual URL 
      await chrome.tabs.update(tab.id, { url });

      chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          chrome.tabs.sendMessage(tab.id, {
            action: "startScraping",
            competitor,
            config: config.selectors,
            category,
            model,
            attributes,
            sessionId
          });
        }
      });

      return tab;
    });

    await Promise.all(tabPromises);

    const checkCompletion = setInterval(() => {
      const session = activeSessions.get(sessionId);
      if (session && session.completed >= session.total) {
        clearInterval(checkCompletion);
        sendResponse({
          success: true,
          results: session.results
        });
        activeSessions.delete(sessionId);
        
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach(tab => {
            if (tab.url && competitors.some(c => 
              tab.url.includes(SCRAPER_CONFIGS[c]?.baseUrl)
            )) {
              chrome.tabs.remove(tab.id);
            }
          });
        });
      }
    }, 500);

    setTimeout(() => {
      clearInterval(checkCompletion);
      const session = activeSessions.get(sessionId);
      if (session) {
        sendResponse({
          success: true,
          results: session.results,
          partial: true
        });
        activeSessions.delete(sessionId);
      }
    }, 30000);

  } catch (error) {
    console.error("Scraping error:", error);
    sendResponse({
      success: false,
      error: error.message
    });
  }
}

function handleScrapedData(data, tabId) {
  const { sessionId, competitor, results } = data;
  const session = activeSessions.get(sessionId);
  
  if (session) {
    session.results.push(...results);
    session.completed++;
    console.log(`${competitor} scraping complete. ${session.completed}/${session.total}`);
  }
}

async function handleNosposRequest(data, sendResponse) {
  const { barcodes } = data;
  const sessionId = Date.now().toString();

  console.log(`[NOSPOS] Starting scrape for ${barcodes.length} barcodes`);

  activeSessions.set(sessionId, {
    type: 'nospos',
    barcodes,
    results: [],
    currentIndex: 0,
    total: barcodes.length,
    tabId: null,
    aborted: false
  });

  try {
    const tabs = await chrome.tabs.query({ url: "https://nospos.com/*" });
    let nosposTab;

    if (tabs.length > 0) {
      nosposTab = tabs[0];
      await chrome.tabs.update(nosposTab.id, {
        active: true,
        url: "https://nospos.com/stock/search"
      });
    } else {
      nosposTab = await chrome.tabs.create({
        url: "https://nospos.com/stock/search",
        active: true
      });
    }

    // Store tab ID early (Fix #1)
    const session = activeSessions.get(sessionId);
    session.tabId = nosposTab.id;

    // -------------------------------
    // 🧨 ABORT WHEN TAB IS CLOSED
    // -------------------------------
    const onRemoved = async (closedTabId) => {
      const s = activeSessions.get(sessionId);
      if (!s || s.aborted) return;

      if (closedTabId === s.tabId) {
        console.warn("[NOSPOS] Tab closed by user — aborting scrape");

        s.aborted = true;
        activeSessions.delete(sessionId);

        chrome.runtime.sendMessage({
          action: "nosposScrape:failure",
          reason: "tabClosed"
        });

        sendResponse({
          success: false,
          error: "The NOSPOS tab was closed."
        });

        chrome.tabs.onRemoved.removeListener(onRemoved);
      }
    };

    chrome.tabs.onRemoved.addListener(onRemoved);

    // -------------------------------
    // 🧨 ABORT IF USER NAVIGATES AWAY
    // -------------------------------
    const onUpdated = async (tabId, changeInfo, tab) => {
      const s = activeSessions.get(sessionId);
      if (!s || s.aborted) return;

      if (tabId !== s.tabId) return;

      if (changeInfo.status === 'loading') {
        const url = tab.url || "";

        // Only allow NOSPOS stock pages during scraping
        const allowed =
          url.includes("/stock/search") ||
          url.includes("/stock/edit") ||
          url.includes("/nospos.com/stock/");

        if (!allowed && !url.includes("nospos.com")) {
          console.warn("[NOSPOS] User navigated off NOSPOS — aborting scrape");

          s.aborted = true;
          activeSessions.delete(sessionId);

          chrome.tabs.onUpdated.removeListener(onUpdated);
          chrome.tabs.onRemoved.removeListener(onRemoved);

          sendResponse({
            success: false,
            error: "User navigated away from NOSPOS."
          });

          return;
        }
      }

      // Wait for page to fully load
      if (tabId === s.tabId && changeInfo.status === 'complete') {
        const currentUrl = tab.url || "";

        // Handle login-interruption
        if (currentUrl.includes("/site/standard-login") || currentUrl.includes("/login")) {
          console.warn("[NOSPOS] User not logged in, aborting scrape.");

          s.aborted = true;
          activeSessions.delete(sessionId);

          chrome.tabs.onUpdated.removeListener(onUpdated);
          chrome.tabs.onRemoved.removeListener(onRemoved);

          chrome.tabs.remove(s.tabId);

          sendResponse({
            success: false,
            error: "Please log in to NOSPOS before starting a scrape."
          });
          return;
        }

        // Logged in and ready → initialize scraping
        chrome.tabs.onUpdated.removeListener(onUpdated);

        setTimeout(() => {
          chrome.tabs.sendMessage(s.tabId, {
            action: "initScraping",
            barcodes,
            sessionId
          });
        }, 1000);
      }
    };

    chrome.tabs.onUpdated.addListener(onUpdated);

    // -------------------------------
    // CHECK FOR COMPLETION
    // -------------------------------
    const checkCompletion = setInterval(async () => {
      const s = activeSessions.get(sessionId);
      if (!s || s.aborted) {
        clearInterval(checkCompletion);
        return;
      }

      if (s.results.length >= s.total) {
        clearInterval(checkCompletion);

        console.log(`[NOSPOS] Scrape complete for all ${s.total} barcodes`);

        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.tabs.onRemoved.removeListener(onRemoved);

        sendResponse({
          success: true,
          results: s.results
        });

        activeSessions.delete(sessionId);
      }
    }, 500);

    // -------------------------------
    // TIMEOUT SAFEGUARD — 5 MIN
    // -------------------------------
    setTimeout(async () => {
      const s = activeSessions.get(sessionId);
      if (!s || s.aborted) return;

      clearInterval(checkCompletion);

      console.warn("[NOSPOS] Scrape timed out — partial results returned");

      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);

      sendResponse({
        success: true,
        results: s.results,
        partial: true
      });

      try {
        await chrome.tabs.remove(s.tabId);
      } catch (err) {
        console.warn("[NOSPOS] Could not close tab after timeout:", err);
      }

      activeSessions.delete(sessionId);
    }, 300000);

  } catch (error) {
    console.error("[NOSPOS] Error:", error);
    sendResponse({
      success: false,
      error: error.message
    });
  }
}



function handleNosposData(data) {
  const { sessionId, result } = data;
  const session = activeSessions.get(sessionId);
  
  if (session) {
    session.results.push(result);
    console.log(`[NOSPOS] Got data for barcode. Total: ${session.results.length}/${session.total}`);
  }
}

function handleNosposReady(data, tabId) {
  const { sessionId } = data;
  console.log(`[NOSPOS] Content script ready in tab ${tabId}`);
}

function parsePrice(text) {
  try {
    if (text.includes(' to ')) {
      text = text.split(' to ')[0];
    }
    const cleaned = text.replace(/[£,()]/g, '').trim();
    const match = cleaned.match(/\d+\.?\d*/);
    return match ? parseFloat(match[0]) : null;
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}