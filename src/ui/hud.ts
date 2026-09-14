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
  MonthlyStatement,
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
import {
  ARREARS_GRACE,
  MONTHS_PER_YEAR,
  loanOffer,
  projectMonth,
  serviceAusterity,
  taxBase,
  upkeepByType,
} from '../sim/economy';
import { wallStats } from '../sim/walls';

export type PanelId = 'build' | 'budget' | 'city' | 'journal' | 'building' | 'land' | 'overlays' | 'menu' | 'guide';

/** The panels Tab walks through, in the order the toolbar offers them. */
const PANEL_CYCLE: PanelId[] = ['build', 'overlays', 'budget', 'journal', 'city', 'menu'];

/**
 * Panels showing figures that move as the city runs, and so are redrawn as it
 * does. The rest — the views, the menu, the guide — are drawn once when they
 * open and again only when something on them is pressed.
 */
const LIVE_PANELS: readonly PanelId[] = ['build', 'budget', 'city', 'journal', 'building', 'land'];

export interface HudCallbacks {
  onToolChange(tool: Partial<ToolState> & { kind: ToolKind }): void;
  onSpeedChange(speed: number): void;
  onOverlayChange(overlay: Overlay): void;
  onTaxChange(zone: Zone, rate: number): void;
  onTakeLoan(): void;
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

/** How long after a press the panel waits before it may redraw itself. */
export const PANEL_SETTLE_MS = 250;

/** "1 gate", "3 gates" — small thing, but the HUD is read constantly. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** "Bloomrise 24", the calendar the rest of the HUD shows. */
function monthAndYear(month: number, year: number): string {
  return `${MONTH_NAMES[(month - 1) % 12]} ${year}`;
}

/**
 * A line of the ledger: money in reads green and money out red, and the sign
 * is always shown, so a column of them can be skimmed for the one that hurts.
 */
function ledgerRow(key: string, amount: number, total = false): HTMLElement {
  const rounded = Math.round(amount);
  const tone = rounded > 0 ? 'good' : rounded < 0 ? 'bad' : '';
  const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : '';
  return el(
    'div',
    { class: `row${total ? ' total' : ''}` },
    el('span', { class: 'key', text: key }),
    el('span', { class: `val ${tone}`, text: `${sign}${gold(Math.abs(rounded))}` }),
  );
}

/** The zone totals of a statement, which are always wanted together. */
function totalTaxes(statement: MonthlyStatement): number {
  return statement.residentialTax + statement.commercialTax + statement.industrialTax;
}

function totalUpkeepOf(statement: MonthlyStatement): number {
  return statement.buildingUpkeep + statement.roadUpkeep + statement.wallUpkeep;
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
  private lastUnreadBad = -1;
  private selectedBuilding: Building | null = null;
  /** The panel's last drawn contents, so it is only rebuilt when they move. */
  private panelSignature = '';
  /** While a finger is on the panel — and briefly after — nothing is rebuilt. */
  private panelHeld = false;
  private panelSettlesAt = 0;
  private projectionCache: { key: string; statement: MonthlyStatement } | null = null;
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

    // A panel is rebuilt from scratch whenever its figures move. Rebuilding
    // it under a finger would destroy the control being pressed — the press
    // would never become a click, and a slider would go dead the moment it
    // was dragged — so a redraw waits until the hand is off it.
    this.panel.addEventListener('pointerdown', () => {
      this.panelHeld = true;
    });
    const release = () => {
      this.panelHeld = false;
      this.panelSettlesAt = Date.now() + PANEL_SETTLE_MS;
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);

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

    // The month the city is having, not the one it closed a fortnight ago:
    // a market built this morning shows against the treasury this morning.
    const net = this.projection(city).net;
    if (Math.abs(net) > 0.5) {
      this.stats.goldDelta.textContent = `${net > 0 ? '+' : ''}${compact(net)}`;
      this.stats.goldDelta.className = `delta ${net >= 0 ? 'up' : 'down'}`;
    } else {
      this.stats.goldDelta.textContent = '';
    }
    this.stats.goldDelta.title = 'Projected for this month';

    this.stats.population.textContent = compact(city.stats.population);
    this.stats.happiness.textContent = percent(city.stats.happiness);
    this.stats.date.textContent = monthAndYear(city.clock.month, city.clock.year);

    this.demandBars.residential.style.height = `${city.demand.residential * 100}%`;
    this.demandBars.commercial.style.height = `${city.demand.commercial * 100}%`;
    this.demandBars.industrial.style.height = `${city.demand.industrial * 100}%`;

    // Badge the Chronicle with unread bad news, so something going wrong is
    // visible without opening the panel to look for it.
    const unread = this.openPanel === 'journal' ? 0 : unreadJournalCount(city, 'bad');
    if (unread !== this.lastUnreadBad) {
      this.lastUnreadBad = unread;
      this.journalBadge.textContent = unread > 9 ? '9+' : String(unread);
      this.journalBadge.hidden = unread === 0;
    }

    this.refreshPanel(city);
  }

  /**
   * The month's projection.
   *
   * It is a survey of every building in the city; at sixty frames a second
   * that is not free, and none of what it rests on moves within a game-day
   * unless the player spends, builds or shifts a tithe.
   */
  private projection(city: CityState): MonthlyStatement {
    const budget = city.budget;
    const key = [
      city.clock.totalDays,
      Math.round(budget.gold),
      city.buildings.size,
      budget.taxRateResidential,
      budget.taxRateCommercial,
      budget.taxRateIndustrial,
      budget.loan ? budget.loan.outstanding : 0,
    ].join('|');
    if (!this.projectionCache || this.projectionCache.key !== key) {
      this.projectionCache = { key, statement: projectMonth(city) };
    }
    return this.projectionCache.statement;
  }

  /** Redraw the open panel, but only once something on it has changed. */
  private refreshPanel(city: CityState): void {
    if (!this.openPanel || !LIVE_PANELS.includes(this.openPanel)) return;
    if (this.panelState(city) === this.panelSignature) return;
    if (this.panelHeld || Date.now() < this.panelSettlesAt) return;
    this.renderPanel(city);
  }

  /**
   * Everything an open panel draws from, rolled into one string. Nothing a
   * panel shows moves more often than once a game-day or once a purchase, so
   * this is what stands between the interface and a rebuild every frame.
   */
  private panelState(city: CityState): string {
    return [
      this.openPanel,
      city.clock.totalDays,
      Math.round(city.budget.gold),
      city.buildings.size,
      city.journal.length,
      this.selectedBuilding ? this.selectedBuilding.id : 0,
      this.landSelection ? `${this.landSelection.px},${this.landSelection.py}` : '',
      this.currentTool.kind,
      this.currentTool.buildDefId ?? '',
      this.currentTool.roadType,
    ].join('|');
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
    this.panelSignature = this.panelState(city);
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
            text: `${gold(def.cost)}${def.upkeep ? ` \u00B7 ${def.upkeep}g/mo` : ''}`,
            style: affordable ? '' : 'color:var(--bad)',
          }),
          // The price is only half of what it costs to say yes: the treasury
          // it leaves behind, and the standing bill it signs the city up to.
          el('span', {
            class: 'after',
            text: `Leaves ${gold(city.budget.gold - def.cost)}${
              def.upkeep ? ` \u00B7 ${gold(def.upkeep * MONTHS_PER_YEAR)} a year` : ''
            }`,
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

  /**
   * The Treasury: what this month is doing, what it is being spent on, what
   * the tithes are worth, what the Crown will lend, and the year behind.
   */
  private renderBudget(city: CityState, body: HTMLElement): void {
    const budget = city.budget;
    const projection = this.projection(city);
    // A tithe scales the take linearly, so a full rate priced once here is
    // enough to re-price every slider as it moves.
    const base = taxBase(city);

    if (budget.arrears > 0) this.renderArrears(city, body);

    append(body, [
      el('div', {
        class: 'section-title',
        text: `This Month \u2014 ${MONTH_NAMES[(projection.month - 1) % 12]}`,
      }),
      el(
        'div',
        { class: 'rows' },
        ledgerRow('Tithes', totalTaxes(projection)),
        ledgerRow('Trade', projection.trade),
        ledgerRow('Upkeep', -totalUpkeepOf(projection)),
        projection.loanRepayment > 0.5 ? ledgerRow('Crown\u2019s instalment', -projection.loanRepayment) : null,
        ledgerRow('Net', projection.net, true),
        statRow('Treasury now', gold(budget.gold)),
        statRow('At month\u2019s end', gold(projection.closingGold)),
      ),
      el('div', {
        class: 'blurb',
        style: 'margin-top:8px',
        text: 'Projected from the city as it stands. Trade is carried forward at the rate it has run so far this month.',
      }),
      el('div', { class: 'section-title', text: 'Tithes' }),
      this.taxRow('Dwellings', Zone.Residential, budget.taxRateResidential, base.residential),
      this.taxRow('Trade', Zone.Commercial, budget.taxRateCommercial, base.commercial),
      this.taxRow('Crafting', Zone.Industrial, budget.taxRateIndustrial, base.industrial),
      el('div', {
        class: 'blurb',
        style: 'margin-top:8px',
        text: 'A tithe of one in ten is expected. Beyond that, folk grumble and then leave. Beside each rate is what it is worth this month.',
      }),
    ]);

    this.renderUpkeepBreakdown(city, body, projection);
    this.renderCrown(city, body);
    this.renderLedger(budget.history, body);
  }

  /** A rate, with what it is currently worth beside it. */
  private taxRow(label: string, zone: Zone, rate: number, fullRate: number): HTMLElement {
    const value = el('span', { class: 'val', text: percent(rate) });
    const take = el('span', { class: 'take', text: gold(fullRate * rate) });
    const slider = el('input', {
      type: 'range',
      min: '0',
      max: '35',
      step: '1',
      value: String(Math.round(rate * 100)),
      'aria-label': `${label} tithe`,
    }) as HTMLInputElement;
    slider.addEventListener('input', () => {
      const next = Number(slider.value) / 100;
      value.textContent = percent(next);
      // Re-price in place rather than rebuilding the panel under the finger.
      take.textContent = gold(fullRate * next);
      this.callbacks.onTaxChange(zone, next);
    });
    return el('div', { class: 'slider-row' }, el('label', { text: label }), slider, value, take);
  }

  /** What the city is actually paying for, dearest first. */
  private renderUpkeepBreakdown(
    city: CityState,
    body: HTMLElement,
    projection: MonthlyStatement,
  ): void {
    const lines = upkeepByType(city);
    const shown = lines.slice(0, 8);
    const rest = lines.slice(8).reduce((sum, line) => sum + line.upkeep, 0);

    append(body, [
      el('div', { class: 'section-title', text: 'Where It Goes' }),
      el(
        'div',
        { class: 'rows' },
        ledgerRow('Streets', -projection.roadUpkeep),
        ledgerRow('Walls and gates', -projection.wallUpkeep),
        ...shown.map((line) =>
          ledgerRow(line.count > 1 ? `${line.name} \u00D7${line.count}` : line.name, -line.upkeep),
        ),
        rest > 0.5 ? ledgerRow('Everything else', -rest) : null,
        ledgerRow('Every month', -totalUpkeepOf(projection), true),
      ),
    ]);
  }

  /** The state of the city's debts, and what it can still borrow. */
  private renderCrown(city: CityState, body: HTMLElement): void {
    const loan = city.budget.loan;
    body.appendChild(el('div', { class: 'section-title', text: 'The Crown' }));

    if (loan) {
      append(body, [
        el(
          'div',
          { class: 'rows' },
          statRow('Still owed', gold(loan.outstanding)),
          statRow('Each month', gold(loan.payment)),
          statRow('Instalments left', plural(loan.monthsRemaining, 'month')),
        ),
        el('div', {
          class: 'blurb',
          style: 'margin-top:8px',
          text: 'The instalment is taken before the city\u2019s own bills, whether or not the tithes cover it. The Crown will not lend again until it is cleared.',
        }),
      ]);
      return;
    }

    const offer = loanOffer(city);
    append(body, [
      el(
        'div',
        { class: 'rows' },
        statRow('Advance', gold(offer.principal)),
        statRow('Repayment', `${gold(offer.payment)} a month`),
        statRow('Term', plural(offer.months, 'month')),
        statRow('Interest', gold(offer.total - offer.principal)),
      ),
      button(
        'action',
        () => this.callbacks.onTakeLoan(),
        `Ask the Crown for ${gold(offer.principal)}`,
      ),
    ]);
  }

  /** The year behind, newest first, so a slide shows before it is a crisis. */
  private renderLedger(history: readonly MonthlyStatement[], body: HTMLElement): void {
    if (history.length === 0) return;
    const recent = history.slice(-6).reverse();
    const last = recent[0];

    append(body, [
      el('div', {
        class: 'section-title',
        text: `Last Month \u2014 ${monthAndYear(last.month, last.year)}`,
      }),
      el(
        'div',
        { class: 'rows' },
        ledgerRow('Dwellings', last.residentialTax),
        ledgerRow('Trade quarter', last.commercialTax),
        ledgerRow('Crafting', last.industrialTax),
        ledgerRow('Buildings', -last.buildingUpkeep),
        ledgerRow('Streets', -last.roadUpkeep),
        ledgerRow('Walls', -last.wallUpkeep),
        last.loanRepayment > 0.5 ? ledgerRow('Crown\u2019s instalment', -last.loanRepayment) : null,
        ledgerRow('Caravans', last.trade),
        ledgerRow('Net', last.net, true),
      ),
      el('div', { class: 'section-title', text: 'Months Closed' }),
      el(
        'div',
        { class: 'rows' },
        ...recent.map((month) =>
          ledgerRow(monthAndYear(month.month, month.year), month.net),
        ),
      ),
    ]);
  }

  /** What being in the red is costing the city, spelled out. */
  private renderArrears(city: CityState, body: HTMLElement): void {
    const months = city.budget.arrears;
    body.appendChild(
      el('div', {
        class: 'blurb alarm',
        text:
          months <= ARREARS_GRACE
            ? 'The treasury is in the red. Another month of this and the city\u2019s servants go unpaid.'
            : `${plural(months, 'month')} in arrears. Unpaid, the guard, the chapels and the markets are doing ${percent(serviceAusterity(city))} of their work \u2014 and will do less the longer the debt stands.`,
      }),
    );
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
            statRow('Treasury after', gold(city.budget.gold - quote.total)),
            statRow(
              'Wall upkeep',
              `${quote.upkeep >= 0 ? '+' : '-'}${gold(Math.abs(quote.upkeep))} a month`,
            ),
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
      [
        'Walk round it',
        'The valley is a real place, so look at it from anywhere: drag with the middle button — or twist with two fingers — to turn and tilt, and hold Q or E to turn a step at a time. The right button slides the map about whatever tool you are holding, and the wheel or a pinch brings you in. Coming in drops the view toward the street; pulling back lifts it over the district.',
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
        text: 'A city builder set in Elwynn Forest, built in the vernacular of England around 1300: cruck cottages and jettied burgage houses, thatch and stone slate, a curtain wall and a gatehouse, in rolling country with no cliff in it anywhere.',
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
