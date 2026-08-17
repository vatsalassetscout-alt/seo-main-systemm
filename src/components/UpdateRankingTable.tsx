/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X, ArrowUpDown, Palette, Search, Check, Loader2, ChevronDown, Users, Trash2, Type } from 'lucide-react';

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
}

export interface RankingRow {
  id: string;
  /** columnId -> cell text. Missing key = empty cell. */
  cells: Record<string, string>;
  /** Row highlight color (the existing "color tag" feature). */
  color?: string;
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
  { id: 'col-location', name: 'Location' },
  { id: 'col-domain', name: 'Domain' },
];

const DEFAULT_BLANK_ROWS = 12;

/** A brand-new, empty sheet: default columns + a page of blank rows, just like opening a fresh Google Sheet. */
export function createEmptySheet(): ManualRankingGrid {
  return {
    columns: DEFAULT_COLUMN_DEFS.map(c => ({ id: c.id, name: c.name })),
    rows: Array.from({ length: DEFAULT_BLANK_ROWS }, () => ({ id: uid('row'), cells: {} })),
  };
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

const SR_NO_COL_WIDTH = 48;
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

  // Admin-only "which user's sheet" picker
  const [userPickerOpen, setUserPickerOpen] = useState(false);
  const [userPickerSearch, setUserPickerSearch] = useState('');
  const userPickerRef = useRef<HTMLDivElement | null>(null);

  const skipNextAutoSave = useRef(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gridRef = useRef(grid);
  useEffect(() => { gridRef.current = grid; }, [grid]);

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
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [sortPanelOpen, colorMenuColId, userPickerOpen]);

  /* ---------------------------- column ops ---------------------------- */

  const addColumn = () => {
    if (!canEdit) return;
    const name = window.prompt('Name this new column (e.g. "Week 1", "Notes"):');
    if (!name || !name.trim()) return;
    setGrid(prev => ({ ...prev, columns: [...prev.columns, { id: uid('col'), name: name.trim() }] }));
  };

  const renameColumn = (colId: string) => {
    if (!canEdit) return;
    const current = grid.columns.find(c => c.id === colId);
    const name = window.prompt('Rename column:', current?.name || '');
    if (!name || !name.trim()) return;
    setGrid(prev => ({ ...prev, columns: prev.columns.map(c => c.id === colId ? { ...c, name: name.trim() } : c) }));
  };

  const deleteColumn = (colId: string) => {
    if (!canEdit) return;
    if (!window.confirm('Remove this column and all its filled data? This cannot be undone.')) return;
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
    setGrid(prev => ({
      ...prev,
      columns: prev.columns.map(c => c.id === colId ? { ...c, [field]: value || undefined } : c)
    }));
  };

  const clearColumnFormatting = (colId: string) => {
    if (!canEdit) return;
    setGrid(prev => ({
      ...prev,
      columns: prev.columns.map(c => c.id === colId ? { ...c, headerColor: undefined, textColor: undefined } : c)
    }));
  };

  /* ------------------------------ row ops ------------------------------ */

  const addRow = () => {
    if (!canEdit) return;
    setGrid(prev => ({ ...prev, rows: [...prev.rows, { id: uid('row'), cells: {} }] }));
  };

  const deleteRow = (rowId: string) => {
    if (!canEdit) return;
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
    setGrid(prev => ({
      ...prev,
      rows: prev.rows.map(r => selectedRowIds[r.id] ? { ...r, color } : r)
    }));
    setSelectedRowIds({});
  };

  const clearColorFromSelected = () => {
    setGrid(prev => ({
      ...prev,
      rows: prev.rows.map(r => selectedRowIds[r.id] ? { ...r, color: undefined } : r)
    }));
    setSelectedRowIds({});
  };

  /* --------------------------- derived state ---------------------------- */

  const visibleRows = useMemo(() => {
    let list = grid.rows;
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      list = list.filter(r => Object.values(r.cells).some(v => (v || '').toLowerCase().includes(term)));
    }
    if (sortColumnId) {
      list = [...list].sort((a, b) => compareCells(a.cells[sortColumnId] || '', b.cells[sortColumnId] || '', sortDirection));
    }
    return list;
  }, [grid.rows, searchTerm, sortColumnId, sortDirection]);

  const selectedCount = Object.values(selectedRowIds).filter(Boolean).length;
  const activeSortColumnName = grid.columns.find(c => c.id === sortColumnId)?.name;

  const selectedUserOption = useMemo(
    () => usersList.find(u => u.emails.includes(selectedUserEmail)),
    [usersList, selectedUserEmail]
  );
  const filteredUserOptions = useMemo(() => {
    const term = userPickerSearch.toLowerCase().trim();
    if (!term) return usersList;
    return usersList.filter(u => u.name.toLowerCase().includes(term) || u.emails.some(e => e.toLowerCase().includes(term)));
  }, [usersList, userPickerSearch]);

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
              ? 'A free-form sheet, just like Google Sheets - type, paste, add rows/columns, color-code, and sort freely.'
              : isAdmin
                ? 'Pick a user below to view their sheet (view-only).'
                : 'View this sheet. Sort and search freely.'}
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

          {/* Save status - editors only */}
          {canEdit && (
            <div className="flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1.5 rounded-lg bg-white border border-gray-200">
              {saveState === 'saving' && <><Loader2 size={11} className="animate-spin text-indigo-500" /> Saving…</>}
              {saveState === 'saved' && <><Check size={11} className="text-emerald-600" /> Saved</>}
              {saveState === 'error' && <span className="text-rose-600">Save failed</span>}
              {saveState === 'idle' && <span className="text-gray-400">All changes saved</span>}
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
                    {grid.columns.map(col => (
                      <label key={col.id} className="flex items-center gap-2 text-xs font-semibold text-gray-700 cursor-pointer hover:bg-gray-50 rounded-lg px-1.5 py-1">
                        <input
                          type="checkbox"
                          checked={sortColumnId === col.id}
                          onChange={() => chooseSortColumn(col.id)}
                          className="cursor-pointer"
                        />
                        <span className="truncate">{col.name}</span>
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
        <div className="overflow-x-auto overflow-y-auto rounded-b-2xl mt-1 max-h-[560px]">
          <table className="text-left text-xs border-collapse w-full" style={{ tableLayout: 'fixed' }}>
            <thead className="bg-slate-50/70 text-slate-500 font-extrabold text-[10px] uppercase border-b border-gray-150 sticky top-0 z-20">
              <tr>
                {colorModeOn && <th className="px-2 py-3 sticky left-0 top-0 bg-slate-50 z-40" style={{ width: CHECKBOX_COL_WIDTH, minWidth: CHECKBOX_COL_WIDTH }}></th>}
                <th
                  className="px-2 py-3 text-center sticky top-0 bg-slate-50 z-40"
                  style={{ left: colorModeOn ? CHECKBOX_COL_WIDTH : 0, width: SR_NO_COL_WIDTH, minWidth: SR_NO_COL_WIDTH }}
                >
                  #
                </th>

                {grid.columns.map(col => {
                  const w = columnWidth(col.name);
                  return (
                    <th
                      key={col.id}
                      className="px-2.5 py-3 group/col relative sticky top-0 z-20"
                      style={{ width: w, minWidth: w, backgroundColor: col.headerColor || '#f8fafc' }}
                    >
                      <div className="flex items-center justify-between gap-1">
                        {canEdit ? (
                          <button
                            onClick={() => renameColumn(col.id)}
                            className="truncate text-left hover:text-indigo-600 cursor-pointer"
                            style={{ color: col.textColor || undefined }}
                            title="Click to rename column"
                          >
                            {col.name}
                          </button>
                        ) : (
                          <span className="truncate" style={{ color: col.textColor || undefined }} title={col.name}>{col.name}</span>
                        )}

                        {canEdit && (
                          <div className="flex items-center gap-0.5 opacity-0 group-hover/col:opacity-100 transition shrink-0">
                            <div className="relative">
                              <button
                                onClick={() => setColorMenuColId(prev => prev === col.id ? null : col.id)}
                                className="text-gray-400 hover:text-indigo-600 cursor-pointer"
                                title="Column color / text color"
                              >
                                <Palette size={11} />
                              </button>
                              {colorMenuColId === col.id && (
                                <div ref={colorMenuRef} className="absolute right-0 top-full mt-1.5 w-56 bg-white border border-gray-200 rounded-xl shadow-xl z-50 p-3 normal-case text-gray-700">
                                  <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1.5 flex items-center gap-1"><Palette size={10} /> Header color</p>
                                  <div className="flex items-center gap-1 flex-wrap mb-3">
                                    {COLOR_SWATCHES.slice(0, 12).map(sw => (
                                      <button
                                        key={sw.value}
                                        title={sw.label}
                                        onClick={() => setColumnColor(col.id, 'headerColor', sw.value)}
                                        className="w-5 h-5 rounded-full border-2 border-white shadow-2xs cursor-pointer hover:scale-110 transition"
                                        style={{ backgroundColor: sw.value }}
                                      />
                                    ))}
                                  </div>
                                  <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1.5 flex items-center gap-1"><Type size={10} /> Text color</p>
                                  <div className="flex items-center gap-1 flex-wrap mb-3">
                                    {TEXT_COLOR_SWATCHES.map(sw => (
                                      <button
                                        key={sw.value}
                                        title={sw.label}
                                        onClick={() => setColumnColor(col.id, 'textColor', sw.value)}
                                        className="w-5 h-5 rounded-full border-2 border-white shadow-2xs cursor-pointer hover:scale-110 transition"
                                        style={{ backgroundColor: sw.value }}
                                      />
                                    ))}
                                  </div>
                                  <button
                                    onClick={() => { clearColumnFormatting(col.id); setColorMenuColId(null); }}
                                    className="text-[10px] font-bold text-gray-500 hover:text-rose-600 cursor-pointer"
                                  >
                                    Clear formatting
                                  </button>
                                </div>
                              )}
                            </div>
                            <button
                              onClick={() => deleteColumn(col.id)}
                              className="text-gray-400 hover:text-rose-600 transition cursor-pointer"
                              title="Remove column"
                            >
                              <X size={11} />
                            </button>
                          </div>
                        )}
                      </div>
                    </th>
                  );
                })}

                {canEdit && (
                  <th className="px-3 py-3 w-12 bg-slate-50 sticky top-0 z-20">
                    <button
                      onClick={addColumn}
                      title="Add a new column"
                      className="w-7 h-7 flex items-center justify-center rounded-lg border border-dashed border-indigo-300 text-indigo-600 hover:bg-indigo-50 cursor-pointer transition"
                    >
                      <Plus size={14} />
                    </button>
                  </th>
                )}
                {/* Filler column: soaks up remaining horizontal space so a
                    colored row's background extends to the right edge. */}
                <th className="w-full bg-slate-50 sticky top-0 z-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-150">
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={grid.columns.length + 3} className="p-12 text-center text-xs text-gray-500 font-bold">
                    {searchTerm ? 'No rows match your search.' : (canEdit ? 'No rows yet - click "+ Row" to start.' : 'No rows yet.')}
                  </td>
                </tr>
              ) : visibleRows.map((row, idx) => {
                const isChecked = !!selectedRowIds[row.id];
                return (
                  <tr key={row.id} style={row.color ? { backgroundColor: row.color } : undefined} className="hover:bg-slate-50/60 transition group/row">
                    {colorModeOn && (
                      <td
                        className="px-2 py-2.5 sticky left-0 z-10"
                        style={{ width: CHECKBOX_COL_WIDTH, minWidth: CHECKBOX_COL_WIDTH, backgroundColor: row.color || '#fff' }}
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
                      className="px-1 py-2.5 text-center font-bold text-gray-400 sticky z-10"
                      style={{ left: colorModeOn ? CHECKBOX_COL_WIDTH : 0, width: SR_NO_COL_WIDTH, minWidth: SR_NO_COL_WIDTH, backgroundColor: row.color || '#fff' }}
                    >
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

                    {grid.columns.map(col => {
                      const w = columnWidth(col.name);
                      const cellValue = row.cells[col.id] || '';
                      return (
                        <td key={col.id} className="p-0" style={{ width: w, minWidth: w, backgroundColor: row.color || undefined }}>
                          {canEdit ? (
                            <input
                              type="text"
                              value={cellValue}
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

                    {canEdit && <td></td>}
                    <td className="w-full" style={{ backgroundColor: row.color || undefined }}></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
