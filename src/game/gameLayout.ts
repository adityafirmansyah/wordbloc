import type { Level } from './levelTypes';
import { buildTray, targetUnits } from './puzzle';
import {
  BANDS,
  PORTRAIT_BANDS,
  PORTRAIT_TRAY_MAX_WIDTH,
  SLOT_GAP,
  TILE_HEIGHT,
  TRAY_GAP,
  TRAY_MAX_WIDTH,
  TRAY_ROW_GAP,
  tileWidth,
} from './theme';

export interface SlotPosition {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TrayPosition {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SceneLayoutResult {
  isPortrait: boolean;
  isMultiRowLandscape: boolean;
  trayRowsCount: number;
  trayPositions: TrayPosition[];
  trayBounds: { top: number; bottom: number };
  slotPositions: SlotPosition[];
  slotBounds: { top: number; bottom: number };
  artSize: { width: number; height: number };
  artHaloRadius: number;
  artCenterY: number;
  mechanicY: number;
  hintY: number;
  headerCenterY: number;
}

/**
 * Computes the complete adaptive layout for GameScene:
 * - Computes tray item positions first.
 * - Detects multi-row landscape or portrait layouts.
 * - Dynamically adapts illustration badge size, halo, and prompt text elevation.
 * - Strictly guarantees `slot.bottom <= tray.top - 24` across all levels and orientations.
 */
export function computeSceneLayout(
  level: Level,
  isPortrait: boolean,
  cx = isPortrait ? 360 : 640,
): SceneLayoutResult {
  // 1. Compute tray layout first
  const items = buildTray(level);
  const maxRowWidth = isPortrait ? PORTRAIT_TRAY_MAX_WIDTH : TRAY_MAX_WIDTH;
  const trayCenterY = isPortrait ? PORTRAIT_BANDS.trayCenterY : BANDS.trayCenterY;
  const safeBottom = isPortrait ? PORTRAIT_BANDS.safeBottom : BANDS.safeBottom;

  const rows: (typeof items)[] = [];
  let currentRow: typeof items = [];
  let rowWidth = 0;

  for (const item of items) {
    const w = tileWidth(item.unit);
    const add = currentRow.length === 0 ? w : w + TRAY_GAP;
    if (rowWidth + add > maxRowWidth && currentRow.length > 0) {
      rows.push(currentRow);
      currentRow = [item];
      rowWidth = w;
    } else {
      currentRow.push(item);
      rowWidth += add;
    }
  }
  if (currentRow.length > 0) {
    rows.push(currentRow);
  }

  const rowHeight = TILE_HEIGHT + TRAY_ROW_GAP;
  const blockHeight = rows.length * rowHeight - TRAY_ROW_GAP;
  const startY = trayCenterY - blockHeight / 2 + TILE_HEIGHT / 2;
  const lastRowBottom = startY + (rows.length - 1) * rowHeight + TILE_HEIGHT / 2;
  const shift = lastRowBottom > safeBottom ? lastRowBottom - safeBottom : 0;
  const trayTop = startY - shift;

  const trayPositions: TrayPosition[] = [];
  let itemIndex = 0;
  rows.forEach((trayRow, rowIndex) => {
    const widths = trayRow.map((item) => tileWidth(item.unit));
    const total =
      widths.reduce<number>((acc, w) => acc + w, 0) + TRAY_GAP * Math.max(0, trayRow.length - 1);
    let cursorX = cx - total / 2;
    const y = trayTop + rowIndex * rowHeight;

    trayRow.forEach((_, i) => {
      const width = widths[i] ?? 128;
      const x = cursorX + width / 2;
      trayPositions.push({
        index: itemIndex++,
        x,
        y,
        width,
        height: TILE_HEIGHT,
      });
      cursorX += width + TRAY_GAP;
    });
  });

  const trayBounds = {
    top: Math.min(...trayPositions.map((p) => p.y - p.height / 2)),
    bottom: Math.max(...trayPositions.map((p) => p.y + p.height / 2)),
  };

  // 2. Guaranteed collision clearance: slot.bottom <= tray.top - 24
  const maxAllowedSlotBottom = trayBounds.top - 24;

  const isMultiRowLandscape = !isPortrait && rows.length > 1;

  let artSize: { width: number; height: number };
  let artHaloRadius: number;
  let artCenterY: number;
  let mechanicY: number;
  let hintY: number;
  let headerCenterY: number;
  let defaultSlotsCenterY: number;

  if (isMultiRowLandscape) {
    // Multi-row landscape fallback: reduce illustration badge, elevate prompt texts
    artSize = { width: 120, height: 120 };
    artHaloRadius = 62;
    artCenterY = 116;
    mechanicY = 188;
    hintY = 215;
    headerCenterY = BANDS.headerCenterY;

    const promptBottom = level.hint ? hintY + 14 : mechanicY + 13;
    const remainingSpace = maxAllowedSlotBottom - promptBottom;
    defaultSlotsCenterY = Math.round(promptBottom + remainingSpace / 2);
  } else if (isPortrait) {
    artSize = PORTRAIT_BANDS.artSize;
    artHaloRadius = PORTRAIT_BANDS.artHaloRadius;
    artCenterY = PORTRAIT_BANDS.artCenterY;
    mechanicY = PORTRAIT_BANDS.mechanicY;
    hintY = PORTRAIT_BANDS.hintY;
    headerCenterY = PORTRAIT_BANDS.headerCenterY;
    defaultSlotsCenterY = PORTRAIT_BANDS.slotsCenterY;
  } else {
    // Single row landscape (standard)
    artSize = BANDS.artSize;
    artHaloRadius = BANDS.artHaloRadius;
    artCenterY = BANDS.artCenterY;
    mechanicY = BANDS.mechanicY;
    hintY = BANDS.hintY;
    headerCenterY = BANDS.headerCenterY;
    defaultSlotsCenterY = BANDS.slotsCenterY;
  }

  // 3. Compute slot positions
  const units = targetUnits(level);
  const widths = units.map((unit) => tileWidth(unit.unit));
  const slotPositions: SlotPosition[] = [];

  if (!isPortrait || units.length <= 5) {
    let centerY = defaultSlotsCenterY;
    if (centerY + TILE_HEIGHT / 2 > maxAllowedSlotBottom) {
      centerY = maxAllowedSlotBottom - TILE_HEIGHT / 2;
    }

    const total =
      widths.reduce<number>((acc, w) => acc + w, 0) + SLOT_GAP * Math.max(0, units.length - 1);
    let cursorX = cx - total / 2;

    units.forEach((_, index) => {
      const width = widths[index] ?? 128;
      const x = cursorX + width / 2;
      cursorX += width + SLOT_GAP;
      slotPositions.push({
        index,
        x,
        y: centerY,
        width,
        height: TILE_HEIGHT,
      });
    });
  } else {
    // Portrait with > 5 units: wrap into 2 rows
    const half = Math.ceil(units.length / 2);
    const row0Widths = widths.slice(0, half);
    const row1Widths = widths.slice(half);

    const total0 =
      row0Widths.reduce<number>((acc, w) => acc + w, 0) +
      SLOT_GAP * Math.max(0, row0Widths.length - 1);
    const total1 =
      row1Widths.reduce<number>((acc, w) => acc + w, 0) +
      SLOT_GAP * Math.max(0, row1Widths.length - 1);

    let row0Y = 630;
    let row1Y = 770;

    if (row1Y + TILE_HEIGHT / 2 > maxAllowedSlotBottom) {
      const diff = row1Y + TILE_HEIGHT / 2 - maxAllowedSlotBottom;
      row0Y -= diff;
      row1Y -= diff;
    }

    let cursor0 = cx - total0 / 2;
    let cursor1 = cx - total1 / 2;

    units.forEach((_, index) => {
      const width = widths[index] ?? 128;
      if (index < half) {
        const x = cursor0 + width / 2;
        cursor0 += width + SLOT_GAP;
        slotPositions.push({
          index,
          x,
          y: row0Y,
          width,
          height: TILE_HEIGHT,
        });
      } else {
        const x = cursor1 + width / 2;
        cursor1 += width + SLOT_GAP;
        slotPositions.push({
          index,
          x,
          y: row1Y,
          width,
          height: TILE_HEIGHT,
        });
      }
    });
  }

  const slotBounds = {
    top: Math.min(...slotPositions.map((p) => p.y - p.height / 2)),
    bottom: Math.max(...slotPositions.map((p) => p.y + p.height / 2)),
  };

  return {
    isPortrait,
    isMultiRowLandscape,
    trayRowsCount: rows.length,
    trayPositions,
    trayBounds,
    slotPositions,
    slotBounds,
    artSize,
    artHaloRadius,
    artCenterY,
    mechanicY,
    hintY,
    headerCenterY,
  };
}
