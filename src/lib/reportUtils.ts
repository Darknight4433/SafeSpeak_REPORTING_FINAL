import { ref, get, set } from 'firebase/database';
import { database } from './firebase';

export async function getNextReportNumber(): Promise<number> {
  try {
    const counterRef = ref(database, 'reportCounter');
    const snapshot = await get(counterRef);
    const currentCount = snapshot.val() || 0;
    const nextCount = currentCount + 1;
    await set(counterRef, nextCount);
    try {
      localStorage.setItem('ss_last_report_num', String(nextCount));
    } catch {}
    return nextCount;
  } catch (error) {
    console.warn('Could not update reportCounter in Firebase, using fallback counter:', error);
    try {
      const local = parseInt(localStorage.getItem('ss_last_report_num') || '0', 10);
      const nextLocal = Math.max(local + 1, Math.floor(Date.now() / 1000) % 100000);
      localStorage.setItem('ss_last_report_num', String(nextLocal));
      return nextLocal;
    } catch {
      return Math.floor(Date.now() / 1000) % 100000;
    }
  }
}

export function formatReportId(reportNumber: number): string {
  return `no${reportNumber}`;
}

export function parseReportId(reportId: string): number {
  return parseInt(reportId.replace('no', ''), 10);
}

/**
 * Recursively cleans any object before sending to Firebase Realtime Database.
 * Replaces undefined values with null and preserves serverTimestamp sentinel objects { '.sv': 'timestamp' }.
 */
export function sanitizeForFirebase<T>(obj: T): T {
  if (obj === undefined) return null as any;
  if (obj === null || typeof obj !== 'object') return obj;
  if ((obj as any)['.sv']) return obj;
  if (Array.isArray(obj)) {
    return obj.map(sanitizeForFirebase) as any;
  }
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) {
      result[key] = null;
    } else {
      result[key] = sanitizeForFirebase(value);
    }
  }
  return result as any;
}
