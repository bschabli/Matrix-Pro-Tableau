/**
 * ============================================================================
 * MatrixApp — Main Application Controller
 * ============================================================================
 *
 * Orchestrates all components:
 *   1. TableauConnector — data extraction & cross-filtering
 *   2. PivotEngine      — data transformation
 *   3. MatrixRenderer    — DOM rendering
 *   4. ExportManager     — Excel/CSV export
 *
 * Lifecycle:
 *   DOM ready → init() → connect to Tableau → load config → fetch data →
 *   transform → render → listen for changes
 */

class MatrixApp {

  constructor() {
    this.connector = new TableauConnector();
    this.engine = null;
    this.renderer = null;
    this.exporter = new ExportManager();
    this.config = null;
    this._matrixData = null;
    this._isLoading = false;
    this._expansionState = new Map();
    this._personalParameterName = 'p.matrix_state_guv';
    this._personalParameter = null;
    this._baseColumnSettings = null;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Initialization
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Initialize the application.
   */
  async init() {
    try {
      this._showLoading('Connecting to Tableau...');

      // 1. Initialize Tableau Extensions API
      await this.connector.initialize(() => this._openConfigDialog());

      // 2. Load saved configuration
      this.config = this.connector.loadConfig();

      // For Viz Extensions, always set worksheetName to the current sheet
      const wsNames = this.connector.getWorksheetNames();
      if (this.connector.isVizExtension && wsNames.length > 0) {
        if (!this.config) {
          this.config = { worksheetName: wsNames[0], rowFields: [], colFields: [], valueFields: [], theme: 'theme-light' };
        } else {
          this.config.worksheetName = wsNames[0];
        }
      }

      // Remember the workbook defaults separately from personal settings.
      this._baseColumnSettings = {
        columnOrder: [...(this.config?.columnOrder || [])],
        hiddenColumns: [...(this.config?.hiddenColumns || [])],
        columnWidths: { ...(this.config?.columnWidths || {}) }
      };

      // Read the personal Tableau parameter before the initial render.
      await this._setupPersonalState();

      // Apply theme class and saved language
      const currentTheme = (this.config && this.config.theme) ? this.config.theme : 'theme-light';
      document.body.className = currentTheme;

      this._applyVisibilityClasses();

      const currentLang = this.config?.language || 'de';
      if (typeof applyI18n === 'function') applyI18n(currentLang);

      if (this.config && this.config.worksheetName) {
        // Always attempt to refresh: encodings come from Tableau Marks card shelves
        await this._refresh();

        // Register event listeners for data changes
        this.connector.registerDataChangeListener(
          this.config.worksheetName,
          () => this._onDataChanged()
        );
      } else {
        this._showWelcome();
      }

      // 3. Wire up toolbar buttons
      this._bindToolbar();

    } catch (err) {
      console.error('[MatrixApp] Initialization error:', err);
      this._showError(err);
    }
  }

  _applyVisibilityClasses() {
    if (!this.config) return;
    const noTB = this.config.showToolbar === false || String(this.config.showToolbar) === 'false';
    const noSB = this.config.showStatusBar === false || String(this.config.showStatusBar) === 'false';
    const noEX = this.config.showExportButtons === false || String(this.config.showExportButtons) === 'false';

    document.body.classList.toggle('no-toolbar', noTB);
    document.body.classList.toggle('no-statusbar', noSB);
    document.body.classList.toggle('no-export', noEX);

    const appEl = document.getElementById('app');
    if (appEl) {
      appEl.classList.toggle('no-toolbar', noTB);
      appEl.classList.toggle('no-statusbar', noSB);
      appEl.classList.toggle('no-export', noEX);
    }
    this._applyBarDesign();
  }

    /**
     * Apply toolbar title settings.
     * Colors are controlled exclusively by the selected theme.
     */
    _applyBarDesign() {
      if (!this.config) return;

      const toolbar = document.getElementById(
        'main-toolbar'
      );

      const brand = document.getElementById(
        'toolbar-brand'
      );

      const title = document.getElementById(
        'toolbar-brand-text'
      );

      const showTitle =
        this.config.showToolbarTitle !== false;

      if (title) {
        title.textContent =
          this.config.toolbarTitle || 'Matrix Pro';
      }

      if (brand) {
        brand.style.display = showTitle ? 'flex' : 'none';
      }

      if (toolbar) {
        toolbar.classList.toggle(
          'toolbar-no-title',
          !showTitle
        );
      }
    }

  // ──────────────────────────────────────────────────────────────────────────
  // Data Pipeline: Fetch → Transform → Render
  // ──────────────────────────────────────────────────────────────────────────

  /**
 * Connect the personal column layout to a Tableau string parameter.
 */
  async _setupPersonalState() {
    const worksheet = this.connector.getWorksheet(
      this.config?.worksheetName
    );

    if (!worksheet?.findParameterAsync) {
      console.warn(
        '[MatrixApp] Tableau parameter API unavailable.'
      );
      return;
    }

    try {
      const parameter = await worksheet.findParameterAsync(
        this._personalParameterName
      );

      if (!parameter) {
        console.warn(
          `[MatrixApp] Parameter not found: ${this._personalParameterName}`
        );
        return;
      }

      this._personalParameter = parameter;

      // Restore the current Tableau / Custom View state.
      await this._readPersonalState();

      // React when Tableau loads another parameter value.
      parameter.addEventListener(
        tableau.TableauEventType.ParameterChanged,
        async () => {
          try {
            const restored = await this._readPersonalState();

            if (!restored || !this.renderer || !this._matrixData) {
              return;
            }

            // Apply widths to the existing renderer as well.
            this.renderer.options.columnWidths = {
              ...this.config.columnWidths
            };

            // No Tableau data query required.
            this._renderVisibleMatrix();
            this._updateStatusBar();

          } catch (err) {
            console.error(
              '[MatrixApp] Personal view restore failed:',
              err
            );
          }
        }
      );

    } catch (err) {
      console.warn(
        '[MatrixApp] Personal state initialization failed:',
        err
      );
    }
  }

  /**
 * Read and apply personal column settings from Tableau.
 * An empty parameter restores the workbook defaults.
 */
  async _readPersonalState() {
      if (!this._personalParameter || !this.config) {
        return false;
      }

      const worksheet = this.connector.getWorksheet(
        this.config.worksheetName
      );

      const parameter = await worksheet.findParameterAsync(
        this._personalParameterName
      );

      if (!parameter) return false;

      const raw = String(parameter.currentValue?.value ?? '');

      let state = null;

      if (raw) {
        try {
          state = JSON.parse(raw);

          if (
            !state ||
            typeof state !== 'object' ||
            state.v !== 1
          ) {
            throw new Error('Unsupported personal state format.');
          }
        } catch (err) {
          console.warn(
            '[MatrixApp] Invalid personal state parameter:',
            err
          );
          return false;
        }
      }

      const defaults = this._baseColumnSettings || {
        columnOrder: [],
        hiddenColumns: [],
        columnWidths: {}
      };

      // Column order
      this.config.columnOrder = Array.isArray(state?.columnOrder)
        ? state.columnOrder.filter(key => typeof key === 'string')
        : [...defaults.columnOrder];

      // Column visibility
      this.config.hiddenColumns = Array.isArray(state?.hiddenColumns)
        ? state.hiddenColumns.filter(key => typeof key === 'string')
        : [...defaults.hiddenColumns];

      // Column widths
      const validWidths = state?.columnWidths &&
        typeof state.columnWidths === 'object' &&
        !Array.isArray(state.columnWidths)
          ? Object.fromEntries(
              Object.entries(state.columnWidths).filter(
                ([key, width]) =>
                  typeof key === 'string' &&
                  Number.isFinite(width) &&
                  width >= 70 &&
                  width <= 700
              )
            )
          : { ...defaults.columnWidths };

      this.config.columnWidths = validWidths;

      return true;
    }

    /**
     * Write the current column layout to the Tableau parameter.
     * The user must subsequently save a Tableau Custom View.
     */
    async _savePersonalState() {
      const button = document.getElementById(
        'btn-save-personal-view'
      );

      if (button?.disabled) return;

      if (button) button.disabled = true;

      try {
        const worksheet = this.connector.getWorksheet(
          this.config?.worksheetName
        );

        if (!worksheet?.findParameterAsync) {
          throw new Error(
            'Die Tableau-Parameter-API ist nicht verfügbar.'
          );
        }

        const parameter = await worksheet.findParameterAsync(
          this._personalParameterName
        );

        if (!parameter) {
          throw new Error(
            `Parameter "${this._personalParameterName}" nicht gefunden.`
          );
        }

        const state = {
          v: 1,

          columnOrder: [
            ...(this.config.columnOrder || [])
          ],

          hiddenColumns: [
            ...(this.config.hiddenColumns || [])
          ],

          columnWidths: {
            ...(this.config.columnWidths || {})
          }
        };

        const json = JSON.stringify(state);

        // Only write if the parameter value actually changed.
        if (
          String(parameter.currentValue?.value ?? '') !== json
        ) {
          await parameter.changeValueAsync(json);
        }

        console.log(
          '[MatrixApp] Personal column layout transferred to Tableau.'
        );

        alert(
          'Spaltenlayout übernommen.\n\n' +
          'Speichere jetzt deine persönliche Ansicht ' +
          'über die Custom-View-Funktion in Tableau.'
        );

      } catch (err) {
        console.error(
          '[MatrixApp] Saving personal view failed:',
          err
        );

        alert(
          'Das Spaltenlayout konnte nicht übernommen werden.\n' +
          (err.message || String(err))
        );

      } finally {
        if (button) button.disabled = false;
      }
    }

  /**
   * Full refresh: fetch data, transform, and render.
   * @private
   */
  async _refresh() {
    if (this._isLoading) return;
    this._isLoading = true;

    // Temporarily disable event listeners to avoid recursive rendering/fetching loops
    this.connector.removeAllListeners();

    const isInitialLoad = !this.renderer || !document.getElementById('matrix-container').innerHTML;

    try {
      // Apply configured theme
      const currentTheme = (this.config && this.config.theme) ? this.config.theme : 'theme-light';
      document.body.className = currentTheme;
      const appEl = document.getElementById('app');
      if (appEl) appEl.className = currentTheme;

      // Apply UI element visibility via CSS classes
      this._applyVisibilityClasses();

      if (isInitialLoad) this._showLoading(t('loading_shelves'));

      // 1. Read field assignments directly from Tableau Marks card shelves
      const encodings = await this.connector.getVisualSpecificationEncodings();

      let isEncodingsChanged = false;
      if (encodings) {
        // Compare with active configuration, and only save if fields changed
        const rowsChanged = JSON.stringify(this.config.rowFields) !== JSON.stringify(encodings.rowFields);
        const colsChanged = JSON.stringify(this.config.colFields) !== JSON.stringify(encodings.colFields);
        const valsChanged = JSON.stringify(this.config.valueFields) !== JSON.stringify(encodings.valueFields);
        isEncodingsChanged = rowsChanged || colsChanged || valsChanged;

        if (isEncodingsChanged) {
          this.config.rowFields = encodings.rowFields || [];
          this.config.colFields = encodings.colFields || [];
          this.config.valueFields = encodings.valueFields || [];
        }
      }

      // Check if required fields exist (must have at least Rows)
      const hasRows = this.config.rowFields && this.config.rowFields.length > 0;

      if (!hasRows) {
        const msg = t('config_prompt_default');
        this._showConfigPrompt(msg);
        this._isLoading = false;
        return;
      }

      if (isInitialLoad) this._showLoading(t('loading_data'));

      // 2. Fetch raw data from the worksheet
      const rawData = await this.connector.fetchData(this.config.worksheetName);
      console.log(`[MatrixApp] Fetched ${rawData.length} rows from "${this.config.worksheetName}"`);

      if (rawData.length === 0) {
        this._showEmpty(t('no_data_found'));
        this._isLoading = false;
        return;
      }

      // Available fields from Tableau summary data.
      // Includes row, column, value and Detail fields.
      const availableFields = Object.keys(rawData[0])
        .filter(field => field !== '__tupleId');

      // Keep field catalog available for the configuration dialog.
      const previousFields = this.config.availableSortFields || [];

      if (
        JSON.stringify(previousFields) !==
        JSON.stringify(availableFields)
      ) {
        this.config.availableSortFields = availableFields;
      }

      console.log(
        '[MatrixApp] Available sort fields:',
        availableFields
      );

      if (isInitialLoad) this._showLoading(t('transforming_data'));

      // Preserve expansion state across data refreshes.
      if (this.renderer) {
        const previousFields =
          this._matrixData?.config?.rowFields || [];

        const currentFields =
          this.config.rowFields || [];

        if (
          JSON.stringify(previousFields) ===
          JSON.stringify(currentFields)
        ) {
          for (const [key, expanded] of
            this.renderer.getExpansionState()) {

            this._expansionState.set(key, expanded);
          }
        } else {
          // Different hierarchy: discard old expansion states.
          this._expansionState.clear();
        }
      }

      // 3. Transform flat data → hierarchical matrix
      this.engine = new PivotEngine({
        rowFields: this.config.rowFields || [],
        rowSort: this.config.rowSort || {},
        summaryGroups: this.config.summaryGroups || [],
        colFields: this.config.colFields || [],
        valueFields: (this.config.valueFields || []).map(v => ({
          ...v,
          label: this.config.valueFormats?.[v.field]?.label || v.label || v.field
        })),
        showRowTotal: this.config.showRowTotal !== false
      });

      this._matrixData = this.engine.process(rawData);

      // 3. Render the matrix
      const container = document.getElementById('matrix-container');
      this.renderer = new MatrixRenderer(container, {
        showSubtotals: this.config.showSubtotals !== false,
        showGrandTotal: this.config.showGrandTotal !== false,
        showDrillThrough: this.config.showDrillThrough !== false,
        cfConfigs: this.config.cfConfigs || {},
        density: this.config.density || 'normal',
        fontSize: this.config.fontSize || '12px',
        showZebra: this.config.showZebra !== false,
        showHGrid: this.config.showHGrid !== false,
        showVGrid: this.config.showVGrid !== false,
        expansionState: this._expansionState,
        valueFormats: (this.config && this.config.valueFormats) || {},
        columnWidths: this.config.columnWidths || {},

        onColumnWidthChange: (key, width) => {
          this.config.columnWidths = {
            ...(this.config.columnWidths || {}),
            [key]: width
          };
        },

        onColumnReorder: (sourceKey, targetKey, insertAfter) => {
          this._moveColumn(sourceKey, targetKey, insertAfter);
        },
        onCellClick: (cellInfo) => this._onCellClick(cellInfo),

        onCellHover: (tupleId, event) =>
          this.connector.hoverTuple(tupleId, event),
        onDrillThrough: (context, event) =>
          this._onDrillThrough(context, event),
        onExpandToggle: (path, expanded) =>
          this._onExpandToggle(path, expanded)
      });

      this._renderVisibleMatrix();

      // 4. Update status bar
      this._updateStatusBar();

      // 5. Show the matrix wrapper (hide welcome/loading)
      document.getElementById('matrix-wrapper').style.display = 'block';
      this._hideOverlays();

    } catch (err) {
      console.error('[MatrixApp] Refresh error:', err);
      this._showError(err);
    } finally {
      this._isLoading = false;
      // Re-register data change listeners after refreshing has finished
      if (this.config && this.config.worksheetName) {
        this.connector.registerDataChangeListener(
          this.config.worksheetName,
          () => this._onDataChanged()
        );
      }
    }
  }

  async _onDrillThrough(context, event) {
      if (this._drillThroughBusy) {
        return;
      }

      if (this.config?.showDrillThrough === false) {
        return;
      }

      this._drillThroughBusy = true;

      const anchor = {
        pageX: event.pageX,
        pageY: event.pageY
      };

      try {
        // 1. Pass the selected matrix context to configured parameters.
        //    This is optional if no parameter mapping exists.
        await this.connector.setDrillThroughParameters(
          context,
          this.config.drillThroughParameters || {}
        );

        // 2. Trigger the native Tableau selection action.
        await this.connector.selectDrillTuple(
          context.tupleId,
          anchor
        );

      } catch (error) {
        console.error(
          '[MatrixApp] Drill-through error:',
          error
        );

        this._updateStatusBar(
          `Einzelposten-Navigation: ${error.message}`
        );

      } finally {
        this._drillThroughBusy = false;
      }
    }

  // ──────────────────────────────────────────────────────────────────────────
  // Configuration Dialog
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Open the configuration dialog.
   * @private
   */
    async _openConfigDialog() {
      try {
        const configUrl = window.location.href.replace(
          /\/[^/]*$/,
          '/config.html'
        );

        // Get the current worksheet fields for the sort configuration.
        let availableFields = [];

        try {
          const columns = await this.connector.getWorksheetFields(
            this.config.worksheetName
          );

          availableFields = columns.map(col => col.fieldName);
        } catch (err) {
          console.warn(
            '[MatrixApp] Could not retrieve Tableau fields:',
            err
          );
        }

        // Pass current session settings without persisting them.
        const result = await this.connector.openConfigDialog(
          configUrl,
          {
            config: this.config,
            availableFields,

            // Bereits vorhandene oberste Hierarchieebene verwenden.
            availableSummaryMembers: (
              this._matrixData?.rowTree || []
            ).map(node => String(node.label))
          }
        );

        // Cancelled dialog: no changes to the matrix.
        if (result !== 'saved') return;

        // Read only the settings saved in the workbook.
        const freshConfig = this.connector.loadConfig();

        if (!freshConfig) {
          throw new Error(
            'Gespeicherte Tableau-Konfiguration konnte nicht geladen werden.'
          );
        }

        this.config = freshConfig;

        // Reload central defaults and overlay personal column settings.
        this._baseColumnSettings = {
          columnOrder: [...(this.config.columnOrder || [])],
          hiddenColumns: [...(this.config.hiddenColumns || [])],
          columnWidths: { ...(this.config.columnWidths || {}) }
        };

        await this._readPersonalState();

        const theme = this.config.theme || 'theme-light';
        document.body.className = theme;

        const appEl = document.getElementById('app');
        if (appEl) appEl.className = theme;

        const wrapEl = document.getElementById('matrix-wrapper');
        if (wrapEl) {
          wrapEl.className = `matrix-wrapper ${theme}`;
        }

        if (typeof applyI18n === 'function') {
          applyI18n(this.config.language || 'de');
        }

        this._applyVisibilityClasses();

        // Apply the saved settings to the matrix.
        await this._refresh();

      } catch (err) {
        console.error('[MatrixApp] Config dialog error:', err);
      }
    }

  // ──────────────────────────────────────────────────────────────────────────
  // Event Handlers
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Called when data changes on the source worksheet (filter/selection change).
   * @private
   */
  _onDataChanged() {
    console.log('[MatrixApp] Data changed, refreshing...');
    // Debounce rapid changes
    clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => this._refresh(), 300);
  }

  /**
   * Called when a value cell is clicked (for cross-filtering).
   * @private
   */
  async _onCellClick(cellInfo) {
    try {
      // Apply cross-filter based on the row dimension
      await this.connector.applyDashboardFilter(
        cellInfo.rowField,
        [cellInfo.rowValue],
        this.config.worksheetName
      );

      this._updateStatusBar(`Filtered: ${cellInfo.rowField} = ${cellInfo.rowValue}`);
    } catch (err) {
      console.warn('[MatrixApp] Cross-filter error:', err);
    }
  }

  /**
   * Called when a node is expanded or collapsed.
   * @private
   */
  _onExpandToggle(path, expanded) {
    console.log(`[MatrixApp] Node ${path} ${expanded ? 'expanded' : 'collapsed'}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Toolbar
  // ──────────────────────────────────────────────────────────────────────────

  _getOrderedColumns() {
    if (!this._matrixData) return [];

    const columns = this._matrixData.flatColumns;
    const savedOrder = this.config.columnOrder || [];

    // Total columns always stay at the end.
    const normal = columns.filter(col => !col.isTotal);
    const totals = columns.filter(col => col.isTotal);

    const byKey = new Map(normal.map(col => [col.key, col]));
    const ordered = [];

    // Restore saved order.
    savedOrder.forEach(key => {
      if (byKey.has(key)) {
        ordered.push(byKey.get(key));
        byKey.delete(key);
      }
    });

    // Append new columns that are not part of the saved order.
    ordered.push(...byKey.values());

    return [...ordered, ...totals];
}

  _moveColumn(sourceKey, targetKey, insertAfter = false) {
    if (sourceKey === targetKey) return;

    const columns = this._getOrderedColumns()
      .filter(col => !col.isTotal);

    const sourceIndex = columns.findIndex(c => c.key === sourceKey);
    const targetIndex = columns.findIndex(c => c.key === targetKey);

    if (sourceIndex < 0 || targetIndex < 0) return;

    const [moved] = columns.splice(sourceIndex, 1);

    const newTargetIndex = columns.findIndex(
      c => c.key === targetKey
    );

    columns.splice(
      newTargetIndex + (insertAfter ? 1 : 0),
      0,
      moved
    );

    // Save the complete order, including hidden columns.
    this.config.columnOrder = columns.map(c => c.key);

    // Re-render without querying Tableau again.
    this._renderVisibleMatrix();
    this._updateStatusBar();
  }

  _getVisibleMatrixData() {
      if (!this._matrixData) return null;

      const hidden = new Set(this.config.hiddenColumns || []);

      const flatColumns = this._getOrderedColumns().filter(
        col => !hidden.has(col.key)
      );

      return {
        ...this._matrixData,
        flatColumns,
        headerRows: this.engine._buildHeaderRows(flatColumns)
      };
    }

    _renderVisibleMatrix() {
      if (!this.renderer || !this._matrixData) return;

      this.renderer.render(this._getVisibleMatrixData());
      this._renderColumnPicker();
    }

    _renderColumnPicker() {
    const panel = document.getElementById('columns-menu-list');
    if (!panel || !this._matrixData) return;

    const previousScroll = panel.scrollTop;
    panel.replaceChildren();

    const hidden = new Set(this.config.hiddenColumns || []);
    const columns = this._getOrderedColumns();
    const movable = columns.filter(col => !col.isTotal);

    const visibleCount = columns.filter(
      col => !hidden.has(col.key)
    ).length;

    columns.forEach(col => {
      const row = document.createElement('div');
      row.className = 'columns-menu-item';

      // Visibility checkbox
      const label = document.createElement('label');
      label.className = 'columns-menu-label';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !hidden.has(col.key);
      checkbox.disabled = checkbox.checked && visibleCount === 1;

      const name = col.isTotal
        ? `Gesamt / ${col.label}`
        : col.colCombo?.length
          ? `${col.colCombo.join(' / ')} / ${col.label}`
          : col.label;

      const text = document.createElement('span');
      text.textContent = name;
      text.title = name;

      label.append(checkbox, text);

      checkbox.addEventListener('change', () => {
        const next = new Set(this.config.hiddenColumns || []);

        if (checkbox.checked) {
          next.delete(col.key);
        } else {
          next.add(col.key);
        }

        this.config.hiddenColumns = Array.from(next);

        this._renderVisibleMatrix();
        this._updateStatusBar();
      });

      // Reorder buttons
      const controls = document.createElement('div');
      controls.className = 'columns-menu-controls';

      const index = movable.findIndex(c => c.key === col.key);

      const actions = [
        {
          symbol: '←',
          title: 'Nach links verschieben',
          target: movable[index - 1],
          after: false
        },
        {
          symbol: '→',
          title: 'Nach rechts verschieben',
          target: movable[index + 1],
          after: true
        }
      ];

      actions.forEach(action => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'columns-move-btn';
        button.textContent = action.symbol;
        button.title = action.title;
        button.disabled = col.isTotal || !action.target;

        button.addEventListener('click', () => {
          if (action.target) {
            this._moveColumn(
              col.key,
              action.target.key,
              action.after
            );
          }
        });

        controls.appendChild(button);
      });

      row.append(label, controls);
      panel.appendChild(row);
    });

    panel.scrollTop = previousScroll;
  }

  /**
   * Bind toolbar button event listeners.
   * @private
   */
  _bindToolbar() {
    // Expand All
    const expandBtn = document.getElementById('btn-expand-all');
    if (expandBtn) {
      expandBtn.addEventListener('click', () => {
        if (this.renderer) this.renderer.expandAll();
      });
    }

    // Collapse All
    const collapseBtn = document.getElementById('btn-collapse-all');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', () => {
        if (this.renderer) this.renderer.collapseAll();
      });
    }

    // Export CSV
    const csvBtn = document.getElementById('btn-export-csv');
    if (csvBtn) {
      csvBtn.addEventListener('click', () => {
        if (this._matrixData) {
          this.exporter.exportToCSV(
            this._getVisibleMatrixData(),
            'Matrix_Pro_Export'
          );
        }
      });
    }

    // Refresh
    const refreshBtn = document.getElementById('btn-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this._refresh());
    }

    // Save personal column layout to Tableau parameter.
    const saveViewBtn = document.getElementById(
      'btn-save-personal-view'
    );

    if (saveViewBtn) {
      saveViewBtn.addEventListener(
        'click',
        () => this._savePersonalState()
      );
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // UI State Management
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Show loading spinner.
   * @private
   */
  _showLoading(message) {
    const overlay = document.getElementById('overlay');
    if (overlay) {
      overlay.innerHTML = `
        <div class="loading-overlay">
          <div class="spinner"></div>
          <div class="loading-text">${message || 'Loading...'}</div>
        </div>
      `;
      overlay.style.display = 'flex';
    }
  }

  /**
   * Show welcome screen (no configuration yet).
   * @private
   */
  _showWelcome() {
    const overlay = document.getElementById('overlay');
    if (overlay) {
      overlay.innerHTML = `
        <div class="welcome-screen">
          <div class="welcome-icon">📊</div>
          <div class="welcome-title">${t('welcome_title')}</div>
          <div class="welcome-subtitle">
            ${t('welcome_subtitle')}
          </div>
          <button class="welcome-btn" id="btn-welcome-configure">
            ${t('btn_configure')}
          </button>
        </div>
      `;
      overlay.style.display = 'flex';

      document.getElementById('btn-welcome-configure').addEventListener('click', () => {
        this._openConfigDialog();
      });
    }
  }

  /**
   * Show prompt to configure fields (when Rows or Values shelves are empty).
   * @private
   */
  _showConfigPrompt(customMsg) {
    const overlay = document.getElementById('overlay');
    if (overlay) {
      const defaultText = t('config_prompt_default');
      overlay.innerHTML = `
        <div class="welcome-screen">
          <div class="welcome-icon">🧮</div>
          <div class="welcome-title">${t('welcome_title')}</div>
          <div class="welcome-subtitle">
            ${customMsg || defaultText}
          </div>
          <button class="welcome-btn" id="btn-prompt-refresh">
            ${t('btn_refresh_overlay')}
          </button>
        </div>
      `;
      overlay.style.display = 'flex';

      // Hide matrix wrapper while prompt is active
      const wrapEl = document.getElementById('matrix-wrapper');
      if (wrapEl) wrapEl.style.display = 'none';

      document.getElementById('btn-prompt-refresh').addEventListener('click', () => {
        this._isLoading = false;
        this._refresh();
      });
    }
  }

  /**
   * Show empty state.
   * @private
   */
  _showEmpty(message) {
    const overlay = document.getElementById('overlay');
    if (overlay) {
      overlay.innerHTML = `
        <div class="welcome-screen">
          <div class="welcome-icon">📭</div>
          <div class="welcome-title">${t('no_data_title')}</div>
          <div class="welcome-subtitle">${message}</div>
          <button class="welcome-btn" id="btn-empty-refresh">
            ${t('btn_refresh_overlay')}
          </button>
        </div>
      `;
      overlay.style.display = 'flex';

      document.getElementById('btn-empty-refresh').addEventListener('click', () => {
        this._refresh();
      });
    }
  }

  /**
   * Show error state.
   * @private
   */
  _showError(err) {
    const message = err instanceof Error
      ? err.message
      : String(err);

    const overlay = document.getElementById('overlay');
    if (!overlay) return;

    overlay.innerHTML = `
      <div class="error-screen">
        <div class="error-icon">⚠️</div>
        <div class="error-title"></div>
        <div class="error-message"></div>
        <button class="welcome-btn" id="btn-error-retry"></button>
      </div>
    `;

    overlay.querySelector('.error-title').textContent =
      t('error_title');

    overlay.querySelector('.error-message').textContent =
      message;

    const retryButton = overlay.querySelector('#btn-error-retry');
    retryButton.textContent = t('btn_retry');

    retryButton.addEventListener('click', () => {
      this.init();
    });

    overlay.style.display = 'flex';
  }

  /**
   * Hide all overlay screens.
   * @private
   */
  _hideOverlays() {
    const overlay = document.getElementById('overlay');
    if (overlay) overlay.style.display = 'none';
  }

  /**
   * Update the status bar.
   * @private
   */
  _updateStatusBar(filterStatus) {
    const statusBarEl = document.getElementById('status-bar') || document.querySelector('.status-bar');
    if (statusBarEl) {
      statusBarEl.style.display = (this.config && this.config.showStatusBar === false) ? 'none' : 'flex';
    }

    if (!this.renderer || !this._matrixData) return;

    const stats = this.renderer.getStats();
    const rowCountEl = document.getElementById('status-rows');
    const colCountEl = document.getElementById('status-columns');
    const levelsEl = document.getElementById('status-levels');
    const worksheetEl = document.getElementById('status-worksheet');
    const filterEl = document.getElementById('status-filter');
    const refreshEl = document.getElementById('status-refresh');

    if (rowCountEl) rowCountEl.textContent = stats.rows;
    if (colCountEl) colCountEl.textContent = stats.columns;
    if (levelsEl) levelsEl.textContent = stats.levels;
    const rowStr = (this.config.rowFields || []).join(', ') || 'None';
    const colStr = (this.config.colFields || []).join(', ') || 'None';
    if (worksheetEl) worksheetEl.textContent = `${this.config.worksheetName} | ${t('status_rows_label')} [${rowStr}] | ${t('status_cols_label')} [${colStr}]`;
    if (filterEl) filterEl.textContent = filterStatus || 'None';
    if (refreshEl) refreshEl.textContent = new Date().toLocaleTimeString();
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Bootstrap
// ──────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const app = new MatrixApp();
  app.init();
});
