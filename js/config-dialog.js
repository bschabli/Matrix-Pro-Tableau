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
      cfConfigs: {},
      showDrillThrough: true,
      drillThroughParameters: {
        rowPath: '',
        columnName: ''
      },
    };
    this._availableSortFields = [];
    this._currentCfField = null;
    this._availableSummaryMembers = [];
  }

  /**
   * Initialize the configuration dialog safely.
   */
  async init() {
      try {
        const payload =
          await tableau.extensions.initializeDialogAsync();

        let context = {};

        try {
          context = JSON.parse(payload || '{}');
        } catch (err) {
          console.warn('[ConfigDialog] Invalid dialog payload:', err);
        }

        // Configuration saved in the Tableau workbook.
        let savedConfig = {};

        const raw = tableau.extensions.settings.get('matrixConfig');

        if (raw) {
          try {
            savedConfig = JSON.parse(raw);
          } catch (err) {
            console.warn('[ConfigDialog] Invalid saved config:', err);
          }
        }

        // Current matrix session takes precedence.
        // This includes column widths, order and visibility.
        this._config = {
          ...this._config,
          ...savedConfig,
          ...(context.config || {})
        };

        this._config.cfConfigs = this._config.cfConfigs || {};

        // Tableau field metadata is used only temporarily.
        this._availableSortFields =
          Array.isArray(context.availableFields)
            ? context.availableFields
            : [];

        this._availableSummaryMembers =
          Array.isArray(context.availableSummaryMembers)
            ? context.availableSummaryMembers
            : [];

      } catch (err) {
        console.error(
          '[ConfigDialog] Initialization error:',
          err
        );
      }

      this._bindUI();

      const language = this._config.language || 'de';
      window._matrixLang = language;

      if (typeof applyI18n === 'function') {
        applyI18n(language);
      }

      document.getElementById('btn-save')
        ?.addEventListener('click', () => this._save());

      document.getElementById('btn-cancel')
        ?.addEventListener('click', () => this._cancel());
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
    bindSelect('number-locale-select', 'numberLocale');

    // Language selection applies inside the dialog.
    // The main matrix is updated only after saving.
    const langEl = document.getElementById('language-select');

    if (langEl) {
      langEl.value = this._config.language || 'de';

      langEl.addEventListener('change', event => {
        const language = event.target.value;

        this._config.language = language;

        if (typeof applyI18n === 'function') {
          applyI18n(language);
        }
      });
    }

    bindToggle('toggle-zebra', 'showZebra', true);
    bindToggle('toggle-hgrid', 'showHGrid', true);
    bindToggle('toggle-vgrid', 'showVGrid', true);
    bindToggle('toggle-subtotals', 'showSubtotals', true);
    bindToggle('toggle-grandtotal', 'showGrandTotal', true);
    bindToggle('toggle-rowtotal', 'showRowTotal', true);
    bindToggle('toggle-showtoolbar', 'showToolbar', true);
    bindToggle('toggle-showexport', 'showExportButtons', true);
    bindToggle('toggle-showstatusbar', 'showStatusBar', true);

    // Toolbar title
    bindToggle(
      'toggle-showtitle',
      'showToolbarTitle',
      true
    );

    const titleInput = document.getElementById(
      'toolbar-title-input'
    );

    if (titleInput) {
      titleInput.value =
        this._config.toolbarTitle ?? 'Matrix Pro';
    }

    // Drill-through button visibility
    bindToggle(
      'toggle-showdrill',
      'showDrillThrough',
      true
    );

    // Optional drill-through parameter mappings
    const drillMappings =
      this._config.drillThroughParameters || {};

    ['rowPath', 'columnName'].forEach(source => {
      const input = document.getElementById(
        `drill-param-${source}`
      );

      if (input) {
        input.value = drillMappings[source] || '';
      }
    });

    // CF Setup
    const cfFieldSelectRow = document.getElementById('cf-field-select-row');
    const cfFieldSelect = document.getElementById('cf-field-select');
    const valueFields = this._config.valueFields || [];
    
    if (valueFields.length > 0) {
      if (cfFieldSelectRow) cfFieldSelectRow.style.display = 'flex';
      if (cfFieldSelect) {
        cfFieldSelect.innerHTML = '';
        valueFields.forEach(vf => {
          const opt = document.createElement('option');
          opt.value = vf.field;
          opt.textContent = vf.label || vf.field;
          cfFieldSelect.appendChild(opt);
        });
        
        // Load initial field config
        this._loadCfFieldState(valueFields[0].field);
        
        // Selection change listener (save old, load new)
        cfFieldSelect.addEventListener('change', (e) => {
          this._saveCurrentCfFieldState();
          this._loadCfFieldState(e.target.value);
        });
      }
    } else {
      if (cfFieldSelectRow) cfFieldSelectRow.style.display = 'none';
      const cfSettingsPanel = document.getElementById('cf-settings-panel');
      if (cfSettingsPanel) {
        cfSettingsPanel.style.display = 'block';
        cfSettingsPanel.innerHTML = `<div style="font-size: 11px; opacity: 0.6; padding: 4px;" data-i18n="no_active_measures">No hay medidas activas. Agrega campos a la repisa de Valores en Tableau.</div>`;
      }
      const savedLang = this._config.language || 'de';
      if (typeof applyI18n === 'function') applyI18n(savedLang);
    }

    // Bind toggle-cf master change
    const cfToggle = document.getElementById('toggle-cf');
    const cfPanel = document.getElementById('cf-settings-panel');
    if (cfToggle && cfPanel) {
      cfToggle.addEventListener('change', (e) => {
        cfPanel.style.display = e.target.checked ? 'block' : 'none';
        if (this._currentCfField) {
          this._config.cfConfigs = this._config.cfConfigs || {};
          if (!this._config.cfConfigs[this._currentCfField]) {
            this._config.cfConfigs[this._currentCfField] = this._getDefaultCfConfig();
          }
          this._config.cfConfigs[this._currentCfField].enabled = e.target.checked;
        }
      });
    }

    // Bind mode select change (Gradient vs Rules)
    const cfModeSelect = document.getElementById('cf-mode-select');
    const cfGradPanel = document.getElementById('cf-gradient-panel');
    const cfRulesPanel = document.getElementById('cf-rules-panel');
    if (cfModeSelect && cfGradPanel && cfRulesPanel) {
      cfModeSelect.addEventListener('change', (e) => {
        const isRules = e.target.value === 'rules';
        cfGradPanel.style.display = isRules ? 'none' : 'block';
        cfRulesPanel.style.display = isRules ? 'block' : 'none';
        if (this._currentCfField) {
          this._config.cfConfigs = this._config.cfConfigs || {};
          if (!this._config.cfConfigs[this._currentCfField]) {
            this._config.cfConfigs[this._currentCfField] = this._getDefaultCfConfig();
          }
          this._config.cfConfigs[this._currentCfField].mode = e.target.value;
        }
      });
    }  

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
    this._populateRowSort();
    this._populateSummaryGroups();
  }

  _populateRowSort() {
      const container = document.getElementById('row-sort-container');
      if (!container) return;

      container.replaceChildren();

      const rowFields = this._config.rowFields || [];
      const rowSort = this._config.rowSort || {};

      const excluded = new Set([
        ...rowFields,
        ...(this._config.colFields || []),
        ...(this._config.valueFields || []).map(v => v.field)
      ]);

      const availableFields = [
        ...new Set(this._availableSortFields)
      ].filter(field =>
        typeof field === 'string' &&
        !field.startsWith('__') &&
        !excluded.has(field)
      ).sort((a, b) => a.localeCompare(b, 'de', { numeric: true }));

      if (!rowFields.length) {
        container.textContent = 'Keine Hierarchieebenen vorhanden.';
        return;
      }

      const modes = [
        ['original', 'Ursprüngliche Reihenfolge'],
        ['alpha-asc', 'Alphabetisch A–Z'],
        ['alpha-desc', 'Alphabetisch Z–A'],
        ['field-asc', 'Sortierfeld aufsteigend'],
        ['field-desc', 'Sortierfeld absteigend']
      ];

      rowFields.forEach((rowField, index) => {
        const rule = rowSort[rowField] || {};

        const wrapper = document.createElement('div');
        wrapper.className = 'form-row';
        wrapper.style.cssText =
          'display:flex;flex-direction:column;align-items:stretch;gap:8px;';

        const title = document.createElement('strong');
        title.textContent = rowField;
        wrapper.appendChild(title);

        const modeSelect = document.createElement('select');
        modeSelect.id = `row-sort-mode-${index}`;
        modeSelect.className = 'form-select';
        modeSelect.style.width = '100%';

        modes.forEach(([value, label]) => {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          modeSelect.appendChild(option);
        });

        modeSelect.value = rule.mode || 'original';
        wrapper.appendChild(modeSelect);

        const fieldSelect = document.createElement('select');
        fieldSelect.id = `row-sort-field-${index}`;
        fieldSelect.className = 'form-select';
        fieldSelect.style.width = '100%';

        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Sortierfeld auswählen';
        fieldSelect.appendChild(placeholder);

        availableFields.forEach(field => {
          const option = document.createElement('option');
          option.value = field;
          option.textContent = field;
          fieldSelect.appendChild(option);
        });

        if (rule.field && !availableFields.includes(rule.field)) {
          const missing = document.createElement('option');
          missing.value = '';
          missing.textContent = `${rule.field} (nicht verfügbar)`;
          missing.disabled = true;
          fieldSelect.appendChild(missing);
        }

        fieldSelect.value = availableFields.includes(rule.field)
          ? rule.field
          : '';

        const syncVisibility = () => {
          fieldSelect.style.display =
            modeSelect.value.startsWith('field-')
              ? 'block'
              : 'none';
        };

        modeSelect.addEventListener('change', syncVisibility);
        syncVisibility();

        wrapper.appendChild(fieldSelect);
        container.appendChild(wrapper);
      });
    }

  _populateSummaryGroups() {
      const container = document.getElementById(
        'summary-groups-container'
      );

      if (!container) return;

      container.replaceChildren();

      if (!Array.isArray(this._config.summaryGroups)) {
        this._config.summaryGroups = [];
      }

      const groups = this._config.summaryGroups;

      const available = [
        ...new Set(
          this._availableSummaryMembers.map(String)
        )
      ];

      const createLabel = text => {
        const label = document.createElement('label');
        label.className = 'form-label';
        label.textContent = text;
        label.style.display = 'block';
        label.style.margin = '10px 0 5px';
        return label;
      };

      const addOption = (select, value, label) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
      };

      groups.forEach((group, index) => {
        const card = document.createElement('div');

        card.style.cssText = `
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          padding: 10px;
          margin-bottom: 12px;
        `;

        // Name der Summenzeile
        card.appendChild(createLabel('Bezeichnung'));

        const nameInput = document.createElement('input');
        nameInput.className = 'form-input';
        nameInput.style.width = '100%';
        nameInput.style.boxSizing = 'border-box';
        nameInput.value = group.label || '';
        nameInput.placeholder = 'z. B. Rohergebnis';

        nameInput.addEventListener('input', () => {
          group.label = nameInput.value;
        });

        card.appendChild(nameInput);

        // Positionen der obersten Hierarchieebene
        card.appendChild(
          createLabel('Einbezogene Hierarchiepositionen')
        );

        const memberBox = document.createElement('div');

        memberBox.style.cssText = `
          max-height: 150px;
          overflow-y: auto;
          border: 1px solid #e5e7eb;
          border-radius: 4px;
          padding: 6px;
        `;

        const members = [
          ...new Set([
            ...available,
            ...(group.members || [])
          ])
        ];

        members.forEach(member => {
          const row = document.createElement('label');

          row.style.cssText = `
            display: flex;
            align-items: center;
            gap: 7px;
            padding: 4px 0;
            font-size: 12px;
            cursor: pointer;
          `;

          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';

          checkbox.checked =
            (group.members || []).includes(member);

          checkbox.addEventListener('change', () => {
            const selected = new Set(group.members || []);

            if (checkbox.checked) {
              selected.add(member);
            } else {
              selected.delete(member);
            }

            group.members = [...selected];
          });

          const label = document.createElement('span');
          label.textContent = available.includes(member)
            ? member
            : `${member} (aktuell nicht vorhanden)`;

          row.append(checkbox, label);
          memberBox.appendChild(row);
        });

        if (members.length === 0) {
          const message = document.createElement('span');
          message.textContent =
            'Keine Hierarchiepositionen verfügbar.';
          message.style.fontSize = '12px';
          memberBox.appendChild(message);
        }

        card.appendChild(memberBox);

        // Position der Summenzeile
        card.appendChild(
          createLabel('Position der Summenzeile')
        );

        const positionSelect = document.createElement('select');
        positionSelect.className = 'form-select';
        positionSelect.style.width = '100%';

        addOption(
          positionSelect,
          'end',
          'Am Ende der obersten Ebene'
        );

        addOption(
          positionSelect,
          'start',
          'Am Anfang der obersten Ebene'
        );

        const savedAnchor =
          (group.position || '').startsWith('after:')
            ? group.position.slice(6)
            : null;

        const anchors = [
          ...new Set([
            ...available,
            ...(savedAnchor ? [savedAnchor] : [])
          ])
        ];

        anchors.forEach(member => {
          const suffix = available.includes(member)
            ? ''
            : ' (aktuell nicht vorhanden)';

          addOption(
            positionSelect,
            `after:${member}`,
            `Nach: ${member}${suffix}`
          );
        });

        positionSelect.value = group.position || 'end';

        positionSelect.addEventListener('change', () => {
          group.position = positionSelect.value;
        });

        card.appendChild(positionSelect);

        // Filterverhalten
        card.appendChild(
          createLabel('Verhalten bei fehlenden Positionen')
        );

        const modeSelect = document.createElement('select');
        modeSelect.className = 'form-select';
        modeSelect.style.width = '100%';

        addOption(
          modeSelect,
          'partial',
          'Vorhandene Positionen summieren'
        );

        addOption(
          modeSelect,
          'complete',
          'Nur vollständig berechnen'
        );

        modeSelect.value = group.missingMode || 'partial';

        modeSelect.addEventListener('change', () => {
          group.missingMode = modeSelect.value;
        });

        card.appendChild(modeSelect);

        // Gruppe entfernen
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'btn-secondary';
        removeButton.textContent = 'Summenzeile entfernen';
        removeButton.style.marginTop = '12px';

        removeButton.addEventListener('click', () => {
          groups.splice(index, 1);
          this._populateSummaryGroups();
        });

        card.appendChild(removeButton);
        container.appendChild(card);
      });

      // Neue Gruppe hinzufügen
      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'btn-secondary';
      addButton.textContent = '+ Summenzeile hinzufügen';

      addButton.disabled =
        available.length === 0 ||
        !(this._config.rowFields || []).length;

      addButton.addEventListener('click', () => {
        groups.push({
          id: `sg_${Date.now()}_${Math.random()
            .toString(36).slice(2, 8)}`,
          label: '',
          members: [],
          position: 'end',
          missingMode: 'partial'
        });

        this._populateSummaryGroups();
      });

      container.appendChild(addButton);
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
      const savedLang = this._config.language || 'de';
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

      // Optionaler Anzeigename der Spalte
      const nameInput = document.createElement('input');
      nameInput.className = 'form-input';
      nameInput.id = `val-fmt-label-${fieldKey}`;
      nameInput.type = 'text';
      nameInput.setAttribute('data-i18n-placeholder', 'value_label_placeholder');
      nameInput.value = format.label || '';
      nameInput.style.cssText = 'width: 100%; box-sizing: border-box;';
      row.appendChild(nameInput);

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

      // Optional factor-based aggregation.
      const factorGroup = document.createElement('div');
      factorGroup.style.cssText =
        'display:flex;flex-direction:column;gap:5px;margin-top:8px;';

      const factorLabel = document.createElement('span');
      factorLabel.className = 'form-label';
      factorLabel.textContent = 'Aggregationsfaktor (optional)';

      const factorSelect = document.createElement('select');
      factorSelect.id = `val-sign-factor-${fieldKey}`;
      factorSelect.className = 'form-select';
      factorSelect.style.width = '100%';

      const addOption = (value, label) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        factorSelect.appendChild(option);
      };

      // No factor = existing aggregation behavior.
      addOption('', 'Standard – ohne Faktor');

      const currentFactor =
        this._config.signFactorFields?.[fieldKey] || '';

      const excluded = new Set([
        ...(this._config.rowFields || []),
        ...(this._config.colFields || []),
        ...valueFields.map(v => v.field)
      ]);

      const availableFactors = [
        ...new Set(this._availableSortFields)
      ].filter(name =>
        typeof name === 'string' &&
        !name.startsWith('__') &&
        !excluded.has(name)
      ).sort((a, b) => a.localeCompare(b, 'de'));

      // Preserve a previously selected factor.
      if (
        currentFactor &&
        !availableFactors.includes(currentFactor)
      ) {
        addOption(
          currentFactor,
          `${currentFactor} (aktuell nicht verfügbar)`
        );
      }

      availableFactors.forEach(name => {
        addOption(name, `SUM × MIN(${name})`);
      });

      factorSelect.value = currentFactor;

      factorGroup.appendChild(factorLabel);
      factorGroup.appendChild(factorSelect);
      row.appendChild(factorGroup);

      container.appendChild(row);
    });

    // Apply translations to new dynamic elements
    const savedLang = this._config.language || 'de';
    if (typeof applyI18n === 'function') applyI18n(savedLang);
  }

  /**
   * Save settings and close dialog.
   * Reads DOM values directly to guarantee accurate state capture.
   * @private
   */
  async _save() {
    const saveBtn = document.getElementById('btn-save');

    if (saveBtn?.disabled) return;

    try {
      this._saveCurrentCfFieldState();

      const getV = id =>
        document.getElementById(id)?.value || '';

      const getC = (id, fallback = true) => {
        const element = document.getElementById(id);
        return element ? element.checked : fallback;
      };

      // Preserve existing measure formats.
      const valueFormats = {
        ...(this._config.valueFormats || {})
      };

      (this._config.valueFields || []).forEach(vf => {
        const typeEl = document.getElementById(
          `val-fmt-type-${vf.field}`
        );

        const decEl = document.getElementById(
          `val-fmt-dec-${vf.field}`
        );

        const labelEl = document.getElementById(
          `val-fmt-label-${vf.field}`
        );

        if (!typeEl || !decEl) return;

        valueFormats[vf.field] = {
          type: typeEl.value,
          decimals: Number.parseInt(decEl.value, 10) || 0,
          label: labelEl?.value.trim() || ''
        };
      });

      // Hierarchy sorting.
      const rowSort = {
        ...(this._config.rowSort || {})
      };

      (this._config.rowFields || []).forEach(
        (rowField, index) => {
          const modeEl = document.getElementById(
            `row-sort-mode-${index}`
          );

          const fieldEl = document.getElementById(
            `row-sort-field-${index}`
          );

          if (!modeEl) return;

          const mode = modeEl.value;
          const field = fieldEl?.value || '';

          if (mode.startsWith('field-') && !field) {
            throw new Error(
              `Bitte ein Sortierfeld für "${rowField}" auswählen.`
            );
          }

          rowSort[rowField] = {
            mode,
            ...(mode.startsWith('field-')
              ? { field }
              : {})
          };
        }
      );

      // Validate custom summary groups before saving.
      for (const group of this._config.summaryGroups || []) {
        group.label = (group.label || '').trim();

        if (!group.label) {
          throw new Error(
            'Bitte für jede Summenzeile eine Bezeichnung eingeben.'
          );
        }

        if (!group.members || group.members.length === 0) {
          throw new Error(
            `Bitte mindestens eine Position für "${group.label}" auswählen.`
          );
        }
      }

        // Includes all current session settings.
        const updated = {
          ...this._config,

          theme: getV('theme-select') || 'theme-light',
          density: getV('density-select') || 'normal',
          fontSize: getV('fontsize-select') || '12px',

          showZebra: getC('toggle-zebra'),
          showHGrid: getC('toggle-hgrid'),
          showVGrid: getC('toggle-vgrid'),

          showSubtotals: getC('toggle-subtotals'),
          showGrandTotal: getC('toggle-grandtotal'),
          showRowTotal: getC('toggle-rowtotal'),

          showToolbar: getC('toggle-showtoolbar'),
          showExportButtons: getC('toggle-showexport'),
          showStatusBar: getC('toggle-showstatusbar'),

          // Toolbar title
          showToolbarTitle: getC('toggle-showtitle'),

          toolbarTitle:
            getV('toolbar-title-input').trim() || 'Matrix Pro',

          showDrillThrough: getC('toggle-showdrill'),

          language: getV('language-select') || 'de',
          numberLocale: getV('number-locale-select') || 'de-DE',

          valueFormats,
          rowSort,
          signFactorFields,

          cfConfigs: this._config.cfConfigs || {},

          drillThroughParameters: {
            rowPath: getV('drill-param-rowPath').trim(),
            columnName: getV('drill-param-columnName').trim()
          }
        };

        // Remove obsolete individual color settings.
        delete updated.barColors;

        // Never persist dynamically discovered field metadata.
        delete updated.availableSortFields;

        // Personal column layout belongs to Tableau Custom Views,
        // not the workbook-wide extension configuration.
        delete updated.columnOrder;
        delete updated.hiddenColumns;
        delete updated.columnWidths;

        const settings = tableau.extensions.settings;
        const previousRaw = settings.get('matrixConfig');

        if (saveBtn) saveBtn.disabled = true;

        try {
          settings.set('matrixConfig', JSON.stringify(updated));

          // Persist explicitly in Tableau authoring mode.
          await settings.saveAsync();

        } catch (err) {
          // Restore the previous in-memory settings value if saving fails.
          if (previousRaw !== undefined) {
            settings.set('matrixConfig', previousRaw);
          } else {
            settings.erase('matrixConfig');
          }

          throw err;
        }

        console.log('[ConfigDialog] Tableau settings saved.');

        // The main extension will reload the saved configuration.
        tableau.extensions.ui.closeDialog('saved');

      } catch (err) {
        console.error('[ConfigDialog] Save error:', err);

        alert(
          'Die Einstellungen konnten nicht gespeichert werden.\n' +
          (err.message || String(err))
        );

      } finally {
        if (saveBtn) saveBtn.disabled = false;
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

  /**
   * Helper template for default conditional formatting configuration block.
   * @private
   */
  _getDefaultCfConfig() {
    return {
      enabled: false,
      mode: 'gradient',
      minColor: '#fee2e2',
      maxColor: '#dcfce7',
      ruleVal1: 50000,
      ruleBg1: '#fee2e2',
      ruleText1: '#991b1b',
      ruleVal2: 200000,
      ruleBg2: '#fef3c7',
      ruleText2: '#92400e',
      ruleBg3: '#dcfce7',
      ruleText3: '#166534'
    };
  }

  /**
   * Reads settings from the DOM controls and updates memory state for the active field.
   * @private
   */
  _saveCurrentCfFieldState() {
    if (!this._currentCfField) return;
    const getV = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
    const getC = (id) => { const el = document.getElementById(id); return el ? el.checked : false; };

    this._config.cfConfigs = this._config.cfConfigs || {};
    this._config.cfConfigs[this._currentCfField] = {
      enabled: getC('toggle-cf'),
      mode: getV('cf-mode-select') || 'gradient',
      minColor: getV('cf-min-color') || '#fee2e2',
      maxColor: getV('cf-max-color') || '#dcfce7',
      ruleVal1: parseFloat(getV('rule-val-1')) || 50000,
      ruleBg1: getV('rule-bg-1') || '#fee2e2',
      ruleText1: getV('rule-text-1') || '#991b1b',
      ruleVal2: parseFloat(getV('rule-val-2')) || 200000,
      ruleBg2: getV('rule-bg-2') || '#fef3c7',
      ruleText2: getV('rule-text-2') || '#92400e',
      ruleBg3: getV('rule-bg-3') || '#dcfce7',
      ruleText3: getV('rule-text-3') || '#166534'
    };
  }

  /**
   * Loads in memory config for the selected field and updates DOM controls.
   * @private
   */
  _loadCfFieldState(field) {
    if (!field) return;
    this._currentCfField = field;
    this._config.cfConfigs = this._config.cfConfigs || {};

    if (!this._config.cfConfigs[field]) {
      this._config.cfConfigs[field] = this._getDefaultCfConfig();
    }

    const cfg = this._config.cfConfigs[field];

    const setC = (id, val) => { const el = document.getElementById(id); if (el) el.checked = Boolean(val); };
    const setV = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };

    setC('toggle-cf', cfg.enabled);
    setV('cf-mode-select', cfg.mode || 'gradient');
    setV('cf-min-color', cfg.minColor || '#fee2e2');
    setV('cf-max-color', cfg.maxColor || '#dcfce7');
    setV('rule-val-1', cfg.ruleVal1 !== undefined ? cfg.ruleVal1 : 50000);
    setV('rule-bg-1', cfg.ruleBg1 || '#fee2e2');
    setV('rule-text-1', cfg.ruleText1 || '#991b1b');
    setV('rule-val-2', cfg.ruleVal2 !== undefined ? cfg.ruleVal2 : 200000);
    setV('rule-bg-2', cfg.ruleBg2 || '#fef3c7');
    setV('rule-text-2', cfg.ruleText2 || '#92400e');
    setV('rule-bg-3', cfg.ruleBg3 || '#dcfce7');
    setV('rule-text-3', cfg.ruleText3 || '#166534');

    // Sync sub-panel layouts in UI
    const cfPanel = document.getElementById('cf-settings-panel');
    if (cfPanel) {
      cfPanel.style.display = cfg.enabled ? 'block' : 'none';
    }

    const isRules = cfg.mode === 'rules';
    const cfGradPanel = document.getElementById('cf-gradient-panel');
    const cfRulesPanel = document.getElementById('cf-rules-panel');
    if (cfGradPanel) cfGradPanel.style.display = isRules ? 'none' : 'block';
    if (cfRulesPanel) cfRulesPanel.style.display = isRules ? 'block' : 'none';
  }
}

// Expose globally
window.ConfigDialog = ConfigDialog;

document.addEventListener('DOMContentLoaded', () => {
  const dialog = new ConfigDialog();
  dialog.init();
});
