/**
 * ============================================================================
 * PivotEngine — Flat Data → Hierarchical Matrix Transformation
 * ============================================================================
 *
 * Transforms a flat array of row-objects (from Tableau) into a hierarchical
 * matrix data structure suitable for rendering as a Power BI-style Matrix.
 *
 * USAGE:
 *   const engine = new PivotEngine({
 *     rowFields:   ['Region', 'Country', 'City'],
 *     colFields:   ['Year', 'Quarter'],
 *     valueFields: [
 *       { field: 'Sales',  aggFunc: 'sum', label: 'Sales' },
 *       { field: 'Profit', aggFunc: 'avg', label: 'Avg Profit' }
 *     ]
 *   });
 *   const matrixData = engine.process(flatDataArray);
 *
 * OUTPUT (MatrixData):
 *   {
 *     columnHeaders: ColumnNode[],   // tree for multi-level column headers
 *     flatColumns:   FlatColumn[],   // leaf columns for rendering & lookup
 *     headerRows:    HeaderCell[][],  // pre-computed header <th> grid
 *     rowTree:       RowNode[],      // hierarchical row data
 *     grandTotals:   ValuesMap,      // grand total values
 *     config:        { rowFields, colFields, valueFields }
 *   }
 */

class PivotEngine {

  /**
   * @param {Object} config
   * @param {string[]} config.rowFields   - Dimension fields for row hierarchy
   * @param {string[]} config.colFields   - Dimension fields for column pivoting
   * @param {Array<{field: string, aggFunc: string, label?: string}>} config.valueFields
   */
  constructor(config = {}) {
    this.rowFields = config.rowFields || [];
    this.colFields = config.colFields || [];
    this.showRowTotal = config.showRowTotal !== false;
    this.valueFields = (config.valueFields || []).map(v => ({
      field: v.field,
      aggFunc: v.aggFunc || 'sum',
      label: v.label || v.field
    }));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Process flat data into a complete MatrixData structure.
   * @param {Object[]} flatData - Array of row objects, e.g. [{Region:'West', Sales:100}, ...]
   * @returns {MatrixData}
   */
  process(flatData) {
    if (!flatData || flatData.length === 0) {
      return this._emptyResult();
    }

    // 1. Build column structure
    const { columnHeaders, flatColumns, colCombinations } = this._buildColumns(flatData);

    // 2. Build pre-computed header rows for the renderer
    const headerRows = this._buildHeaderRows(flatColumns);

    // 3. Build hierarchical row tree with aggregated values
    const rowTree = this._buildRowTree(flatData, 0, colCombinations);

    // 4. Compute grand totals
    const grandTotals = this._computeValues(flatData, colCombinations);

    // 5. Compute value ranges for conditional formatting
    const valueRanges = this._computeValueRanges(rowTree, flatColumns);

    return {
      columnHeaders,
      flatColumns,
      headerRows,
      rowTree,
      grandTotals,
      valueRanges,
      config: {
        rowFields: this.rowFields,
        colFields: this.colFields,
        valueFields: this.valueFields
      }
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Column Structure
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Build column headers tree and flat column list.
   * @private
   */
  _buildColumns(data) {
    // Case 1: No column pivoting — columns are just the measures
    if (this.colFields.length === 0) {
      const flatColumns = this.valueFields.map(v => ({
        key: v.field,
        valueKey: 'ALL',
        colCombo: null,
        measure: v,
        label: v.label,
        isTotal: false
      }));

      return {
        columnHeaders: [],
        flatColumns,
        colCombinations: []
      };
    }

    // Case 2: Column pivoting active
    // Extract unique column-dimension combinations from the data
    const comboSet = new Set();
    data.forEach(row => {
      const combo = this.colFields.map(f => {
        const val = row[f];
        return val != null ? String(val) : '(Blank)';
      });
      comboSet.add(JSON.stringify(combo));
    });

    const colCombinations = Array.from(comboSet)
      .map(s => JSON.parse(s))
      .sort((a, b) => {
        // Sort column combinations lexicographically
        for (let i = 0; i < a.length; i++) {
          const cmp = String(a[i]).localeCompare(String(b[i]));
          if (cmp !== 0) return cmp;
        }
        return 0;
      });

    // Build column header tree (for multi-level rendering)
    const columnHeaders = this._buildColumnTree(colCombinations, 0);

    // Build flat column list: each combo × each measure, plus totals
    const flatColumns = [];

    colCombinations.forEach(combo => {
      this.valueFields.forEach(v => {
        flatColumns.push({
          key: combo.join('|') + '||' + v.field,
          valueKey: combo.join('|'),
          colCombo: combo,
          measure: v,
          label: v.label,
          isTotal: false
        });
      });
    });

    // Append total columns (one per measure) if showRowTotal is active
    if (this.showRowTotal !== false) {
      this.valueFields.forEach(v => {
        flatColumns.push({
          key: 'TOTAL||' + v.field,
          valueKey: 'TOTAL',
          colCombo: null,
          measure: v,
          label: v.label,
          isTotal: true
        });
      });
    }

    return { columnHeaders, flatColumns, colCombinations };
  }

  /**
   * Recursively build a tree of column headers from combinations.
   * @private
   */
  _buildColumnTree(combinations, level) {
    if (level >= this.colFields.length) return [];

    // Group combinations by value at the current level
    const groups = new Map();
    combinations.forEach(combo => {
      const key = combo[level];
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(combo);
    });

    return Array.from(groups.entries()).map(([label, combos]) => ({
      label,
      field: this.colFields[level],
      level,
      children: this._buildColumnTree(combos, level + 1),
      leafCount: combos.length * this.valueFields.length
    }));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Header Rows (pre-computed for renderer)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Pre-compute the header <th> grid: an array of rows,
   * each row is an array of { label, colspan, rowspan, isTotal, isMeasure }.
   * @private
   */
  _buildHeaderRows(flatColumns) {
    // No column pivoting → single header row with measure names
    if (this.colFields.length === 0) {
      return [
        flatColumns.map(c => ({
          label: c.label,
          colspan: 1,
          rowspan: 1,
          isTotal: false,
          isMeasure: true
        }))
      ];
    }

    const numColLevels = this.colFields.length;
    const headerRows = [];
    const numMeasures = this.valueFields.length;

    // For each column-field level, scan flatColumns and group spans
    for (let level = 0; level < numColLevels; level++) {
      const row = [];
      let i = 0;

      while (i < flatColumns.length) {
        const col = flatColumns[i];

        if (col.isTotal) {
          // Total section header — only add at level 0 with rowspan
          if (level === 0) {
            row.push({
              label: 'Total',
              colspan: numMeasures,
              rowspan: numColLevels,
              isTotal: true,
              isMeasure: false
            });
          }
          // Skip all total columns (they are at the end)
          break;
        }

        // Find span of consecutive non-total columns sharing the same
        // value at this level AND all parent levels
        const parentKey = col.colCombo.slice(0, level + 1).join('|');
        let span = 1;
        while (i + span < flatColumns.length && !flatColumns[i + span].isTotal) {
          const nextKey = flatColumns[i + span].colCombo.slice(0, level + 1).join('|');
          if (nextKey !== parentKey) break;
          span++;
        }

        row.push({
          label: col.colCombo[level],
          colspan: span,
          rowspan: 1,
          isTotal: false,
          isMeasure: false
        });

        i += span;
      }

      headerRows.push(row);
    }

    // Final row: measure labels for every flat column (including totals)
    const measureRow = flatColumns.map(c => ({
      label: c.label,
      colspan: 1,
      rowspan: 1,
      isTotal: c.isTotal,
      isMeasure: true
    }));
    headerRows.push(measureRow);

    return headerRows;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Row Tree
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Recursively group records by row fields and build a tree of RowNodes.
   * Each node has aggregated values for every flat-column key.
   * @private
   */
  _buildRowTree(records, level, colCombinations) {
      if (level >= this.rowFields.length) {
        return [];
      }

      const field = this.rowFields[level];
      const groups = this._groupBy(records, field);

      return Array.from(groups.entries()).map(([label, groupRecords]) => ({
        label,
        field,
        level,
        expanded: level === 0,
        children: this._buildRowTree(
          groupRecords,
          level + 1,
          colCombinations
        ),
        values: this._computeValues(groupRecords, colCombinations),
        recordCount: groupRecords.length,
        tooltipTupleIds: this._getTooltipTupleIds(groupRecords)
      }));
    }

  _getTooltipTupleIds(records) {
      const index = new Map();

      for (const record of records) {
        const key = this.colFields.length
          ? this.colFields.map(field => {
              const value = record[field];
              return value != null ? String(value) : '(Blank)';
            }).join('|')
          : 'ALL';

        const entry = index.get(key);

        if (entry) {
          entry.count++;
        } else {
          index.set(key, {
            tupleId: record.__tupleId,
            count: 1
          });
        }
      }

      const result = {};

      for (const [key, entry] of index) {
        if (entry.count === 1 && Number.isInteger(entry.tupleId)) {
          result[key] = entry.tupleId;
        }
      }

      if (records.length === 1 &&
          Number.isInteger(records[0].__tupleId)) {
        result.TOTAL = records[0].__tupleId;
      }

      return result;
    }

  // ──────────────────────────────────────────────────────────────────────────
  // Aggregation
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Compute aggregated values for a set of records across all column combos
   * and all measures.
   *
   * Returns a ValuesMap:
   *   { 'ALL': {Sales: 1000, Profit: 200}, ... }
   *   or
   *   { '2023|Q1': {Sales: 300}, '2023|Q2': {Sales: 400}, 'TOTAL': {Sales: 700} }
   *
   * @private
   */
  _computeValues(records, colCombinations) {
    const result = {};

    if (this.colFields.length === 0 || colCombinations.length === 0) {
      // No pivoting — aggregate all records under 'ALL'
      result['ALL'] = {};
      this.valueFields.forEach(v => {
        result['ALL'][v.field] = this._aggregate(records, v.field, v.aggFunc);
      });
      return result;
    }

    // Aggregate per column combination
    colCombinations.forEach(combo => {
      const key = combo.join('|');
      const filtered = this._filterByCombo(records, combo);
      result[key] = {};
      this.valueFields.forEach(v => {
        result[key][v.field] = this._aggregate(filtered, v.field, v.aggFunc);
      });
    });

    // Total across all combos
    result['TOTAL'] = {};
    this.valueFields.forEach(v => {
      result['TOTAL'][v.field] = this._aggregate(records, v.field, v.aggFunc);
    });

    return result;
  }

  /**
   * Helper to retrieve a row value by field name, handling bracket notation and key aliases.
   * @private
   */
  _getRowValue(row, fieldName) {
    if (!row || !fieldName) return undefined;
    if (row[fieldName] !== undefined) return row[fieldName];

    const cleanField = String(fieldName).replace(/^\[|\]$/g, '').trim();
    if (row[cleanField] !== undefined) return row[cleanField];

    const keys = Object.keys(row);
    const matchedKey = keys.find(k => {
      const cleanK = k.replace(/^\[|\]$/g, '').trim();
      return cleanK === cleanField || cleanK.endsWith(cleanField) || cleanField.endsWith(cleanK);
    });

    return matchedKey ? row[matchedKey] : undefined;
  }

  /**
   * Aggregate an array of records for a single field using the given function.
   * @private
   * @param {Object[]} records
   * @param {string} field
   * @param {string} aggFunc - 'sum' | 'avg' | 'min' | 'max' | 'count'
   * @returns {number|null}
   */
  _aggregate(records, field, aggFunc) {
    if (!records || records.length === 0) return null;
    if (field === '_count' || aggFunc === 'count') {
      return records.length;
    }

    const values = [];
    for (let i = 0; i < records.length; i++) {
      const val = this._getRowValue(records[i], field);
      const v = parseFloat(val);
      if (!isNaN(v)) values.push(v);
    }

    if (values.length === 0) return null;

    switch (aggFunc) {
      case 'sum':
        return values.reduce((a, b) => a + b, 0);
      case 'avg':
      case 'average':
        return values.reduce((a, b) => a + b, 0) / values.length;
      case 'min':
        return Math.min(...values);
      case 'max':
        return Math.max(...values);
      case 'count':
        return values.length;
      default:
        return values.reduce((a, b) => a + b, 0);
    }
  }

  /**
   * Filter records that match a specific column combination.
   * @private
   */
  _filterByCombo(records, combo) {
    return records.filter(row =>
      combo.every((val, i) => {
        const rowVal = this._getRowValue(row, this.colFields[i]);
        return (rowVal != null ? String(rowVal) : '(Blank)') === val;
      })
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Value Ranges (for conditional formatting)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Compute min/max for each measure across all leaf-level row nodes.
   * Used by the renderer for color-scale conditional formatting.
   * @private
   */
  _computeValueRanges(rowTree, flatColumns) {
    const ranges = {};
    this.valueFields.forEach(v => {
      ranges[v.field] = { min: Infinity, max: -Infinity };
    });

    const collectValues = (nodes) => {
      nodes.forEach(node => {
        // Collect from this node's values
        Object.values(node.values).forEach(measureMap => {
          this.valueFields.forEach(v => {
            const val = measureMap[v.field];
            if (val != null && isFinite(val)) {
              if (val < ranges[v.field].min) ranges[v.field].min = val;
              if (val > ranges[v.field].max) ranges[v.field].max = val;
            }
          });
        });
        // Recurse into children
        if (node.children && node.children.length > 0) {
          collectValues(node.children);
        }
      });
    };

    collectValues(rowTree);

    // Handle edge case: no values found
    this.valueFields.forEach(v => {
      if (!isFinite(ranges[v.field].min)) ranges[v.field].min = 0;
      if (!isFinite(ranges[v.field].max)) ranges[v.field].max = 0;
    });

    return ranges;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Utilities
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Group records by a field, preserving insertion order.
   * @private
   * @returns {Map<string, Object[]>}
   */
  _groupBy(records, field) {
    const groups = new Map();
    records.forEach(row => {
      const val = this._getRowValue(row, field);
      const key = val != null ? String(val) : '(Blank)';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    return groups;
  }

  /**
   * Return an empty MatrixData result.
   * @private
   */
  _emptyResult() {
    return {
      columnHeaders: [],
      flatColumns: [],
      headerRows: [],
      rowTree: [],
      grandTotals: {},
      valueRanges: {},
      config: {
        rowFields: this.rowFields,
        colFields: this.colFields,
        valueFields: this.valueFields
      }
    };
  }
}

// Make available globally (for non-module scripts loaded via <script> tag)
window.PivotEngine = PivotEngine;
