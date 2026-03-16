// ============================================================
// DOM FINDER — Background Service Worker
// Handles context menu, Groq API calls, and messaging
// ============================================================

// --- Context Menu Setup ---
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'dom-finder-summary',
    title: '🏠 Dom Finder — Podsumowanie oferty',
    contexts: ['page', 'link', 'selection'],
    documentUrlPatterns: [
      'https://www.otodom.pl/*', 'https://otodom.pl/*',
      'https://www.gratka.pl/*', 'https://gratka.pl/*',
      'https://www.olx.pl/*', 'https://olx.pl/*',
      'https://www.domy.pl/*', 'https://domy.pl/*',
      'https://www.morizon.pl/*', 'https://morizon.pl/*',
      'https://www.domiporta.pl/*', 'https://domiporta.pl/*',
      'https://www.sprzedajemy.pl/*', 'https://sprzedajemy.pl/*',
      'https://www.adresowo.pl/*', 'https://adresowo.pl/*',
      'https://www.nieruchomosci-online.pl/*', 'https://nieruchomosci-online.pl/*',
      'https://www.rynekpierwotny.pl/*', 'https://rynekpierwotny.pl/*',
      'https://www.gethome.pl/*', 'https://gethome.pl/*',
      'https://www.adradar.pl/*', 'https://adradar.pl/*'
    ]
  });
});

// --- Context Menu Click Handler ---
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'dom-finder-summary') {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'extractAndSummarize' });
    } catch (err) {
      // Content script not injected yet — inject it programmatically
      console.log('[Dom Finder] Content script not found, injecting...');
      try {
        await injectContentScripts(tab.id);
        // Small delay to let the script initialize
        await new Promise(r => setTimeout(r, 300));
        await chrome.tabs.sendMessage(tab.id, { action: 'extractAndSummarize' });
      } catch (injectErr) {
        console.error('[Dom Finder] Failed to inject content script:', injectErr.message);
      }
    }
  }
});

// --- SPA (Single Page Application) Navigation Support ---
// Many real estate sites (like Otodom) use React/Next.js and don't trigger hard reloads.
const validDomains = ['otodom.pl', 'gratka.pl', 'olx.pl', 'domy.pl', 'morizon.pl', 'domiporta.pl', 'sprzedajemy.pl', 'adresowo.pl', 'nieruchomosci-online.pl', 'rynekpierwotny.pl', 'gethome.pl', 'adradar.pl'];

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const isSupported = validDomains.some(domain => tab.url.includes(domain));
    if (isSupported) {
      // Inject scripts to ensure they run on dynamic client-side navigations
      injectContentScripts(tabId).catch(() => {});
    }
  }
});

async function injectContentScripts(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId: tabId },
    files: ['content.js']
  });
  await chrome.scripting.insertCSS({
    target: { tabId: tabId },
    files: ['overlay.css']
  });
}

// --- Message Handler ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getAISummary') {
    handleAISummary(request.data)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true; // Keep message channel open for async response
  }

  if (request.action === 'getSettings') {
    chrome.storage.sync.get(['groqApiKey', 'destinationAddress', 'selectedModel'], (result) => {
      sendResponse({
        apiKey: result.groqApiKey || '',
        destination: result.destinationAddress || 'Warszawa Centrum',
        model: result.selectedModel || 'llama-3.3-70b-versatile'
      });
    });
    return true;
  }
});

// --- Groq API Call ---
async function handleAISummary(listingData) {
  const settings = await chrome.storage.sync.get(['groqApiKey', 'destinationAddress', 'selectedModel']);
  const apiKey = settings.groqApiKey;
  const destination = settings.destinationAddress || 'Warszawa Centrum';
  const model = settings.selectedModel || 'llama-3.3-70b-versatile';

  if (!apiKey) {
    return { error: 'Brak klucza API Groq. Kliknij ikonę rozszerzenia i wprowadź klucz API.' };
  }

  const prompt = buildPrompt(listingData, destination);

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content: `Jesteś ekspertem od nieruchomości w Polsce. Analizujesz oferty mieszkań i domów. Odpowiadaj ZAWSZE po polsku. Bądź zwięzły ale merytoryczny. Formatuj odpowiedź używając emoji i krótkich sekcji.`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 1500
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `Błąd API: ${response.status}`);
    }

    const data = await response.json();
    const aiText = data.choices?.[0]?.message?.content || 'Brak odpowiedzi z AI.';

    return {
      summary: aiText,
      model: model,
      destination: destination
    };
  } catch (err) {
    return { error: `Błąd połączenia z Groq: ${err.message}` };
  }
}

// --- Prompt Builder ---
function buildPrompt(listing, destination) {
  const parts = [];
  parts.push(`Przeanalizuj poniższą ofertę nieruchomości i stwórz zwięzłe podsumowanie.\n`);

  if (listing.title) parts.push(`📌 Tytuł: ${listing.title}`);
  if (listing.price) parts.push(`💰 Cena: ${listing.price}`);
  if (listing.pricePerMeter) parts.push(`💰 Cena/m²: ${listing.pricePerMeter}`);
  if (listing.area) parts.push(`📐 Powierzchnia: ${listing.area}`);
  if (listing.rooms) parts.push(`🚪 Pokoje: ${listing.rooms}`);
  if (listing.floor) parts.push(`🏢 Piętro: ${listing.floor}`);
  if (listing.location) parts.push(`📍 Lokalizacja: ${listing.location}`);
  if (listing.address) parts.push(`🗺️ Adres: ${listing.address}`);
  if (listing.yearBuilt) parts.push(`🏗️ Rok budowy: ${listing.yearBuilt}`);
  if (listing.condition) parts.push(`🔧 Stan: ${listing.condition}`);
  if (listing.heating) parts.push(`🔥 Ogrzewanie: ${listing.heating}`);
  if (listing.parking) parts.push(`🅿️ Parking: ${listing.parking}`);
  if (listing.description) {
    const desc = listing.description.substring(0, 2000);
    parts.push(`\n📝 Opis oferty:\n${desc}`);
  }

  parts.push(`\n---\nStwórz podsumowanie w następującym formacie:\n`);
  parts.push(`1. 📍 **LOKALIZACJA I OKOLICA** — analiza lokalizacji, co w pobliżu (sklepy, szkoły, parki, komunikacja miejska, metro), charakter dzielnicy`);
  parts.push(`2. ✅ **ZALETY** — 3-4 najważniejsze zalety`);
  parts.push(`3. ⚠️ **NA CO ZWRÓCIĆ UWAGĘ** — 2-3 potencjalne ryzyka lub ukryte wady (np. głośna ulica, brak windy, podejrzanie dziwny rozkład)`);
  parts.push(`4. 💡 **OCENA** — krótka ogólna ocena oferty (1-2 zdania) polecasz czy nie`);
  parts.push(`5. 🚨 **STAN / REMONT / INWESTYCJA** — PRZEANALIZUJ OPIS CZY OFERTA WYMAGA REMONTU LUB CZY JEST INWESTYCYJNA. Jeśli oferta jest "do remontu", "stan surowy", "odświeżenia" ALBO to oferta inwestycyjna (pod najem, flip), napisz o tym BARDZO WIDOCZNIE używając odpowiednich emoji ⚠️ lub 🛠️. Jeśli w wyciągniętym opisie ani liście cech nie ma informacji o stanie, ale niska cena lub inne cechy to sugerują, napisz: "Brak informacji o stanie technicznym nieruchomości, ale cena sugeruje, że może być to oferta 'do odświeżenia/remontu' 🛠️". Jeśli mieszkanie jest ewidentnie nowe/gotowe, pomiń ten punkt.`);

  return parts.join('\n');
}
