/** Tiny DOM helpers, so the HUD code reads as structure rather than plumbing. */

type Attributes = Record<string, string | number | boolean | undefined>;
type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else node.setAttribute(key, String(value));
  }
  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function button(
  className: string,
  onClick: () => void,
  ...children: Child[]
): HTMLButtonElement {
  const node = el('button', { class: className, type: 'button' }, ...children);
  node.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return node;
}

/** A labelled row with a value, optionally with a 0..1 meter. */
export function statRow(key: string, value: string, meter?: number): HTMLElement {
  const children: Child[] = [el('span', { class: 'key', text: key })];
  if (meter !== undefined) {
    const fill = el('i');
    fill.style.width = `${Math.max(0, Math.min(1, meter)) * 100}%`;
    children.push(el('div', { class: 'meter' }, fill));
  }
  children.push(el('span', { class: 'val', text: value }));
  return el('div', { class: 'row' }, ...children);
}

/** Format a number of gold with thousands separators. */
export function gold(amount: number): string {
  return `${Math.round(amount).toLocaleString('en-GB')}g`;
}

export function percent(value: number, decimals = 0): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

export function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${(value / 1000).toFixed(1)}k`;
  return Math.round(value).toLocaleString('en-GB');
}
