# 🏠 Dom Finder — AI Real Estate Assistant

A Chrome extension that adds AI-powered summaries to Polish real estate listing websites. Hover over any listing card or right-click on a property page to get an instant analysis — pros, cons, neighborhood info, renovation warnings, and a commute map — all powered by free Groq AI.

## ✨ Features

- **AI Summaries** — one-click property analysis with location breakdown, pros/cons, and renovation warnings
- **Hover-to-Summarize** — hover over any listing card on search results and click the floating button
- **Right-Click Menu** — right-click anywhere on a listing page for a full summary
- **Commute Map** — embedded Google Maps transit directions to your chosen destination
- **Draggable Overlay** — results appear in a sleek, draggable panel
- **Multiple AI Models** — choose between Llama 3.3 70B, Llama 3.1 8B, Gemma 2, DeepSeek R1, Mixtral, and more
- **Free to Use** — runs on the free Groq API tier

## 🌐 Supported Websites

| Site | Listing Page | Search Cards |
|------|:---:|:---:|
| [otodom.pl](https://otodom.pl) | ✅ | ✅ |
| [gratka.pl](https://gratka.pl) | ✅ | ✅ |
| [olx.pl](https://olx.pl) | ✅ | ✅ |
| [morizon.pl](https://morizon.pl) | ✅ | ✅ |
| [domiporta.pl](https://domiporta.pl) | ✅ | ✅ |
| [sprzedajemy.pl](https://sprzedajemy.pl) | ✅ | ✅ |
| Other Polish real estate sites | ✅ (generic parser) | ✅ (generic parser) |

## 📦 Installation

1. **Download** — clone or download this repository
   ```bash
   git clone https://github.com/patrasxd/dom-finder.git
   ```
2. **Open Chrome** — go to `chrome://extensions/`
3. **Enable Developer Mode** — toggle in the top-right corner
4. **Load Unpacked** — click "Load unpacked" and select the `dom-finder` folder
5. **Get a Groq API key** — go to [console.groq.com/keys](https://console.groq.com/keys) (free)
6. **Configure** — click the Dom Finder icon in your toolbar and paste your API key

## 🚀 Usage

### On a listing page
Right-click anywhere → select **🏠 Dom Finder — Podsumowanie oferty**

### On a search results page
Hover over any listing card → click the floating **🏠 Podsumowanie AI** button

### Settings
Click the extension icon to configure:
- **Groq API Key** — required, get one free at [console.groq.com](https://console.groq.com/keys)
- **Commute Destination** — default: "Warszawa Centrum"
- **AI Model** — pick your preferred model (Llama 3.3 70B recommended)

## 🛠️ Tech Stack

- **Manifest V3** Chrome Extension
- **Vanilla JS** — no frameworks, lightweight and fast
- **Groq API** — free LLM inference (Llama, Gemma, DeepSeek, Mixtral)
- **Google Maps Embed** — transit commute directions

## 🔒 Privacy

- Your API key is stored locally in Chrome's `storage.sync` — it never leaves your browser except to call the Groq API directly
- No analytics, no tracking, no data collection
- All processing happens client-side + Groq API

## 📄 License

[MIT](LICENSE)
