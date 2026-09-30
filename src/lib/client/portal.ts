/**
 * Moves the node to <body> so `position: fixed` overlays escape ancestors that
 * create a containing block (transform, filter, backdrop-filter, contain).
 */
export function portal(node: HTMLElement) {
	document.body.appendChild(node);
	return { destroy: () => node.remove() };
}
