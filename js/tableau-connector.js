/**
 * ============================================================================
 * TableauConnector — Tableau Extensions API Integration Layer
 * ============================================================================
 *
 * Handles all communication with the Tableau Extensions API:
 *   - Initialization and lifecycle
 *   - Reading worksheet data
 *   - Persisting configuration in extension settings
 *   - Cross-filtering other dashboard worksheets
 *   - Listening for data/filter change events
 *
 * USAGE:
 *   const connector = new TableauConnector();
 *   await connector.initialize(onConfigureCallback);
 *   const data = await connector.fetchData('Sheet 1');
 */

class TableauConnector {

  constructor() {
    this._dashboard = null;
    this._worksheet = null;
    this._isVizExtension = false;
    this._eventListeners = [];
    this._dataChangedCallbacks = [];
    this._isInitialized = false;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Initialization
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Initialize the Tableau Extensions API.
   * @param {Function} onConfigureCallback - Called when user opens Configure dialog
   * @returns {Promise<void>}
   */
  async initialize(onConfigureCallback) {
    try {
      await tableau.extensions.initializeAsync({
        configure: onConfigureCallback
      });

      if (tableau.extensions.worksheetContent) {
        this._isVizExtension = true;
        this._worksheet = tableau.extensions.worksheetContent.worksheet;
        console.log('[TableauConnector] Initialized as Viz Extension. Worksheet:', this._worksheet.name);
      } else if (tableau.extensions.dashboardContent) {
        this._isVizExtension = false;
        this._dashboard = tableau.extensions.dashboardContent.dashboard;
        console.log('[TableauConnector] Initialized as Dashboard Extension. Dashboard:', this._dashboard.name);
      } else {
        console.warn('[TableauConnector] Neither worksheetContent nor dashboardContent found.');
      }

      this._isInitialized = true;
      return true;
    } catch (err) {
      console.error('[TableauConnector] Initialization failed:', err);
      throw new Error('Failed to initialize Tableau Extensions API: ' + err.message);
    }
  }

  /**
   * Check if the connector is initialized.
   */
  get isInitialized() {
    return this._isInitialized;
  }

  /**
   * Check if running as a Viz Extension.
   */
  get isVizExtension() {
    return this._isVizExtension;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Worksheet Discovery
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get the list of worksheet names.
   * @returns {string[]}
   */
  getWorksheetNames() {
    if (this._isVizExtension && this._worksheet) {
      return [this._worksheet.name];
    }
    if (this._dashboard) {
      return this._dashboard.worksheets.map(ws => ws.name);
    }
    return [];
  }

  /**
   * Get a specific worksheet by name.
   * @param {string} name
   * @returns {Worksheet|null}
   */
  getWorksheet(name) {
    if (this._isVizExtension && this._worksheet) {
      return this._worksheet;
    }
    if (!this._dashboard) return null;
    return this._dashboard.worksheets.find(ws => ws.name === name) || null;
  }

  /**
   * Get encoding map from Tableau Viz Specification.
   *
   * Tableau's API structure:
   *   spec.marksSpecifications[activeIndex].encodings → array of encoding objects
   *   Each encoding object: { id: "rows"|"columns"|"values", field: { name: "Category" } }
   */
  async getVisualSpecificationEncodings() {
    if (!this._worksheet || typeof this._worksheet.getVisualSpecificationAsync !== 'function') {
      return null;
    }

    try {
      const spec = await this._worksheet.getVisualSpecificationAsync();

      const result = {
        rowFields: [],
        colFields: [],
        valueFields: [],
        _debugSpec: spec
      };

      if (!spec) return result;

      // Clean bracket notation
      const clean = (str) => (str || '').replace(/^\[|\]$/g, '').trim();

      // Classify one field into the correct bucket based on shelf string
      const addField = (shelfStr, fieldObj) => {
        if (!fieldObj) return;
        const idStr = String(shelfStr || '').toLowerCase().trim();

        // Extract field name
        let name = '';
        if (typeof fieldObj === 'string') {
          name = fieldObj;
        } else if (typeof fieldObj === 'object') {
          name = fieldObj.name || fieldObj.fieldName || fieldObj.caption || fieldObj.fieldId || fieldObj.id || '';
        }
        name = clean(name);
        if (!name) return;

        // Classify shelf
        let shelf = '';
        if (idStr.includes('row') || idStr === 'a') {
          shelf = 'rows';
        } else if (idStr.includes('col') || idStr.includes('column') || idStr === 'b') {
          shelf = 'columns';
        } else if (idStr.includes('val') || idStr.includes('value') || idStr.includes('measure') || idStr === 'c') {
          shelf = 'values';
        }

        if (shelf === 'rows') {
          if (!result.rowFields.includes(name)) result.rowFields.push(name);
        } else if (shelf === 'columns') {
          if (!result.colFields.includes(name)) result.colFields.push(name);
        } else if (shelf === 'values') {
          if (!result.valueFields.find(v => v.field === name)) {
            const agg = (fieldObj && fieldObj.aggregation) ? String(fieldObj.aggregation).toLowerCase() : 'sum';
            result.valueFields.push({ field: name, aggFunc: agg, label: name });
          }
        }
      };

      // Primary: spec.marksSpecifications[activeIndex].encodings
      const idx = typeof spec.activeMarksSpecificationIndex === 'number'
        ? spec.activeMarksSpecificationIndex : 0;

      if (Array.isArray(spec.marksSpecifications) && spec.marksSpecifications.length > 0) {
        const ms = spec.marksSpecifications[idx] || spec.marksSpecifications[0];

        if (Array.isArray(ms.encodings)) {
          ms.encodings.forEach(enc => {
            // Concatenate all text properties to guarantee matching rows/columns/values
            const shelfStr = `${enc.id || ''} ${enc.fieldEncodingId || ''} ${enc.name || ''} ${enc.displayName || ''}`;

            if (enc.field) {
              addField(shelfStr, enc.field);
            }
            if (Array.isArray(enc.fields)) {
              enc.fields.forEach(f => addField(shelfStr, f));
            }
          });
        }
      }

      // If user has dimensions in rows but no measure in values yet, default to count of rows
      if (result.rowFields.length > 0 && result.valueFields.length === 0) {
        result.valueFields.push({ field: '_count', aggFunc: 'count', label: (typeof t === 'function' ? t('default_measure_label') : 'Recuento') });
      }

      console.log('[TableauConnector] Parsed Encodings Result:', result);
      return result;
    } catch (err) {
      console.warn('[TableauConnector] getVisualSpecificationEncodings error:', err);
      return null;
    }
  }


  /**
   * Get the column metadata (field names and data types) for a worksheet.
   * Uses getSummaryDataAsync to read the available columns.
   * @param {string} worksheetName
   * @returns {Promise<Array<{fieldName: string, dataType: string, index: number}>>}
   */
  async getWorksheetFields(worksheetName) {
    const ws = this.getWorksheet(worksheetName);
    if (!ws) throw new Error(`Worksheet "${worksheetName}" not found.`);

    try {
      const dataTable = await ws.getSummaryDataAsync();
      return dataTable.columns.map(col => ({
        fieldName: col.fieldName,
        dataType: col.dataType,
        index: col.index
      }));
    } catch (err) {
      console.error(`[TableauConnector] Failed to get fields for "${worksheetName}":`, err);
      throw err;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Data Extraction
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Fetch data from a worksheet and return it as an array of plain objects.
   *
   * Each object maps field names to their values:
   *   [{ Region: "West", Sales: 1200.50, ... }, ...]
   *
   * @param {string} worksheetName
   * @param {Object} [options]
   * @param {number} [options.maxRows] - Max rows to fetch (0 = all)
   * @returns {Promise<Object[]>}
   */
  async fetchData(worksheetName, options = {}) {
    const ws = this.getWorksheet(worksheetName);
    if (!ws) throw new Error(`Worksheet "${worksheetName}" not found.`);

    try {
      const fetchOptions = {};
      if (options.maxRows) {
        fetchOptions.maxRows = options.maxRows;
      }

      const dataTable = await ws.getSummaryDataAsync(fetchOptions);
      return this._dataTableToObjects(dataTable);
    } catch (err) {
      console.error(`[TableauConnector] Failed to fetch data from "${worksheetName}":`, err);
      throw err;
    }
  }

  /**
   * Convert a Tableau DataTable into an array of plain JS objects.
   * Uses `formattedValue` for dimensions and `value` for numeric measures.
   * @private
   */
  _dataTableToObjects(dataTable) {
    const columns = dataTable.columns;
    const rows = dataTable.data;
    const result = [];

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const obj = {};

      for (let c = 0; c < columns.length; c++) {
        const col = columns[c];
        const cell = row[c];

        // Use the native value for numeric types, formatted value for strings
        if (col.dataType === 'float' || col.dataType === 'int') {
          obj[col.fieldName] = cell.value;
        } else {
          // Use formattedValue for dimensions, dates, etc.
          obj[col.fieldName] = cell.formattedValue;
        }
      }

      result.push(obj);
    }

    return result;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Configuration Persistence (Extension Settings)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Save configuration to extension settings & localStorage.
   * @param {Object} config - Configuration object to save
   * @returns {Promise<void>}
   */
  async saveConfig(config) {
    const raw = JSON.stringify(config);
    try { localStorage.setItem('matrixConfig', raw); } catch(e) {}
    if (typeof tableau !== 'undefined' && tableau.extensions && tableau.extensions.settings) {
      tableau.extensions.settings.set('matrixConfig', raw);
      try { await tableau.extensions.settings.saveAsync(); } catch(e) {}
    }
  }

  /**
   * Load configuration from localStorage or extension settings.
   * @returns {Object|null}
   */
  loadConfig() {
    let raw = null;
    try { raw = localStorage.getItem('matrixConfig'); } catch(e) {}

    if (!raw && typeof tableau !== 'undefined' && tableau.extensions && tableau.extensions.settings) {
      raw = tableau.extensions.settings.get('matrixConfig');
    }

    if (!raw) return null;

    try {
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Configuration Dialog
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Open the configuration dialog as a Tableau popup.
   * @param {string} dialogUrl - URL to the config.html page
   * @returns {Promise<string>} - Payload returned by the dialog
   */
  async openConfigDialog(dialogUrl) {
    try {
      const payload = await tableau.extensions.ui.displayDialogAsync(
        dialogUrl,
        '', // initial payload (unused; config is read from settings)
        { height: 640, width: 540 }
      );
      console.log('[TableauConnector] Config dialog closed. Payload:', payload);
      return payload;
    } catch (err) {
      // tableau.ErrorCodes.DialogClosedByUser means user cancelled
      if (err.errorCode === tableau.ErrorCodes.DialogClosedByUser) {
        console.log('[TableauConnector] Config dialog cancelled by user.');
        return null;
      }
      throw err;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Cross-Filtering
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Apply a categorical filter to all worksheets in the dashboard
   * (except the source worksheet, to avoid circular filtering).
   *
   * @param {string} fieldName - The field/dimension name to filter on
   * @param {string[]} values  - Array of values to filter to
   * @param {string} [sourceWorksheetName] - The worksheet driving the filter (excluded)
   */
  async applyDashboardFilter(fieldName, values, sourceWorksheetName) {
    if (this._dashboard) {
      const promises = this._dashboard.worksheets
        .filter(ws => ws.name !== sourceWorksheetName)
        .map(ws =>
          ws.applyFilterAsync(fieldName, values, tableau.FilterUpdateType.Replace)
            .catch(err => {
              console.warn(`[TableauConnector] Filter skipped for "${ws.name}":`, err.message);
            })
        );
      await Promise.all(promises);
      console.log(`[TableauConnector] Dashboard filter applied: ${fieldName} = [${values.join(', ')}]`);
    } else if (this._worksheet) {
      await this._worksheet.applyFilterAsync(fieldName, values, tableau.FilterUpdateType.Replace)
        .catch(err => console.warn('[TableauConnector] Filter skipped:', err.message));
    }
  }

  /**
   * Clear a categorical filter.
   * @param {string} fieldName
   */
  async clearDashboardFilter(fieldName) {
    if (this._dashboard) {
      const promises = this._dashboard.worksheets.map(ws =>
        ws.clearFilterAsync(fieldName)
          .catch(err => {
            console.warn(`[TableauConnector] Clear filter skipped for "${ws.name}":`, err.message);
          })
      );
      await Promise.all(promises);
      console.log(`[TableauConnector] Dashboard filter cleared: ${fieldName}`);
    } else if (this._worksheet) {
      await this._worksheet.clearFilterAsync(fieldName)
        .catch(err => console.warn('[TableauConnector] Clear filter skipped:', err.message));
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Event Listeners
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Register a callback to be invoked when data changes on the configured worksheet.
   * Listens for FilterChanged, MarkSelectionChanged, and SummaryDataChanged events.
   *
   * @param {string} worksheetName
   * @param {Function} callback - Called with no arguments when data changes
   */
  registerDataChangeListener(worksheetName, callback) {
    const ws = this.getWorksheet(worksheetName);
    if (!ws) {
      console.warn(`[TableauConnector] Cannot register listener: worksheet "${worksheetName}" not found.`);
      return;
    }

    // Remove previous listeners
    this.removeAllListeners();

    const eventTypes = [
      tableau.TableauEventType.FilterChanged,
      tableau.TableauEventType.MarkSelectionChanged
    ];
    if (tableau.TableauEventType.SummaryDataChanged) {
      eventTypes.push(tableau.TableauEventType.SummaryDataChanged);
    }

    eventTypes.forEach(eventType => {
      try {
        const unsub = ws.addEventListener(eventType, () => {
          console.log(`[TableauConnector] Event ${eventType} on`, ws.name);
          callback();
        });
        this._eventListeners.push(unsub);
      } catch (e) {
        console.warn(`[TableauConnector] Listener skipped for ${eventType}:`, e.message);
      }
    });

    console.log('[TableauConnector] Data change listeners registered for', ws.name);
  }

  /**
   * Remove all registered event listeners.
   */
  removeAllListeners() {
    this._eventListeners.forEach(unsub => {
      if (typeof unsub === 'function') unsub();
    });
    this._eventListeners = [];
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Utilities
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get the dashboard or worksheet name.
   */
  get dashboardName() {
    if (this._isVizExtension && this._worksheet) {
      return this._worksheet.name;
    }
    return this._dashboard ? this._dashboard.name : 'Unknown';
  }
}

// Expose globally
window.TableauConnector = TableauConnector;
