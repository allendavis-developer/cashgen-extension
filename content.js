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
      results.push(...scrapeCashConverters(selectors));
    } else if (competitor === "eBay") {
      results.push(...scrapeEbay(selectors));
    } else if (competitor === "CashGenerator") {
      results.push(...scrapeCashGenerator(selectors));
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

function scrapeCashConverters(selectors) {
  const results = [];
  const cards = document.querySelectorAll(selectors.container);

  cards.forEach(card => {
    try {
      const titleEl = card.querySelector(selectors.title);
      const priceEl = card.querySelector(selectors.price);
      const shopEl = card.querySelector(selectors.shop);
      const urlEl = card.querySelector('a');

      if (!titleEl || !priceEl) return;

      const title = titleEl.textContent.trim();
      const priceText = priceEl.textContent.trim();
      const price = parsePrice(priceText);
      const store = shopEl ? shopEl.textContent.trim() : null;

      let url = urlEl ? urlEl.href : null;
      if (url && url.startsWith('/')) {
        url = 'https://www.cashconverters.co.uk' + url;
      }

      // Extract ID from URL
      let id = null;
      if (urlEl && urlEl.getAttribute('href')) {
        const href = urlEl.getAttribute('href');
        const match = href.match(/\/(\d+)(?:\/)?$/);
        if (match) id = match[1];
      }

      if (title && price) {
        results.push({ competitor: "CashConverters", id, title, price, store, url });
      }
    } catch (e) {
      console.error("Error parsing CashConverters card:", e);
    }
  });

  return results;
}


function scrapeCashGenerator(selectors) {
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

      const gradeEl = card.querySelector(selectors.grade);
      const grade = gradeEl ? gradeEl.textContent.trim() : null;

      const titleEl = card.querySelector(selectors.title);
      const priceEl = card.querySelector(selectors.price);
      const urlEl = card.querySelector(selectors.url);


      if (!titleEl || !priceEl) return;

      const title = titleEl.textContent.trim();
      console.log(card, title);

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

      if (!grade || grade === 'B' || /\bB\b/.test(title)) {
        results.push({ competitor, id, title, price, store: null, url });
      }

      console.log({
      title: titleEl?.textContent.trim(),
      price: priceEl?.textContent.trim(),
      href: urlEl?.getAttribute('href'),
      grade
    });

    } catch (e) {
      console.error("Error parsing CEX card:", e);
    }
  });

  console.log(results);

  return results;
}


function scrapeEbay(selectors) {
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
        results.push({ competitor: "eBay", id, title, price, store: null, url });
      }
    } catch (e) {
      console.error("Error parsing eBay card:", e);
    }
  });

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