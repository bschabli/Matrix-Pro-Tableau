# Matrix Pro — Hierarchical Matrix Extension for Tableau

Matrix Pro is a professional, high-performance visual extension for Tableau dashboards that brings Power BI-style hierarchical matrices and pivot tables into Tableau. It enables multi-level grouping, drill-down/drill-up navigation (`+` / `-` toggles), customizable subtotals/totals, and advanced conditional formatting.

---

## 🚀 Key Features

* **Multi-Level Grouping & Hierarchy:** Build custom hierarchies on rows and columns with collapsing/expanding nodes.
* **Tableau-Native Filters integration:** Cross-filters other dashboard sheets directly when clicking cells.
* **Premium Design Themes:** Preconfigured themes: Light (Classic), Dark Mode (Midnight), and Modern Blue.
* **Density & Typography Controls:** Compact (4px), Normal (8px), and Spacious (12px) paddings with font size customization.
* **Independent Conditional Formatting Engine [NEW v1.0.1]:**
  * **Per-Field Configuration:** Enable and configure distinct format settings (gradient scale or logical rules) for each value column independently.
  * **Color Scale (Gradient):** Dynamic background gradients interpolated between custom Minimum (Low) and Maximum (High) hex colors.
  * **Logical Rules:** Multi-threshold value rules with custom background and text color presets.
  * **Luminance Auto-Contrast:** Automatically calculates background brightness to switch text colors dynamically between white and dark grey, ensuring text is always legible.
* **No-PBI Rebranding:** Completely independent branding, vector SVG graphics, and neutral styles.
* **Localizations (6 Languages):** Full real-time interface translation for **English**, **Spanish**, **Chinese**, **German**, **Italian**, and **French**.
* **Stable Event Pipeline & Deduplication [NEW v1.0.1]:** Uses data-signature and layout fingerprinting to eliminate rendering loops and prevent dashboard flickering or "Loading" indicators.
* **Exports:** Fast local exports to Excel (`.xlsx` formatted workbook) and standard CSV files.

---

## 📂 File Structure

```bash
Matrix Pro Tableau/
├── matrix_extension.trex     # Tableau Extension Manifest (XML)
├── index.html                # Main application UI and structure
├── config.html               # Accordion-style visual settings panel
├── css/
│   └── matrix.css            # Unified design system & themes (light/dark/blue)
├── js/
│   ├── app.js                # Core Application controller & coordinator
│   ├── tableau-connector.js  # Tableau Extension API integration layer
│   ├── pivot-engine.js       # Client-side data aggregation & pivot engine
│   ├── matrix-renderer.js    # Interactive DOM matrix builder
│   ├── export.js             # Excel (SheetJS) & CSV export manager
│   └── i18n.js               # Multi-language dictionary & translation helper
```

---

## ⚙️ Technical Architecture

### 1. Tableau Integration (`tableau-connector.js`)
Handles the lifecycle of the Tableau Extensions API:
* Listens for filter, selection, and data updates on the worksheet.
* Reads active dimensions and measures from the **Rows (A)**, **Columns (B)**, and **Values (C)** shelves on the Marks card via `getVisualSpecificationAsync()`.
* Persists format preferences inside the Tableau workbook settings.

### 2. High-Performance Pivot Engine (`pivot-engine.js`)
Transforms flat transactional rows fetched from Tableau into a nested tree structure:
* Dynamically aggregates measures (supports `SUM`, `AVG`, `MIN`, `MAX`, `COUNT`).
* Generates hierarchical keys for row and column paths.
* Automatically computes row-level subtotals, column-level subtotals, and grand totals.

### 3. Matrix Rendering System (`matrix-renderer.js`)
Builds and manages the interactive DOM table:
* Dynamically injects collapsed/expanded row trees.
* Applies spacing styles, bold headings, borders, and zebra styling based on active config.
* Applies conditional formatting rules (gradient color scales or logical range-based rules).

### 4. Internationalization (`i18n.js`)
* Provides a centralized dictionary with translation tags for English, Spanish, Chinese, German, Italian, and French.
* Translates DOM components dynamically via `data-i18n` attributes.
* Synchronizes language updates across the configuration dialog and main extension window in real-time (0ms latency) via `BroadcastChannel` APIs.

---

## 🛠️ Configuration Options

| Option Category | Setting Name | Description |
| :--- | :--- | :--- |
| **Theme & Style** | Theme Style | Choose from Light (Classic), Dark Mode, and Modern Blue. |
| **Grid & Density** | Row Density / Font Size | Configure spacing padding (4px, 8px, 12px) and text scale (11px–14px). |
| | Gridlines | Toggle horizontal and vertical grid separator borders. |
| **Headers & Rows** | Bold Headers | Highlight row/column dimension labels with bold text. |
| | Zebra Striping | Alternating row background shading for readability. |
| **Subtotals & Totals** | Show Subtotals | Display expandable subtotal rows for intermediate parent groupings. |
| | Show Grand Total | Display vertical grand totals row at the bottom. |
| | Column Total | Display horizontal column total values. |
| **Conditional Formatting** | Enable CF | Toggle formatting on or off. |
| | CF Mode: Gradient | Interpolate cell colors dynamically between custom Min and Max pickers. |
| | CF Mode: Rules | Map numerical ranges to specific background and text hex colors. |
| **Toolbar & Status Bar** | Show Toolbar | Toggle blue action header bar. |
| | Show Export Buttons | Toggle Excel and CSV download action buttons. |
| | Show Status Bar | Toggle bottom worksheet information bar. |
| **Extension Language** | Interface Language | Select interface language (ES, EN, ZH, DE, IT, FR) with instant refresh. |

---

## 💻 Installation & Usage

### 1. Production Deployment (GitHub Pages)
The production version of this extension is already deployed and hosted publicly on GitHub Pages:
* **Hosted URL:** `https://arley-economist-dev.github.io/Matrix-Pro-Tableau/index.html`
* **Pre-configured Manifest:** The included [`matrix_extension.trex`](matrix_extension.trex) file is already pre-configured to load this live production URL.

### 2. Local Development (Optional)
If you wish to make changes locally and run the extension:
1. Start any local static web server in the project directory:
   ```bash
   npx http-server -p 8765
   ```
2. Open [`matrix_extension.trex`](matrix_extension.trex) and temporarily point the `<url>` element to local server:
   ```xml
   <url>http://localhost:8765/index.html</url>
   ```

### 3. Add to Tableau
1. Open Tableau Desktop and connect to a dataset (e.g., Sample - Superstore).
2. Create a new dashboard sheet.
3. Drag **Extension** from the Dashboard Objects pane onto your dashboard.
4. Choose **Access Local Extension** and select your `matrix_extension.trex` file.
5. Right-click the extension zone, choose **Configure**, and define your matrix layouts, themes, and translation options.

---

## ⏳ Changelog

### v1.0.1 (July 23, 2026)
* **Independent Per-Field Formatting:** Refactored formatting controls to select and configure distinct conditional formats for each measure in the matrix independently.
* **Text Luminance Auto-Contrast:** Implemented background-brightness math to toggle cell text color dynamically between white (`#ffffff`) and dark grey (`#1f2937`) for legibility.
* **Flicker and Loop Prevention:** Integrated a data-signature and configuration fingerprint checking loop guard to completely resolve recursive refresh loops in Tableau dashboards.
* **Worksheet Shelf Auto-Detection:** Re-enabled sheet data listeners so structural changes on Rows/Columns/Values are rendered immediately.
* **High-Res Branding assets:** Recreated and saved the manifest icon in high-resolution PNG using the original vector logo.

---

## 📄 License
This project is open-source and released under the MIT License. Feel free to customize and extend.

