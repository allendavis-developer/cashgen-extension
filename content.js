// content.js - Injected into competitor pages for scraping

console.log("Price scraper content script loaded");

// Signal to parent page that extension is ready
window.postMessage({ type: "EXTENSION_READY" }, "*");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "startScraping") {
    console.log("Starting scrape for:", message.competitor);
    scrapePage(message.competitor, message.config, message.sessionId);
    sendResponse({ received: true });
  }
  return true;
});

async function scrapePage(competitor, selectors, sessionId) {
  // Wait for content to load
  await waitForSelector(selectors.price || selectors.container, 5000);
  
  const results = [];

  try {
    // TODO: Can you just turn all of this into one function man
    if (competitor === "CashConverters") {
      results.push(...scrapeCashConverters(selectors));
    } else if (competitor === "eBay") {
      results.push(...scrapeEbay(selectors));
    } else if (competitor === "CashGenerator") {
      results.push(...scrapeCashGenerator(selectors));
    } else {
      results.push(...scrapeGeneric(competitor, selectors));
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

      if (title && price) {
        results.push({
          competitor: "CashConverters",
          title,
          price,
          store,
          url
        });
      }
    } catch (e) {
      console.error("Error parsing CashConverters card:", e);
    }
  });

  return results;
}

function scrapeEbay(selectors) {
  const results = [];
  const cards = document.querySelectorAll(selectors.container || 'li.s-card');

  cards.forEach(card => {
    try {
      // Try multiple selectors for each field
      const titleEl = card.querySelector('.s-card__title .su-styled-text.primary') ||
                      card.querySelector('.s-card__title') ||
                      card.querySelector('[role="heading"]');
      
      const priceEl = card.querySelector('.s-card__price') ||
                      card.querySelector('.s-item__price');
      
      const urlEl = card.querySelector('.su-card-container__content a') ||
                    card.querySelector('a.su-link');

      if (!titleEl || !priceEl) return;

      let title = titleEl.textContent.trim();
      title = title.replace(/^New listing\s*/i, '').trim();
      
      const priceText = priceEl.textContent.trim();
      const price = parsePrice(priceText);
      const url = urlEl ? urlEl.href : null;

      if (title && price) {
        results.push({
          competitor: "eBay",
          title,
          price,
          store: null,
          url
        });
      }
    } catch (e) {
      console.error("Error parsing eBay card:", e);
    }
  });

  return results;
}

function scrapeGeneric(competitor, selectors) {
  const results = [];
  
  // Get all titles first to iterate
  const titleElements = document.querySelectorAll(selectors.title);
  const priceElements = document.querySelectorAll(selectors.price);
  
  const titles = Array.from(titleElements).map(el => el.textContent.trim());
  const prices = Array.from(priceElements).map(el => {
    const text = el.textContent.trim();
    return parsePrice(text);
  }).filter(p => p !== null);

  // Get stores if available
  let stores = [];
  if (selectors.shop) {
    stores = Array.from(titleElements).map(titleEl => {
      try {
        const container = titleEl.closest('.snize-overhidden, .product-item-wrapper, .card, article') || 
                         titleEl.parentElement;
        const shopEl = container ? container.querySelector(selectors.shop) : null;
        return shopEl ? shopEl.textContent.trim().replace(/\s+/g, ' ') : null;
      } catch {
        return null;
      }
    });
  } else {
    stores = new Array(titles.length).fill(null);
  }

  // Get URLs
  let urls = [];
  if (selectors.url) {
    const urlElements = document.querySelectorAll(selectors.url);
    urls = Array.from(urlElements).map(urlEl => {
      let href = urlEl.href || null;
      if (href && href.startsWith('/')) {
        const baseUrl = SCRAPER_CONFIGS[competitor]?.baseUrl || '';
        href = baseUrl + href;
      }
      return href;
    });
  } else {
    urls = new Array(titles.length).fill(null);
  }

  // Combine into results
  const minLength = Math.min(titles.length, prices.length);
  for (let i = 0; i < minLength; i++) {
    if (titles[i] && prices[i]) {
      results.push({
        competitor,
        title: titles[i],
        price: prices[i],
        store: stores[i] || null,
        url: urls[i] || null
      });
    }
  }

  return results;
}

function scrapeCashGenerator(selectors) {
  const results = [];
  const cards = document.querySelectorAll('.snize-product');

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

      let url = urlEl ? urlEl.getAttribute('href') : null;
      if (url && url.startsWith('/')) {
        url = 'https://cashgenerator.co.uk' + url;
      }

      if (title && price) {
        results.push({
          competitor: 'CashGenerator',
          title,
          price,
          store,
          url
        });
      }
    } catch (e) {
      console.error('Error parsing CashGenerator card:', e);
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