import type { VotingHistoryRecord } from '../types/voting';

/**
 * Formatea una fecha canónica (ISO 8601, timestamp o Date) para presentación en la UI.
 * Asegura la separación estricta entre el dato canónico (createdAt) y su presentación localizada.
 */
export function formatHistoryDate(
  recordOrDate?: VotingHistoryRecord | { createdAt?: string; date?: string } | string | null
): string {
  if (!recordOrDate) return '';

  const dateValue = typeof recordOrDate === 'string'
    ? recordOrDate
    : (recordOrDate.createdAt || recordOrDate.date || '');

  if (!dateValue) return '';

  // Intentar parsear como fecha ISO o timestamp numérico
  const dateObj = new Date(dateValue);
  if (!Number.isNaN(dateObj.getTime())) {
    return dateObj.toLocaleString('es-CO', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  // Fallback si era una cadena ya preformateada heredada
  if (typeof recordOrDate === 'object' && recordOrDate.date) {
    return recordOrDate.date;
  }

  return dateValue;
}
