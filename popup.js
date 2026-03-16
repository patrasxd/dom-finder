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
  const aiToggle = document.getElementById('ai-toggle');
  const aiToggleDesc = document.getElementById('ai-toggle-desc');
  const aiDependentFields = document.querySelectorAll('.ai-dependent');

  // --- Update AI-dependent fields visibility ---
  function updateAIDependentFields(enabled) {
    aiDependentFields.forEach(field => {
      if (enabled) {
        field.classList.remove('disabled');
      } else {
        field.classList.add('disabled');
      }
    });

    if (enabled) {
      aiToggleDesc.textContent = 'Analiza oferty przez sztuczną inteligencję';
      aiToggleDesc.classList.remove('ai-off');
    } else {
      aiToggleDesc.textContent = 'Wyłączony — tylko pobieranie danych ze strony';
      aiToggleDesc.classList.add('ai-off');
    }
  }

  // --- Load saved settings ---
  chrome.storage.sync.get(['groqApiKey', 'destinationAddress', 'selectedModel', 'aiAgentEnabled'], (result) => {
    if (result.groqApiKey) {
      apiKeyInput.value = result.groqApiKey;
    }
    if (result.destinationAddress) {
      destinationInput.value = result.destinationAddress;
    }
    if (result.selectedModel) {
      modelSelect.value = result.selectedModel;
    }

    // AI toggle — default to true if not set
    const aiEnabled = result.aiAgentEnabled !== false;
    aiToggle.checked = aiEnabled;
    updateAIDependentFields(aiEnabled);
    updateStatus(result.groqApiKey, aiEnabled);
  });

  // --- AI Toggle change handler ---
  aiToggle.addEventListener('change', () => {
    updateAIDependentFields(aiToggle.checked);
    updateStatus(apiKeyInput.value.trim(), aiToggle.checked);
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
    const aiEnabled = aiToggle.checked;

    chrome.storage.sync.set({
      groqApiKey: apiKey,
      destinationAddress: destination,
      selectedModel: model,
      aiAgentEnabled: aiEnabled
    }, () => {
      // Show success state
      const btnText = btnSave.querySelector('.btn-text');
      const btnSuccess = btnSave.querySelector('.btn-success');
      btnText.style.display = 'none';
      btnSuccess.style.display = 'inline';
      btnSave.classList.add('saved');

      updateStatus(apiKey, aiEnabled);

      // Reset button after 2 seconds
      setTimeout(() => {
        btnText.style.display = 'inline';
        btnSuccess.style.display = 'none';
        btnSave.classList.remove('saved');
      }, 2000);
    });
  });

  // --- Update status indicator ---
  function updateStatus(apiKey, aiEnabled) {
    const dot = statusEl.querySelector('.status-dot');
    const text = statusEl.querySelector('span');

    if (!aiEnabled) {
      dot.className = 'status-dot warning';
      text.textContent = 'Tryb bez AI — tylko dane ze strony';
    } else if (apiKey && apiKey.startsWith('gsk_')) {
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
