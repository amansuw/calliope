import type { Toast } from '$lib/types';

class Toasts {
	items = $state<(Toast & { expires: number })[]>([]);

	push(t: Omit<Toast, 'id'> & { id?: string }, ttl = t.level === 'error' ? 9000 : 5000) {
		const toast = { ...t, id: t.id ?? crypto.randomUUID(), expires: Date.now() + ttl };
		this.items = [...this.items.slice(-4), toast];
		setTimeout(() => this.dismiss(toast.id), ttl);
	}

	dismiss(id: string) {
		this.items = this.items.filter((t) => t.id !== id);
	}
}

export const toasts = new Toasts();
