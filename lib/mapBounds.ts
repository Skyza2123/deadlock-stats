export type MapBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export const DEADLOCK_MAP_RADIUS = 10752;

export const DEADLOCK_WORLD_BOUNDS: MapBounds = {
  minX: -DEADLOCK_MAP_RADIUS,
  maxX: DEADLOCK_MAP_RADIUS,
  minY: -DEADLOCK_MAP_RADIUS,
  maxY: DEADLOCK_MAP_RADIUS,
};

export const DEADLOCK_PATH_GRID_BOUNDS: MapBounds = {
  minX: 0,
  maxX: 16383,
  minY: 0,
  maxY: 16383,
};
