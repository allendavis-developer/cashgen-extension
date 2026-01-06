// content.js - Injected into competitor pages for scraping
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


console.log("Price scraper content script loaded");

// Signal to parent page that extension is ready
window.postMessage({ type: "EXTENSION_READY" }, "*");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "startScraping") {
    scrapePage(message.competitor, message.config, message.sessionId);
    sendResponse({ received: true });
  }
  return true;
});

async function scrapePage(competitor, selectors, sessionId) {
  // Wait for content to load
  await waitForSelector(selectors.price || selectors.container, 5000);
  
  const results = [];

  // Extra delay to let dynamic content settle (especially CeX)
  if (competitor === "CEX") {
    await delay(1500); // 1.5s gives Vue time to patch the DOM
  }

  try {
    // TODO: Can you just turn all of this into one function man
    if (competitor === "CashConverters") {
      results.push(...await fetchAllCashConvertersResults(selectors));
    } else if (competitor === "eBay") {
      results.push(...await scrapeEbay(selectors));
    } else if (competitor === "CashGenerator") {
      results.push(...await scrapeCashGenerator(selectors));
    } else {
      results.push(...scrapeCEX(competitor, selectors));
    }
  } catch (error) {
    console.error(`Scraping error for ${competitor}:`, error);
  }

  // Send results back to background script
  chrome.runtime.sendMessage({
    action: "scrapedData",
    data: {
      sessionId,
      competitor,
      results
    }
  });
}

async function fetchAllCashConvertersResults() {
  let allResults = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    // Take current page URL and replace "search-results" with "c3api/search/results"
    // Add or replace the page parameter
    let apiUrl = new URL(window.location.href);
    apiUrl.pathname = apiUrl.pathname.replace("search-results", "c3api/search/results");
    apiUrl.searchParams.set("page", page);

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.5993.117 Safari/537.36",
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Referer": "https://www.cashconverters.co.uk/",
    };

    try {
      const response = await fetch(apiUrl.toString(), { headers });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const data = await response.json();
      const results = parseCashConvertersResults(data);

      if (results.length === 0) {
        hasMore = false; // Stop loop if no more results
      } else {
        allResults.push(...results);
        page++;
      }
    } catch (err) {
      console.error("Failed to fetch CashConverters API:", err);
      hasMore = false;
    }
  }

  return allResults;
}

function parseCashConvertersResults(payload) {
  const items = payload?.Value?.ProductList?.ProductListItems || [];

  return items.map(raw => {
    const title = raw.Title || "";
    const price = raw.Sp || 0;
    const url = raw.Url || "";
    const store = raw.StoreNameWithState || "";
    const condition = raw.Condition || raw.ProductCondition || "";
    const stable_id = raw.Code || null;

    return {
      competitor: "CashConverters",
      stable_id,
      title,
      price,
      description: "",
      condition,
      store,
      url: url.startsWith("/") ? `https://www.cashconverters.co.uk${url}` : url,
    };
  });
}

async function autoScroll() {
  return new Promise((resolve) => {
    let totalHeight = 0;
    const distance = 400; // pixels to scroll per step
    const timer = setInterval(() => {
      const scrollHeight = document.body.scrollHeight;
      window.scrollBy(0, distance);
      totalHeight += distance;

      if (totalHeight >= scrollHeight) {
        clearInterval(timer);
        resolve();
      }
    }, 100); // wait 100ms per scroll
  });
}


async function scrapeCashGenerator(selectors) {
  await autoScroll(); // make sure all products are loaded

  const results = [];
  const cards = document.querySelectorAll('.snize-product');

  // Stores to exclude (case-insensitive)
  const excludedStores = [
    'Cash Generator Warrington',
    'Cash Generator Toxteth',
    'Cash Generator Wythenshawe',
    'Cash Generator Netherton'
  ].map(s => s.toLowerCase());


  cards.forEach(card => {
    try {
      const urlEl = card.querySelector('.snize-view-link');
      const titleEl = card.querySelector('.snize-title');
      const priceEl = card.querySelector('.snize-price.money');
      const shopEl = card.querySelector('.snize-attribute');

      if (!titleEl || !priceEl) return;

      const title = titleEl.textContent.trim();
      const priceText = priceEl.textContent.trim();
      const price = parsePrice(priceText);
      const store = shopEl ? shopEl.textContent.trim() : null;

      // Skip excluded stores
      if (store && excludedStores.includes(store.toLowerCase())) {
        console.log("Skipping: ", store);
        return;
      }

      console.log("scraping this ", card);


      let url = urlEl ? urlEl.getAttribute('href') : null;
      if (url && url.startsWith('/')) {
        url = 'https://cashgenerator.co.uk' + url;
      }

      // Extract ID
      const id = card.getAttribute('data-original-product-id') ||
                 (card.id ? card.id.replace(/\D/g, '') : null);

      if (title && price) {
        results.push({ competitor: 'CashGenerator', id, title, price, store, url });
      }
    } catch (e) {
      console.error('Error parsing CashGenerator card:', e);
    }
  });

  return results;
}


function scrapeCEX(competitor, selectors) {
  const results = [];
  const cards = document.querySelectorAll(selectors.container);

  cards.forEach(card => {
    try {
      const titleEl = card.querySelector(selectors.title);
      const priceEl = card.querySelector(selectors.price);
      const urlEl = card.querySelector(selectors.url);

      if (!titleEl || !priceEl) return;

      const title = titleEl.textContent.trim();
      const priceText = priceEl.textContent.trim();
      const price = parsePrice(priceText);

      let url = urlEl ? urlEl.href || urlEl.getAttribute('href') : null;
      if (url && url.startsWith('/')) {
        url = SCRAPER_CONFIGS[competitor]?.baseUrl + url;
      }

      // Extract product code from query param `id`
      let id = null;
      if (urlEl && urlEl.getAttribute('href')) {
        const href = urlEl.getAttribute('href');
        const match = href.match(/[?&]id=([^&]+)/);
        if (match) id = decodeURIComponent(match[1]);
      }

      // Check grade in title
      const gradeMatch = title.match(/\b([A-C])\b/i);
      if (!gradeMatch || gradeMatch[1].toUpperCase() === 'B') {
        results.push({ competitor, id, title, price, store: null, url });
      }

      console.log({
        title,
        price: priceText,
        href: urlEl?.getAttribute('href'),
      });

    } catch (e) {
      console.error("Error parsing CEX card:", e);
    }
  });

  console.log(results);

  return results;
}

function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve, reject) => {
    // Check if element already exists
    const element = document.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }

    // Set up MutationObserver to watch for the element
    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector);
      if (element) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(element);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Set timeout to reject if element doesn't appear
    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Element ${selector} not found within ${timeout}ms`));
    }, timeout);
  });
}

async function scrapeEbay(selectors) {
  const results = [];
  const cards = document.querySelectorAll(selectors.container || 'li.s-card');

  cards.forEach(card => {
    try {
      const titleEl = card.querySelector('.s-card__title .su-styled-text.primary') ||
                      card.querySelector('.s-card__title') ||
                      card.querySelector('[role="heading"]');

      const priceEl = card.querySelector('.s-card__price') ||
                      card.querySelector('.s-item__price');

      const urlEl = card.querySelector('.su-card-container__content a') ||
                    card.querySelector('a.su-link') ||
                    card.querySelector('a[href*="/itm/"]');

      const imgEl = card.querySelector('img.s-card__image');
      const image = imgEl ? imgEl.src : null;

      if (!titleEl || !priceEl) return;

      let title = titleEl.textContent.trim();
      title = title.replace(/^New listing\s*/i, '').trim();

      const priceText = priceEl.textContent.trim();
      const price = parsePrice(priceText);

      // Skip anything that isn't a real number
      if (typeof price !== 'number' || Number.isNaN(price)) return;

      const url = urlEl ? urlEl.href : null;

      let id = null;
      if (url) {
        const match = url.match(/\/itm\/(\d+)/);
        if (match) id = match[1];
      }

      if (title) {
        results.push({ competitor: "eBay", id, title, price, store: null, url, image });
      }
    } catch (e) {
      console.error("Error parsing eBay card:", e);
    }
  });

  // After scraping, click the more filters button
  const moreFiltersBtn = document.querySelector(
    'body > div.srp-main.srp-main--isLarge > div.srp-rail__left > ul > li.x-refine__main__list--more button'
  );

  if (moreFiltersBtn) {
    moreFiltersBtn.click();
    // Wait for the overlay to appear
    await waitForElement('#x-overlay__form');
  }


  return results;
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

function waitForSelector(selector, timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(selector)) {
      return resolve();
    }

    const observer = new MutationObserver(() => {
      if (document.querySelector(selector)) {
        observer.disconnect();
        resolve();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    setTimeout(() => {
      observer.disconnect();
      resolve(); // Resolve anyway after timeout
    }, timeout);
  });
}

// Define SCRAPER_CONFIGS in content script for base URLs
const SCRAPER_CONFIGS = {
  CashConverters: { baseUrl: "https://www.cashconverters.co.uk" },
  CashGenerator: { baseUrl: "https://cashgenerator.co.uk" },
  CEX: { baseUrl: "https://uk.webuy.com" },
  eBay: { baseUrl: "https://www.ebay.co.uk" }
};