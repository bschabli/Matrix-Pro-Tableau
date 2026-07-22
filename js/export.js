/**
 * ============================================================================
 * ExportManager — Excel (.xlsx) and CSV Export for the Matrix
 * ============================================================================
 *
 * Uses SheetJS (xlsx) for Excel export. Exports the matrix hierarchy with
 * proper indentation, subtotals, and formatting.
 *
 * USAGE:
 *   const exporter = new ExportManager();
 *   exporter.exportToExcel(matrixData, 'Matrix_Export');
 *   exporter.exportToCSV(matrixData, 'Matrix_Export');
 */

class ExportManager {

  constructor() {
    this._numberFormatter = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Excel Export
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Export matrix data to an Excel (.xlsx) file and trigger download.
   * @param {MatrixData} matrixData - Output from PivotEngine
   * @param {string} [filename='Matrix_Export'] - Filename without extension
   */
  exportToExcel(matrixData, filename = 'Matrix_Export') {
    if (typeof XLSX === 'undefined') {
      console.error('[ExportManager] SheetJS (XLSX) library not loaded.');
      alert('Export library not available. Please check your internet connection.');
      return;
    }

    try {
      const { rows2D, merges } = this._buildExcelData(matrixData);

      // Create workbook and worksheet
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(rows2D);

      // Apply merges for multi-level column headers
      if (merges.length > 0) {
        ws['!merges'] = merges;
      }

      // Set column widths
      const colWidths = this._computeColumnWidths(rows2D);
      ws['!cols'] = colWidths;

      XLSX.utils.book_append_sheet(wb, ws, 'Matrix');

      // Trigger download
      XLSX.writeFile(wb, `${filename}.xlsx`);
      console.log('[ExportManager] Excel file exported:', filename);
    } catch (err) {
      console.error('[ExportManager] Excel export failed:', err);
      alert('Export failed: ' + err.message);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CSV Export
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Export matrix data to a CSV file and trigger download.
   * @param {MatrixData} matrixData
   * @param {string} [filename='Matrix_Export']
   */
  exportToCSV(matrixData, filename = 'Matrix_Export') {
    try {
      const { rows2D } = this._buildExcelData(matrixData);

      // Convert to CSV string
      const csvContent = rows2D.map(row =>
        row.map(cell => {
          const val = cell != null ? String(cell) : '';
          // Escape cells containing commas, quotes, or newlines
          if (val.includes(',') || val.includes('"') || val.includes('\n')) {
            return '"' + val.replace(/"/g, '""') + '"';
          }
          return val;
        }).join(',')
      ).join('\r\n');

      // Trigger download
      const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
      this._downloadBlob(blob, `${filename}.csv`);
      console.log('[ExportManager] CSV file exported:', filename);
    } catch (err) {
      console.error('[ExportManager] CSV export failed:', err);
      alert('Export failed: ' + err.message);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Build 2D Array for Export
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Build a 2D array (rows × columns) for the entire matrix, including:
   * - Multi-level column headers
   * - Hierarchical row data with indentation markers
   * - Subtotal rows
   * - Grand total row
   *
   * Also computes cell merges for Excel.
   *
   * @private
   * @returns {{ rows2D: any[][], merges: Object[] }}
   */
  _buildExcelData(matrixData) {
    const rows2D = [];
    const merges = [];
    const { flatColumns, headerRows, rowTree, grandTotals, config } = matrixData;

    // ── 1. Column Header Rows ──
    let currentRow = 0;
    headerRows.forEach((headerRow, rowIndex) => {
      const row = [];

      // First cell: Row header spacer (only for the first row, merged down)
      if (rowIndex === 0) {
        row.push(config.rowFields.join(' / ') || 'Rows');
        if (headerRows.length > 1) {
          merges.push({
            s: { r: 0, c: 0 },
            e: { r: headerRows.length - 1, c: 0 }
          });
        }
      } else {
        row.push(''); // covered by merge
      }

      // Column header cells
      let colOffset = 1; // column 0 is the row-header
      headerRow.forEach(cell => {
        row.push(cell.label);

        // Fill merged cells with empty values
        for (let i = 1; i < cell.colspan; i++) {
          row.push('');
        }

        // Track merges
        if (cell.colspan > 1 || cell.rowspan > 1) {
          merges.push({
            s: { r: currentRow, c: colOffset },
            e: {
              r: currentRow + (cell.rowspan || 1) - 1,
              c: colOffset + (cell.colspan || 1) - 1
            }
          });
        }

        colOffset += cell.colspan || 1;
      });

      rows2D.push(row);
      currentRow++;
    });

    // ── 2. Data Rows (recursive) ──
    this._buildDataRows(rowTree, flatColumns, rows2D, 0);

    // ── 3. Grand Total Row ──
    const grandRow = ['Grand Total'];
    flatColumns.forEach(col => {
      const valuesMap = grandTotals[col.valueKey];
      const value = valuesMap ? valuesMap[col.measure.field] : null;
      grandRow.push(value != null && isFinite(value) ? Math.round(value * 100) / 100 : '');
    });
    rows2D.push(grandRow);

    return { rows2D, merges };
  }

  /**
   * Recursively build data rows for the 2D array.
   * @private
   */
  _buildDataRows(nodes, flatColumns, rows2D, level) {
    nodes.forEach(node => {
      const hasChildren = node.children && node.children.length > 0;

      // Main data row
      const row = [];

      // Row label with indentation (spaces for hierarchy)
      const indent = '  '.repeat(level);
      row.push(indent + node.label);

      // Value cells
      flatColumns.forEach(col => {
        const valuesMap = node.values[col.valueKey];
        const value = valuesMap ? valuesMap[col.measure.field] : null;
        row.push(value != null && isFinite(value) ? Math.round(value * 100) / 100 : '');
      });

      rows2D.push(row);

      // Recurse into children
      if (hasChildren) {
        this._buildDataRows(node.children, flatColumns, rows2D, level + 1);

        // Subtotal row
        const subtotalRow = [];
        subtotalRow.push(indent + node.label + ' Total');
        flatColumns.forEach(col => {
          const valuesMap = node.values[col.valueKey];
          const value = valuesMap ? valuesMap[col.measure.field] : null;
          subtotalRow.push(value != null && isFinite(value) ? Math.round(value * 100) / 100 : '');
        });
        rows2D.push(subtotalRow);
      }
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Utilities
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Compute column widths for Excel based on content.
   * @private
   */
  _computeColumnWidths(rows2D) {
    if (rows2D.length === 0) return [];

    const maxCols = Math.max(...rows2D.map(r => r.length));
    const widths = [];

    for (let c = 0; c < maxCols; c++) {
      let maxLen = 8; // minimum width
      rows2D.forEach(row => {
        const cell = row[c];
        if (cell != null) {
          const len = String(cell).length;
          if (len > maxLen) maxLen = len;
        }
      });
      widths.push({ wch: Math.min(maxLen + 2, 40) });
    }

    return widths;
  }

  /**
   * Trigger a file download from a Blob.
   * @private
   */
  _downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

// Expose globally
window.ExportManager = ExportManager;
