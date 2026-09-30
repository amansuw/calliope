export function bytes(n: number | null | undefined, digits = 1): string {
	if (n == null || !Number.isFinite(n)) return '—';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let i = 0;
	let v = n;
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024;
		i++;
	}
	return `${v.toFixed(i === 0 ? 0 : digits)} ${units[i]}`;
}

export function rate(bps: number | null | undefined): string {
	if (!bps) return '0 KB/s';
	return `${bytes(bps, bps > 1024 * 1024 ? 2 : 0)}/s`;
}

export function duration(ms: number | null | undefined): string {
	if (!ms) return '—';
	const s = Math.round(ms / 1000);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = String(s % 60).padStart(2, '0');
	return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function eta(sec: number | null | undefined): string {
	if (sec == null) return '—';
	if (sec < 60) return `${Math.round(sec)}s`;
	return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' });

export function ago(ts: number | null | undefined, now = Date.now()): string {
	if (!ts) return 'never';
	const diff = (ts - now) / 1000;
	const abs = Math.abs(diff);
	if (abs < 45) return diff < 0 ? 'just now' : 'in a moment';
	if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
	if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
	return rtf.format(Math.round(diff / 86400), 'day');
}

export function clock(ts: number | null | undefined): string {
	if (!ts) return '—';
	return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function plural(n: number, word: string, pluralWord = `${word}s`) {
	return `${n.toLocaleString()} ${n === 1 ? word : pluralWord}`;
}
