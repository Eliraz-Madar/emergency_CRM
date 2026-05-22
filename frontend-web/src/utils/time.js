/**
 * Canonical time formatters used throughout the project.
 *
 * All functions render in the browser's local timezone (Israel when run locally)
 * and always use 24-hour clock so "13:37:02" is never shown as "1:37:02 PM".
 */

const TIME_OPTS = {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
};

const DATETIME_OPTS = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
};

/**
 * Format any date-like value as "HH:MM:SS" (24-hour, local timezone).
 * Returns '--:--:--' for invalid input.
 */
export const formatTime = (value) => {
  const d = new Date(value);
  if (isNaN(d.getTime())) return '--:--:--';
  return d.toLocaleTimeString('en-GB', TIME_OPTS);
};

/**
 * Format any date-like value as "DD/MM/YYYY, HH:MM:SS" (24-hour, local timezone).
 * Returns '--' for invalid input.
 */
export const formatDateTime = (value) => {
  const d = new Date(value);
  if (isNaN(d.getTime())) return '--';
  return d.toLocaleString('en-GB', DATETIME_OPTS);
};
