// ============================================================
// DOM FINDER — Popup Script
// Handles settings save/load and API key validation
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('settings-form');
  const apiKeyInput = document.getElementById('api-key');
  const destinationInput = document.getElementById('destination');
  const modelSelect = document.getElementById('model');
  const toggleKeyBtn = document.getElementById('toggle-key');
  const btnSave = document.getElementById('btn-save');
  const statusEl = document.getElementById('status');

  // --- Load saved settings ---
  chrome.storage.sync.get(['groqApiKey', 'destinationAddress', 'selectedModel'], (result) => {
    if (result.groqApiKey) {
      apiKeyInput.value = result.groqApiKey;
    }
    if (result.destinationAddress) {
      destinationInput.value = result.destinationAddress;
    }
    if (result.selectedModel) {
      modelSelect.value = result.selectedModel;
    }
    updateStatus(result.groqApiKey);
  });

  // --- Toggle API key visibility ---
  toggleKeyBtn.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleKeyBtn.textContent = '🔒';
    } else {
      apiKeyInput.type = 'password';
      toggleKeyBtn.textContent = '👁';
    }
  });

  // --- Save settings ---
  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const apiKey = apiKeyInput.value.trim();
    const destination = destinationInput.value.trim() || 'Warszawa Centrum';
    const model = modelSelect.value;

    chrome.storage.sync.set({
      groqApiKey: apiKey,
      destinationAddress: destination,
      selectedModel: model
    }, () => {
      // Show success state
      const btnText = btnSave.querySelector('.btn-text');
      const btnSuccess = btnSave.querySelector('.btn-success');
      btnText.style.display = 'none';
      btnSuccess.style.display = 'inline';
      btnSave.classList.add('saved');

      updateStatus(apiKey);

      // Reset button after 2 seconds
      setTimeout(() => {
        btnText.style.display = 'inline';
        btnSuccess.style.display = 'none';
        btnSave.classList.remove('saved');
      }, 2000);
    });
  });

  // --- Update status indicator ---
  function updateStatus(apiKey) {
    const dot = statusEl.querySelector('.status-dot');
    const text = statusEl.querySelector('span');

    if (apiKey && apiKey.startsWith('gsk_')) {
      dot.className = 'status-dot';
      text.textContent = 'Gotowy do użycia';
    } else if (apiKey) {
      dot.className = 'status-dot warning';
      text.textContent = 'Klucz API może być nieprawidłowy';
    } else {
      dot.className = 'status-dot error';
      text.textContent = 'Brak klucza API — dodaj klucz powyżej';
    }
  }
});
