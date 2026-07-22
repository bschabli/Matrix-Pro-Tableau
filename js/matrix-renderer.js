/**
 * ============================================================================
 * MatrixRenderer — DOM Rendering for the Hierarchical Matrix
 * ============================================================================
 *
 * Renders MatrixData (from PivotEngine) as an interactive HTML <table> with:
 *   - Multi-level column headers with colspan/rowspan
 *   - Hierarchical row headers with indent and expand/collapse
 *   - Subtotal rows per group level
 *   - Grand total row (tfoot)
 *   - Conditional formatting (color scales, data bars)
 *   - Click handlers for cross-filtering
 *
 * USAGE:
 *   const renderer = new MatrixRenderer(containerElement, {
 *     onCellClick: (cellInfo) => { ... },
 *     onExpandToggle: (nodePath, expanded) => { ... },
 *     showSubtotals: true,
 *     showGrandTotal: true,
 *     conditionalFormatting: true,
 *     numberFormat: { minimumFractionDigits: 0, maximumFractionDigits: 2 }
 *   });
 *   renderer.render(matrixData);
 */

class MatrixRenderer {

  /**
   * @param {HTMLElement} container - DOM element to render the table into
   * @param {Object} options
   */
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      indentSize: 18,           // px per level of indent
      showSubtotals: true,       // show subtotal rows after each group
      showGrandTotal: true,      // show grand total row in tfoot
      conditionalFormatting: false, // disable color-scale formatting by default
      numberFormat: {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      },
      onCellClick: null,         // callback: (cellInfo) => void
      onExpandToggle: null,      // callback: (nodePath, expanded) => void
      ...options
    };

    this._matrixData = null;
    this._expandedPaths = new Set(); // tracks which tree paths are expanded
    this._selectedCell = null;       // currently selected cell for highlighting
    this._numberFormatter = new Intl.NumberFormat('en-US', this.options.numberFormat);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Render the full matrix table from MatrixData.
   * @param {MatrixData} matrixData - Output from PivotEngine.process()
   */
  render(matrixData) {
    this._matrixData = matrixData;

    // Initialize expanded state from the tree data
    this._initExpandedState(matrixData.rowTree, '');

    // Clear container
    this.container.innerHTML = '';

    if (!matrixData.flatColumns || matrixData.flatColumns.length === 0) {
      this._renderEmpty();
      return;
    }

    // Build the table
    const table = document.createElement('table');
    table.className = 'matrix-table';
    table.setAttribute('role', 'treegrid');

    if (this.options.density) {
      table.classList.add(`density-${this.options.density}`);
    }
    if (this.options.fontSize) {
      table.style.fontSize = this.options.fontSize;
    }
    if (this.options.showZebra === false) {
      table.classList.add('no-zebra');
    }
    if (this.options.showHGrid === false) {
      table.classList.add('no-hgrid');
    }
    if (this.options.showVGrid === false) {
      table.classList.add('no-vgrid');
    }

    // 1. Header
    table.appendChild(this._buildThead(matrixData));

    // 2. Body
    table.appendChild(this._buildTbody(matrixData));

    // 3. Footer (grand total)
    if (this.options.showGrandTotal) {
      table.appendChild(this._buildTfoot(matrixData));
    }

    this.container.appendChild(table);
  }

  /**
   * Expand all nodes in the tree.
   */
  expandAll() {
    if (!this._matrixData) return;
    this._setAllExpanded(this._matrixData.rowTree, '', true);
    this._refreshBody();
  }

  /**
   * Collapse all nodes in the tree.
   */
  collapseAll() {
    if (!this._matrixData) return;
    this._setAllExpanded(this._matrixData.rowTree, '', false);
    this._refreshBody();
  }

  /**
   * Get statistics about the rendered matrix.
   */
  getStats() {
    if (!this._matrixData) return { rows: 0, columns: 0, levels: 0 };
    return {
      rows: this._countNodes(this._matrixData.rowTree),
      columns: this._matrixData.flatColumns.length,
      levels: this._matrixData.config.rowFields.length
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Header (thead)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Build the <thead> element with multi-level column headers.
   * @private
   */
  _buildThead(data) {
    const thead = document.createElement('thead');
    const headerRows = data.headerRows;
    const numHeaderRows = headerRows.length;

    headerRows.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');

      // Add row-header spacer cell on the first header row only
      if (rowIndex === 0) {
        const spacerTh = document.createElement('th');
        spacerTh.className = 'row-header-spacer';
        spacerTh.rowSpan = numHeaderRows;

        const container = document.createElement('div');
        container.className = 'spacer-content';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'spacer-label';
        labelSpan.textContent = data.config.rowFields.join(' / ') || 'Rows';
        container.appendChild(labelSpan);

        const btnGroup = document.createElement('div');
        btnGroup.className = 'corner-controls';

        const expBtn = document.createElement('button');
        expBtn.className = 'corner-btn';
        expBtn.title = t('btn_expand_all');
        expBtn.innerHTML = '⊞';
        expBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.expandAll();
        });

        const colBtn = document.createElement('button');
        colBtn.className = 'corner-btn';
        colBtn.title = t('btn_collapse_all');
        colBtn.innerHTML = '⊟';
        colBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.collapseAll();
        });

        btnGroup.appendChild(expBtn);
        btnGroup.appendChild(colBtn);
        container.appendChild(btnGroup);

        spacerTh.appendChild(container);
        tr.appendChild(spacerTh);
      }

      // Add column header cells
      row.forEach(cell => {
        const th = document.createElement('th');
        th.textContent = cell.label;
        if (cell.colspan > 1) th.colSpan = cell.colspan;
        if (cell.rowspan > 1) th.rowSpan = cell.rowspan;

        // CSS classes
        const classes = [];
        if (cell.isTotal) classes.push('col-total-header');
        if (cell.isMeasure) classes.push('col-value');
        th.className = classes.join(' ');

        tr.appendChild(th);
      });

      thead.appendChild(tr);
    });

    return thead;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Body (tbody)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Build the <tbody> element with hierarchical rows.
   * @private
   */
  _buildTbody(data) {
    const tbody = document.createElement('tbody');
    this._renderNodes(data.rowTree, '', tbody, data.flatColumns, data);
    return tbody;
  }

  /**
   * Recursively render row nodes into the tbody.
   * @private
   * @param {RowNode[]} nodes
   * @param {string} parentPath - dot-separated index path (e.g. "0.2.1")
   * @param {HTMLElement} tbody
   * @param {FlatColumn[]} flatColumns
   * @param {MatrixData} data
   */
  _renderNodes(nodes, parentPath, tbody, flatColumns, data) {
    nodes.forEach((node, index) => {
      const path = parentPath ? `${parentPath}.${index}` : `${index}`;
      const hasChildren = node.children && node.children.length > 0;
      const isExpanded = this._expandedPaths.has(path);
      const isLeaf = !hasChildren;
      const isParentVisible = this._isPathVisible(parentPath);

      // ── Main data row ──
      const tr = document.createElement('tr');
      tr.dataset.path = path;
      tr.dataset.level = node.level;
      tr.setAttribute('role', 'row');
      tr.setAttribute('aria-level', node.level + 1);

      if (hasChildren) {
        tr.setAttribute('aria-expanded', isExpanded);
      }

      // Visibility based on ancestor expansion
      if (!isParentVisible) {
        tr.classList.add('row-hidden');
      }

      // --- Row header cell ---
      const tdHeader = document.createElement('td');
      tdHeader.className = 'row-header';

      const headerContent = document.createElement('div');
      headerContent.className = 'row-header-content';

      // Indent
      const indent = document.createElement('span');
      indent.className = 'row-header-indent';
      indent.style.width = `${node.level * this.options.indentSize}px`;
      headerContent.appendChild(indent);

      // Expand/collapse button or placeholder
      if (hasChildren) {
        const btn = document.createElement('button');
        btn.className = `expand-btn ${isExpanded ? 'expanded' : 'collapsed'}`;
        btn.setAttribute('aria-label', isExpanded ? 'Collapse' : 'Expand');
        btn.dataset.path = path;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._toggleNode(path);
        });
        headerContent.appendChild(btn);
      } else {
        const placeholder = document.createElement('span');
        placeholder.className = 'expand-btn-placeholder';
        headerContent.appendChild(placeholder);
      }

      // Label
      const label = document.createElement('span');
      label.className = 'row-label';
      label.textContent = node.label;
      headerContent.appendChild(label);

      tdHeader.appendChild(headerContent);
      tr.appendChild(tdHeader);

      // --- Value cells ---
      flatColumns.forEach(col => {
        const td = this._createValueCell(node, col, data, path);
        tr.appendChild(td);
      });

      tbody.appendChild(tr);

      // ── Recurse into children (render even if hidden, toggle via CSS) ──
      if (hasChildren) {
        this._renderNodes(node.children, path, tbody, flatColumns, data);

        // ── Subtotal row (after children) ──
        if (this.options.showSubtotals && !isLeaf) {
          const subtotalTr = this._createSubtotalRow(node, path, flatColumns, data);
          if (!isParentVisible || !isExpanded) {
            subtotalTr.classList.add('row-hidden');
          }
          tbody.appendChild(subtotalTr);
        }
      }
    });
  }

  /**
   * Create a value cell <td> for a given node and column.
   * @private
   */
  _createValueCell(node, col, data, path) {
    const td = document.createElement('td');
    td.className = 'value-cell';

    // Look up the value
    const valueKey = col.valueKey;
    const measureField = col.measure.field;
    const valuesMap = node.values[valueKey];
    const value = valuesMap ? valuesMap[measureField] : null;

    if (value != null && isFinite(value)) {
      td.textContent = this._formatNumber(value);
      td.dataset.value = value;

      // Conditional formatting
      if (this.options.conditionalFormatting && data.valueRanges) {
        this._applyConditionalFormat(td, value, measureField, data.valueRanges);
      }
    } else {
      td.textContent = '–';
      td.classList.add('value-null');
    }

    // Total column styling
    if (col.isTotal) {
      td.classList.add('col-total');
    }

    // Click handler for cross-filtering
    td.addEventListener('click', () => {
      this._handleCellClick(node, col, value, path);
    });

    return td;
  }

  /**
   * Create a subtotal row for a parent node.
   * @private
   */
  _createSubtotalRow(node, parentPath, flatColumns, data) {
    const tr = document.createElement('tr');
    tr.className = `subtotal-row subtotal-level-${node.level}`;
    tr.dataset.subtotalFor = parentPath;

    // Row header
    const tdHeader = document.createElement('td');
    tdHeader.className = 'row-header';

    const headerContent = document.createElement('div');
    headerContent.className = 'row-header-content';

    const indent = document.createElement('span');
    indent.className = 'row-header-indent';
    indent.style.width = `${node.level * this.options.indentSize}px`;
    headerContent.appendChild(indent);

    const placeholder = document.createElement('span');
    placeholder.className = 'expand-btn-placeholder';
    headerContent.appendChild(placeholder);

    const label = document.createElement('span');
    label.className = 'row-label';
    label.textContent = `${node.label} Total`;
    headerContent.appendChild(label);

    tdHeader.appendChild(headerContent);
    tr.appendChild(tdHeader);

    // Value cells (same values as the node — they ARE the subtotals)
    flatColumns.forEach(col => {
      const td = document.createElement('td');
      td.className = 'value-cell';
      if (col.isTotal) td.classList.add('col-total');

      const valueKey = col.valueKey;
      const measureField = col.measure.field;
      const valuesMap = node.values[valueKey];
      const value = valuesMap ? valuesMap[measureField] : null;

      if (value != null && isFinite(value)) {
        td.textContent = this._formatNumber(value);
        td.dataset.value = value;
      } else {
        td.textContent = '–';
        td.classList.add('value-null');
      }

      tr.appendChild(td);
    });

    return tr;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Footer (tfoot — Grand Total)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Build the <tfoot> with the grand total row.
   * @private
   */
  _buildTfoot(data) {
    const tfoot = document.createElement('tfoot');
    const tr = document.createElement('tr');

    // Row header
    const tdHeader = document.createElement('td');
    tdHeader.className = 'row-header';
    tdHeader.textContent = 'Grand Total';
    tr.appendChild(tdHeader);

    // Value cells from grandTotals
    data.flatColumns.forEach(col => {
      const td = document.createElement('td');
      td.className = 'value-cell';
      if (col.isTotal) td.classList.add('col-total');

      const valueKey = col.valueKey;
      const measureField = col.measure.field;
      const valuesMap = data.grandTotals[valueKey];
      const value = valuesMap ? valuesMap[measureField] : null;

      if (value != null && isFinite(value)) {
        td.textContent = this._formatNumber(value);
      } else {
        td.textContent = '–';
        td.classList.add('value-null');
      }

      tr.appendChild(td);
    });

    tfoot.appendChild(tr);
    return tfoot;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Expand / Collapse Logic
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Toggle a node's expanded/collapsed state and update the DOM.
   * @private
   */
  _toggleNode(path) {
    const isExpanded = this._expandedPaths.has(path);

    if (isExpanded) {
      this._expandedPaths.delete(path);
    } else {
      this._expandedPaths.add(path);
    }

    // Update the expand button
    const btn = this.container.querySelector(`.expand-btn[data-path="${path}"]`);
    if (btn) {
      btn.classList.toggle('expanded', !isExpanded);
      btn.classList.toggle('collapsed', isExpanded);
      btn.setAttribute('aria-label', !isExpanded ? 'Collapse' : 'Expand');
    }

    // Update the aria-expanded on the row
    const row = this.container.querySelector(`tr[data-path="${path}"]`);
    if (row) {
      row.setAttribute('aria-expanded', !isExpanded);
    }

    // Update visibility of descendant rows
    this._updateChildVisibility(path);

    // Callback
    if (this.options.onExpandToggle) {
      this.options.onExpandToggle(path, !isExpanded);
    }
  }

  /**
   * Update the visibility of all rows that are children of the given path.
   * A row is visible if ALL its ancestors are expanded.
   * @private
   */
  _updateChildVisibility(path) {
    // Find all rows whose path starts with this path + "."
    const allRows = this.container.querySelectorAll('tr[data-path], tr[data-subtotal-for]');

    allRows.forEach(tr => {
      const rowPath = tr.dataset.path || tr.dataset.subtotalFor;
      if (!rowPath || !rowPath.startsWith(path + '.')) return;

      // Check if this row's actual path should be visible
      // by checking all ancestor paths
      if (tr.dataset.subtotalFor) {
        // Subtotal rows are visible when their parent is expanded AND visible
        const parentPath = tr.dataset.subtotalFor;
        const isParentExpanded = this._expandedPaths.has(parentPath);
        const isParentVisible = this._isPathVisible(this._getParentPath(parentPath));
        if (isParentExpanded && isParentVisible) {
          tr.classList.remove('row-hidden');
          tr.classList.add('row-entering');
          setTimeout(() => tr.classList.remove('row-entering'), 200);
        } else {
          tr.classList.add('row-hidden');
          tr.classList.remove('row-entering');
        }
      } else {
        // Data rows
        const parentOfRow = this._getParentPath(rowPath);
        if (this._isPathVisible(parentOfRow) && this._expandedPaths.has(parentOfRow)) {
          tr.classList.remove('row-hidden');
          tr.classList.add('row-entering');
          setTimeout(() => tr.classList.remove('row-entering'), 200);
        } else {
          tr.classList.add('row-hidden');
          tr.classList.remove('row-entering');
        }
      }
    });
  }

  /**
   * Initialize the expanded state from the row tree's default expanded flags.
   * @private
   */
  _initExpandedState(nodes, parentPath) {
    this._expandedPaths.clear();
    this._collectExpandedPaths(nodes, parentPath);
  }

  _collectExpandedPaths(nodes, parentPath) {
    nodes.forEach((node, index) => {
      const path = parentPath ? `${parentPath}.${index}` : `${index}`;
      if (node.expanded && node.children && node.children.length > 0) {
        this._expandedPaths.add(path);
      }
      if (node.children) {
        this._collectExpandedPaths(node.children, path);
      }
    });
  }

  /**
   * Set all nodes to expanded or collapsed.
   * @private
   */
  _setAllExpanded(nodes, parentPath, expanded) {
    nodes.forEach((node, index) => {
      const path = parentPath ? `${parentPath}.${index}` : `${index}`;
      if (node.children && node.children.length > 0) {
        if (expanded) {
          this._expandedPaths.add(path);
        } else {
          this._expandedPaths.delete(path);
        }
        this._setAllExpanded(node.children, path, expanded);
      }
    });
  }

  /**
   * Re-render the tbody by toggling visibility based on expandedPaths.
   * @private
   */
  _refreshBody() {
    const allRows = this.container.querySelectorAll('tbody tr');
    allRows.forEach(tr => {
      const path = tr.dataset.path;
      const subtotalFor = tr.dataset.subtotalFor;

      if (path) {
        const parentPath = this._getParentPath(path);
        if (!parentPath) {
          // Top-level rows are always visible
          tr.classList.remove('row-hidden');
        } else {
          const visible = this._isPathVisible(parentPath) && this._expandedPaths.has(parentPath);
          tr.classList.toggle('row-hidden', !visible);
        }

        // Update expand buttons
        const btn = tr.querySelector('.expand-btn');
        if (btn) {
          const isExp = this._expandedPaths.has(path);
          btn.classList.toggle('expanded', isExp);
          btn.classList.toggle('collapsed', !isExp);
        }
      } else if (subtotalFor) {
        const isExp = this._expandedPaths.has(subtotalFor);
        const parentOfSubtotal = this._getParentPath(subtotalFor);
        const parentVis = !parentOfSubtotal || (this._isPathVisible(parentOfSubtotal) && this._expandedPaths.has(parentOfSubtotal));
        tr.classList.toggle('row-hidden', !(isExp && parentVis));
      }
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Conditional Formatting
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Helper: Parse hex color string '#rrggbb' to {r, g, b} object.
   * @private
   */
  _hexToRgb(hex) {
    if (!hex || typeof hex !== 'string') return { r: 248, g: 226, b: 226 };
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    if (isNaN(num)) return { r: 248, g: 226, b: 226 };
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  }

  /**
   * Apply conditional formatting (Gradient scale or Logical value rules).
   * @private
   */
  _applyConditionalFormat(td, value, measureField, valueRanges) {
    if (!this.options.conditionalFormatting || typeof value !== 'number' || isNaN(value)) return;

    const cfMode = this.options.cfMode || 'gradient';

    if (cfMode === 'rules') {
      // ⚙️ Logical Rules Mode
      const val1 = typeof this.options.ruleVal1 === 'number' ? this.options.ruleVal1 : 50000;
      const val2 = typeof this.options.ruleVal2 === 'number' ? this.options.ruleVal2 : 200000;

      let bg = '#ffffff';
      let text = 'inherit';

      if (value < val1) {
        bg = this.options.ruleBg1 || '#fee2e2';
        text = this.options.ruleText1 || '#991b1b';
      } else if (value >= val1 && value < val2) {
        bg = this.options.ruleBg2 || '#fef3c7';
        text = this.options.ruleText2 || '#92400e';
      } else {
        bg = this.options.ruleBg3 || '#dcfce7';
        text = this.options.ruleText3 || '#166534';
      }

      td.style.backgroundColor = bg;
      td.style.color = text;
      td.classList.add('cf-cell');
      return;
    }

    // 🎨 Gradient Scale Mode
    const range = valueRanges[measureField];
    if (!range || range.max === range.min) return;

    const ratio = Math.max(0, Math.min(1, (value - range.min) / (range.max - range.min)));
    const minRgb = this._hexToRgb(this.options.cfMinColor || '#fee2e2');
    const maxRgb = this._hexToRgb(this.options.cfMaxColor || '#dcfce7');

    const r = Math.round(minRgb.r + (maxRgb.r - minRgb.r) * ratio);
    const g = Math.round(minRgb.g + (maxRgb.g - minRgb.g) * ratio);
    const b = Math.round(minRgb.b + (maxRgb.b - minRgb.b) * ratio);

    td.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
    td.classList.add('cf-cell');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Cell Click (Cross-Filter)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Handle a click on a value cell.
   * @private
   */
  _handleCellClick(node, col, value, path) {
    // Clear previous selection
    if (this._selectedCell) {
      const prevRow = this.container.querySelector('tr.selected');
      if (prevRow) prevRow.classList.remove('selected');
    }

    // Highlight the clicked row
    const row = this.container.querySelector(`tr[data-path="${path}"]`);
    if (row) row.classList.add('selected');

    this._selectedCell = { node, col, value, path };

    // Call external handler
    if (this.options.onCellClick) {
      this.options.onCellClick({
        rowField: node.field,
        rowValue: node.label,
        rowLevel: node.level,
        colKey: col.valueKey,
        measureField: col.measure.field,
        measureLabel: col.measure.label,
        value: value,
        path: path
      });
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Utilities
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Format a number for display.
   * @private
   */
  _formatNumber(value) {
    if (value == null || !isFinite(value)) return '–';
    return this._numberFormatter.format(value);
  }

  /**
   * Get the parent path of a dotted path string.
   * "0.1.2" → "0.1", "0" → "" (empty = root)
   * @private
   */
  _getParentPath(path) {
    const lastDot = path.lastIndexOf('.');
    return lastDot === -1 ? '' : path.substring(0, lastDot);
  }

  /**
   * Check if a path is visible (all ancestors are expanded).
   * @private
   */
  _isPathVisible(path) {
    if (!path) return true; // root is always visible
    const parentPath = this._getParentPath(path);
    return this._expandedPaths.has(path) !== undefined &&
           this._isAncestorsExpanded(path);
  }

  /**
   * Check that every ancestor of a path is expanded.
   * @private
   */
  _isAncestorsExpanded(path) {
    if (!path) return true;
    const parts = path.split('.');
    let current = '';
    for (let i = 0; i < parts.length; i++) {
      current = i === 0 ? parts[0] : current + '.' + parts[i];
      if (i < parts.length - 1) {
        // Check that this intermediate path is expanded
        // The path up to but not including the last part must be expanded
      }
    }
    // Simpler approach: check each parent level
    const parentPath = this._getParentPath(path);
    if (!parentPath) return true; // top-level, always visible
    return this._expandedPaths.has(parentPath) && this._isAncestorsExpanded(parentPath);
  }

  /**
   * Count total nodes in the tree.
   * @private
   */
  _countNodes(nodes) {
    let count = 0;
    nodes.forEach(n => {
      count++;
      if (n.children) count += this._countNodes(n.children);
    });
    return count;
  }

  /**
   * Render an empty state message.
   * @private
   */
  _renderEmpty() {
    this.container.innerHTML = `
      <div class="loading-overlay">
        <div style="font-size: 48px; opacity: 0.3;">📊</div>
        <div class="loading-text">No data to display. Check your configuration.</div>
      </div>
    `;
  }
}

// Expose globally
window.MatrixRenderer = MatrixRenderer;
