/**
 * The heads-up display: top bar, demand meter, toolbar and sliding panel.
 *
 * The HUD owns no game state. It is handed the city each frame and calls
 * back into the host for anything that changes the world.
 */
import {
  ALL_GOODS,
  ALL_SERVICES,
  Building,
  GOOD_LABELS,
  MONTH_NAMES,
  RoadType,
  SERVICE_LABELS,
  Zone,
} from '../sim/types';
import {
  CityState,
  ROAD_NAMES,
  buildingCenter,
  markJournalRead,
  tileIndex,
  unreadJournalCount,
} from '../sim/city';
import { PLACEABLE_DEFS, getDef } from '../data/buildings';
import { ToolKind, ToolState, toolHint } from './tools';
import { Overlay } from '../render/renderer';
import { append, button, clear, compact, el, gold, percent, statRow } from './dom';
import { quoteParcel } from '../sim/build';
import { wallStats } from '../sim/walls';

export type PanelId = 'build' | 'budget' | 'city' | 'journal' | 'building' | 'land' | 'overlays' | 'menu' | 'guide';

/** The panels Tab walks through, in the order the toolbar offers them. */
const PANEL_CYCLE: PanelId[] = ['build', 'overlays', 'budget', 'journal', 'city', 'menu'];

export interface HudCallbacks {
  onToolChange(tool: Partial<ToolState> & { kind: ToolKind }): void;
  onSpeedChange(speed: number): void;
  onOverlayChange(overlay: Overlay): void;
  onTaxChange(zone: Zone, rate: number): void;
  onBuyParcel(px: number, py: number): void;
  onNewCity(): void;
  onSave(): void;
  onLoad(): void;
  onToggleZones(): void;
  onToggleEdgeScroll(enabled: boolean): void;
  onFocusBuilding(building: Building): void;
}

const TOOLS: { kind: ToolKind; glyph: string; label: string; extra?: Partial<ToolState>; className?: string }[] = [
  { kind: 'inspect', glyph: '\u{1F50D}', label: 'Inspect' },
  { kind: 'road', glyph: '\u{1F6E3}', label: 'Roads' },
  { kind: 'zone', glyph: '\u{1F3E0}', label: 'Dwellings', extra: { zone: Zone.Residential }, className: 'residential' },
  { kind: 'zone', glyph: '\u{1F3EA}', label: 'Trade', extra: { zone: Zone.Commercial }, className: 'commercial' },
  { kind: 'zone', glyph: '⚒', label: 'Crafting', extra: { zone: Zone.Industrial }, className: 'industrial' },
  { kind: 'zone', glyph: '\u{1F9F9}', label: 'Dezone', extra: { zone: Zone.None } },
  { kind: 'build', glyph: '\u{1F3DB}', label: 'Build' },
  { kind: 'land', glyph: '\u{1F5FA}', label: 'Land' },
  { kind: 'demolish', glyph: '\u{1F528}', label: 'Raze' },
];

const OVERLAYS: { id: Overlay; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'water', label: 'Water' },
  { id: 'sewage', label: 'Drainage' },
  { id: 'safety', label: 'Protection' },
  { id: 'faith', label: 'The Light' },
  { id: 'leisure', label: 'Merriment' },
  { id: 'commerce', label: 'Commerce' },
  { id: 'landValue', label: 'Land Value' },
  { id: 'pollution', label: 'Filth' },
  { id: 'land', label: 'Lots for Sale' },
];

/** "1 gate", "3 gates" — small thing, but the HUD is read constantly. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** "Bloomrise 24", the calendar the rest of the HUD shows. */
function monthAndYear(month: number, year: number): string {
  return `${MONTH_NAMES[(month - 1) % 12]} ${year}`;
}

export class Hud {
  readonly root: HTMLElement;
  private readonly callbacks: HudCallbacks;

  private readonly stats = {
    gold: el('span', { class: 'value', text: '0g' }),
    goldDelta: el('span', { class: 'delta' }),
    population: el('span', { class: 'value', text: '0' }),
    happiness: el('span', { class: 'value', text: '—' }),
    date: el('span', { class: 'value', text: '' }),
  };

  private readonly demandBars = {
    residential: el('span'),
    commercial: el('span'),
    industrial: el('span'),
  };

  private readonly speedButtons: HTMLButtonElement[] = [];
  private readonly toolButtons: { node: HTMLButtonElement; kind: ToolKind; extra?: Partial<ToolState> }[] = [];

  private readonly panel: HTMLElement;
  private readonly panelTitle: HTMLElement;
  private readonly panelBody: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly hint: HTMLElement;

  /** Unread-bad-news marker on the Chronicle button; hidden when empty. */
  private readonly journalBadge = el('span', { class: 'badge', hidden: true });

  private openPanel: PanelId | null = null;
  private toastTimer = 0;
  private lastJournalLength = -1;
  private lastUnreadBad = -1;
  private selectedBuilding: Building | null = null;
  private landSelection: { px: number; py: number } | null = null;
  private currentTool: ToolState;
  private currentOverlay: Overlay = 'none';
  private showZones = true;
  private edgeScroll = false;

  constructor(root: HTMLElement, tool: ToolState, callbacks: HudCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this.currentTool = tool;

    root.appendChild(this.buildTopBar());
    root.appendChild(this.buildSpeedControl());
    root.appendChild(this.buildDemandMeter());
    root.appendChild(this.buildToolbar());

    this.panelTitle = el('h2', { text: '' });
    this.panelBody = el('div', { class: 'panel-body' });
    this.panel = el(
      'div',
      { id: 'panel' },
      el('div', { class: 'panel-grip' }),
      el(
        'div',
        { class: 'panel-head' },
        this.panelTitle,
        button('icon-button', () => this.closePanel(), '✕'),
      ),
      this.panelBody,
    );
    root.appendChild(this.panel);

    this.toast = el('div', { id: 'toast' });
    root.appendChild(this.toast);

    this.hint = el('div', { id: 'hint' });
    root.appendChild(this.hint);
  }

  // --- construction ---------------------------------------------------------

  private buildSpeedControl(): HTMLElement {
    const speed = el('div', { id: 'speed' });
    const labels = ['⏸', '▶', '⏩', '⏭'];
    for (let i = 0; i < labels.length; i++) {
      const node = button(i === 1 ? 'active' : '', () => this.callbacks.onSpeedChange(i), labels[i]);
      node.title = ['Pause', 'Normal', 'Fast', 'Very fast'][i];
      this.speedButtons.push(node);
      speed.appendChild(node);
    }
    return speed;
  }

  private buildTopBar(): HTMLElement {
    return el(
      'header',
      { id: 'topbar' },
      el('div', { class: 'stat gold' }, el('span', { class: 'icon', text: '\u{1FA99}' }), this.stats.gold, this.stats.goldDelta),
      el('div', { class: 'stat' }, el('span', { class: 'icon', text: '\u{1F465}' }), this.stats.population),
      el('div', { class: 'stat' }, el('span', { class: 'icon', text: '✨' }), this.stats.happiness),
      el('div', { class: 'stat date' }, this.stats.date),
      el('div', { class: 'spacer' }),
      button('icon-button', () => this.togglePanel('menu'), '☰'),
    );
  }

  private buildDemandMeter(): HTMLElement {
    const bar = (key: 'residential' | 'commercial' | 'industrial', color: string, label: string) => {
      const fill = this.demandBars[key];
      fill.style.background = color;
      fill.style.height = '0%';
      return el('div', { class: 'demand-bar', title: label }, fill, el('span', { class: 'label', text: label[0] }));
    };

    const meter = el(
      'div',
      { id: 'demand' },
      bar('residential', 'var(--residential)', 'Dwellings'),
      bar('commercial', 'var(--commercial)', 'Trade'),
      bar('industrial', 'var(--industrial)', 'Crafting'),
    );
    meter.addEventListener('click', () => this.togglePanel('city'));
    return meter;
  }

  private buildToolbar(): HTMLElement {
    const bar = el('footer', { id: 'toolbar' });
    for (const entry of TOOLS) {
      const node = button(
        `tool ${entry.className ?? ''}`,
        () => this.selectTool(entry.kind, entry.extra),
        el('span', { class: 'glyph', text: entry.glyph }),
        el('span', { text: entry.label }),
      );
      this.toolButtons.push({ node, kind: entry.kind, extra: entry.extra });
      bar.appendChild(node);
    }

    bar.appendChild(
      button(
        'tool',
        () => this.togglePanel('overlays'),
        el('span', { class: 'glyph', text: '\u{1F5FA}' }),
        el('span', { text: 'Views' }),
      ),
    );
    bar.appendChild(
      button(
        'tool',
        () => this.togglePanel('budget'),
        el('span', { class: 'glyph', text: '\u{1F4DC}' }),
        el('span', { text: 'Treasury' }),
      ),
    );
    bar.appendChild(
      button(
        'tool',
        () => this.togglePanel('journal'),
        el('span', { class: 'glyph', text: '\u{1F4D6}' }),
        el('span', { text: 'Chronicle' }),
        this.journalBadge,
      ),
    );
    return bar;
  }

  // --- tool selection -------------------------------------------------------

  /** Pick a tool exactly as tapping its toolbar button would. */
  selectTool(kind: ToolKind, extra?: Partial<ToolState>): void {
    this.currentTool = { ...this.currentTool, ...extra, kind };
    this.callbacks.onToolChange({ ...extra, kind });
    this.refreshToolButtons();

    if (kind === 'build') this.togglePanel('build', true);
    else if (kind === 'road') this.togglePanel('build', true);
    else if (this.openPanel === 'build') this.closePanel();

    this.showHint(toolHint(this.currentTool));
  }

  setTool(tool: ToolState): void {
    this.currentTool = tool;
    this.refreshToolButtons();
  }

  private refreshToolButtons(): void {
    for (const entry of this.toolButtons) {
      const matches =
        entry.kind === this.currentTool.kind &&
        (entry.extra?.zone === undefined || entry.extra.zone === this.currentTool.zone);
      entry.node.classList.toggle('active', matches);
    }
  }

  setSpeed(speed: number): void {
    this.speedButtons.forEach((node, index) => node.classList.toggle('active', index === speed));
  }

  // --- per-frame refresh ----------------------------------------------------

  update(city: CityState): void {
    const budget = city.budget;
    this.stats.gold.textContent = gold(budget.gold);

    const net = budget.lastIncome + budget.lastTrade - budget.lastUpkeep;
    if (Math.abs(net) > 0.5) {
      this.stats.goldDelta.textContent = `${net > 0 ? '+' : ''}${compact(net)}`;
      this.stats.goldDelta.className = `delta ${net >= 0 ? 'up' : 'down'}`;
    } else {
      this.stats.goldDelta.textContent = '';
    }

    this.stats.population.textContent = compact(city.stats.population);
    this.stats.happiness.textContent = percent(city.stats.happiness);
    this.stats.date.textContent = monthAndYear(city.clock.month, city.clock.year);

    this.demandBars.residential.style.height = `${city.demand.residential * 100}%`;
    this.demandBars.commercial.style.height = `${city.demand.commercial * 100}%`;
    this.demandBars.industrial.style.height = `${city.demand.industrial * 100}%`;

    if (this.openPanel === 'city' || this.openPanel === 'budget' || this.openPanel === 'building') {
      this.renderPanel(city);
    }
    if (city.journal.length !== this.lastJournalLength) {
      this.lastJournalLength = city.journal.length;
      if (this.openPanel === 'journal') this.renderPanel(city);
    }

    // Badge the Chronicle with unread bad news, so something going wrong is
    // visible without opening the panel to look for it.
    const unread = this.openPanel === 'journal' ? 0 : unreadJournalCount(city, 'bad');
    if (unread !== this.lastUnreadBad) {
      this.lastUnreadBad = unread;
      this.journalBadge.textContent = unread > 9 ? '9+' : String(unread);
      this.journalBadge.hidden = unread === 0;
    }
  }

  // --- panels ---------------------------------------------------------------

  private city: CityState | null = null;

  attachCity(city: CityState): void {
    this.city = city;
  }

  togglePanel(id: PanelId, forceOpen = false): void {
    if (this.openPanel === id && !forceOpen) {
      this.closePanel();
      return;
    }
    this.openPanel = id;
    this.panel.classList.add('open');
    if (this.city) this.renderPanel(this.city);
  }

  closePanel(): void {
    this.openPanel = null;
    this.panel.classList.remove('open');
  }

  get panelIsOpen(): boolean {
    return this.openPanel !== null;
  }

  /** Tab: step to the next panel, starting from the first when none is open. */
  cyclePanel(): void {
    const index = this.openPanel === null ? -1 : PANEL_CYCLE.indexOf(this.openPanel);
    this.togglePanel(PANEL_CYCLE[(index + 1) % PANEL_CYCLE.length], true);
  }

  selectBuilding(building: Building | null): void {
    this.selectedBuilding = building;
    if (building) this.togglePanel('building', true);
    else if (this.openPanel === 'building') this.closePanel();
  }

  selectParcel(px: number, py: number): void {
    this.landSelection = { px, py };
    this.togglePanel('land', true);
  }

  private renderPanel(city: CityState): void {
    if (!this.openPanel) return;
    const body = this.panelBody;
    const scroll = body.scrollTop;
    clear(body);

    switch (this.openPanel) {
      case 'build':
        this.panelTitle.textContent = this.currentTool.kind === 'road' ? 'Roads' : 'Build';
        if (this.currentTool.kind === 'road') this.renderRoads(body);
        else this.renderCatalogue(city, body);
        break;
      case 'budget':
        this.panelTitle.textContent = 'Treasury';
        this.renderBudget(city, body);
        break;
      case 'city':
        this.panelTitle.textContent = 'The City';
        this.renderCityReport(city, body);
        break;
      case 'journal':
        this.panelTitle.textContent = 'Chronicle';
        this.renderJournal(city, body);
        break;
      case 'building':
        this.panelTitle.textContent = this.selectedBuilding ? getDef(this.selectedBuilding.defId).name : 'Nothing here';
        this.renderBuilding(city, body);
        break;
      case 'land':
        this.panelTitle.textContent = 'Annex Land';
        this.renderLand(city, body);
        break;
      case 'overlays':
        this.panelTitle.textContent = 'Views';
        this.renderOverlays(body);
        break;
      case 'menu':
        this.panelTitle.textContent = 'Azeroth Skylines';
        this.renderMenu(body);
        break;
      case 'guide':
        this.panelTitle.textContent = 'Founding a Settlement';
        this.renderGuide(body);
        break;
      default:
        break;
    }
    body.scrollTop = scroll;
  }

  private renderRoads(body: HTMLElement): void {
    const list = el('div', { class: 'card-list' });
    const roads: { type: RoadType; cost: number; blurb: string }[] = [
      { type: RoadType.Path, cost: 4, blurb: 'Packed dirt, and the quickest way to walk. No carts, and no water or drainage beneath it.' },
      { type: RoadType.Cobble, cost: 14, blurb: 'The workhorse street. Carries carts and utilities.' },
      { type: RoadType.Avenue, cost: 38, blurb: 'Broad flagstones. Faster traffic, finer address.' },
    ];
    for (const road of roads) {
      const card = button(
        `card ${this.currentTool.roadType === road.type ? 'selected' : ''}`,
        () => {
          this.currentTool = { ...this.currentTool, kind: 'road', roadType: road.type };
          this.callbacks.onToolChange({ kind: 'road', roadType: road.type });
          this.refreshToolButtons();
          if (this.city) this.renderPanel(this.city);
        },
        el('span', { class: 'name', text: ROAD_NAMES[road.type] }),
        el('span', { class: 'cost', text: `${road.cost}g per tile` }),
        el('span', { class: 'blurb', text: road.blurb }),
      );
      list.appendChild(card);
    }
    append(body, [
      el('div', { class: 'section-title', text: 'Streets' }),
      list,
      el('div', {
        class: 'blurb',
        style: 'margin-top:10px',
        text: 'Streets carry water and drainage beneath the cobbles, so utilities only reach buildings that front a road.',
      }),
    ]);
  }

  private renderCatalogue(city: CityState, body: HTMLElement): void {
    const groups: { title: string; ids: string[] }[] = [
      { title: 'Water & Drainage', ids: ['well', 'cistern', 'reservoir', 'cesspit', 'canal', 'sewerworks'] },
      { title: 'The Guard', ids: ['guardpost', 'barracks', 'garrison'] },
      { title: 'The Light', ids: ['shrine', 'chapel', 'cathedral'] },
      { title: 'Merriment', ids: ['garden', 'fountain', 'inn', 'tourney', 'keep'] },
      { title: 'Trade with the World', ids: ['market', 'caravanserai', 'docks'] },
    ];

    for (const group of groups) {
      const list = el('div', { class: 'card-list' });
      for (const id of group.ids) {
        const def = PLACEABLE_DEFS.find((entry) => entry.id === id);
        if (!def) continue;
        const locked = def.unlockPopulation !== undefined && city.stats.population < def.unlockPopulation;
        const affordable = city.budget.gold >= def.cost;
        const card = button(
          `card ${this.currentTool.buildDefId === def.id ? 'selected' : ''} ${locked ? 'locked' : ''}`,
          () => {
            if (locked) {
              this.showToast(`Needs ${def.unlockPopulation} citizens`, 'bad');
              return;
            }
            this.currentTool = { ...this.currentTool, kind: 'build', buildDefId: def.id };
            this.callbacks.onToolChange({ kind: 'build', buildDefId: def.id });
            this.refreshToolButtons();
            this.showHint(`${def.name} — tap a plot beside a road`);
            if (this.city) this.renderPanel(this.city);
          },
          el('span', { class: 'name', text: def.name }),
          el('span', {
            class: 'cost',
            text: `${gold(def.cost)}${def.upkeep ? ` · ${def.upkeep}g/mo` : ''}`,
            style: affordable ? '' : 'color:var(--bad)',
          }),
          el('span', { class: 'blurb', text: def.description }),
          locked ? el('span', { class: 'tag', text: `Needs ${def.unlockPopulation} folk` }) : null,
          def.requiresWaterAdjacency ? el('span', { class: 'tag', text: 'Waterside' }) : null,
          def.requiresMapEdge ? el('span', { class: 'tag', text: 'Road to the world' }) : null,
        );
        list.appendChild(card);
      }
      if (list.childElementCount === 0) continue;
      append(body, [el('div', { class: 'section-title', text: group.title }), list]);
    }
  }

  private renderBudget(city: CityState, body: HTMLElement): void {
    const budget = city.budget;
    const net = budget.lastIncome + budget.lastTrade - budget.lastUpkeep;

    const taxRow = (label: string, zone: Zone, rate: number) => {
      const value = el('span', { class: 'val', text: percent(rate) });
      const slider = el('input', {
        type: 'range',
        min: '0',
        max: '35',
        step: '1',
        value: String(Math.round(rate * 100)),
      }) as HTMLInputElement;
      slider.addEventListener('input', () => {
        const next = Number(slider.value) / 100;
        value.textContent = percent(next);
        this.callbacks.onTaxChange(zone, next);
      });
      return el('div', { class: 'slider-row' }, el('label', { text: label }), slider, value);
    };

    append(body, [
      el('div', { class: 'section-title', text: 'Last Month' }),
      el(
        'div',
        { class: 'rows' },
        statRow('Taxes', gold(budget.lastIncome)),
        statRow('Trade', gold(budget.lastTrade)),
        statRow('Upkeep', budget.lastUpkeep > 0.5 ? `-${gold(budget.lastUpkeep)}` : gold(0)),
        statRow('Net', `${net >= 0 ? '+' : ''}${gold(net)}`),
        statRow('Treasury', gold(budget.gold)),
      ),
      el('div', { class: 'section-title', text: 'Tithes' }),
      taxRow('Dwellings', Zone.Residential, budget.taxRateResidential),
      taxRow('Trade', Zone.Commercial, budget.taxRateCommercial),
      taxRow('Crafting', Zone.Industrial, budget.taxRateIndustrial),
      el('div', {
        class: 'blurb',
        style: 'margin-top:8px',
        text: 'A tithe of one in ten is expected. Beyond that, folk grumble and then leave.',
      }),
    ]);
  }

  private renderCityReport(city: CityState, body: HTMLElement): void {
    const stats = city.stats;
    const walls = wallStats(city);

    const serviceRows = ALL_SERVICES.map((service) =>
      statRow(SERVICE_LABELS[service], percent(stats.services[service]), stats.services[service]),
    );

    const goodsRows = ALL_GOODS.map((good) =>
      statRow(
        GOOD_LABELS[good],
        `${compact(stats.goodsProduced[good])} made · ${compact(stats.goodsConsumed[good])} used · ${compact(stats.stockpile[good])} stored`,
      ),
    );

    append(body, [
      el('div', { class: 'section-title', text: 'The People' }),
      el(
        'div',
        { class: 'rows' },
        statRow('Date', `${MONTH_NAMES[(city.clock.month - 1) % 12]}, year ${city.clock.year}`),
        statRow('Citizens', compact(stats.population)),
        statRow('Housing', compact(stats.housingCapacity)),
        statRow('Contentment', percent(stats.happiness), stats.happiness),
        statRow('Work', `${compact(stats.employed)} of ${compact(stats.jobs)} posts`),
        statRow('Idle hands', percent(stats.unemployment)),
        statRow('Travellers', compact(stats.travelers)),
      ),
      el('div', { class: 'section-title', text: 'Services' }),
      el('div', { class: 'rows' }, ...serviceRows),
      el('div', { class: 'section-title', text: 'Land' }),
      el(
        'div',
        { class: 'rows' },
        statRow('Land value', percent(stats.landValue), stats.landValue),
        statRow('Filth', percent(stats.pollution), stats.pollution),
        statRow('Buildings', `${compact(stats.buildingCount)} (${stats.abandonedCount} derelict)`),
        statRow(
          'City wall',
          `${plural(walls.walls + walls.towers, 'length')} · ${plural(walls.towers, 'tower')} · ${plural(walls.gates, 'gate')}`,
        ),
      ),
      el('div', { class: 'section-title', text: 'Goods' }),
      el('div', { class: 'rows' }, ...goodsRows),
    ]);
  }

  private renderJournal(city: CityState, body: HTMLElement): void {
    const list = el('div', { class: 'journal' });
    for (const entry of city.journal) {
      const row = el(
        'div',
        { class: `journal-entry ${entry.tone}${entry.unread ? ' unread' : ''}` },
        el('span', { class: 'when', text: monthAndYear(entry.month, entry.year) }),
        entry.text,
      );
      row.title = `Day ${entry.day}`;
      list.appendChild(row);
    }
    if (city.journal.length === 0) {
      list.appendChild(el('div', { class: 'journal-entry', text: 'Nothing of note has happened yet.' }));
    }
    body.appendChild(list);
    // Rendered is read: the badge clears as soon as the player looks.
    markJournalRead(city);
  }

  private renderBuilding(city: CityState, body: HTMLElement): void {
    const building = this.selectedBuilding;
    if (!building) {
      body.appendChild(el('div', { class: 'blurb', text: 'Tap a building to inspect it.' }));
      return;
    }
    // The building may have been demolished since it was selected.
    const live = city.buildings.get(building.id);
    if (!live) {
      body.appendChild(el('div', { class: 'blurb', text: 'This building is gone.' }));
      return;
    }

    const def = getDef(live.defId);
    const index = tileIndex(city, live.x, live.y);
    const rows: HTMLElement[] = [statRow('Contentment', percent(live.happiness), live.happiness)];

    if (def.residents) rows.push(statRow('Residents', `${live.residents} of ${def.residents}`));
    if (def.jobs) rows.push(statRow('Workers', `${live.workers} of ${def.jobs}`));
    if (def.produces || def.consumes) rows.push(statRow('Supplied', percent(live.supplyRatio), live.supplyRatio));
    rows.push(statRow('Land value', percent(city.landValue[index]), city.landValue[index]));
    rows.push(statRow('Filth', percent(city.pollution[index]), city.pollution[index]));
    rows.push(statRow('Road access', live.connected ? 'Yes' : 'None'));
    rows.push(statRow('Behind the walls', live.protected ? 'Yes' : 'No'));
    if (live.abandoned) rows.push(statRow('State', 'Derelict'));

    const stockEntries = ALL_GOODS.filter((good) => (live.stock[good] ?? 0) > 0.05).map((good) =>
      statRow(GOOD_LABELS[good], (live.stock[good] ?? 0).toFixed(1)),
    );

    const serviceEntries = ALL_SERVICES.map((service) =>
      statRow(SERVICE_LABELS[service], percent(city.coverage[service][index]), city.coverage[service][index]),
    );

    append(body, [
      el('div', { class: 'blurb', text: def.description }),
      el('div', { class: 'section-title', text: 'Condition' }),
      el('div', { class: 'rows' }, ...rows),
      el('div', { class: 'section-title', text: 'Services Reaching Here' }),
      el('div', { class: 'rows' }, ...serviceEntries),
      stockEntries.length > 0 ? el('div', { class: 'section-title', text: 'In Store' }) : null,
      stockEntries.length > 0 ? el('div', { class: 'rows' }, ...stockEntries) : null,
      button('action secondary', () => this.callbacks.onFocusBuilding(live), 'Centre the view here'),
    ]);
  }

  private renderLand(city: CityState, body: HTMLElement): void {
    if (!this.landSelection) {
      append(body, [
        el('div', {
          class: 'blurb',
          text: 'Tap a lot beyond the walls to see what the Crown asks for it. Buying a lot pushes the curtain wall out to enclose it.',
        }),
      ]);
      return;
    }

    const { px, py } = this.landSelection;
    const quote = quoteParcel(city, px, py);
    const affordable = quote.ok && city.budget.gold >= quote.total;

    append(body, [
      el('div', { class: 'section-title', text: `Lot ${px + 1}, ${py + 1}` }),
      quote.ok
        ? el(
            'div',
            { class: 'rows' },
            statRow('Land', gold(quote.land)),
            statRow('Masonry', gold(quote.masonry)),
            statRow('Total', gold(quote.total)),
            statRow('Treasury', gold(city.budget.gold)),
          )
        : el('div', { class: 'blurb', text: quote.reason ?? 'This land is not for sale.' }),
      quote.ok
        ? el('div', {
            class: 'blurb',
            style: 'margin-top:8px',
            text: 'The masonry bill covers only the new stonework. Walls made interior by the purchase are pulled down at no charge.',
          })
        : null,
      (() => {
        const action = button('action', () => this.callbacks.onBuyParcel(px, py), affordable ? 'Annex this lot' : 'Not enough gold');
        action.disabled = !affordable;
        return action;
      })(),
    ]);
  }

  private renderOverlays(body: HTMLElement): void {
    const chips = el('div', { class: 'chip-row' });
    for (const overlay of OVERLAYS) {
      chips.appendChild(
        button(`chip ${this.currentOverlay === overlay.id ? 'active' : ''}`, () => {
          this.currentOverlay = overlay.id;
          this.callbacks.onOverlayChange(overlay.id);
          if (this.city) this.renderPanel(this.city);
        }, overlay.label),
      );
    }

    append(body, [
      el('div', { class: 'section-title', text: 'Map View' }),
      chips,
      el('div', { class: 'section-title', text: 'Display' }),
      button(`chip ${this.showZones ? 'active' : ''}`, () => {
        this.showZones = !this.showZones;
        this.callbacks.onToggleZones();
        if (this.city) this.renderPanel(this.city);
      }, this.showZones ? 'Zoning paint: shown' : 'Zoning paint: hidden'),
    ]);
  }

  /** Shown once when a new city is founded, and from the menu thereafter. */
  private renderGuide(body: HTMLElement): void {
    const steps: [string, string][] = [
      [
        'Lay a street',
        'The king\u2019s road ends inside your walls. Pick \u201cRoads\u201d and drag a cobbled street off it. Streets are laid in an L from where the drag began.',
      ],
      [
        'Zone beside it',
        'Pick \u201cDwellings\u201d and drag a rectangle along the street. Buildings only grow on zoned land that fronts a road, so leave no plot more than one tile from the cobbles.',
      ],
      [
        'Sink a well, dig a drain',
        'Water and drainage run beneath the streets, so both reach any building whose door is on a road. One well serves fourteen buildings; watch the Views map to see how far it reaches.',
      ],
      [
        'Give them work and a market',
        'Zone \u201cCrafting\u201d for workshops and \u201cTrade\u201d for shops. Keep the forges downwind: smoke drives land value down, and with it the chance of anyone building in stone.',
      ],
      [
        'Post the guard',
        'A Guard Post makes a quarter feel safe, which is worth as much to your citizens as clean water. Shrines, gardens and an inn do the rest.',
      ],
      [
        'Buy the next lot',
        'When the district fills, pick \u201cLand\u201d and tap a lot beyond the walls. You pay for the ground and for the new stonework, and the curtain wall moves out to enclose it.',
      ],
    ];

    append(body, [
      el('div', {
        class: 'blurb',
        text: 'A road runs into the valley and stops. What follows is yours.',
      }),
      ...steps.flatMap(([title, text], index) => [
        el('div', { class: 'section-title', text: `${index + 1}. ${title}` }),
        el('div', { class: 'blurb', text }),
      ]),
      button('action', () => this.closePanel(), 'Begin'),
    ]);
  }

  private renderMenu(body: HTMLElement): void {
    append(body, [
      el('div', {
        class: 'blurb',
        text: 'A city builder set in Elwynn Forest. Grow a settlement from the king’s road into a walled city in the manner of Stormwind.',
      }),
      button('action secondary', () => this.togglePanel('guide', true), 'How to found a settlement'),
      el('div', { class: 'section-title', text: 'Your City' }),
      button('action secondary', () => this.callbacks.onSave(), 'Save to this device'),
      button('action secondary', () => this.callbacks.onLoad(), 'Load saved city'),
      button('action secondary', () => this.callbacks.onNewCity(), 'Found a new city'),
      el('div', { class: 'section-title', text: 'Controls' }),
      el('div', {
        class: 'blurb',
        html:
          'One finger drags the map, or draws while a tool is held. Two fingers pinch to zoom and move.<br>' +
          'With a mouse, the <b>right</b> or <b>middle</b> button drags the map whatever tool is held, and a ' +
          '<b>right click</b> puts the tool down. A wheel notch zooms; a two-finger trackpad scroll moves the map, ' +
          'and <b>Ctrl</b>+scroll or a pinch zooms.',
      }),
      el('div', {
        class: 'blurb',
        html:
          '<b>WASD</b> or the arrows scroll &middot; <b>Q</b>/<b>E</b> (or <b>[</b>/<b>]</b>) zoom &middot; ' +
          '<b>1</b>-<b>4</b> speed &middot; <b>Tab</b> next panel &middot; <b>Esc</b> or right click backs out<br>' +
          'Tools: <b>I</b> inspect &middot; <b>R</b> roads &middot; <b>Z</b> dwellings &middot; <b>T</b> trade &middot; ' +
          '<b>C</b> crafting &middot; <b>B</b> build &middot; <b>L</b> land &middot; <b>X</b> raze',
      }),
      button(`chip ${this.edgeScroll ? 'active' : ''}`, () => {
        this.edgeScroll = !this.edgeScroll;
        this.callbacks.onToggleEdgeScroll(this.edgeScroll);
        if (this.city) this.renderPanel(this.city);
      }, this.edgeScroll ? 'Edge scrolling: on' : 'Edge scrolling: off'),
    ]);
  }

  // --- transient feedback ---------------------------------------------------

  showToast(message: string, tone: 'good' | 'bad' | 'info' = 'info'): void {
    // The two share the bottom of the screen; a toast is the more urgent.
    this.hideHint();
    this.toast.textContent = message;
    this.toast.className = `show ${tone}`;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toast.className = '';
    }, 2200);
  }

  private hintTimer = 0;

  showHint(message: string): void {
    this.hint.textContent = message;
    this.hint.classList.add('show');
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => this.hint.classList.remove('show'), 4200);
  }

  hideHint(): void {
    this.hint.classList.remove('show');
  }

  /** Reflect the edge-scroll setting the host restored from storage. */
  setEdgeScroll(enabled: boolean): void {
    this.edgeScroll = enabled;
    if (this.city && this.openPanel === 'menu') this.renderPanel(this.city);
  }

  get zonesVisible(): boolean {
    return this.showZones;
  }

  get overlay(): Overlay {
    return this.currentOverlay;
  }
}

export { buildingCenter };
