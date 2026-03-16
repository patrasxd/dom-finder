// ============================================================
// DOM FINDER — Content Script
// Extracts listing data from otodom.pl and gratka.pl
// Shows overlay with AI summary
// ============================================================

(function () {
  'use strict';
  
  console.log("[Dom Finder] Content script LOADED on URL:", window.location.href);

  // Prevent double-injection
  if (window.__domFinderInjected) return;
  window.__domFinderInjected = true;
  
  console.log("[Dom Finder] Content script INITIALIZING...");

  const SITE = detectSite();
  let overlayEl = null;
  let floatingBtn = null;
  let currentHoveredCard = null;

  // ─── Site Detection ───
  function detectSite() {
    const host = window.location.hostname;
    if (host.includes('otodom.pl')) return 'otodom';
    if (host.includes('gratka.pl')) return 'gratka';
    if (host.includes('olx.pl')) return 'olx';
    if (host.includes('morizon.pl')) return 'morizon';
    if (host.includes('domiporta.pl')) return 'domiporta';
    if (host.includes('sprzedajemy.pl')) return 'sprzedajemy';
    return 'unknown';
  }

  // ─── OTODOM Parser ───
  const otodomParser = {
    isListingPage() {
      return window.location.pathname.includes('/oferta/') ||
        window.location.pathname.includes('/pl/oferta/');
    },

    extractFromListingPage() {
      const data = {};

      // Title
      const titleEl = document.querySelector('[data-cy="adPageAdTitle"], h1');
      data.title = titleEl?.textContent?.trim() || '';

      // Price
      const priceEl = document.querySelector('[data-cy="adPageHeaderPrice"], [aria-label="Cena"]');
      data.price = priceEl?.textContent?.trim() || '';

      // Price per meter
      const ppmEl = document.querySelector('[aria-label="Cena za metr kwadratowy"]');
      data.pricePerMeter = ppmEl?.textContent?.trim() || '';

      // Location / Address
      const locationEl = document.querySelector('[aria-label="Adres"], a[href*="map"]');
      data.location = locationEl?.textContent?.trim() || '';

      // Try breadcrumbs for location
      if (!data.location) {
        const breadcrumbs = document.querySelectorAll('[data-cy="breadcrumb-link"], nav[aria-label] a');
        const locationParts = [];
        breadcrumbs.forEach(el => {
          const t = el.textContent?.trim();
          if (t && !t.toLowerCase().includes('otodom') && !t.toLowerCase().includes('strona')) {
            locationParts.push(t);
          }
        });
        if (locationParts.length) data.location = locationParts.join(', ');
      }

      // Parameters table
      const params = document.querySelectorAll('[data-testid="table-value-area"], [data-testid*="table-value"]');
      const paramLabels = document.querySelectorAll('[data-testid*="table-label"]');

      // Try extracting from detailed params section
      const allParams = document.querySelectorAll('div[data-testid="ad.top-information.table"] div');
      allParams.forEach(el => {
        const text = el.textContent?.trim().toLowerCase();
        const value = el.nextElementSibling?.textContent?.trim();
        if (!value) return;
        if (text?.includes('powierzchnia')) data.area = value;
        if (text?.includes('pokoi') || text?.includes('pokoje')) data.rooms = value;
        if (text?.includes('piętro')) data.floor = value;
        if (text?.includes('rok budowy')) data.yearBuilt = value;
        if (text?.includes('stan')) data.condition = value;
        if (text?.includes('ogrzewanie')) data.heating = value;
        if (text?.includes('parking') || text?.includes('miejsce')) data.parking = value;
      });

      // Alternative: look for common parameter patterns
      const infoItems = document.querySelectorAll('[class*="parameter"], [class*="info"], li');
      infoItems.forEach(el => {
        const text = el.textContent?.trim();
        if (!text) return;
        if (text.match(/powierzchnia.*?(\d+[\s,.]?\d*\s*m)/i)) data.area = data.area || text.match(/(\d+[\s,.]?\d*\s*m²?)/i)?.[1];
        if (text.match(/poko[ij].*?(\d+)/i)) data.rooms = data.rooms || text.match(/(\d+)/)?.[1];
        if (text.match(/piętro.*?(\d+)/i)) data.floor = data.floor || text;
      });

      // Description
      const descEl = document.querySelector('[data-cy="adPageAdDescription"] div, [class*="description"]');
      data.description = descEl?.textContent?.trim() || '';

      // Additional: try to get data from JSON-LD
      const jsonLd = document.querySelector('script[type="application/ld+json"]');
      if (jsonLd) {
        try {
          const ld = JSON.parse(jsonLd.textContent);
          if (ld['@type'] === 'Product' || ld['@type'] === 'RealEstateListing') {
            data.title = data.title || ld.name;
            data.description = data.description || ld.description;
            if (ld.offers?.price) data.price = data.price || `${ld.offers.price} ${ld.offers.priceCurrency}`;
          }
        } catch (e) { /* ignore */ }
      }

      // Get address from the page more broadly
      const addressEl = document.querySelector('[class*="address"], [class*="location-address"]');
      data.address = addressEl?.textContent?.trim() || data.location || '';

      return data;
    },

    extractFromCard(card) {
      const data = {};

      // Title & Link — use data-cy="listing-item-link" as primary
      const linkEl = card.querySelector('a[data-cy="listing-item-link"]') || card.querySelector('a[href*="/oferta/"]');
      if (linkEl) {
        data.url = linkEl.href || '';
        // Title is often in h3 inside the link, or the link text itself
        const titleInner = linkEl.querySelector('h3, p, span');
        data.title = titleInner?.textContent?.trim() || linkEl.textContent?.trim() || '';
      }

      // Price
      const priceEl = card.querySelector('span[data-cy="listing-item-price"]');
      data.price = priceEl?.textContent?.trim() || '';

      // Price per meter (usually next to price)
      if (priceEl) {
        const parent = priceEl.parentElement;
        const siblings = parent?.querySelectorAll('span');
        siblings?.forEach(s => {
          const t = s.textContent?.trim();
          if (t && t.includes('zł/m') && s !== priceEl) data.pricePerMeter = t;
        });
      }

      // Location — try to find address-like text in the card
      // Otodom shows location as a separate line like "ul. X, Dzielnica, Warszawa, mazowieckie"
      const allText = card.querySelectorAll('p, span, div');
      allText.forEach(el => {
        const t = el.textContent?.trim();
        if (!t) return;
        // Location pattern: contains city/district names, commas, "mazowieckie" etc.
        if (t.match(/,.*(?:Warszawa|warszawa|mazowieckie|małopolskie|dolnośląskie|wielkopolskie|pomorskie|śląskie|łódzkie)/i) && !data.location) {
          data.location = t;
        }
      });

      // Parameters from card — rooms, area, floor
      const allSpans = card.querySelectorAll('span, dt, dd, li, div');
      allSpans.forEach(s => {
        const text = s.textContent?.trim();
        if (!text || text.length > 50) return; // Skip long text
        if (text.match(/^\d+[\s,.]?\d*\s*m²$/) && !data.area) data.area = text;
        if (text.match(/^\d+\s*poko/i) && !data.rooms) data.rooms = text;
        if (text.match(/piętro|parter/i) && text.length < 20 && !data.floor) data.floor = text;
      });

      // Also try to grab area/rooms from combined text like "3 pokoje  74.81 m²  parter"
      if (!data.area || !data.rooms) {
        const cardText = card.textContent || '';
        if (!data.rooms) {
          const roomMatch = cardText.match(/(\d+)\s*poko[ji]/i);
          if (roomMatch) data.rooms = roomMatch[0].trim();
        }
        if (!data.area) {
          const areaMatch = cardText.match(/(\d+[,.]?\d*)\s*m²/i);
          if (areaMatch) data.area = areaMatch[0].trim();
        }
      }

      data.address = data.location || '';
      return data;
    },

    getListingCards() {
      return document.querySelectorAll(
        'article[data-cy="listing-item"], ' +
        'section[data-cy="listing-item"], ' +
        '[data-cy="listing-item"], ' +
        '[data-cy="search.listing"], ' +
        'li[data-cy*="listing"]'
      );
    }
  };

  // ─── MORIZON Parser ───
  const morizonParser = {
    isListingPage() {
      return window.location.pathname.match(/\/oferta\//);
    },

    extractFromListingPage() {
      const data = {};

      data.title = document.querySelector('h1, header.offer-header h1')?.textContent?.trim() || '';
      data.price = document.querySelector('.details-price__value, .offer-price__number, .offer-price')?.textContent?.trim() || '';
      data.pricePerMeter = document.querySelector('.details-price__value-m2, .offer-price__m2, .price-m2')?.textContent?.trim() || '';
      
      const streetEl = document.querySelector('h2');
      const addressEl = document.querySelector('.details-location__address');
      
      const street = streetEl?.textContent?.trim() || '';
      const detailedAddress = addressEl?.textContent?.trim() || '';
      
      data.location = [street, detailedAddress].filter(Boolean).join(', ');
      data.address = data.location;

      const detailsRows = document.querySelectorAll('.offer-details__table tr, table tr, .details-features__item');
      detailsRows.forEach(row => {
        let th, td;
        if (row.classList.contains('details-features__item')) {
           th = row.querySelector('.details-features__label')?.textContent?.trim()?.toLowerCase();
           td = row.querySelector('.details-features__value')?.textContent?.trim();
        } else {
           th = row.querySelector('th')?.textContent?.trim()?.toLowerCase();
           td = row.querySelector('td')?.textContent?.trim();
        }
        
        if (!th || !td) return;
        
        if (th.includes('pow. całkowita') || th.includes('powierzchnia') || th.includes('area')) data.area = td;
        if (th.includes('liczba pokoi') || th.includes('pokoje') || th.includes('rooms')) data.rooms = td;
        if (th.includes('piętro') || th.includes('floor')) data.floor = td;
        if (th.includes('rok budowy') || th.includes('year built')) data.yearBuilt = td;
        if (th.includes('stan') || th.includes('condition')) data.condition = td;
        if (th.includes('ogrzewanie') || th.includes('heating')) data.heating = td;
      });

      // Quick facts on top fallback
      if (!data.area || !data.rooms) {
        const quickFacts = document.querySelectorAll('.offer-summary__item, [class*="param"]');
        quickFacts.forEach(item => {
           const label = item.getAttribute('title')?.toLowerCase() || item.textContent?.toLowerCase();
           const val = item.textContent?.replace(label || '', '')?.trim();
           if(label?.includes('powierzchnia') || item.textContent?.toLowerCase().includes('m²')) data.area = data.area || item.textContent?.trim();
           if(label?.includes('pokoi') || label?.includes('pokoje')) data.rooms = data.rooms || item.textContent?.trim();
           if(label?.includes('piętro')) data.floor = data.floor || item.textContent?.trim();
        });
      }

      data.description = document.querySelector('.offer-description__text, .description')?.textContent?.trim() || '';

      return data;
    },

    extractFromCard(card) {
      const data = genericParser.extractFromCard(card);
      
      // Morizon specific card selectors (from user snippet)
      const titleEl = card.querySelector('.property-card__title, [data-cy="propertyCardTitle"]');
      if (titleEl) data.title = titleEl.textContent.trim();

      const priceEl = card.querySelector('.property-card__price, .property-card__price--main, [data-cy="propertyCardPrice"]');
      if (priceEl) data.price = priceEl.textContent.trim();

      const featuresEl = card.querySelector('.property-card__features');
      if (featuresEl) {
        const text = featuresEl.textContent || '';
        if (text.includes('m²')) data.area = text.split('•').find(s => s.includes('m²'))?.trim();
        if (text.includes('poko')) data.rooms = text.split('•').find(s => s.includes('poko'))?.trim();
        if (text.includes('piętro')) data.floor = text.split('•').find(s => s.includes('piętro'))?.trim();
      }

      const locEl = card.querySelector('.property-card__location, [data-cy="propertyCardLocation"]');
      if (locEl) data.location = locEl.textContent.trim();

      // Ensure address matches location for Google Maps link
      data.address = data.location || '';
      
      return data;
    },

    getListingCards() {
      // Morizon specific card containers
      return Array.from(document.querySelectorAll('.property-card, [class*="property-card"], article.offer-item'));
    }
  };

  // ─── GRATKA Parser ───
  const gratkaParser = {
    isListingPage() {
      return window.location.pathname.match(/\/nieruchomosci\/.*?\/\d+/);
    },

    extractFromListingPage() {
      const data = {};

      // Title
      data.title = document.querySelector('h1, .sticker__title')?.textContent?.trim() || '';

      // Price
      data.price = document.querySelector('[class*="priceInfo__value"], .priceInfo, [class*="price"]')?.textContent?.trim() || '';

      // Price per m2
      const ppmEls = document.querySelectorAll('[class*="priceInfo__additional"], [class*="perMeter"]');
      ppmEls.forEach(el => {
        const text = el.textContent?.trim();
        if (text?.includes('m²') || text?.includes('/m')) data.pricePerMeter = text;
      });

      // Location
      data.location = document.querySelector('[class*="offerLocation"], [class*="location"], .location')?.textContent?.trim() || '';

      // Parameters
      const paramRows = document.querySelectorAll('[class*="parameters__item"], li[class*="param"], .parameters li');
      paramRows.forEach(row => {
        const label = row.querySelector('[class*="label"], span:first-child, dt')?.textContent?.trim()?.toLowerCase();
        const value = row.querySelector('[class*="value"], span:last-child, dd, b')?.textContent?.trim();
        if (!label || !value) return;
        if (label.includes('powierzchnia') || label.includes('area')) data.area = value;
        if (label.includes('pokoi') || label.includes('pokoje') || label.includes('rooms')) data.rooms = value;
        if (label.includes('piętro') || label.includes('floor')) data.floor = value;
        if (label.includes('rok budowy') || label.includes('year')) data.yearBuilt = value;
        if (label.includes('stan') || label.includes('condition')) data.condition = value;
        if (label.includes('ogrzewanie') || label.includes('heating')) data.heating = value;
        if (label.includes('parking')) data.parking = value;
      });

      // Description
      data.description = document.querySelector('[class*="description__container"], [class*="description"], .offerDescription')?.textContent?.trim() || '';
      data.address = data.location;

      return data;
    },

    extractFromCard(card) {
      const data = {};

      // Link and title
      const linkEl = card.querySelector('a[href*="/nieruchomosci/"]') || card.querySelector('a[class*="card"]') || card.querySelector('a');
      if (linkEl) {
        data.url = linkEl.href || '';
        data.title = linkEl.querySelector('h2, h3, [class*="title"]')?.textContent?.trim() || linkEl.textContent?.trim()?.substring(0, 200) || '';
      }

      data.price = card.querySelector('[class*="price"], span[class*="price"]')?.textContent?.trim() || '';
      data.location = card.querySelector('[class*="location"], span[class*="location"], [class*="address"]')?.textContent?.trim() || '';

      const spans = card.querySelectorAll('span, li, div');
      spans.forEach(s => {
        const t = s.textContent?.trim();
        if (!t || t.length > 30) return;
        if (t.match(/\d+[\s,]*\d*\s*m²/) && !data.area) data.area = t;
        if (t.match(/\d+\s*poko/i) && !data.rooms) data.rooms = t;
      });

      data.address = data.location || '';
      return data;
    },

    getListingCards() {
      return document.querySelectorAll(
        '[class*="listing__item"], ' +
        '[class*="teaserUnified"], ' +
        'article[class*="listing"], ' +
        'a.property-card, ' +
        'article.property-card, ' +
        '[class*="propertyCard"]'
      );
    }
  };

  // ─── DOMIPORTA Parser ───
  const domiportaParser = {
    isListingPage() {
      return !!document.querySelector('.details__header_price') || 
             window.location.pathname.includes('/nieruchomosci/sprzedam-') || 
             window.location.pathname.includes('/nieruchomosci/wynajmij-');
    },
    extractFromListingPage() {
      const data = {};
      data.title = document.querySelector('h1, .details__title')?.textContent?.trim() || '';
      data.price = document.querySelector('.details__header_price')?.textContent?.trim() || '';
      
      const locEl = document.querySelector('.details__location');
      data.location = locEl?.textContent?.trim() || '';
      data.address = data.location;

      const items = document.querySelectorAll('.details__features_item');
      items.forEach(item => {
        const label = item.querySelector('.details__features_label')?.textContent?.trim()?.toLowerCase();
        const value = item.querySelector('.details__features_value')?.textContent?.trim();
        if (!label || !value) return;
        if (label.includes('powierzchnia')) data.area = value;
        if (label.includes('liczba pokoi')) data.rooms = value;
        if (label.includes('piętro')) data.floor = value;
        if (label.includes('rok budowy')) data.yearBuilt = value;
      });

      data.description = document.querySelector('.details__description_content, .details__description_text')?.textContent?.trim() || '';
      return data;
    },
    extractFromCard(card) {
      const data = {};
      const titleLinks = card.querySelectorAll('.sneakpeak__title');
      if (titleLinks.length > 0) {
        const titleLink = titleLinks[0];
        data.url = titleLink.href;
        data.title = titleLink.querySelector('h2')?.textContent?.trim() || '';
        
        // Domiporta list view has multiple .sneakpeak__title links: title, location, category
        // The one containing city name/district is usually the one with the <span>
        const locLink = Array.from(titleLinks).find(link => link.querySelector('span')) || titleLinks[1] || titleLinks[0];
        const locSpan = locLink.querySelector('span') || locLink;
        data.location = locSpan.textContent?.trim() || '';
      }
      data.price = card.querySelector('.sneakpeak__price')?.textContent?.trim() || '';
      
      const details = card.querySelectorAll('.sneakpeak__details_item span');
      details.forEach(span => {
        const text = span.textContent?.trim() || '';
        if (text.includes('m²')) data.area = text;
        if (text.match(/^\d+ pok/i)) data.rooms = text;
        if (text.includes('piętro')) data.floor = text;
      });

      data.address = data.location;
      return data;
    },
    getListingCards() {
      return document.querySelectorAll('.sneakpeak');
    }
  };

  // ─── SPRZEDAJEMY Parser ───
  const sprzedajemyParser = {
    isListingPage() {
      return !!document.querySelector('.offerLink') || window.location.pathname.match(/-nr\d+$/);
    },
    extractFromListingPage() {
      const data = {};
      data.title = document.querySelector('h1')?.textContent?.trim() || '';
      data.price = document.querySelector('.price strong, .price-value')?.textContent?.trim() || '';
      
      const locEl = document.querySelector('.location, .offer-location');
      data.location = locEl?.textContent?.replace(/\s+/g, ' ')?.trim() || '';
      data.address = data.location;

      const attrs = document.querySelectorAll('.attributes li, .attribute');
      attrs.forEach(attr => {
        const label = attr.querySelector('span:first-child')?.textContent?.trim?.()?.toLowerCase() || '';
        const value = attr.querySelector('b, strong, span:last-child')?.textContent?.trim() || '';
        const text = attr.textContent?.toLowerCase() || '';

        if (text.includes('powierzchnia') || text.includes('m²')) data.area = value || text.match(/\d+[\s,.]?\d*\s*m²/)?.[0];
        if (text.includes('liczba pokoi') || text.includes('pokoi')) data.rooms = value || text.match(/(\d+)\s*pok/)?.[1];
        if (text.includes('piętro')) data.floor = value || text.match(/piętro\s*(\d+|parter)/i)?.[0];
      });

      data.description = document.querySelector('.description')?.textContent?.trim() || '';
      return data;
    },
    extractFromCard(card) {
      const data = {};
      const link = card.querySelector('a.offerLink');
      if (link) {
        data.url = link.href;
        data.title = link.textContent?.trim() || '';
      }
      data.price = card.querySelector('.price span')?.textContent?.trim() || '';
      data.location = card.querySelector('a.location')?.textContent?.trim() || '';
      
      const attrs = card.querySelectorAll('.attribute');
      attrs.forEach(attr => {
        const text = attr.textContent?.trim() || '';
        if (text.includes('m²')) data.area = text;
        if (text.match(/\d+\s*pok/i)) data.rooms = text;
        // Check if this attribute is actually the location link (Sprzedajemy puts it there sometimes)
        const locLink = attr.querySelector('a.location');
        if (locLink) data.location = locLink.textContent?.replace(/\s+/g, ' ')?.trim();
      });

      if (!data.location) {
        const locEl = card.querySelector('a.location');
        if (locEl) data.location = locEl.textContent?.replace(/\s+/g, ' ')?.trim();
      }
      return data;
    },
    getListingCards() {
      return document.querySelectorAll('article[class*="offer"], li.offer, article.offer-item, article');
    }
  };

  // ─── Supercharged Generic Parser (Handles dozens of sites) ───
  const genericParser = {
    isListingPage() {
      // Check URL and common traits for a specific property listing page
      const url = window.location.href;
      if (url.match(/\/(oferta|ogloszenie|nieruchomosci|property|details|mieszkanie|dom)\//i)) return true;
      if (document.querySelectorAll('h1').length === 1 && document.body.textContent.match(/cena|powierzchnia|pokoje/i)) return true;
      return false;
    },

    extractFromListingPage() {
      const data = {};
      const bodyText = document.body.innerText;

      // 1. JSON-LD Extraction (Best quality if exists)
      const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
      jsonLdScripts.forEach(script => {
        try {
          const ld = JSON.parse(script.textContent);
          const tryParseLD = (obj) => {
            if (!obj) return;
            if (obj['@type'] === 'Product' || obj['@type'] === 'Offer' || obj['@type'] === 'RealEstateListing') {
              if (obj.name) data.title = obj.name;
              if (obj.description) data.description = obj.description;
              if (obj.offers && obj.offers.price) {
                data.price = `${obj.offers.price} ${obj.offers.priceCurrency || 'PLN'}`;
              }
            }
          };
          if (Array.isArray(ld)) ld.forEach(tryParseLD);
          else tryParseLD(ld);
        } catch (e) { /* ignore */ }
      });

      // 2. DOM Extraction for missing fields
      data.title = data.title || document.querySelector('h1')?.textContent?.trim() || document.title;
      
      const descEl = document.querySelector('[class*="description"], [id*="description"], [class*="opis"], [itemprop="description"]');
      data.description = data.description || descEl?.textContent?.trim() || bodyText.substring(0, 3000);

      // Extract Price (look for price classes first, then regex)
      const priceEl = document.querySelector('[class*="price"], [itemprop="price"], [class*="cena"]');
      if (priceEl && priceEl.textContent.match(/\d/)) {
        data.price = data.price || priceEl.textContent.trim();
      } else if (!data.price) {
        const priceMatch = bodyText.match(/(\d[\d\s,]*)\s*(?:zł|PLN|pln)/i);
        if (priceMatch) data.price = priceMatch[0].trim();
      }

      // Extract Parameters using Regex on text or specific elements
      const paramText = document.querySelector('[class*="param"], [class*="detail"], [class*="szczegol"], [class*="info"]')?.textContent || bodyText;
      
      const areaMatch = paramText.match(/(\d+[\s,.]?\d*)\s*(?:m2|m²|mkw|metr|m\.kw)/i);
      if (areaMatch) data.area = `${areaMatch[1].trim()} m²`;

      // Extract exact number of rooms
      const roomsMatch = paramText.match(/(?:liczba pokoi|pokoje|pokoi)[\s:]*(\d+)|(\d+)\s*(?:pokoj|pokoi|pokoje)/i);
      if (roomsMatch) data.rooms = (roomsMatch[1] || roomsMatch[2]).trim();

      // Extract specific floor number
      const floorMatch = paramText.match(/(?:piętro|poziom)[\s:]*(\d+|parter)/i);
      if (floorMatch) data.floor = floorMatch[1].trim();
      
      const yearMatch = paramText.match(/(?:rok budowy)[\s:]*(\d{4})/i);
      if (yearMatch) data.yearBuilt = yearMatch[1].trim();

      // Location - try to find location elements
      const locEl = document.querySelector('[class*="location"], [class*="address"], [class*="lokalizacja"]');
      if (locEl) data.location = locEl.textContent.trim().substring(0, 100);

      data.address = data.location || '';
      return data;
    },

    extractFromCard(card) {
      const data = {};
      const linkEl = card.querySelector('a[href]');
      if (linkEl) {
        data.url = linkEl.href;
        data.title = linkEl.querySelector('h2, h3, h4, span.title, [class*="title"]')?.textContent?.trim() || linkEl.textContent?.trim() || '';
      }

      const cardText = card.textContent || '';
      const priceMatch = cardText.match(/(\d[\d\s,]*)\s*(?:zł|PLN|pln)/i);
      if (priceMatch) data.price = priceMatch[0].trim();

      const areaMatch = cardText.match(/(\d+[\s,.]?\d*)\s*(?:m2|m²|mkw)/i);
      if (areaMatch) data.area = `${areaMatch[1].trim()} m²`;

      const roomsMatch = cardText.match(/(\d+)\s*(?:pokoj|pokoi|pokoje)/i);
      if (roomsMatch) data.rooms = roomsMatch[1].trim();

      const floorMatch = cardText.match(/(?:piętro|poziom)[\s:]*(\d+|parter)/i);
      if (floorMatch) data.floor = floorMatch[1].trim();

      // Heuristic Location Extraction
      const allTextEls = card.querySelectorAll('p, span, div');
      for (const el of allTextEls) {
        const t = el.textContent?.trim();
        if (!t || t.length > 100) continue;
        
        // Match city names or addresses (e.g., "Warszawa", "Kraków", "ul. ...")
        if (t.match(/,.*(?:Warszawa|warszawa|Kraków|kraków|Wrocław|Poznań|Gdańsk|Łódź|mazowieckie|małopolskie|dolnośląskie)/i)) {
          data.location = t;
          break;
        }
        
        // Simple city name match as fallback if no comma
        if (t.match(/^(?:Warszawa|Kraków|Wrocław|Poznań|Gdańsk|Łódź)(?:\s*,.*)?$/i)) {
          data.location = t;
        }
      }

      return data;
    },

    getListingCards() {
      // Find elements that look like cards and contain a link
      const possibleCards = document.querySelectorAll(
        'article, [class*="card"], [class*="offer"], [class*="listing"], [class*="item"]'
      );
      
      const validCards = [];
      possibleCards.forEach(card => {
        // Must contain an anchor tag and some text (like price or area)
        if (card.querySelector('a') && card.textContent.match(/\d/)) {
          // Exclude huge containers like the whole page or lists
          if (card.children.length < 20 && card.innerText.length < 1500) {
             validCards.push(card);
          }
        }
      });
      return validCards;
    }
  };

  // ─── Get the right parser ───
  function getParser() {
    if (SITE === 'otodom') return otodomParser;
    if (SITE === 'gratka') return gratkaParser;
    if (SITE === 'olx') return olxParser;
    if (SITE === 'morizon') return morizonParser;
    if (SITE === 'domiporta') return domiportaParser;
    if (SITE === 'sprzedajemy') return sprzedajemyParser;
    return genericParser;
  }

  // ─── Create Overlay ───
  function createOverlay() {
    if (overlayEl) return overlayEl;

    overlayEl = document.createElement('div');
    overlayEl.id = 'dom-finder-overlay';
    overlayEl.innerHTML = `
      <div class="df-overlay-header">
        <div class="df-overlay-title">
          <span class="df-logo">🏠</span>
          <span>Dom Finder</span>
        </div>
        <div class="df-overlay-actions">
          <button class="df-btn-minimize" title="Minimalizuj">─</button>
          <button class="df-btn-close" title="Zamknij">✕</button>
        </div>
      </div>
      <div class="df-overlay-body">
        <div class="df-loading">
          <div class="df-spinner"></div>
          <p class="df-loading-text">Analizuję ofertę z AI...</p>
        </div>
        <div class="df-content" style="display:none">
          <div class="df-quick-facts"></div>
          <div class="df-commute-section"></div>
          <div class="df-ai-summary"></div>
        </div>
        <div class="df-error" style="display:none"></div>
      </div>
    `;

    document.body.appendChild(overlayEl);

    // Event listeners
    overlayEl.querySelector('.df-btn-close').addEventListener('click', closeOverlay);
    overlayEl.querySelector('.df-btn-minimize').addEventListener('click', toggleMinimize);

    // Make draggable
    makeDraggable(overlayEl);

    return overlayEl;
  }

  function closeOverlay() {
    if (overlayEl) {
      overlayEl.classList.add('df-closing');
      setTimeout(() => {
        overlayEl.classList.remove('df-closing', 'df-visible');
        overlayEl.querySelector('.df-content').style.display = 'none';
        overlayEl.querySelector('.df-loading').style.display = 'flex';
        overlayEl.querySelector('.df-error').style.display = 'none';
      }, 300);
    }
  }

  function toggleMinimize() {
    if (overlayEl) {
      overlayEl.classList.toggle('df-minimized');
      const btn = overlayEl.querySelector('.df-btn-minimize');
      btn.textContent = overlayEl.classList.contains('df-minimized') ? '□' : '─';
    }
  }

  function showOverlay() {
    createOverlay();
    overlayEl.classList.remove('df-closing', 'df-minimized');
    overlayEl.classList.add('df-visible');
    overlayEl.querySelector('.df-loading').style.display = 'flex';
    overlayEl.querySelector('.df-content').style.display = 'none';
    overlayEl.querySelector('.df-error').style.display = 'none';
  }

  // ─── Make Draggable ───
  function makeDraggable(el) {
    const header = el.querySelector('.df-overlay-header');
    let isDragging = false;
    let startX, startY, initialX, initialY;

    header.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      initialX = rect.left;
      initialY = rect.top;
      header.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      el.style.left = `${initialX + dx}px`;
      el.style.top = `${initialY + dy}px`;
      el.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
      header.style.cursor = 'grab';
    });
  }

  // ─── Display Results ───
  function displayResults(listingData, aiResponse) {
    if (!overlayEl) return;

    const contentEl = overlayEl.querySelector('.df-content');
    const loadingEl = overlayEl.querySelector('.df-loading');
    const errorEl = overlayEl.querySelector('.df-error');

    if (aiResponse.error) {
      loadingEl.style.display = 'none';
      errorEl.style.display = 'block';
      errorEl.innerHTML = `
        <div class="df-error-icon">⚠️</div>
        <p>${aiResponse.error}</p>
        ${!aiResponse.error.includes('klucz') ? '' : '<p class="df-error-hint">Kliknij ikonę rozszerzenia Dom Finder na pasku narzędzi, aby dodać klucz API.</p>'}
      `;
      return;
    }

    loadingEl.style.display = 'none';
    contentEl.style.display = 'block';

    // Quick facts
    const quickFacts = contentEl.querySelector('.df-quick-facts');
    const facts = [];
    if (listingData.price) facts.push(`<div class="df-fact"><span class="df-fact-icon">💰</span><div class="df-fact-text"><strong>Cena</strong><span>${listingData.price}</span></div></div>`);
    if (listingData.pricePerMeter) facts.push(`<div class="df-fact"><span class="df-fact-icon">💵</span><div class="df-fact-text"><strong>Za m²</strong><span>${listingData.pricePerMeter}</span></div></div>`);
    if (listingData.area) facts.push(`<div class="df-fact"><span class="df-fact-icon">📐</span><div class="df-fact-text"><strong>Metraż</strong><span>${listingData.area}</span></div></div>`);
    if (listingData.rooms) facts.push(`<div class="df-fact"><span class="df-fact-icon">🚪</span><div class="df-fact-text"><strong>Pokoje</strong><span>${listingData.rooms} ${listingData.rooms.match(/poko/i) ? '' : 'pokoi'}</span></div></div>`);
    if (listingData.floor) facts.push(`<div class="df-fact"><span class="df-fact-icon">🏢</span><div class="df-fact-text"><strong>Piętro</strong><span>${listingData.floor}</span></div></div>`);
    if (listingData.yearBuilt) facts.push(`<div class="df-fact"><span class="df-fact-icon">🏗️</span><div class="df-fact-text"><strong>Rok budowy</strong><span>${listingData.yearBuilt}</span></div></div>`);
    if (listingData.condition) facts.push(`<div class="df-fact"><span class="df-fact-icon">✨</span><div class="df-fact-text"><strong>Stan</strong><span>${listingData.condition}</span></div></div>`);
    if (listingData.location) facts.push(`<div class="df-fact df-fact-full"><span class="df-fact-icon">📍</span><div class="df-fact-text"><strong>Lokalizacja</strong><span>${listingData.location}</span></div></div>`);
    
    quickFacts.innerHTML = facts.length ? `<div class="df-facts-grid">${facts.join('')}</div>` : '';

    // AI Summary
    const aiSummaryEl = contentEl.querySelector('.df-ai-summary');
    if (aiResponse.aiDisabled) {
      aiSummaryEl.innerHTML = `
        <div class="df-section-title" style="opacity:0.6;">🤖 Agent AI <span class="df-model-badge" style="background:rgba(245,158,11,0.2);color:#f59e0b;">wyłączony</span></div>
        <div class="df-ai-text" style="color:#9ca3af;font-size:12px;">Włącz Agent AI w ustawieniach rozszerzenia, aby uzyskać analizę oferty.</div>
      `;
    } else {
      aiSummaryEl.innerHTML = `
        <div class="df-section-title">🤖 AI Overview <span class="df-model-badge">${aiResponse.model || ''}</span></div>
        <div class="df-ai-text">${formatAIText(aiResponse.summary)}</div>
      `;
    }

    // Commute section
    const commuteEl = contentEl.querySelector('.df-commute-section');
    const address = listingData.address || listingData.location || '';
    const destination = aiResponse.destination || 'Warszawa Centrum';

    if (address) {
      const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(address)}&destination=${encodeURIComponent(destination)}&travelmode=transit`;
      const embedUrl = `https://www.google.com/maps?saddr=${encodeURIComponent(address)}&daddr=${encodeURIComponent(destination)}&dirflg=r&output=embed`;
      commuteEl.innerHTML = `
        <div class="df-section-title">🗺️ Dojazd komunikacją miejską</div>
        <div class="df-maps-embed-container">
          <iframe
            class="df-maps-iframe"
            src="${embedUrl}"
            allowfullscreen
            loading="lazy"
            referrerpolicy="no-referrer-when-downgrade"
          ></iframe>
          <div class="df-maps-loading">
            <div class="df-spinner" style="width:24px;height:24px;border-width:2px"></div>
            <span>Ładuję mapę...</span>
          </div>
        </div>
        <div class="df-maps-info">
          <span class="df-maps-route">📍 ${address} → ${destination}</span>
        </div>
        <a href="${mapsUrl}" target="_blank" class="df-maps-link">
          <span class="df-maps-icon">🗺️</span>
          <span>Otwórz pełną trasę w Google Maps</span>
          <span class="df-arrow">→</span>
        </a>
      `;

      // Hide loading overlay when iframe loads
      const iframe = commuteEl.querySelector('.df-maps-iframe');
      const loadingDiv = commuteEl.querySelector('.df-maps-loading');
      iframe.addEventListener('load', () => {
        if (loadingDiv) loadingDiv.style.display = 'none';
      });
    } else {
      commuteEl.innerHTML = '';
    }
  }

  function formatAIText(text) {
    if (!text) return '';
    // Convert markdown-like formatting
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>')
      .replace(/^(#{1,3})\s+(.*)/gm, (_, hashes, content) => {
        const level = hashes.length + 2;
        return `<h${level} class="df-heading">${content}</h${level}>`;
      });
  }

  // ─── Floating Button (for listing cards on search pages) ───
  function createFloatingButton() {
    if (floatingBtn) return floatingBtn;
    floatingBtn = document.createElement('button');
    floatingBtn.id = 'dom-finder-float-btn';
    floatingBtn.classList.add('df-float-btn'); // For our own safety checks
    floatingBtn.innerHTML = '🏠 <span>Podsumowanie AI</span>';
    floatingBtn.title = 'Dom Finder — Podsumowanie oferty ze sztuczną inteligencją';

    // Update button label based on AI setting
    chrome.storage.sync.get(['aiAgentEnabled'], (result) => {
      const aiEnabled = result.aiAgentEnabled !== false;
      const labelSpan = floatingBtn.querySelector('span');
      if (labelSpan) {
        labelSpan.textContent = aiEnabled ? 'Podsumowanie AI' : 'Podsumowanie';
      }
      floatingBtn.title = aiEnabled
        ? 'Dom Finder — Podsumowanie oferty ze sztuczną inteligencją'
        : 'Dom Finder — Podsumowanie danych oferty';
    });
    
    // Force inline styles just in case the site's CSS is extremely aggressive
    floatingBtn.style.cssText = `
      position: absolute !important;
      z-index: 2147483647 !important;
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
      padding: 8px 14px !important;
      background: linear-gradient(135deg, #6366f1, #4f46e5) !important;
      color: white !important;
      border: none !important;
      border-radius: 10px !important;
      font-size: 13px !important;
      font-weight: 600 !important;
      font-family: system-ui, -apple-system, sans-serif !important;
      cursor: pointer !important;
      opacity: 0 !important;
      pointer-events: none !important;
      transition: opacity 0.2s ease, transform 0.2s ease !important;
      box-shadow: 0 4px 15px rgba(99, 102, 241, 0.4) !important;
      white-space: nowrap !important;
      transform: translateY(-5px) scale(0.9) !important;
    `;
    
    document.body.appendChild(floatingBtn);

    floatingBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (currentHoveredCard) {
        const parser = getParser();
        const data = parser.extractFromCard(currentHoveredCard);
        triggerSummary(data);
      }
    });

    return floatingBtn;
  }

  function showFloatingButton(card) {
    createFloatingButton();
    currentHoveredCard = card;
    const rect = card.getBoundingClientRect();
    
    // Ensure styles are forced visible
    floatingBtn.style.setProperty('top', `${Math.round(window.scrollY + rect.top + 8)}px`, 'important');
    floatingBtn.style.setProperty('left', `${Math.round(window.scrollX + rect.right - 180)}px`, 'important');
    floatingBtn.style.setProperty('opacity', '1', 'important');
    floatingBtn.style.setProperty('pointer-events', 'auto', 'important');
    floatingBtn.style.setProperty('transform', 'translateY(0) scale(1)', 'important');
    
    floatingBtn.classList.add('df-float-visible');
  }

  function hideFloatingButton() {
    if (floatingBtn) {
      floatingBtn.style.setProperty('opacity', '0', 'important');
      floatingBtn.style.setProperty('pointer-events', 'none', 'important');
      floatingBtn.style.setProperty('transform', 'translateY(-5px) scale(0.9)', 'important');
      floatingBtn.classList.remove('df-float-visible');
    }
    currentHoveredCard = null;
  }

  // ─── Setup Card Hover Listeners via Event Delegation ───
  function setupCardHovers() {
    if (window.__dfHoverListenerAdded) return;
    window.__dfHoverListenerAdded = true;

    // Helper to find a valid card element from a target
    function getCardElement(target) {
      if (!target || target === document.body) return null;

      // 1. Direct Ancestor Search (Fastest & most accurate for known structures)
      const exactCard = target.closest(
        '[data-cy="listing-item"], ' +
        '[data-cy="l-card"], ' +
        '[data-sentry-source-file="BaseCard.tsx"], ' +
        'article.property-card, a.property-card, .sneakpeak, article[class*="offer"], ' +
        '[class*="listing__item"], [class*="teaserUnified"]'
      );
      if (exactCard) return exactCard;

      // Specific Otodom Promoted/Investment cards fallback
      if (window.location.hostname.includes('otodom')) {
         const presentationCard = target.closest('div[role="presentation"], [data-sentry-element="ContentContainer"]');
         if (presentationCard && presentationCard.querySelector('a[href*="/pl/oferta/"]')) {
             return presentationCard;
         }
      }

      // 2. Generic Structural Search (if specific selectors fail)
      let el = target;
      while (el && el !== document.body) {
        // Exclude UI controls
        if (el.tagName === 'BUTTON' && el.getAttribute('aria-label')?.includes('slide')) break;
        if (el.classList.contains('df-float-btn')) break;

        // Does it look like a card? (Has a listing link AND a price/area AND is reasonably sized)
        if (el.tagName === 'DIV' || el.tagName === 'SECTION' || el.tagName === 'ARTICLE' || el.tagName === 'LI') {
          const hasListingLink = el.querySelector('a[href*="/pl/oferta/"], a[href*="/oferta/"], a[href*="/nieruchomosci/"], a[href*="-nr"], a.offerLink');
          
          // Check for price classes OR generic text context with non-breaking spaces (\u00A0)
          const hasPriceClass = el.querySelector('[class*="price" i], [class*="cena" i], [data-testid="ad-price"], [data-sentry-component*="Price"]');
          const hasPriceText = el.textContent && (/\d+[\s\u00A0]*(?:zł|pln)/i.test(el.textContent));
          
          if (hasListingLink && (hasPriceClass || hasPriceText)) {
            // Ensure this isn't the entire page or a huge list container
            if (el.offsetHeight > 100 && el.offsetHeight < 1200 && el.offsetWidth > 200) {
              return el;
            }
          }
        }
        el = el.parentElement;
      }

      return null;
    }

    document.addEventListener('mousemove', (e) => {
      // 1. Are we currently hovering a card? Check if we left its physical bounds.
      if (currentHoveredCard) {
        let isInsideCurrentCard = false;
        
        // Ensure card is still in the document
        if (document.body.contains(currentHoveredCard)) {
          const rect = currentHoveredCard.getBoundingClientRect();
          if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
            isInsideCurrentCard = true;
          }
        }
        
        // Are we hovering the floating button itself?
        let isInsideButton = false;
        if (floatingBtn && document.body.contains(floatingBtn)) {
           const btnRect = floatingBtn.getBoundingClientRect();
           // Expand hit area slightly to make it easier to reach
           if (e.clientX >= (btnRect.left - 20) && e.clientX <= (btnRect.right + 20) && e.clientY >= (btnRect.top - 20) && e.clientY <= (btnRect.bottom + 20)) {
             isInsideButton = true;
           }
        }

        // If we left both the card and the button, hide it.
        if (!isInsideCurrentCard && !isInsideButton) {
          console.log("[Dom Finder] Hiding button. Left card.", { isInsideCurrentCard, isInsideButton });
          hideFloatingButton();
        } else {
          // We are safely inside, no need to check for new cards
          return;
        }
      }

      // 2. Identify if we entered a new card
      // e.target might be a detached React node if it just re-rendered, so we use elementsFromPoint as a fallback
      let newCard = getCardElement(e.target);
      
      if (!newCard) {
         // Fallback for detached elements: ask browser what is *actually* under the cursor right now
         const elements = document.elementsFromPoint(e.clientX, e.clientY);
         for (const el of elements) {
           newCard = getCardElement(el);
           if (newCard) break;
         }
      }

      // If we found a valid card and it's not the one we're already tracking
      if (newCard && newCard !== currentHoveredCard) {
        console.log("[Dom Finder] Found NEW card! Tag:", newCard.tagName, "Classes:", newCard.className);
        showFloatingButton(newCard);
      }
    });
  }

  // ─── Parse listing data from fetched HTML string ───
  function parseHTMLForListingData(htmlString, site) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');
    const data = {};

    if (site === 'otodom') {
      // Title
      const titleEl = doc.querySelector('[data-cy="adPageAdTitle"], h1');
      data.title = titleEl?.textContent?.trim() || '';

      // Price
      const priceEl = doc.querySelector('[data-cy="adPageHeaderPrice"], [aria-label="Cena"]');
      data.price = priceEl?.textContent?.trim() || '';

      // Price per meter
      const ppmEl = doc.querySelector('[aria-label="Cena za metr kwadratowy"]');
      data.pricePerMeter = ppmEl?.textContent?.trim() || '';

      // Location
      const locationEl = doc.querySelector('[aria-label="Adres"], a[href*="map"]');
      data.location = locationEl?.textContent?.trim() || '';

      if (!data.location) {
        const breadcrumbs = doc.querySelectorAll('[data-cy="breadcrumb-link"], nav[aria-label] a');
        const parts = [];
        breadcrumbs.forEach(el => {
          const t = el.textContent?.trim();
          if (t && !t.toLowerCase().includes('otodom') && !t.toLowerCase().includes('strona')) parts.push(t);
        });
        if (parts.length) data.location = parts.join(', ');
      }

      // Parameters
      const allParams = doc.querySelectorAll('div[data-testid="ad.top-information.table"] div');
      allParams.forEach(el => {
        const text = el.textContent?.trim().toLowerCase();
        const value = el.nextElementSibling?.textContent?.trim();
        if (!value) return;
        if (text?.includes('powierzchnia')) data.area = value;
        if (text?.includes('pokoi') || text?.includes('pokoje')) data.rooms = value;
        if (text?.includes('piętro')) data.floor = value;
        if (text?.includes('rok budowy')) data.yearBuilt = value;
        if (text?.includes('stan wykończenia') || text?.includes('stan')) data.condition = value;
        if (text?.includes('ogrzewanie')) data.heating = value;
        if (text?.includes('parking') || text?.includes('miejsce')) data.parking = value;
        if (text?.includes('rynek')) data.market = value;
        if (text?.includes('rodzaj zabudowy')) data.buildingType = value;
      });

      // Also try parameter patterns
      const infoItems = doc.querySelectorAll('[class*="parameter"], [class*="info"], li');
      infoItems.forEach(el => {
        const text = el.textContent?.trim();
        if (!text) return;
        if (text.match(/powierzchnia.*?(\d+[\s,.]?\d*\s*m)/i)) data.area = data.area || text.match(/(\d+[\s,.]?\d*\s*m²?)/i)?.[1];
        if (text.match(/poko[ij].*?(\d+)/i)) data.rooms = data.rooms || text.match(/(\d+)/)?.[1];
        if (text.match(/piętro.*?(\d+)/i)) data.floor = data.floor || text;
      });

      // Description
      const descEl = doc.querySelector('[data-cy="adPageAdDescription"] div, [class*="description"]');
      data.description = descEl?.textContent?.trim() || '';

      // JSON-LD
      const jsonLd = doc.querySelector('script[type="application/ld+json"]');
      if (jsonLd) {
        try {
          const ld = JSON.parse(jsonLd.textContent);
          if (ld['@type'] === 'Product' || ld['@type'] === 'RealEstateListing') {
            data.title = data.title || ld.name;
            data.description = data.description || ld.description;
            if (ld.offers?.price) data.price = data.price || `${ld.offers.price} ${ld.offers.priceCurrency}`;
          }
        } catch (e) { /* ignore */ }
      }

      const addressEl = doc.querySelector('[class*="address"], [class*="location-address"]');
      data.address = addressEl?.textContent?.trim() || data.location || '';

    } else if (site === 'gratka') {
      data.title = doc.querySelector('h1, .sticker__title')?.textContent?.trim() || '';
      data.price = doc.querySelector('[class*="priceInfo__value"], .priceInfo, [class*="price"]')?.textContent?.trim() || '';

      const ppmEls = doc.querySelectorAll('[class*="priceInfo__additional"], [class*="perMeter"]');
      ppmEls.forEach(el => {
        const text = el.textContent?.trim();
        if (text?.includes('m²') || text?.includes('/m')) data.pricePerMeter = text;
      });

      data.location = doc.querySelector('[class*="offerLocation"], [class*="location"], .location')?.textContent?.trim() || '';

      const paramRows = doc.querySelectorAll('[class*="parameters__item"], li[class*="param"], .parameters li');
      paramRows.forEach(row => {
        const label = row.querySelector('[class*="label"], span:first-child, dt')?.textContent?.trim?.()?.toLowerCase();
        const value = row.querySelector('[class*="value"], span:last-child, dd, b')?.textContent?.trim();
        if (!label || !value) return;
        if (label.includes('powierzchnia')) data.area = value;
        if (label.includes('pokoi') || label.includes('pokoje')) data.rooms = value;
        if (label.includes('piętro')) data.floor = value;
        if (label.includes('rok budowy')) data.yearBuilt = value;
        if (label.includes('stan')) data.condition = value;
        if (label.includes('ogrzewanie')) data.heating = value;
        if (label.includes('parking')) data.parking = value;
      });

      data.description = doc.querySelector('[class*="description__container"], [class*="description"], .offerDescription')?.textContent?.trim() || '';
      data.address = data.location;
    } else if (site === 'morizon') {
      data.title = doc.querySelector('h1, header.offer-header h1')?.textContent?.trim() || '';
      data.price = doc.querySelector('.details-price__value, .offer-price__number, .offer-price')?.textContent?.trim() || '';
      data.pricePerMeter = doc.querySelector('.details-price__value-m2, .offer-price__m2, .price-m2')?.textContent?.trim() || '';
      
      const streetEl = doc.querySelector('h2');
      const addressEl = doc.querySelector('.details-location__address');
      data.location = [streetEl?.textContent?.trim(), addressEl?.textContent?.trim()].filter(Boolean).join(', ') || '';
      data.address = data.location;

      const detailsItems = doc.querySelectorAll('.offer-details__table tr, table tr, .details-features__item');
      detailsItems.forEach(item => {
        let label, value;
        if (item.classList.contains('details-features__item')) {
          label = item.querySelector('.details-features__label')?.textContent?.trim()?.toLowerCase();
          value = item.querySelector('.details-features__value')?.textContent?.trim();
        } else {
          label = item.querySelector('th')?.textContent?.trim()?.toLowerCase();
          value = item.querySelector('td')?.textContent?.trim();
        }
        
        if (!label || !value) return;
        if (label.includes('powierzchnia')) data.area = value;
        if (label.includes('pokoi') || label.includes('pokoje')) data.rooms = value;
        if (label.includes('piętro')) data.floor = value;
        if (label.includes('rok budowy')) data.yearBuilt = value;
      });

      data.description = doc.querySelector('.offer-description__text, .description, .details-description__content')?.textContent?.trim() || '';
    } else if (site === 'domiporta') {
      data.title = doc.querySelector('h1, .details__title')?.textContent?.trim() || '';
      data.price = doc.querySelector('.details__header_price')?.textContent?.trim() || '';
      // Better location extraction for Domiporta listing
      const locEl = doc.querySelector('.details__location, [class*="location"]');
      data.location = locEl?.textContent?.replace(/\s+/g, ' ')?.trim() || '';
      data.address = data.location;
      const items = doc.querySelectorAll('.details__features_item');
      items.forEach(item => {
        const label = item.querySelector('.details__features_label')?.textContent?.trim()?.toLowerCase();
        const value = item.querySelector('.details__features_value')?.textContent?.trim();
        if (label?.includes('powierzchnia')) data.area = value;
        if (label?.includes('liczba pokoi')) data.rooms = value;
      });
      data.description = doc.querySelector('.details__description_content')?.textContent?.trim() || '';
    } else if (site === 'sprzedajemy') {
      data.title = doc.querySelector('h1')?.textContent?.trim() || '';
      data.price = doc.querySelector('.price strong, .price-value')?.textContent?.trim() || '';
      // Better location extraction for Sprzedajemy listing
      const locEl = doc.querySelector('.location, .offer-location');
      data.location = locEl?.textContent?.replace(/\s+/g, ' ')?.trim() || '';
      data.address = data.location;
      
      const descEl = doc.querySelector('.description, #offer-description');
      data.description = descEl?.textContent?.trim() || '';
    }

    return data;
  }

  // ─── Merge listing data (card + fetched) ───
  function mergeListingData(cardData, fetchedData) {
    const merged = { ...cardData };
    for (const [key, value] of Object.entries(fetchedData)) {
      if (value && (!merged[key] || merged[key].length < value.length)) {
        merged[key] = value;
      }
    }
    return merged;
  }

  // ─── Update loading text ───
  function updateLoadingText(text) {
    if (overlayEl) {
      const loadingText = overlayEl.querySelector('.df-loading-text');
      if (loadingText) loadingText.textContent = text;
    }
  }

  // ─── Trigger Summary (main flow) ───
  async function triggerSummary(listingData) {
    showOverlay();

    let enrichedData = { ...listingData };

    // If we have a URL but sparse data, fetch the full listing page in background
    if (listingData.url && !listingData.description) {
      try {
        updateLoadingText('Pobieram dane oferty...');
        const response = await fetch(listingData.url, {
          credentials: 'omit',
          headers: { 'Accept': 'text/html' }
        });
        if (response.ok) {
          const html = await response.text();
          const fetchedData = parseHTMLForListingData(html, SITE);
          enrichedData = mergeListingData(listingData, fetchedData);
        }
      } catch (err) {
        console.warn('[Dom Finder] Nie udało się pobrać strony oferty:', err.message);
        // Continue with card data only
      }
    }

    // Check if AI Agent is enabled
    const settings = await new Promise(resolve => {
      chrome.storage.sync.get(['aiAgentEnabled'], resolve);
    });
    const aiEnabled = settings.aiAgentEnabled !== false;

    if (!aiEnabled) {
      // AI disabled — show only scraped data
      displayResults(enrichedData, { aiDisabled: true, destination: '' });
      return;
    }

    updateLoadingText('Analizuję ofertę z AI...');

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'getAISummary',
        data: enrichedData
      });
      displayResults(enrichedData, response);
    } catch (err) {
      displayResults(enrichedData, { error: `Błąd: ${err.message}` });
    }
  }

  // ─── Track right-click target for context menu ───
  let lastRightClickTarget = null;
  document.addEventListener('contextmenu', (e) => {
    lastRightClickTarget = e.target;
  });

  // ─── Find the nearest listing URL from a clicked element ───
  function findNearestListingUrl(element) {
    if (!element) return null;

    // Pattern for listing URLs on supported sites
    const urlPatterns = ['/oferta/', '/pl/oferta/', '/nieruchomosci/', '/nieruchomosc-'];

    function isListingLink(el) {
      if (el.tagName !== 'A') return false;
      const href = el.getAttribute('href') || '';
      return urlPatterns.some(p => href.includes(p));
    }

    // Strategy 1: Check if the element itself is a listing link
    if (isListingLink(element)) return element.href;

    // Strategy 2: Walk UP the DOM, checking each ancestor and its children
    let el = element;
    let depth = 0;
    while (el && el !== document.body && depth < 15) {
      // Check the element itself
      if (isListingLink(el)) return el.href;

      // Check direct child links
      const childLink = el.querySelector('a[href*="/oferta/"], a[href*="/nieruchomosci/"], a[data-cy="listing-item-link"]');
      if (childLink) return childLink.href;

      el = el.parentElement;
      depth++;
    }

    // Strategy 3: Check siblings and nearby elements
    if (element.parentElement) {
      const siblingLink = element.parentElement.querySelector('a[href*="/oferta/"], a[href*="/nieruchomosci/"], a[data-cy="listing-item-link"]');
      if (siblingLink) return siblingLink.href;
    }

    return null;
  }

  // ─── Message Listener (from background.js) ───
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractAndSummarize') {
      const parser = getParser();

      if (parser.isListingPage()) {
        // On a specific listing page — extract full data directly
        const data = parser.extractFromListingPage();
        triggerSummary(data);
      } else {
        // On a search results page — find the listing URL near the right-click
        const listingUrl = findNearestListingUrl(lastRightClickTarget);
        if (listingUrl) {
          // We found a listing URL — background-fetch the full page data
          const data = { url: listingUrl, title: '', description: '' };
          triggerSummary(data); // triggerSummary will fetch + parse the full page
        } else {
          // No listing found nearby
          showOverlay();
          displayResults({}, {
            error: 'Nie znalazłem oferty w tym miejscu. Kliknij prawym przyciskiem bezpośrednio na kartę oferty (na zdjęcie, tytuł lub cenę).'
          });
        }
      }
    }
  });

  // ─── Initialize ───
  function init() {
    // Setup card hovers on search/listing pages
    setupCardHovers();

    // Watch for dynamically loaded content (infinite scroll, etc.)
    const observer = new MutationObserver(() => {
      setupCardHovers();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
