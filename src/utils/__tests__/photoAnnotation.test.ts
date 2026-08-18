import { describe, expect, it } from 'vitest';
import {
  clampAnnotationCoordinate,
  createCoordinateAnnotation,
  createPresetAnnotation,
  describeAnnotation,
} from '../photoAnnotation';

describe('accessible photo annotation helpers', () => {
  it('creates deterministic non-coordinate preset placement', () => {
    expect(createPresetAnnotation('blur', 'center', 'annotation-1')).toEqual({
      id: 'annotation-1',
      x: 50,
      y: 50,
      label: 'Blur area at center',
      type: 'blur',
    });
  });

  it('clamps visual coordinates and rejects non-finite positions', () => {
    expect(clampAnnotationCoordinate(-1)).toBe(0);
    expect(clampAnnotationCoordinate(101)).toBe(100);
    expect(clampAnnotationCoordinate(Number.NaN)).toBe(50);
    expect(createCoordinateAnnotation('note', -4, 120, 'annotation-2')).toMatchObject({
      x: 0,
      y: 100,
    });
  });

  it('describes annotations without requiring coordinate gestures', () => {
    const annotation = createCoordinateAnnotation('highlight', 80, 12, 'annotation-3');
    expect(describeAnnotation(annotation)).toBe('Important area, top right');
  });
});
