import { Platform, Share } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

import { devPrivacyError, getPrivacySafeErrorReason } from './privacyLog';

export async function shareLocalFile(filePath: string, title = 'SafeRide file'): Promise<boolean> {
  try {
    const shareUri =
      Platform.OS === 'android'
        ? await FileSystem.getContentUriAsync(filePath)
        : filePath;

    const sharePayload =
      Platform.OS === 'android'
        ? { message: `${title}\n${shareUri}`.trim() }
        : { url: shareUri, message: title };

    const result = await Share.share(
      sharePayload,
      Platform.OS === 'android' ? { dialogTitle: title } : undefined,
    );
    return result.action === Share.sharedAction;
  } catch (error) {
    devPrivacyError('local file share failed', { reason: getPrivacySafeErrorReason(error) });
    return false;
  }
}
