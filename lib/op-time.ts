// Waktu untuk time entry OP. Sejak Okt 2026 instance OP mewajibkan `startTime` (DateTime) —
// tanpa itu POST /time_entries ditolak 422 "can't be blank". Semua dihitung dalam WIB (+07:00):
// tanggal UTC (toISOString().slice(0,10)) salah untuk kerja 00:00–07:00 WIB (jatuh ke kemarin).

const WIB_MS = 7 * 60 * 60 * 1000

/** Tanggal kalender WIB (YYYY-MM-DD) dari sebuah waktu (default: sekarang). */
export function wibDate(d: Date = new Date()): string {
  return new Date(d.getTime() + WIB_MS).toISOString().slice(0, 10)
}

/**
 * startTime untuk time entry OP. Pakai jam mulai ASLI kalau diketahui dan jatuh di hari `spentOn`
 * (timer, awal sesi); kalau tidak, 09:00 WIB di hari itu — bukan jam karangan saat data asli ada.
 */
export function opStartTime(spentOn: string, started?: string | Date | null): string {
  if (started) {
    const d = new Date(started)
    if (!isNaN(d.getTime())) {
      const w = new Date(d.getTime() + WIB_MS).toISOString()   // jam dinding WIB, ditulis seolah UTC
      if (w.slice(0, 10) === spentOn) return `${w.slice(0, 16)}:00+07:00`
    }
  }
  return `${spentOn}T09:00:00+07:00`
}
