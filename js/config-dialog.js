/**
 * ============================================================================
 * ConfigDialog — Matrix Pro Visual Controller
 * ============================================================================
 *
 * Runs inside config.html (opened as a Tableau popup dialog).
 * Controls all visual customization settings for Matrix Pro:
 *   - Theme Presets (Light, Dark Mode, Modern Blue)
 *   - Grid Density & Padding (Compact, Normal, Spacious)
 *   - Horizontal & Vertical Gridlines
 *   - Font Size & Typography
 *   - Row & Column Subtotals, Grand Totals
 *   - Conditional Formatting (Color scales and logical value rules)
 */

class ConfigDialog {

  constructor() {
    this._config = {
      theme: 'theme-light',
      density: 'normal',
      fontSize: '12px',
      showZebra: true,
      showHGrid: true,
      showVGrid: true,
      showSubtotals: true,
      showGrandTotal: true,
      enableCF: false
    };
  }

  /**
   * Initialize the configuration dialog safely.
   */
  async init() {
    try {
      // Safely initialize Tableau extension dialog if available
      if (typeof tableau !== 'undefined' && tableau.extensions && typeof tableau.extensions.initializeDialogAsync === 'function') {
        try {
          await tableau.extensions.initializeDialogAsync();
          const savedRaw = tableau.extensions.settings.get('matrixConfig');
          if (savedRaw) {
            try {
              const parsed = JSON.parse(savedRaw);
              this._config = Object.assign({}, this._config, parsed);
            } catch (e) {
              console.warn('[ConfigDialog] Could not parse saved config from Tableau settings');
            }
          }
        } catch (tErr) {
          console.warn('[ConfigDialog] Tableau dialog init warning:', tErr);
        }
      } else {
        // Fallback for standalone/dev mode
        const savedRaw = localStorage.getItem('matrixConfig');
        if (savedRaw) {
          try {
            this._config = Object.assign({}, this._config, JSON.parse(savedRaw));
          } catch (e) {}
        }
      }
    } catch (err) {
      console.warn('[ConfigDialog] Init fallback handled:', err);
    } finally {
      // Always bind UI regardless of Tableau environment
      this._bindUI();

      // Apply saved language (i18n)
      const savedLang = this._config.language || localStorage.getItem('matrixLang') || 'es';
      window._matrixLang = savedLang;
      if (typeof applyI18n === 'function') applyI18n(savedLang);

      const saveBtn = document.getElementById('btn-save');
      const cancelBtn = document.getElementById('btn-cancel');

      if (saveBtn) saveBtn.addEventListener('click', () => this._save());
      if (cancelBtn) cancelBtn.addEventListener('click', () => this._cancel());
    }
  }

  /**
   * Bind all format controls.
   * @private
   */
  _bindUI() {
    const bindSelect = (id, key) => {
      const el = document.getElementById(id);
      if (el) {
        if (this._config[key] !== undefined) el.value = this._config[key];
        el.addEventListener('change', (e) => { this._config[key] = e.target.value; });
      }
    };

    const bindToggle = (id, key, defVal = true) => {
      const el = document.getElementById(id);
      if (el) {
        el.checked = this._config[key] !== undefined ? Boolean(this._config[key]) : defVal;
        el.addEventListener('change', (e) => { this._config[key] = e.target.checked; });
      }
    };

    bindSelect('theme-select', 'theme');
    bindSelect('density-select', 'density');
    bindSelect('fontsize-select', 'fontSize');

    // Language selector binding (live translation on change)
    const langEl = document.getElementById('language-select');
    if (langEl) {
      const savedLang = this._config.language || localStorage.getItem('matrixLang') || 'es';
      langEl.value = savedLang;
      langEl.addEventListener('change', (e) => {
        const newLang = e.target.value;
        this._config.language = newLang;
        localStorage.setItem('matrixLang', newLang);
        if (typeof applyI18n === 'function') applyI18n(newLang);

        // Broadcast to main window immediately for live preview
        try {
          if ('BroadcastChannel' in window) {
            const bc = new BroadcastChannel('matrix_config_channel');
            bc.postMessage({ type: 'APPLY_CONFIG', config: this._config });
          }
        } catch (err) {}
      });
    }

    bindToggle('toggle-zebra', 'showZebra', true);
    bindToggle('toggle-hgrid', 'showHGrid', true);
    bindToggle('toggle-vgrid', 'showVGrid', true);
    bindToggle('toggle-subtotals', 'showSubtotals', true);
    bindToggle('toggle-grandtotal', 'showGrandTotal', true);
    bindToggle('toggle-rowtotal', 'showRowTotal', true);
    bindToggle('toggle-cf', 'enableCF', false);
    bindToggle('toggle-showtoolbar', 'showToolbar', true);
    bindToggle('toggle-showexport', 'showExportButtons', true);
    bindToggle('toggle-showstatusbar', 'showStatusBar', true);

    // CF Master Toggle Panel Visibility
    const cfToggle = document.getElementById('toggle-cf');
    const cfPanel = document.getElementById('cf-settings-panel');
    if (cfToggle && cfPanel) {
      cfPanel.style.display = cfToggle.checked ? 'block' : 'none';
      cfToggle.addEventListener('change', (e) => {
        cfPanel.style.display = e.target.checked ? 'block' : 'none';
      });
    }

    // CF Mode Switch (Gradient vs Rules)
    const cfModeSelect = document.getElementById('cf-mode-select');
    const cfGradPanel = document.getElementById('cf-gradient-panel');
    const cfRulesPanel = document.getElementById('cf-rules-panel');
    if (cfModeSelect && cfGradPanel && cfRulesPanel) {
      if (this._config.cfMode) cfModeSelect.value = this._config.cfMode;
      const updateCfPanels = () => {
        const isRules = cfModeSelect.value === 'rules';
        cfGradPanel.style.display = isRules ? 'none' : 'block';
        cfRulesPanel.style.display = isRules ? 'block' : 'none';
      };
      updateCfPanels();
      cfModeSelect.addEventListener('change', updateCfPanels);
    }

    // Restore saved CF color/rule values if present
    const setVal = (id, k, def) => {
      const el = document.getElementById(id);
      if (el) el.value = (this._config[k] !== undefined) ? this._config[k] : def;
    };

    setVal('cf-min-color', 'cfMinColor', '#fee2e2');
    setVal('cf-max-color', 'cfMaxColor', '#dcfce7');
    setVal('rule-val-1', 'ruleVal1', 50000);
    setVal('rule-bg-1', 'ruleBg1', '#fee2e2');
    setVal('rule-text-1', 'ruleText1', '#991b1b');
    setVal('rule-val-2', 'ruleVal2', 200000);
    setVal('rule-bg-2', 'ruleBg2', '#fef3c7');
    setVal('rule-text-2', 'ruleText2', '#92400e');
    setVal('rule-bg-3', 'ruleBg3', '#dcfce7');
    setVal('rule-text-3', 'ruleText3', '#166534');

    // Accordion toggle behavior (Power BI style: single active card to prevent overlap)
    document.querySelectorAll('.accordion-header').forEach(header => {
      header.addEventListener('click', () => {
        const item = header.closest('.accordion-item');
        if (!item) return;

        const isOpen = item.classList.contains('open');

        // Close all cards for clean single-view pane
        document.querySelectorAll('.accordion-item').forEach(el => el.classList.remove('open'));

        // If it wasn't open, open it now
        if (!isOpen) {
          item.classList.add('open');
        }
      });
    });

    // Populate dynamic value formatting cards
    this._populateValueFormats();
  }

  /**
   * Dynamically build formatting selectors for each active measure.
   * @private
   */
  _populateValueFormats() {
    const container = document.getElementById('value-formats-container');
    if (!container) return;
    container.innerHTML = '';

    const valueFields = this._config.valueFields || [];
    const valueFormats = this._config.valueFormats || {};

    if (valueFields.length === 0) {
      container.innerHTML = `<div style="font-size: 11px; opacity: 0.6; padding: 4px;" data-i18n="no_active_measures">No hay medidas activas. Agrega campos a la repisa de Valores en Tableau.</div>`;
      // Apply translation immediately
      const savedLang = this._config.language || localStorage.getItem('matrixLang') || 'es';
      if (typeof applyI18n === 'function') applyI18n(savedLang);
      return;
    }

    valueFields.forEach(vf => {
      const fieldKey = vf.field;
      const format = valueFormats[fieldKey] || { type: 'auto', decimals: 2 };

      const row = document.createElement('div');
      row.className = 'value-format-row';
      row.style.cssText = 'display: flex; flex-direction: column; gap: 6px; padding: 10px; background: rgba(0,0,0,0.03); border-radius: 6px; border: 1px solid rgba(128,128,128,0.15);';
      
      // Field Label Header
      const header = document.createElement('div');
      header.style.cssText = 'font-size: 12px; font-weight: 600; color: var(--matrix-accent); margin-bottom: 2px;';
      header.textContent = vf.label || vf.field;
      row.appendChild(header);

      // Controls row
      const controls = document.createElement('div');
      controls.style.cssText = 'display: flex; gap: 12px; align-items: center; justify-content: space-between;';

      // Type Selector
      const typeGroup = document.createElement('div');
      typeGroup.style.cssText = 'display: flex; flex-direction: column; gap: 4px; flex-grow: 1;';
      const typeLabel = document.createElement('span');
      typeLabel.style.cssText = 'font-size: 10px; opacity: 0.7; font-weight: 600;';
      typeLabel.setAttribute('data-i18n', 'label_format_type');
      typeLabel.textContent = typeof t === 'function' ? t('label_format_type') : 'Tipo de Formato';
      
      const typeSelect = document.createElement('select');
      typeSelect.className = 'form-select';
      typeSelect.id = `val-fmt-type-${fieldKey}`;
      typeSelect.style.cssText = 'min-width: 140px;';
      typeSelect.innerHTML = `
        <option value="auto" ${format.type === 'auto' ? 'selected' : ''} data-i18n="format_auto">${typeof t === 'function' ? t('format_auto') : 'Automático / Número'}</option>
        <option value="currency" ${format.type === 'currency' ? 'selected' : ''} data-i18n="format_currency">${typeof t === 'function' ? t('format_currency') : 'Moneda ($)'}</option>
        <option value="percent" ${format.type === 'percent' ? 'selected' : ''} data-i18n="format_percent">${typeof t === 'function' ? t('format_percent') : 'Porcentaje (%)'}</option>
      `;

      typeGroup.appendChild(typeLabel);
      typeGroup.appendChild(typeSelect);
      controls.appendChild(typeGroup);

      // Decimals Input
      const decGroup = document.createElement('div');
      decGroup.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
      const decLabel = document.createElement('span');
      decLabel.style.cssText = 'font-size: 10px; opacity: 0.7; font-weight: 600;';
      decLabel.setAttribute('data-i18n', 'label_decimals');
      decLabel.textContent = typeof t === 'function' ? t('label_decimals') : 'Decimales';

      const decInput = document.createElement('input');
      decInput.className = 'form-input';
      decInput.id = `val-fmt-dec-${fieldKey}`;
      decInput.type = 'number';
      decInput.min = '0';
      decInput.max = '6';
      decInput.value = (format.decimals !== undefined) ? format.decimals : 2;
      decInput.style.cssText = 'width: 60px; padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px;';

      decGroup.appendChild(decLabel);
      decGroup.appendChild(decInput);
      controls.appendChild(decGroup);

      row.appendChild(controls);
      container.appendChild(row);
    });

    // Apply translations to new dynamic elements
    const savedLang = this._config.language || localStorage.getItem('matrixLang') || 'es';
    if (typeof applyI18n === 'function') applyI18n(savedLang);
  }

  /**
   * Save settings and close dialog.
   * Reads DOM values directly to guarantee accurate state capture.
   * @private
   */
  async _save() {
    try {
      const themeEl = document.getElementById('theme-select');
      const densityEl = document.getElementById('density-select');
      const fontSizeEl = document.getElementById('fontsize-select');

      const zebraEl = document.getElementById('toggle-zebra');
      const hgridEl = document.getElementById('toggle-hgrid');
      const vgridEl = document.getElementById('toggle-vgrid');
      const subtotalsEl = document.getElementById('toggle-subtotals');
      const grandtotalEl = document.getElementById('toggle-grandtotal');
      const rowtotalEl = document.getElementById('toggle-rowtotal');
      const cfEl = document.getElementById('toggle-cf');

      const showtoolbarEl = document.getElementById('toggle-showtoolbar');
      const showexportEl = document.getElementById('toggle-showexport');
      const showstatusbarEl = document.getElementById('toggle-showstatusbar');

      const getV = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };

      let existing = {};
      try {
        const localRaw = localStorage.getItem('matrixConfig');
        if (localRaw) existing = JSON.parse(localRaw);
      } catch (e) {}

      if (typeof tableau !== 'undefined' && tableau.extensions && tableau.extensions.settings) {
        const savedRaw = tableau.extensions.settings.get('matrixConfig');
        if (savedRaw) {
          try { existing = Object.assign({}, existing, JSON.parse(savedRaw)); } catch (e) {}
        }
      }

      // Collect value formats from dynamic DOM elements
      const valueFormats = {};
      (existing.valueFields || this._config.valueFields || []).forEach(vf => {
        const typeEl = document.getElementById(`val-fmt-type-${vf.field}`);
        const decEl = document.getElementById(`val-fmt-dec-${vf.field}`);
        if (typeEl && decEl) {
          valueFormats[vf.field] = {
            type: typeEl.value,
            decimals: parseInt(decEl.value, 10) || 0
          };
        }
      });

      const updated = Object.assign({}, existing, {
        theme: themeEl ? themeEl.value : 'theme-light',
        density: densityEl ? densityEl.value : 'normal',
        fontSize: fontSizeEl ? fontSizeEl.value : '12px',
        showZebra: zebraEl ? Boolean(zebraEl.checked) : true,
        showHGrid: hgridEl ? Boolean(hgridEl.checked) : true,
        showVGrid: vgridEl ? Boolean(vgridEl.checked) : true,
        showSubtotals: subtotalsEl ? Boolean(subtotalsEl.checked) : true,
        showGrandTotal: grandtotalEl ? Boolean(grandtotalEl.checked) : true,
        showRowTotal: rowtotalEl ? Boolean(rowtotalEl.checked) : true,
        enableCF: cfEl ? Boolean(cfEl.checked) : false,
        cfMode: getV('cf-mode-select') || 'gradient',
        cfMinColor: getV('cf-min-color') || '#fee2e2',
        cfMaxColor: getV('cf-max-color') || '#dcfce7',
        ruleVal1: parseFloat(getV('rule-val-1')) || 50000,
        ruleBg1: getV('rule-bg-1') || '#fee2e2',
        ruleText1: getV('rule-text-1') || '#991b1b',
        ruleVal2: parseFloat(getV('rule-val-2')) || 200000,
        ruleBg2: getV('rule-bg-2') || '#fef3c7',
        ruleText2: getV('rule-text-2') || '#92400e',
        ruleBg3: getV('rule-bg-3') || '#dcfce7',
        ruleText3: getV('rule-text-3') || '#166534',
        showToolbar: showtoolbarEl ? Boolean(showtoolbarEl.checked) : true,
        showExportButtons: showexportEl ? Boolean(showexportEl.checked) : true,
        showStatusBar: showstatusbarEl ? Boolean(showstatusbarEl.checked) : true,
        language: getV('language-select') || localStorage.getItem('matrixLang') || 'es',
        valueFormats: valueFormats
      });

      const updatedJson = JSON.stringify(updated);

      // 1. Synchronous localStorage update (instant cross-window availability)
      try { localStorage.setItem('matrixConfig', updatedJson); } catch (e) {}

      // 2. Broadcast message to main window for INSTANT REAL-TIME APPLY (0ms latency)
      try {
        if ('BroadcastChannel' in window) {
          const bc = new BroadcastChannel('matrix_config_channel');
          bc.postMessage({ type: 'APPLY_CONFIG', config: updated });
          bc.close();
        }
      } catch (bcErr) {
        console.warn('[ConfigDialog] BroadcastChannel error:', bcErr);
      }

      // 3. Update Tableau settings (fire-and-forget saveAsync in background)
      if (typeof tableau !== 'undefined' && tableau.extensions && tableau.extensions.settings) {
        try {
          tableau.extensions.settings.set('matrixConfig', updatedJson);
          tableau.extensions.settings.saveAsync().catch(e => console.warn('[ConfigDialog] saveAsync bg warning:', e));
        } catch (sErr) {
          console.warn('[ConfigDialog] settings set error:', sErr);
        }
      }

      // 4. Close popup dialog window cleanly
      if (typeof tableau !== 'undefined' && tableau.extensions && tableau.extensions.ui && typeof tableau.extensions.ui.closeDialog === 'function') {
        try {
          tableau.extensions.ui.closeDialog('saved');
        } catch (cErr) {
          console.warn('[ConfigDialog] closeDialog error:', cErr);
        }
      }

      setTimeout(() => {
        try { window.close(); } catch(e) {}
      }, 50);

    } catch (err) {
      console.error('[ConfigDialog] Save error:', err);
    }
  }

  /**
   * Cancel and close dialog.
   * @private
   */
  _cancel() {
    if (typeof tableau !== 'undefined' && tableau.extensions && tableau.extensions.ui) {
      tableau.extensions.ui.closeDialog('cancelled');
    } else {
      window.close();
    }
  }
}

// Expose globally
window.ConfigDialog = ConfigDialog;
