import { afterEach, describe, expect, it } from 'vitest';

import {
  ACTIVE_PRIVACY_CONTROL_VERSION,
  loadPrivacyControls,
  resetPrivacyControlsForTests,
} from '../privacyControls.js';

const originalPath = process.env.SAFERIDE_PRIVACY_CONTROLS_PATH;

afterEach(() => {
  if (originalPath === undefined) delete process.env.SAFERIDE_PRIVACY_CONTROLS_PATH;
  else process.env.SAFERIDE_PRIVACY_CONTROLS_PATH = originalPath;
  resetPrivacyControlsForTests();
});

describe('privacy controls', () => {
  it('loads the checked-in manifest from the repository execution context', () => {
    const controls = loadPrivacyControls();
    expect(controls.controlVersion).toBe(ACTIVE_PRIVACY_CONTROL_VERSION);
    expect(controls.capabilities.dsar_server_processing.status).toBe('disabled');
  });

  it('fails closed when an explicitly configured manifest is unavailable', () => {
    process.env.SAFERIDE_PRIVACY_CONTROLS_PATH = '/nonexistent/saferide/privacy-controls.json';
    resetPrivacyControlsForTests();
    expect(() => loadPrivacyControls()).toThrow('Privacy control manifest is unavailable');
  });
});
