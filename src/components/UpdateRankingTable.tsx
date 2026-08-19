/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Plus, X, ArrowUpDown, Palette, Search, ChevronDown, Users, Trash2 } from 'lucide-react';

/* ==========================================================================
 * DATA MODEL
 * ------------------------------------------------------------------------
 * This tab is now a free-form spreadsheet (Google-Sheets-style) instead of
 * a fixed grid driven by the Projects list. Rows are just rows - anyone
 * with edit rights can add, remove, and fill them with anything. A brand
 * new sheet is seeded with 3 default columns (Project Name / Location /
 * Domain) and a handful of blank rows, exactly like opening a fresh sheet.
 * ========================================================================== */

export interface RankingColumn {
  id: string;
  name: string;
  /** Header background color for this column (Google-Sheets "fill color"). */
  headerColor?: string;
  /** Text color applied to every cell in this column. */
  textColor?: string;
  /** User-resized column width in px (drag the header edge, Google-Sheets style). Falls back to the auto-computed width when unset. */
  width?: number;
}

export interface RankingRow {
  id: string;
  /** columnId -> cell text. Missing key = empty cell. */
  cells: Record<string, string>;
  /** Row highlight color (the existing "color tag" feature - colors the whole row). */
  color?: string;
  /** columnId -> color for one specific cell. Used by "Color Block" to paint a
      rectangular range (section + N rows + N columns) instead of a full row.
      Takes priority over `color` when both are set on the same cell. */
  cellColors?: Record<string, string>;
}

export interface ManualRankingGrid {
  columns: RankingColumn[];
  rows: RankingRow[];
}

export interface RankingUserOption {
  name: string;
  emails: string[];
}

const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const DEFAULT_COLUMN_DEFS: Array<{ id: string; name: string }> = [
  { id: 'col-project-name', name: 'Project Name' },
  { id: 'col-domain', name: 'Domain' },
  { id: 'col-location', name: 'Location' },
];

// A brand-new sheet always opens with columns A -> AZ (52 total, same as the
// first screen of a fresh Google Sheet) and 500 rows, regardless of how many
// projects are seeded in. The first 3 columns keep their real names above;
// the rest are blank spreadsheet columns until the user renames them.
const DEFAULT_TOTAL_COLUMNS = 52; // A..Z, AA..AZ
const DEFAULT_TOTAL_ROWS = 500;

/** Minimal shape needed to seed a sheet row - matches the app-wide Project type. */
interface SeedProject {
  name?: string;
  location?: string;
  domain?: string;
}

/**
 * A brand-new sheet: the 3 default columns, with row 1 holding the header
 * text as plain cell data (exactly like a real spreadsheet - the column
 * chrome above is just A/B/C, the actual "Project Name" label lives in
 * the first data row) followed by one row per project passed in. If there
 * are no projects yet, it's padded out with blank rows just like opening
 * a fresh Google Sheet.
 */
export function createEmptySheet(projects: SeedProject[] = []): ManualRankingGrid {
  const columns = DEFAULT_COLUMN_DEFS.map(c => ({ id: c.id, name: c.name }));

  const headerRow: RankingRow = {
    id: uid('row'),
    cells: {
      'col-project-name': 'Project Name',
      'col-location': 'Location',
      'col-domain': 'Domain',
    },
  };

  const projectRows: RankingRow[] = projects.map(p => ({
    id: uid('row'),
    cells: {
      'col-project-name': p.name || '',
      'col-location': p.location || '',
      'col-domain': p.domain || '',
    },
  }));

  return padSheetToDefaults({ columns, rows: [headerRow, ...projectRows] });
}

/**
 * Pads an ALREADY-LOADED sheet (e.g. one fetched from Supabase that was
 * saved back when the default was only 3 columns / 12 rows) up to the
 * current A -> AZ / 500-row default, without touching any existing data.
 * Safe to call on every load - if the sheet is already big enough it's a
 * no-op copy.
 */
export function padSheetToDefaults(grid: ManualRankingGrid): ManualRankingGrid {
  const columns = [...grid.columns];
  while (columns.length < DEFAULT_TOTAL_COLUMNS) {
    columns.push({ id: uid('col'), name: '' });
  }
  const rows = [...grid.rows];
  while (rows.length < DEFAULT_TOTAL_ROWS) {
    rows.push({ id: uid('row'), cells: {} });
  }
  return { columns, rows };
}

/** 0 -> A, 1 -> B, ... 25 -> Z, 26 -> AA, matching real spreadsheet column letters. */
function columnLetter(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

interface UpdateRankingTableProps {
  /** Admin can only VIEW a chosen user's sheet here; regular users get full editing rights on their own sheet. */
  isAdmin?: boolean;
  canEdit: boolean;
  /** The email/id of whoever's sheet is currently loaded (used to tag autosaves). */
  currentUserEmail?: string;
  grid: ManualRankingGrid;
  setGrid: React.Dispatch<React.SetStateAction<ManualRankingGrid>>;
  isLoading: boolean;
  /** Height (px) of the sticky filters+tab-bar block above this table, so the
      table header can stick right below it instead of hiding under it. */
  stickyOffset?: number;

  /** Admin-only: single-select "which user's sheet am I viewing" picker.
      Deliberately separate from the multi-select Users filter in the main
      filter block near Location - that filter never reaches this section,
      and picking a user here never touches that filter either. */
  usersList?: RankingUserOption[];
  selectedUserEmail?: string;
  onSelectedUserChange?: (email: string) => void;

  /** Wiring from the page-level "Workspace Filters" bar. Only the filters
      that map onto something this free-form sheet actually has are applied
      here: the global search box (matched against every cell, same as the
      sheet's own local search), a Location filter (matched against a
      column named "Location", if one exists), and a Project filter
      (matched against a column named "Project Name", if one exists). The
      workspace Users filter and Date filter are intentionally NOT wired in
      here - they don't apply to this section. */
  globalSearchTerm?: string;
  locationFilter?: string[];
  projectNameFilter?: string[];
}

// Fill-color palette for header cells and the row color-tagging feature (24 presets)
const COLOR_SWATCHES = [
  { label: 'Green', value: '#d1fae5' },
  { label: 'Emerald', value: '#a7f3d0' },
  { label: 'Teal', value: '#ccfbf1' },
  { label: 'Cyan', value: '#cffafe' },
  { label: 'Sky', value: '#e0f2fe' },
  { label: 'Blue', value: '#dbeafe' },
  { label: 'Indigo', value: '#e0e7ff' },
  { label: 'Violet', value: '#ede9fe' },
  { label: 'Purple', value: '#f3e8ff' },
  { label: 'Fuchsia', value: '#fae8ff' },
  { label: 'Pink', value: '#fce7f3' },
  { label: 'Rose', value: '#ffe4e6' },
  { label: 'Red', value: '#fee2e2' },
  { label: 'Orange', value: '#ffedd5' },
  { label: 'Amber', value: '#fef3c7' },
  { label: 'Yellow', value: '#fef9c3' },
  { label: 'Lime', value: '#ecfccb' },
  { label: 'Gray', value: '#e5e7eb' },
  { label: 'Slate', value: '#e2e8f0' },
  { label: 'Stone', value: '#e7e5e4' },
  { label: 'Dark Green', value: '#86efac' },
  { label: 'Dark Blue', value: '#93c5fd' },
  { label: 'Dark Red', value: '#fca5a5' },
  { label: 'Dark Purple', value: '#d8b4fe' },
];

// Solid text-color palette for the per-column "text color" feature
const TEXT_COLOR_SWATCHES = [
  { label: 'Black', value: '#111827' },
  { label: 'Gray', value: '#6b7280' },
  { label: 'Red', value: '#dc2626' },
  { label: 'Orange', value: '#ea580c' },
  { label: 'Amber', value: '#b45309' },
  { label: 'Green', value: '#16a34a' },
  { label: 'Teal', value: '#0d9488' },
  { label: 'Blue', value: '#2563eb' },
  { label: 'Indigo', value: '#4f46e5' },
  { label: 'Purple', value: '#9333ea' },
  { label: 'Pink', value: '#db2777' },
];

// Sizes a column based on its name length instead of a fixed oversized width.
const columnWidth = (name: string): number => {
  const px = 72 + name.length * 8;
  return Math.min(220, Math.max(110, px));
};

const SR_NO_COL_WIDTH = 60;
const CHECKBOX_COL_WIDTH = 36;

// Compares two cell values the way a spreadsheet would: numeric if both
// sides parse as numbers, otherwise a normal case-insensitive text sort.
// Blank cells always sort to the bottom regardless of direction.
const compareCells = (a: string, b: string, dir: 'asc' | 'desc'): number => {
  const aTrim = (a || '').trim();
  const bTrim = (b || '').trim();
  const aEmpty = aTrim === '';
  const bEmpty = bTrim === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  const an = parseFloat(aTrim.replace(/,/g, ''));
  const bn = parseFloat(bTrim.replace(/,/g, ''));
  if (!isNaN(an) && !isNaN(bn)) {
    return dir === 'asc' ? an - bn : bn - an;
  }
  return dir === 'asc' ? aTrim.localeCompare(bTrim) : bTrim.localeCompare(aTrim);
};

export default function UpdateRankingTable({
  isAdmin = false,
  canEdit,
  currentUserEmail = '',
  grid,
  setGrid,
  isLoading,
  stickyOffset = 0,
  usersList = [],
  selectedUserEmail = '',
  onSelectedUserChange,
  globalSearchTerm = '',
  locationFilter = [],
  projectNameFilter = [],
}: UpdateRankingTableProps) {
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [searchTerm, setSearchTerm] = useState('');

  // Sort filter (High-to-low / Low-to-high / A-Z / Z-A, spreadsheet-style)
  // applied to one chosen column. Local, per-session only.
  const [sortColumnId, setSortColumnId] = useState<string>('');
  const [sortDirection, setSortDirection] = useState<'desc' | 'asc'>('desc');
  const [sortPanelOpen, setSortPanelOpen] = useState(false);
  const sortPanelRef = useRef<HTMLDivElement | null>(null);

  // Row color-tagging filter mode
  const [colorModeOn, setColorModeOn] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<Record<string, boolean>>({});
  const [customColor, setCustomColor] = useState('#c7d2fe');

  // Per-column formatting popover (fill color + text color)
  const [colorMenuColId, setColorMenuColId] = useState<string | null>(null);
  const colorMenuRef = useRef<HTMLDivElement | null>(null);

  // Cell color: paint whatever cell(s) are currently selected (click, or
  // click-drag for a range) - no manual row/column numbers needed.
  const [blockPanelOpen, setBlockPanelOpen] = useState(false);
  const blockPanelRef = useRef<HTMLDivElement | null>(null);

  // Freeze panes: pin the first N columns (stays put while X-scrolling) and/or
  // the first N data rows (stays put while Y-scrolling), Google-Sheets style.
  // Freezing happens instantly via the checkboxes right on the sheet - above
  // each column letter, and to the left of each row number. No popup, no
  // separate "Apply" step.
  const [frozenCols, setFrozenCols] = useState(0);
  const [frozenRows, setFrozenRows] = useState(0);
  const [rowTopOffsets, setRowTopOffsets] = useState<number[]>([]); // [0] = header height, [i] = top for frozen data row i-1
  const headerRowElRef = useRef<HTMLTableRowElement | null>(null);
  const frozenRowElRefs = useRef<Record<number, HTMLTableRowElement | null>>({});

  // Admin-only "which user's sheet" picker
  const [userPickerOpen, setUserPickerOpen] = useState(false);
  const [userPickerSearch, setUserPickerSearch] = useState('');
  const userPickerRef = useRef<HTMLDivElement | null>(null);

  // Column resize (drag the right edge of a header cell, Google-Sheets style).
  // Kept as local state during the drag itself so only the visible rows
  // repaint on every pixel of movement instead of the whole 500-row grid;
  // committed into grid.columns[].width (and therefore autosaved) on mouseup.
  const [colWidths, setColWidths] = useState<Record<string, number>>({});

  // Click-and-drag range selection across cells, like Sheets/Excel. Indices
  // are positions into the CURRENTLY VISIBLE rows/columns, not row/col ids -
  // selection is a session-only UI aid (for highlighting + copy), not saved.
  const [selStart, setSelStart] = useState<{ r: number; c: number } | null>(null);
  const [selEnd, setSelEnd] = useState<{ r: number; c: number } | null>(null);
  const isSelectingRef = useRef(false);

  // Row virtualization: with up to 500 rows x 52 columns (26,000 input
  // boxes), rendering every cell up front is what was tanking page speed
  // in this section. Only the rows actually scrolled into view (plus a
  // small overscan buffer) are mounted; the rest are represented by two
  // lightweight spacer rows so the scrollbar height stays correct.
  const VIEWPORT_HEIGHT = 560; // matches the max-h-[560px] scroll container below
  const ROW_OVERSCAN = 10;
  const [rowHeight, setRowHeight] = useState(37);
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRafRef = useRef<number | null>(null);
  const firstScrollableRowRef = useRef<HTMLTableRowElement | null>(null);

  const handleGridScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    if (scrollRafRef.current != null) return; // already have a frame queued, skip
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      setScrollTop(top);
    });
  };

  const skipNextAutoSave = useRef(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gridRef = useRef(grid);
  useEffect(() => { gridRef.current = grid; }, [grid]);

  // Ctrl/Cmd+Z undo (and Ctrl/Cmd+Shift+Z / Ctrl+Y redo), Sheets-style.
  // Snapshots of the grid are pushed onto a plain stack right before each
  // user-triggered mutation; undo pops one off and restores it, pushing the
  // just-left state onto the redo stack so redo can step forward again.
  const undoStackRef = useRef<ManualRankingGrid[]>([]);
  const redoStackRef = useRef<ManualRankingGrid[]>([]);
  const MAX_UNDO_STEPS = 50;

  const pushUndoSnapshot = () => {
    undoStackRef.current.push(gridRef.current);
    if (undoStackRef.current.length > MAX_UNDO_STEPS) undoStackRef.current.shift();
    redoStackRef.current = []; // a fresh edit invalidates whatever could have been redone
  };

  const undo = () => {
    if (!canEdit) return;
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    redoStackRef.current.push(gridRef.current);
    setGrid(prev);
  };

  const redo = () => {
    if (!canEdit) return;
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push(gridRef.current);
    setGrid(next);
  };

  // Whenever the underlying sheet owner changes (admin swaps who they're
  // viewing), don't treat the freshly-loaded data as an edit to autosave.
  useEffect(() => { skipNextAutoSave.current = true; }, [currentUserEmail]);

  // Debounced autosave. Never runs for a read-only (admin) view.
  useEffect(() => {
    if (!canEdit || !currentUserEmail) return;
    if (skipNextAutoSave.current) {
      skipNextAutoSave.current = false;
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState('saving');
    saveTimer.current = setTimeout(async () => {
      saveTimer.current = null;
      try {
        const res = await fetch('/api/manual-rankings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user: currentUserEmail, columns: grid.columns, rows: grid.rows })
        });
        setSaveState(res.ok ? 'saved' : 'error');
      } catch (e) {
        console.error('Failed to save ranking sheet to Supabase:', e);
        setSaveState('error');
      }
    }, 400);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, canEdit, currentUserEmail]);

  // Flush any still-pending save immediately on unmount (e.g. switching tabs
  // mid-debounce), so a quick edit right before navigating away isn't lost.
  useEffect(() => {
    return () => {
      if (saveTimer.current && canEdit && currentUserEmail) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        try {
          fetch('/api/manual-rankings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: currentUserEmail, columns: gridRef.current.columns, rows: gridRef.current.rows }),
            keepalive: true
          }).catch((e) => console.error('Failed to flush pending save on unmount:', e));
        } catch (e) {
          console.error('Failed to flush pending save on unmount:', e);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close popovers when clicking outside of them
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sortPanelOpen && sortPanelRef.current && !sortPanelRef.current.contains(e.target as Node)) {
        setSortPanelOpen(false);
      }
      if (colorMenuColId && colorMenuRef.current && !colorMenuRef.current.contains(e.target as Node)) {
        setColorMenuColId(null);
      }
      if (userPickerOpen && userPickerRef.current && !userPickerRef.current.contains(e.target as Node)) {
        setUserPickerOpen(false);
      }
      if (blockPanelOpen && blockPanelRef.current && !blockPanelRef.current.contains(e.target as Node)) {
        setBlockPanelOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [sortPanelOpen, colorMenuColId, userPickerOpen, blockPanelOpen]);

  /* ---------------------------- column ops ---------------------------- */

  const addColumn = () => {
    if (!canEdit) return;
    const name = window.prompt('Name this new column (e.g. "Week 1", "Notes"):');
    if (!name || !name.trim()) return;
    pushUndoSnapshot();
    setGrid(prev => ({ ...prev, columns: [...prev.columns, { id: uid('col'), name: name.trim() }] }));
  };

  const renameColumn = (colId: string) => {
    if (!canEdit) return;
    const current = grid.columns.find(c => c.id === colId);
    const name = window.prompt('Rename column:', current?.name || '');
    if (!name || !name.trim()) return;
    pushUndoSnapshot();
    setGrid(prev => ({ ...prev, columns: prev.columns.map(c => c.id === colId ? { ...c, name: name.trim() } : c) }));
  };

  const deleteColumn = (colId: string) => {
    if (!canEdit) return;
    if (!window.confirm('Remove this column and all its filled data? This cannot be undone.')) return;
    pushUndoSnapshot();
    setGrid(prev => ({
      ...prev,
      columns: prev.columns.filter(c => c.id !== colId),
      rows: prev.rows.map(r => {
        if (!(colId in r.cells)) return r;
        const cells = { ...r.cells };
        delete cells[colId];
        return { ...r, cells };
      })
    }));
    if (sortColumnId === colId) setSortColumnId('');
  };

  const setColumnColor = (colId: string, field: 'headerColor' | 'textColor', value: string) => {
    if (!canEdit) return;
    pushUndoSnapshot();
    setGrid(prev => ({
      ...prev,
      columns: prev.columns.map(c => c.id === colId ? { ...c, [field]: value || undefined } : c)
    }));
  };

  const clearColumnFormatting = (colId: string) => {
    if (!canEdit) return;
    pushUndoSnapshot();
    setGrid(prev => ({
      ...prev,
      columns: prev.columns.map(c => c.id === colId ? { ...c, headerColor: undefined, textColor: undefined } : c)
    }));
  };

  /** Effective width for a column: live drag value > saved width > auto-computed default. */
  const getColWidth = (col: RankingColumn): number => colWidths[col.id] ?? col.width ?? columnWidth(col.name);

  // Drag-to-resize a column, like grabbing the edge of a header in Sheets.
  // Live width changes stay in local `colWidths` state (cheap - only the
  // visible/virtualized rows re-render); the final width is written into
  // grid.columns once on mouseup so it persists via the normal autosave.
  const handleColumnResizeStart = (e: React.MouseEvent, colId: string, currentWidth: number) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(60, Math.min(600, currentWidth + (ev.clientX - startX)));
      setColWidths(prev => ({ ...prev, [colId]: next }));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setColWidths(prev => {
        const finalWidth = prev[colId];
        if (finalWidth != null && canEdit) {
          pushUndoSnapshot();
          setGrid(g => ({ ...g, columns: g.columns.map(c => c.id === colId ? { ...c, width: finalWidth } : c) }));
        }
        return prev;
      });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  /* ------------------------------ row ops ------------------------------ */

  const addRow = () => {
    if (!canEdit) return;
    pushUndoSnapshot();
    setGrid(prev => ({ ...prev, rows: [...prev.rows, { id: uid('row'), cells: {} }] }));
  };

  const deleteRow = (rowId: string) => {
    if (!canEdit) return;
    pushUndoSnapshot();
    setGrid(prev => ({ ...prev, rows: prev.rows.filter(r => r.id !== rowId) }));
    setSelectedRowIds(prev => {
      if (!(rowId in prev)) return prev;
      const next = { ...prev };
      delete next[rowId];
      return next;
    });
  };

  const updateCell = (rowId: string, colId: string, raw: string) => {
    if (!canEdit) return;
    setGrid(prev => ({
      ...prev,
      rows: prev.rows.map(r => r.id === rowId ? { ...r, cells: { ...r.cells, [colId]: raw } } : r)
    }));
  };

  // Google-Sheets-style paste: pasting a multi-cell block (tab/newline
  // separated, exactly what copying a range from Google Sheets or Excel
  // puts on the clipboard) fills cells starting at the focused cell,
  // growing the sheet with extra rows/columns automatically if the pasted
  // block is bigger than what's currently there.
  const handleCellPaste = (e: React.ClipboardEvent<HTMLInputElement>, rowId: string, colId: string) => {
    if (!canEdit) return;
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!text.includes('\t') && !text.includes('\n')) return; // single value: let the browser handle it normally

    e.preventDefault();
    let lines = text.replace(/\r/g, '').split('\n');
    while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    const block = lines.map(line => line.split('\t'));

    pushUndoSnapshot();
    setGrid(prev => {
      const columns = [...prev.columns];
      const rows = prev.rows.map(r => ({ ...r, cells: { ...r.cells } }));

      const startRowIdx = rows.findIndex(r => r.id === rowId);
      const startColIdx = columns.findIndex(c => c.id === colId);
      if (startRowIdx === -1 || startColIdx === -1) return prev;

      const widestPasteRow = Math.max(...block.map(r => r.length));
      while (columns.length < startColIdx + widestPasteRow) {
        columns.push({ id: uid('col'), name: `Column ${columns.length + 1}` });
      }
      while (rows.length < startRowIdx + block.length) {
        rows.push({ id: uid('row'), cells: {} });
      }

      block.forEach((lineCells, ri) => {
        const targetRow = rows[startRowIdx + ri];
        lineCells.forEach((val, ci) => {
          const targetCol = columns[startColIdx + ci];
          targetRow.cells[targetCol.id] = val;
        });
      });

      return { columns, rows };
    });
  };

  /* ------------------------------ sorting ------------------------------ */

  const chooseSortColumn = (colId: string) => {
    setSortColumnId(prev => (prev === colId ? '' : colId));
  };

  /* --------------------------- row color tag ---------------------------- */

  const applyColorToSelected = (color: string) => {
    pushUndoSnapshot();
    setGrid(prev => ({
      ...prev,
      rows: prev.rows.map(r => selectedRowIds[r.id] ? { ...r, color } : r)
    }));
    setSelectedRowIds({});
  };

  const clearColorFromSelected = () => {
    pushUndoSnapshot();
    setGrid(prev => ({
      ...prev,
      rows: prev.rows.map(r => selectedRowIds[r.id] ? { ...r, color: undefined } : r)
    }));
    setSelectedRowIds({});
  };

  /* ---------------------------- cell color --------------------------------
   * Paints whichever cell(s) are currently selected (single click, or
   * click-drag for a rectangular range) - no manual row/column entry. */

  const applyColorToSelectedCells = (color: string | undefined) => {
    if (!canEdit || !selBounds) return;
    const selectedRowIdSet = new Set(
      visibleRows.slice(selBounds.r0, selBounds.r1 + 1).map(r => r.id)
    );
    const targetColIds = grid.columns.slice(selBounds.c0, selBounds.c1 + 1).map(c => c.id);

    pushUndoSnapshot();
    setGrid(prev => ({
      ...prev,
      rows: prev.rows.map(r => {
        if (!selectedRowIdSet.has(r.id)) return r;
        const cellColors = { ...(r.cellColors || {}) };
        targetColIds.forEach(colId => {
          if (color) cellColors[colId] = color;
          else delete cellColors[colId];
        });
        return { ...r, cellColors };
      })
    }));
  };

  /* ----------------------- click-drag range selection --------------------
   * Mirrors Sheets/Excel: mousedown on a cell starts a selection, dragging
   * (mouseenter) over other cells stretches it into a rectangle, mouseup
   * (anywhere) ends the drag. Ctrl/Cmd+C on a multi-cell selection copies
   * it as a tab/newline block, same shape Sheets puts on the clipboard. */

  const beginSelect = (r: number, c: number) => {
    isSelectingRef.current = true;
    setSelStart({ r, c });
    setSelEnd({ r, c });
  };
  const extendSelect = (r: number, c: number) => {
    if (isSelectingRef.current) setSelEnd({ r, c });
  };
  useEffect(() => {
    const onUp = () => { isSelectingRef.current = false; };
    document.addEventListener('mouseup', onUp);
    return () => document.removeEventListener('mouseup', onUp);
  }, []);

  const selBounds = useMemo(() => {
    if (!selStart || !selEnd) return null;
    return {
      r0: Math.min(selStart.r, selEnd.r), r1: Math.max(selStart.r, selEnd.r),
      c0: Math.min(selStart.c, selEnd.c), c1: Math.max(selStart.c, selEnd.c),
    };
  }, [selStart, selEnd]);

  const isCellSelected = (r: number, c: number): boolean => {
    if (!selBounds) return false;
    return r >= selBounds.r0 && r <= selBounds.r1 && c >= selBounds.c0 && c <= selBounds.c1;
  };

  /* --------------------------- derived state ---------------------------- */

  // Columns the page-level Workspace Filters can hook into - matched by
  // name so this keeps working even if the sheet's column ids differ (e.g.
  // an older saved sheet, or the user renamed things back to the same label).
  const locationColId = useMemo(
    () => grid.columns.find(c => c.name.trim().toLowerCase() === 'location')?.id,
    [grid.columns]
  );
  const projectNameColId = useMemo(
    () => grid.columns.find(c => c.name.trim().toLowerCase() === 'project name')?.id,
    [grid.columns]
  );

  const visibleRows = useMemo(() => {
    let list = grid.rows;
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      list = list.filter(r => Object.values(r.cells).some(v => (v || '').toLowerCase().includes(term)));
    }
    // Global search bar from the page-level Workspace Filters - same "match
    // any cell" behavior as the sheet's own search box above, just wired to
    // the shared filter bar so typing there also narrows this sheet.
    if (globalSearchTerm.trim()) {
      const term = globalSearchTerm.toLowerCase();
      list = list.filter(r => Object.values(r.cells).some(v => (v || '').toLowerCase().includes(term)));
    }
    // Location filter - only has something to match against if this sheet
    // has a "Location" column (true for the default seeded columns).
    if (locationFilter.length > 0 && locationColId) {
      const wanted = new Set(locationFilter.map(l => l.toLowerCase()));
      list = list.filter(r => wanted.has((r.cells[locationColId] || '').trim().toLowerCase()));
    }
    // Project filter - matched against a "Project Name" column, same idea.
    if (projectNameFilter.length > 0 && projectNameColId) {
      const wanted = new Set(projectNameFilter.map(p => p.toLowerCase()));
      list = list.filter(r => wanted.has((r.cells[projectNameColId] || '').trim().toLowerCase()));
    }
    if (sortColumnId) {
      list = [...list].sort((a, b) => compareCells(a.cells[sortColumnId] || '', b.cells[sortColumnId] || '', sortDirection));
    }
    return list;
  }, [grid.rows, searchTerm, sortColumnId, sortDirection, globalSearchTerm, locationFilter, projectNameFilter, locationColId, projectNameColId]);

  // Measure actual rendered row heights so frozen rows can be pinned at the
  // right pixel offset (header height, then each frozen row stacked below it).
  useLayoutEffect(() => {
    const offsets: number[] = [headerRowElRef.current?.getBoundingClientRect().height || 34];
    for (let i = 0; i < frozenRows; i++) {
      const el = frozenRowElRefs.current[i];
      offsets.push(offsets[offsets.length - 1] + (el?.getBoundingClientRect().height || 37));
    }
    setRowTopOffsets(offsets);
  }, [frozenRows, grid.columns.length, visibleRows.length]);

  // Left-offset (px) of each data column, for pinning frozen columns during
  // horizontal scroll. Starts after the sticky row-number (+ checkbox) gutter.
  const colLeftBase = (colorModeOn ? CHECKBOX_COL_WIDTH : 0) + SR_NO_COL_WIDTH;
  const colLeftOffsets = useMemo(() => {
    let acc = Math.round(colLeftBase);
    return grid.columns.map(c => {
      const left = acc;
      acc += Math.round(getColWidth(c));
      return left;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid.columns, colLeftBase, colWidths]);

  // Only step in for genuine multi-cell selections; a single-cell selection
  // (or none) falls through to the browser's normal input copy behavior.
  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      if (!selBounds) return;
      if (selBounds.r0 === selBounds.r1 && selBounds.c0 === selBounds.c1) return;
      const lines: string[] = [];
      for (let ri = selBounds.r0; ri <= selBounds.r1; ri++) {
        const row = visibleRows[ri];
        const vals: string[] = [];
        for (let ci = selBounds.c0; ci <= selBounds.c1; ci++) {
          const col = grid.columns[ci];
          vals.push(row && col ? (row.cells[col.id] || '') : '');
        }
        lines.push(vals.join('\t'));
      }
      e.clipboardData?.setData('text/plain', lines.join('\n'));
      e.preventDefault();
    };
    document.addEventListener('copy', onCopy);
    return () => document.removeEventListener('copy', onCopy);
  }, [selBounds, visibleRows, grid.columns]);

  /* --------------------- select-all / clear-selection --------------------
   * Ctrl/Cmd+A selects the whole visible sheet (all rows currently shown x
   * all columns), same as Sheets. Delete/Backspace on a multi-cell range
   * clears every cell in it in one go. Both are wired up on the scroll
   * container below via onKeyDown, so they only fire while the sheet
   * itself has focus (not e.g. the search box). */

  const selectAllCells = () => {
    if (!grid.columns.length || !visibleRows.length) return;
    setSelStart({ r: 0, c: 0 });
    setSelEnd({ r: visibleRows.length - 1, c: grid.columns.length - 1 });
  };

  const clearSelectedRange = () => {
    if (!canEdit || !selBounds) return;
    if (selBounds.r0 === selBounds.r1 && selBounds.c0 === selBounds.c1) return; // single cell: let normal typing/backspace handle it
    const targetRowIds = new Set(visibleRows.slice(selBounds.r0, selBounds.r1 + 1).map(r => r.id));
    const targetColIds = new Set(grid.columns.slice(selBounds.c0, selBounds.c1 + 1).map(c => c.id));
    pushUndoSnapshot();
    setGrid(prev => ({
      ...prev,
      rows: prev.rows.map(r => {
        if (!targetRowIds.has(r.id)) return r;
        const cells = { ...r.cells };
        targetColIds.forEach(cid => { delete cells[cid]; });
        return { ...r, cells };
      })
    }));
  };

  const handleSheetKeyDown = (e: React.KeyboardEvent) => {
    const meta = e.ctrlKey || e.metaKey;
    if (meta && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
      return;
    }
    if ((meta && e.key.toLowerCase() === 'y') || (meta && e.shiftKey && e.key.toLowerCase() === 'z')) {
      e.preventDefault();
      redo();
      return;
    }
    if (meta && e.key.toLowerCase() === 'a') {
      e.preventDefault(); // stop the browser's native "select all text in this input"
      selectAllCells();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selBounds && !(selBounds.r0 === selBounds.r1 && selBounds.c0 === selBounds.c1)) {
      e.preventDefault();
      clearSelectedRange();
    }
  };

  // Clicking anywhere in the sheet that isn't a text input (row/col headers,
  // a read-only cell, empty space) still moves keyboard focus onto the
  // scroll container, so Ctrl+A / Delete keep working even outside an
  // actively-focused cell.
  const sheetContainerRef = useRef<HTMLDivElement | null>(null);
  const handleSheetMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName !== 'INPUT') {
      sheetContainerRef.current?.focus();
    }
  };

  // --- Row virtualization math -------------------------------------------
  // Frozen rows always render (they're normally few, and need to stay in
  // the sticky flow). Everything after them is windowed: only rows inside
  // (or just outside, via overscan) the visible viewport are mounted.
  const frozenFlowHeight = (rowTopOffsets[frozenRows] ?? rowTopOffsets[0] ?? 0) - (rowTopOffsets[0] ?? 0);
  const scrollableRows = visibleRows.slice(frozenRows);
  const rawStart = Math.floor(Math.max(0, scrollTop - frozenFlowHeight) / rowHeight) - ROW_OVERSCAN;
  const virtualStart = Math.max(0, rawStart);
  const visibleCount = Math.ceil(VIEWPORT_HEIGHT / rowHeight) + ROW_OVERSCAN * 2;
  const virtualEnd = Math.min(scrollableRows.length, virtualStart + visibleCount);
  const renderedScrollableRows = scrollableRows.slice(virtualStart, virtualEnd);
  const topSpacerHeight = virtualStart * rowHeight;
  const bottomSpacerHeight = (scrollableRows.length - virtualEnd) * rowHeight;
  // Row-number col + filler col + data cols + optional checkbox col.
  const totalTableCols = grid.columns.length + 2 + (colorModeOn ? 1 : 0);

  // Measure the true row height once real rows are on screen (falls back
  // to the 37px default used elsewhere until then).
  useLayoutEffect(() => {
    const h = firstScrollableRowRef.current?.getBoundingClientRect().height;
    if (h && Math.abs(h - rowHeight) > 0.5) setRowHeight(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderedScrollableRows.length, grid.columns.length]);

  const selectedCount = Object.values(selectedRowIds).filter(Boolean).length;
  const activeSortColIdx = grid.columns.findIndex(c => c.id === sortColumnId);
  const activeSortColumnName = activeSortColIdx === -1
    ? undefined
    : (grid.columns[activeSortColIdx].name || `Col ${columnLetter(activeSortColIdx)}`);

  const selectedUserOption = useMemo(
    () => usersList.find(u => u.emails.includes(selectedUserEmail)),
    [usersList, selectedUserEmail]
  );
  const filteredUserOptions = useMemo(() => {
    const term = userPickerSearch.toLowerCase().trim();
    if (!term) return usersList;
    return usersList.filter(u => u.name.toLowerCase().includes(term) || u.emails.some(e => e.toLowerCase().includes(term)));
  }, [usersList, userPickerSearch]);

  // Renders one data row. Used both for the always-mounted frozen rows and
  // for the virtualized window of scrollable rows - `idx` is always the
  // row's real position in visibleRows (row-number label, sticky offsets,
  // and selection all key off this, regardless of which pass renders it).
  const renderDataRow = (row: RankingRow, idx: number, isFrozenRow: boolean, isFirstScrollable = false) => {
    const isChecked = !!selectedRowIds[row.id];
    const rowTop = isFrozenRow ? (rowTopOffsets[idx + 1] ?? rowTopOffsets[0] ?? 0) : undefined;
    const rowStickyStyle = isFrozenRow ? { position: 'sticky' as const, top: rowTop, zIndex: 15 } : undefined;
    return (
      <tr
        key={row.id}
        ref={isFrozenRow ? (el) => { frozenRowElRefs.current[idx] = el; } : (isFirstScrollable ? firstScrollableRowRef : undefined)}
        style={row.color && !isFrozenRow ? { backgroundColor: row.color } : undefined}
        className="hover:bg-slate-50/60 transition group/row"
      >
        {colorModeOn && (
          <td
            className="px-2 py-2.5 sticky left-0 border-l border-r border-b border-slate-200"
            style={{ width: CHECKBOX_COL_WIDTH, minWidth: CHECKBOX_COL_WIDTH, backgroundColor: row.color || '#fff', ...rowStickyStyle, zIndex: isFrozenRow ? 25 : 10 }}
          >
            <input
              type="checkbox"
              checked={isChecked}
              onChange={(e) => setSelectedRowIds(prev => ({ ...prev, [row.id]: e.target.checked }))}
              className="cursor-pointer"
            />
          </td>
        )}
        <td
          className={`px-1 py-2.5 text-center font-bold text-slate-500 sticky border-r border-b border-slate-200 bg-slate-100 ${!colorModeOn ? 'border-l' : ''}`}
          style={{
            left: colorModeOn ? CHECKBOX_COL_WIDTH : 0,
            width: SR_NO_COL_WIDTH, minWidth: SR_NO_COL_WIDTH,
            backgroundColor: row.color || '#f1f5f9',
            ...rowStickyStyle, zIndex: isFrozenRow ? 25 : 10,
          }}
        >
          <input
            type="checkbox"
            checked={idx < frozenRows}
            onChange={(e) => setFrozenRows(e.target.checked ? idx + 1 : idx)}
            title={idx < frozenRows ? 'Unfreeze from here' : 'Freeze up to this row'}
            className="align-middle mr-1 cursor-pointer w-3 h-3"
          />
          <span className="group-hover/row:hidden">{idx + 1}</span>
          {canEdit && (
            <button
              onClick={() => deleteRow(row.id)}
              className="hidden group-hover/row:inline-flex items-center justify-center text-gray-400 hover:text-rose-600 cursor-pointer"
              title="Delete row"
            >
              <Trash2 size={11} />
            </button>
          )}
        </td>

        {grid.columns.map((col, colIdx) => {
          const w = getColWidth(col);
          const cellValue = row.cells[col.id] || '';
          const blockColorForCell = row.cellColors?.[col.id];
          const cellBg = blockColorForCell || row.color || undefined;
          const isFrozenCol = colIdx < frozenCols;
          // Only show the drag-selection tint for genuine multi-cell ranges -
          // a single clicked/focused cell already gets its own input outline.
          const isRangeSelected = !!selBounds
            && !(selBounds.r0 === selBounds.r1 && selBounds.c0 === selBounds.c1)
            && isCellSelected(idx, colIdx);
          return (
            <td
              key={col.id}
              className={`p-0 border-r border-b border-slate-200 ${isFrozenCol ? 'sticky' : ''}`}
              style={{
                width: w, minWidth: w,
                backgroundColor: (isFrozenCol || isFrozenRow) ? (cellBg || '#fff') : cellBg,
                ...(isFrozenCol ? { left: colLeftOffsets[colIdx] } : {}),
                ...rowStickyStyle,
                zIndex: isFrozenCol && isFrozenRow ? 26 : isFrozenCol ? 12 : isFrozenRow ? 15 : undefined,
                boxShadow: isRangeSelected ? 'inset 0 0 0 9999px rgba(99,102,241,0.25)' : undefined,
              }}
              onMouseDown={() => beginSelect(idx, colIdx)}
              onMouseEnter={() => extendSelect(idx, colIdx)}
            >
              {canEdit ? (
                <input
                  type="text"
                  value={cellValue}
                  onFocus={pushUndoSnapshot}
                  onChange={(e) => updateCell(row.id, col.id, e.target.value)}
                  onPaste={(e) => handleCellPaste(e, row.id, col.id)}
                  placeholder="—"
                  style={{ color: col.textColor || undefined }}
                  className="w-full text-xs font-bold text-gray-800 px-2.5 py-2.5 border border-transparent hover:border-gray-200 focus:border-indigo-400 rounded-lg focus:outline-hidden bg-transparent focus:bg-white transition"
                />
              ) : (
                <span className="block px-2.5 py-2.5 text-xs font-bold text-gray-800 truncate" style={{ color: col.textColor || undefined }}>
                  {cellValue || '—'}
                </span>
              )}
            </td>
          );
        })}

        <td className="w-full border-b border-slate-200" style={{ backgroundColor: isFrozenRow ? (row.color || '#fff') : (row.color || undefined), ...rowStickyStyle }}></td>
      </tr>
    );
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="p-4 bg-gray-50/50 border-b border-gray-150 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">
            {isAdmin ? 'Manual Ranking' : 'Update Ranking'}
          </h3>
          <p className="text-[10px] text-gray-500 font-semibold mt-0.5">
            {canEdit
              ? 'A free-form sheet, just like Google Sheets - type, paste, drag to select a range, Ctrl+A to select all, Ctrl+C to copy, Delete to clear a range.'
              : isAdmin
                ? 'Pick a user below to view (and edit) their sheet.'
                : 'View this sheet. Drag to select a range, Ctrl+C to copy, sort and search freely.'}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap relative">
          {/* Admin-only: single-select "viewing which user's sheet" picker.
              Intentionally separate from the main Users filter near Location -
              that filter has zero effect on this section. */}
          {isAdmin && (
            <div className="relative" ref={userPickerRef}>
              <button
                onClick={() => setUserPickerOpen(v => !v)}
                className={`flex items-center gap-1.5 text-xs font-bold border rounded-xl px-2.5 py-2 cursor-pointer transition ${
                  selectedUserEmail ? 'bg-indigo-600 border-indigo-700 text-white' : 'bg-white border-gray-200 hover:bg-gray-50 text-gray-700'
                }`}
              >
                <Users size={12} />
                {selectedUserOption ? selectedUserOption.name : 'Select a user'}
                <ChevronDown size={12} />
              </button>

              {userPickerOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-64 max-w-[85vw] max-h-80 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-xl z-50 p-3">
                  <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-2">Viewing user's sheet</p>
                  <input
                    type="text"
                    value={userPickerSearch}
                    onChange={(e) => setUserPickerSearch(e.target.value)}
                    placeholder="Search user..."
                    className="w-full mb-2 px-2 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-[11px] font-bold focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                  />
                  <div className="flex flex-col gap-0.5 max-h-56 overflow-y-auto">
                    {filteredUserOptions.length === 0 && (
                      <p className="text-[11px] text-gray-400 font-semibold px-1 py-1">No users found.</p>
                    )}
                    {filteredUserOptions.map(u => {
                      const isSelected = u.emails.includes(selectedUserEmail);
                      return (
                        <button
                          key={u.emails[0]}
                          onClick={() => { onSelectedUserChange?.(isSelected ? '' : u.emails[0]); setUserPickerOpen(false); setUserPickerSearch(''); }}
                          className={`text-left text-[11px] font-bold px-2 py-1.5 rounded-lg cursor-pointer transition ${
                            isSelected ? 'bg-indigo-600 text-white' : 'hover:bg-gray-50 text-gray-800'
                          }`}
                        >
                          {u.name} <span className={`font-mono normal-case ${isSelected ? 'text-indigo-100' : 'text-gray-400'}`}>· {u.emails[0]}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Save status - editors only. Kept silent during normal
              saving/saved/idle states per request; only a real save failure
              (which risks losing the edit) still surfaces to the user. */}
          {canEdit && saveState === 'error' && (
            <div className="flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-600">
              Save failed - check your connection
            </div>
          )}

          <div className="relative w-full sm:w-56">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-gray-400">
              <Search size={13} />
            </span>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search anywhere in the sheet..."
              className="w-full text-xs pl-8 pr-3 py-2 border border-gray-200 rounded-xl focus:outline-hidden focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
            />
          </div>

          {/* Sort filter */}
          <div className="relative" ref={sortPanelRef}>
            <button
              onClick={() => setSortPanelOpen(v => !v)}
              className={`flex items-center gap-1.5 text-xs font-bold border rounded-xl px-2.5 py-2 cursor-pointer transition ${
                sortColumnId ? 'bg-indigo-600 border-indigo-700 text-white' : 'bg-white border-gray-200 hover:bg-gray-50 text-gray-700'
              }`}
            >
              <ArrowUpDown size={12} />
              {sortColumnId ? `${activeSortColumnName}: ${sortDirection === 'desc' ? 'High → Low / Z → A' : 'Low → High / A → Z'}` : 'Sort'}
              <ChevronDown size={12} />
            </button>

            {sortPanelOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-64 max-w-[85vw] max-h-80 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-xl z-50 p-3">
                <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-2">Sort direction</p>
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => setSortDirection('desc')}
                    className={`flex-1 text-xs font-bold rounded-lg px-2 py-1.5 border cursor-pointer transition ${
                      sortDirection === 'desc' ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-white border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    High → Low
                  </button>
                  <button
                    onClick={() => setSortDirection('asc')}
                    className={`flex-1 text-xs font-bold rounded-lg px-2 py-1.5 border cursor-pointer transition ${
                      sortDirection === 'asc' ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-white border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    Low → High
                  </button>
                </div>

                <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-2">Apply to column</p>
                {grid.columns.length === 0 ? (
                  <p className="text-[11px] text-gray-400 font-semibold">
                    {canEdit ? 'Add a column first.' : 'No columns yet.'}
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {grid.columns.map((col, colIdx) => (
                      <label key={col.id} className="flex items-center gap-2 text-xs font-semibold text-gray-700 cursor-pointer hover:bg-gray-50 rounded-lg px-1.5 py-1">
                        <input
                          type="checkbox"
                          checked={sortColumnId === col.id}
                          onChange={() => chooseSortColumn(col.id)}
                          className="cursor-pointer"
                        />
                        <span className="truncate">{col.name || `Column ${columnLetter(colIdx)}`}</span>
                      </label>
                    ))}
                  </div>
                )}

                {sortColumnId && (
                  <button
                    onClick={() => { setSortColumnId(''); }}
                    className="mt-2 text-[10px] font-bold text-gray-500 hover:text-rose-600 cursor-pointer"
                  >
                    Clear sort
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Row color tagging - editors only */}
          {canEdit && (
            <button
              onClick={() => { setColorModeOn(v => !v); setSelectedRowIds({}); }}
              className={`flex items-center gap-1.5 text-xs font-bold border rounded-xl px-2.5 py-2 cursor-pointer transition ${
                colorModeOn ? 'bg-indigo-600 border-indigo-700 text-white' : 'bg-white border-gray-200 hover:bg-gray-50 text-gray-700'
              }`}
            >
              <Palette size={12} />
              Color Tag {colorModeOn ? 'On' : ''}
            </button>
          )}

          {/* Block color - color a rectangular range (section + rows + columns),
              instead of the whole row like "Color Tag" above. Editors only. */}
          {canEdit && (
            <div className="relative" ref={blockPanelRef}>
              <button
                onClick={() => setBlockPanelOpen(v => !v)}
                className={`flex items-center gap-1.5 text-xs font-bold border rounded-xl px-2.5 py-2 cursor-pointer transition ${
                  blockPanelOpen ? 'bg-indigo-600 border-indigo-700 text-white' : 'bg-white border-gray-200 hover:bg-gray-50 text-gray-700'
                }`}
              >
                <Palette size={12} />
                Cell Color
                <ChevronDown size={12} />
              </button>

              {blockPanelOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-64 max-w-[85vw] bg-white border border-gray-200 rounded-xl shadow-xl z-50 p-3">
                  <p className="text-[10px] font-bold text-gray-500 mb-2">
                    {selBounds
                      ? `${selBounds.r1 - selBounds.r0 + 1} row${selBounds.r1 > selBounds.r0 ? 's' : ''} × ${selBounds.c1 - selBounds.c0 + 1} column${selBounds.c1 > selBounds.c0 ? 's' : ''} selected`
                      : 'Click a cell (or drag to select a range), then pick a color'}
                  </p>
                  <div className="flex items-center gap-1.5 flex-wrap mb-3">
                    {COLOR_SWATCHES.map(sw => (
                      <button
                        key={sw.value}
                        title={sw.label}
                        disabled={!selBounds}
                        onClick={() => { applyColorToSelectedCells(sw.value); setBlockPanelOpen(false); }}
                        className={`w-6 h-6 rounded-full border-2 border-white shadow-2xs transition ${selBounds ? 'cursor-pointer hover:scale-110' : 'opacity-40 cursor-not-allowed'}`}
                        style={{ backgroundColor: sw.value }}
                      />
                    ))}
                    <input
                      type="color"
                      disabled={!selBounds}
                      onChange={(e) => { applyColorToSelectedCells(e.target.value); setBlockPanelOpen(false); }}
                      title="Pick a custom color"
                      className="w-6 h-6 rounded-full border-2 border-white shadow-2xs cursor-pointer overflow-hidden p-0 disabled:opacity-40 disabled:cursor-not-allowed"
                    />
                  </div>

                  <button
                    disabled={!selBounds}
                    onClick={() => { applyColorToSelectedCells(undefined); setBlockPanelOpen(false); }}
                    className="text-xs font-bold text-gray-500 hover:text-rose-600 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition"
                  >
                    Clear color
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Freeze panes - pin the first N columns and/or first N data rows so
              they stay put while scrolling (X-scroll for columns, Y for rows).
              Freezing is done with the checkboxes right on the sheet itself
              (above each column letter, left of each row number) and takes
              effect instantly - this button is just a status readout + a
              one-click way to unfreeze everything. */}
          {(frozenCols > 0 || frozenRows > 0) && (
            <button
              onClick={() => { setFrozenCols(0); setFrozenRows(0); }}
              title="Unfreeze all"
              className="flex items-center gap-1.5 text-xs font-bold border rounded-xl px-2.5 py-2 cursor-pointer transition bg-indigo-600 border-indigo-700 text-white hover:bg-indigo-700"
            >
              <ArrowUpDown size={12} />
              {`Frozen ${frozenCols}c/${frozenRows}r`}
              <X size={12} />
            </button>
          )}

          {/* Add row - editors only */}
          {canEdit && (
            <button
              onClick={addRow}
              title="Add a new row"
              className="flex items-center gap-1.5 text-xs font-bold border border-dashed border-indigo-300 text-indigo-600 rounded-xl px-2.5 py-2 cursor-pointer hover:bg-indigo-50 transition"
            >
              <Plus size={12} /> Row
            </button>
          )}

          {/* Add column - editors only. Sheets are unlimited in both directions,
              so this is the columns counterpart to "+ Row" above. */}
          {canEdit && (
            <button
              onClick={addColumn}
              title="Add a new column"
              className="flex items-center gap-1.5 text-xs font-bold border border-dashed border-indigo-300 text-indigo-600 rounded-xl px-2.5 py-2 cursor-pointer hover:bg-indigo-50 transition"
            >
              <Plus size={12} /> Column
            </button>
          )}
        </div>
      </div>

      {/* Color palette bar - shown once rows are checked in color mode */}
      {canEdit && colorModeOn && selectedCount > 0 && (
        <div className="sticky top-0 z-40 mx-4 mt-3 p-3 bg-indigo-50 border border-indigo-150 rounded-xl shadow-md">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-indigo-800">{selectedCount} row{selectedCount > 1 ? 's' : ''} selected</span>
            <button
              onClick={clearColorFromSelected}
              className="text-[10px] font-bold text-gray-600 hover:text-rose-600 px-2 py-1 rounded-lg hover:bg-white transition cursor-pointer"
            >
              Clear color
            </button>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {COLOR_SWATCHES.map(sw => (
              <button
                key={sw.value}
                title={sw.label}
                onClick={() => applyColorToSelected(sw.value)}
                className="w-6 h-6 rounded-full border-2 border-white shadow-2xs cursor-pointer hover:scale-110 transition"
                style={{ backgroundColor: sw.value }}
              />
            ))}
            <div className="flex items-center gap-1 ml-1 pl-2 border-l border-indigo-200">
              <input
                type="color"
                value={customColor}
                onChange={(e) => setCustomColor(e.target.value)}
                title="Pick a custom color"
                className="w-6 h-6 rounded-full border-2 border-white shadow-2xs cursor-pointer overflow-hidden p-0"
              />
              <button
                onClick={() => applyColorToSelected(customColor)}
                className="text-[10px] font-bold text-indigo-700 hover:text-indigo-900 px-2 py-1 rounded-lg hover:bg-white transition cursor-pointer"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {isAdmin && !selectedUserEmail ? (
        <div className="p-12 text-center text-xs text-gray-500 font-bold bg-slate-50/40 rounded-b-2xl border-t border-slate-150">
          Pick a user from the dropdown above to view their sheet.
        </div>
      ) : isLoading ? (
        <div className="p-12 text-center text-xs text-gray-500 font-bold">Loading sheet...</div>
      ) : (
        <div
          ref={sheetContainerRef}
          className="overflow-x-auto overflow-y-auto rounded-b-2xl mt-1 max-h-[560px] outline-hidden"
          onScroll={handleGridScroll}
          onMouseDown={handleSheetMouseDown}
          onKeyDown={handleSheetKeyDown}
          tabIndex={-1}
        >
          <table className="text-left text-xs border-separate w-full" style={{ tableLayout: 'fixed', borderSpacing: 0 }}>
            <thead className="bg-slate-100 text-slate-500 font-bold text-[11px] sticky top-0 z-20">
              <tr ref={headerRowElRef}>
                {colorModeOn && <th className="px-2 py-2 sticky left-0 top-0 bg-slate-100 z-40 border-l border-t border-r border-b border-slate-200"></th>}
                {/* Plain row-number corner cell, same as a real spreadsheet's top-left corner block. */}
                <th
                  className={`px-2 py-2 text-center sticky top-0 bg-slate-100 z-40 border-t border-r border-b border-slate-200 ${!colorModeOn ? 'border-l' : ''}`}
                  style={{ left: colorModeOn ? CHECKBOX_COL_WIDTH : 0, width: SR_NO_COL_WIDTH, minWidth: SR_NO_COL_WIDTH }}
                ></th>

                {grid.columns.map((col, colIdx) => {
                  const w = getColWidth(col);
                  const isFrozenCol = colIdx < frozenCols;
                  return (
                    <th
                      key={col.id}
                      className={`relative px-2.5 py-2 text-center sticky top-0 border-t border-r border-b border-slate-200 group/col ${isFrozenCol ? 'z-30' : 'z-20'} ${!col.headerColor ? 'bg-slate-100' : ''}`}
                      style={{
                        width: w, minWidth: w,
                        backgroundColor: col.headerColor || undefined,
                        ...(isFrozenCol ? { left: colLeftOffsets[colIdx] } : {}),
                      }}
                      title={col.name}
                    >
                      <input
                        type="checkbox"
                        checked={isFrozenCol}
                        onChange={(e) => setFrozenCols(e.target.checked ? colIdx + 1 : colIdx)}
                        title={isFrozenCol ? 'Unfreeze from here' : 'Freeze up to this column'}
                        className="block mx-auto mb-0.5 cursor-pointer w-3 h-3"
                      />
                      <span className="group-hover/col:hidden">{columnLetter(colIdx)}</span>
                      {canEdit && (
                        <button
                          onClick={() => deleteColumn(col.id)}
                          className="hidden group-hover/col:inline-flex items-center justify-center text-gray-400 hover:text-rose-600 cursor-pointer mx-auto"
                          title="Delete column"
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                      {/* Drag-to-resize handle, Google-Sheets style - grab the
                          right edge of the header and stretch/shrink the column. */}
                      <div
                        onMouseDown={(e) => handleColumnResizeStart(e, col.id, w)}
                        title="Drag to resize column"
                        className="absolute top-0 right-0 h-full w-2 cursor-col-resize hover:bg-indigo-400/60 active:bg-indigo-500/70 z-10"
                      />
                    </th>
                  );
                })}

                {/* Filler column: soaks up remaining horizontal space so the
                    letter-header row extends to the right edge, like Sheets. */}
                <th className="w-full bg-slate-100 sticky top-0 z-20 border-t border-b border-slate-200"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-150">
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={totalTableCols} className="p-12 text-center text-xs text-gray-500 font-bold">
                    {(searchTerm || globalSearchTerm || locationFilter.length > 0 || projectNameFilter.length > 0)
                      ? 'No rows match the current search/filters.'
                      : (canEdit ? 'No rows yet - click "+ Row" to start.' : 'No rows yet.')}
                  </td>
                </tr>
              ) : (
                <>
                  {/* Frozen rows (if any) always render in full - they're pinned
                      and typically few. Everything else is virtualized below. */}
                  {visibleRows.slice(0, frozenRows).map((row, idx) => renderDataRow(row, idx, true))}

                  {/* Spacer soaking up the height of rows scrolled past above
                      the current window, so the scrollbar stays the right size
                      without those rows actually being mounted. */}
                  {topSpacerHeight > 0 && (
                    <tr aria-hidden="true">
                      <td colSpan={totalTableCols} style={{ height: topSpacerHeight, padding: 0, border: 'none' }} />
                    </tr>
                  )}

                  {renderedScrollableRows.map((row, i) =>
                    renderDataRow(row, frozenRows + virtualStart + i, false, i === 0)
                  )}

                  {bottomSpacerHeight > 0 && (
                    <tr aria-hidden="true">
                      <td colSpan={totalTableCols} style={{ height: bottomSpacerHeight, padding: 0, border: 'none' }} />
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
