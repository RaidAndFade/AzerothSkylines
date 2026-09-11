/** The opening screen: name a valley, or carry on with a saved city. */
import { el, button } from './dom';

export interface TitleOptions {
  hasSave: boolean;
  onStart(seed: string): void;
  onContinue(): void;
}

export function createTitleScreen(options: TitleOptions): HTMLElement {
  const seedInput = el('input', {
    type: 'text',
    placeholder: 'Name your valley',
    value: randomValleyName(),
    autocomplete: 'off',
    autocapitalize: 'words',
    spellcheck: 'false',
  }) as HTMLInputElement;

  const start = button('action', () => options.onStart(seedInput.value.trim() || randomValleyName()), 'Found a settlement');

  const controls = el(
    'div',
    { class: 'controls' },
    seedInput,
    start,
    options.hasSave ? button('action secondary', () => options.onContinue(), 'Continue your city') : null,
  );

  const screen = el(
    'div',
    { id: 'title' },
    el('h1', { text: 'AZEROTH SKYLINES' }),
    el('p', {
      class: 'tagline',
      text:
        'A road runs into Elwynn Forest and stops. Lay out streets, zone the land, sink wells, raise the curtain wall, and grow a hamlet into a city worthy of Stormwind.',
    }),
    controls,
    el('p', {
      class: 'hint',
      text: 'One finger drags the map or draws with a tool. Two fingers pinch to zoom. Every valley name grows a different valley.',
    }),
  );

  seedInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') start.click();
  });

  return screen;
}

const FIRST = ['North', 'Gold', 'Elwynn', 'Stone', 'West', 'Raven', 'Brack', 'Lion', 'Thorn', 'Crystal', 'Amber', 'Duskwood'];
const SECOND = ['shire', 'brook', 'vale', 'ford', 'hollow', 'marsh', 'watch', 'reach', 'crest', 'fall', 'mere', 'wood'];

export function randomValleyName(): string {
  const first = FIRST[Math.floor(Math.random() * FIRST.length)];
  const second = SECOND[Math.floor(Math.random() * SECOND.length)];
  return `${first}${second}`;
}
