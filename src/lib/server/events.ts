import type { ServerEvents, Toast, ToastLevel } from '$lib/types';

type Handler = <K extends keyof ServerEvents>(event: K, data: ServerEvents[K]) => void;

class Bus {
	private handlers = new Set<Handler>();

	emit<K extends keyof ServerEvents>(event: K, data: ServerEvents[K]) {
		for (const h of this.handlers) {
			try {
				h(event, data);
			} catch (err) {
				console.error('[bus] handler failed', err);
			}
		}
	}

	subscribe(handler: Handler) {
		this.handlers.add(handler);
		return () => this.handlers.delete(handler);
	}

	toast(level: ToastLevel, title: string, message?: string, href?: string) {
		const toast: Toast = { id: crypto.randomUUID(), level, title, message, href };
		this.emit('toast', toast);
	}
}

declare global {
	var __calliope_bus__: Bus | undefined;
}

export const bus = (globalThis.__calliope_bus__ ??= new Bus());
