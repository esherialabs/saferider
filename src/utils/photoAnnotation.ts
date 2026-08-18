export type AnnotationTool = 'blur' | 'highlight' | 'note';
export type AnnotationPresetRegion = 'top' | 'center' | 'bottom';

export interface AnnotationPoint {
  id: string;
  x: number;
  y: number;
  label: string;
  type: AnnotationTool;
}

const PRESET_COORDINATES: Record<AnnotationPresetRegion, { x: number; y: number }> = {
  top: { x: 50, y: 20 },
  center: { x: 50, y: 50 },
  bottom: { x: 50, y: 80 },
};

const TOOL_LABELS: Record<AnnotationTool, string> = {
  blur: 'Blur area',
  highlight: 'Important area',
  note: 'Note',
};

const REGION_LABELS: Record<AnnotationPresetRegion, string> = {
  top: 'top',
  center: 'center',
  bottom: 'bottom',
};

export function clampAnnotationCoordinate(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(0, value));
}

export function createCoordinateAnnotation(
  type: AnnotationTool,
  x: number,
  y: number,
  id: string,
): AnnotationPoint {
  return {
    id,
    x: clampAnnotationCoordinate(x),
    y: clampAnnotationCoordinate(y),
    label: TOOL_LABELS[type],
    type,
  };
}

export function createPresetAnnotation(
  type: AnnotationTool,
  region: AnnotationPresetRegion,
  id: string,
): AnnotationPoint {
  const coordinates = PRESET_COORDINATES[region];
  return {
    id,
    ...coordinates,
    label: `${TOOL_LABELS[type]} at ${REGION_LABELS[region]}`,
    type,
  };
}

export function describeAnnotation(annotation: AnnotationPoint): string {
  const horizontal = annotation.x < 34 ? 'left' : annotation.x > 66 ? 'right' : 'center';
  const vertical = annotation.y < 34 ? 'top' : annotation.y > 66 ? 'bottom' : 'middle';
  return `${annotation.label}, ${vertical} ${horizontal}`;
}
