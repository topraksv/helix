/**
 * `expo-notifications` on the web, replaced by a statement that the web has no
 * local reminders. `metro.config.js` substitutes it on the web only and says
 * why; `scripts/check-web-budget.mjs` holds what it measured.
 *
 * `setNotificationHandler` is the one call that runs on the web, at module
 * scope, and it does nothing here. Everything else THROWS rather than pretend:
 * reaching it means a web guard went missing, and a reminder that silently
 * never fires is the worst of the possible answers. The package's enums are
 * read only after one of those calls, so they are not answered at all.
 * `tests/repo/release-config.test.ts` holds this file to every function `src`
 * calls on the package.
 */

const UNAVAILABLE =
  "expo-notifications is not bundled on the web. metro.config.js substitutes " +
  "src/services/notifications-absent.js for it because every caller returns " +
  "early there. To notify on the web, remove that substitution and re-measure " +
  "the web bundle budget.";

function unavailable() {
  throw new Error(UNAVAILABLE);
}

export function setNotificationHandler() {}

export const getPermissionsAsync = unavailable;
export const requestPermissionsAsync = unavailable;
export const setNotificationChannelAsync = unavailable;
export const scheduleNotificationAsync = unavailable;
export const cancelAllScheduledNotificationsAsync = unavailable;
export const dismissAllNotificationsAsync = unavailable;
export const getLastNotificationResponse = unavailable;
export const clearLastNotificationResponse = unavailable;
export const addNotificationResponseReceivedListener = unavailable;
