import type { GameAction, PrivateGameState, PublicGameState, CardInstance, Phase } from "../../shared/types.js";
import cardsData from "../../data/cards.json";
import { isCardModalBlockingPendingActions } from "./card-modal.js";
import { BOARD_EVENT_PENDING_KINDS, humanControlsPending } from "./pending-choice-ui.js";
import { isGameIntroDismissed } from "./game-start-modal.js";
import { isFriendshipGainOption, snapshotFriendshipBeforeChoice } from "./friendship-vfx.js";
import { isInputLocked } from "./input-lock.js";
import { ENERGY_ICON, FRIENDSHIP_ICON } from "./ui-icons.js";

export { ENERGY_ICON, FRIENDSHIP_ICON } from "./ui-icons.js";

export { isBoardMountedEventPending } from "./pending-choice-ui.js";

type StateHandler = (pub: PublicGameState, priv?: PrivateGameState) => void;
type ErrorHandler = (message: string) => void;

const cardNamesById = Object.fromEntries(
  (cardsData as { id: string; name: string; friendshipRequirement?: number }[]).map((c) => [c.id, c.name])
);

const cardMetaById = Object.fromEntries(
  (cardsData as { id: string; name: string; friendshipRequirement?: number }[]).map((c) => [c.id, c])
);

const cardInstantById = Object.fromEntries(
  (cardsData as { id: string; instant?: boolean }[]).map((c) => [c.id, !!c.instant])
);

const cardEffectById = Object.fromEntries(
  (cardsData as { id: string; effectId?: string }[]).map((c) => [c.id, c.effectId ?? ""])
);

export type HandCardVisualClass = "playable" | "unplayable" | "actions-spent";

export function getHandCardVisualClass(
  phase: Phase,
  cardId: string,
  pub?: PublicGameState
): HandCardVisualClass {
  const isInstant = cardInstantById[cardId];
  const isCycleAction = (cardsData as { id: string; cycleIcon?: boolean }[]).some(
    (c) => c.id === cardId && c.cycleIcon
  );

  if (phase === "day" || phase === "night") {
    if (pub) {
      const noActions =
        (phase === "day" && pub.dayActionsRemaining <= 0) ||
        (phase === "night" && pub.nightActionsRemaining <= 0);
      if (noActions && isCycleAction && !isInstant) return "actions-spent";
    }
    return "playable";
  }
  return isInstant ? "playable" : "unplayable";
}


export function formatPhaseActionLabel(
  phase: "day" | "night",
  remaining: number,
  total: number
): string {
  const name = phase === "day" ? "Day" : "Night";
  return `${name} ${remaining}/${total}`;
}

export function formatEndPhaseButtonLabel(
  phase: "day" | "night",
  remaining: number,
  hasInstantPlays: boolean
): string {
  const name = phase === "day" ? "Day" : "Night";
  if (remaining > 0) return `End ${name} Phase (${remaining} left)`;
  if (hasInstantPlays) return `End ${name} Phase (instants OK)`;
  return `End ${name} Phase`;
}

function renderDncPhaseBands(pub: PublicGameState): string {
  if (!pub.currentDncPhases?.length) return "";
  return `
    <div class="dnc-phase-bands" aria-hidden="true">
      ${pub.currentDncPhases
        .map((phase, index) => {
          const state =
            index === pub.dncPhaseIndex
              ? "is-current"
              : index < pub.dncPhaseIndex
                ? "is-done"
                : "";
          return `<div class="dnc-phase-band ${state}" data-phase="${phase}"></div>`;
        })
        .join("")}
    </div>`;
}

export class GameClient {
  private ws: WebSocket | null = null;
  public publicState: PublicGameState | null = null;
  public privateState: PrivateGameState | null = null;
  private onState: StateHandler = () => {};
  private onError: ErrorHandler = () => {};

  connect(params: {
    roomId: string;
    role: "tv" | "player" | "host" | "solo";
    slot?: number;
    name?: string;
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const url = `${proto}://${location.host}/ws`;
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.ws!.send(
          JSON.stringify({
            type: "JOIN",
            roomId: params.roomId,
            role: params.role === "solo" ? "player" : params.role,
            slot: params.slot ?? 1,
            name: params.name ?? "Player",
          })
        );
      };

      this.ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string);
        if (msg.type === "STATE" || msg.type === "ROOM") {
          this.publicState = msg.public as PublicGameState;
          this.privateState = (msg.private as PrivateGameState | undefined) ?? null;
          this.onState(this.publicState, this.privateState ?? undefined);
          resolve();
        }
        if (msg.type === "ERROR") {
          this.onError(msg.message as string);
        }
      };

      this.ws.onerror = () => reject(new Error("WebSocket failed"));
    });
  }

  onStateUpdate(handler: StateHandler): void {
    this.onState = handler;
  }

  onErrorMessage(handler: ErrorHandler): void {
    this.onError = handler;
  }

  waitForStarted(timeoutMs = 10000): Promise<void> {
    if (this.publicState?.started) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Game start timed out")), timeoutMs);
      const prev = this.onState;
      this.onState = (pub, priv) => {
        prev(pub, priv);
        if (pub.started) {
          clearTimeout(timer);
          resolve();
        }
      };
    });
  }

  sendAction(action: GameAction): void {
    this.ws?.send(JSON.stringify({ type: "ACTION", action }));
  }

  startGame(possessedId: string, playerCount?: number): void {
    this.ws?.send(
      JSON.stringify({
        type: "START",
        possessedId,
        ...(playerCount != null ? { playerCount } : {}),
      })
    );
  }
}

export async function fetchPossessedIds(): Promise<string[]> {
  const options = await fetchPossessedOptions();
  return options.map((o) => o.id);
}

export async function fetchPossessedOptions(): Promise<{ id: string; name: string }[]> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch("/api/solo");
      if (!res.ok) {
        throw new Error("Could not load characters — is the server running on port 3000?");
      }
      const data = (await res.json()) as { possessed?: string[] };
      if (!data.possessed?.length) {
        throw new Error("No Possessed characters returned from server.");
      }
      return data.possessed.map((id) => ({ id, name: getCardDisplayName(id) }));
    } catch (err) {
      lastError = err as Error;
      if (attempt < 4) {
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }

  throw lastError ?? new Error("Could not load characters.");
}

export async function createRoom(): Promise<{ roomId: string; joinUrls: Record<number, string> }> {
  const res = await fetch("/api/rooms", { method: "POST" });
  return res.json();
}

export async function createSoloRoom(): Promise<string> {
  const res = await fetch("/api/solo", { method: "POST" });
  if (!res.ok) throw new Error("Could not create solo room.");
  const data = await res.json();
  return data.roomId as string;
}

export function getHumanPlayerId(pub: PublicGameState): string {
  const human = pub.players.find((p) => p.isHuman);
  if (!human) throw new Error("No human player in game state.");
  return human.id;
}

export function cardImg(cardId: string): string {
  const map: Record<string, string> = {
    action_01: "Action Deck/Action_01.png",
    action_02: "Action Deck/Action_02.png",
    action_03: "Action Deck/Action_03.png",
    action_04: "Action Deck/Action_04.png",
    action_05: "Action Deck/Action_05.png",
    action_06: "Action Deck/Action_06.png",
    action_07: "Action Deck/Action_07.png",
    action_08: "Action Deck/Action_08.png",
    action_09: "Action Deck/Action_09.png",
    action_10: "Action Deck/Action_10.png",
    action_11: "Action Deck/Action_11.png",
    action_12: "Action Deck/Action_12.png",
    action_13: "Action Deck/Action_13.png",
    action_14: "Action Deck/Action_14.png",
    action_15: "Action Deck/Action_15.png",
    action_16: "Action Deck/Action_16.png",
    action_17: "Action Deck/Action_17.png",
    action_18: "Action Deck/Action_18.png",
    action_19: "Action Deck/Action_19.png",
    action_20: "Action Deck/Action_20.png",
    action_21: "Action Deck/Action_21.png",
    dc_cover: "Demon's Contract/DC_Cover.png",
    dc_01: "Demon's Contract/DC_01.png",
    dc_02: "Demon's Contract/DC_02.png",
    dc_03: "Demon's Contract/DC_03.png",
    dc_04: "Demon's Contract/DC_04.png",
    dc_05: "Demon's Contract/DC_05.png",
    dc_06: "Demon's Contract/DC_06.png",
    dc_07: "Demon's Contract/DC_07.png",
    dc_08: "Demon's Contract/DC_08.png",
    dc_09: "Demon's Contract/DC_09.png",
    dc_10: "Demon's Contract/DC_10.png",
    dc_11: "Demon's Contract/DC_11.png",
    dc_12: "Demon's Contract/DC_12.png",
    dc_13: "Demon's Contract/DC_13.png",
    possessed_01: "Possessed/Possessed_01.png",
    possessed_02: "Possessed/Possessed_02.png",
    possessed_03: "Possessed/Possessed_03.png",
    possessed_04: "Possessed/Possessed_04.png",
    possessed_05: "Possessed/Possessed_05.png",
    possessed_06: "Possessed/Possessed_06.png",
    possessed_07: "Possessed/Possessed_07.png",
    possessed_08: "Possessed/Possessed_08.png",
    possessed_09: "Possessed/Possessed_09.png",
    possessed_10: "Possessed/Possessed_10.png",
    event_01: "Events/Event_01.png",
    event_02: "Events/Event_02.png",
    event_03: "Events/Event_03.png",
    event_04: "Events/Event_04.png",
    event_05: "Events/Event_05.png",
    event_06: "Events/Event_06.png",
    event_07: "Events/Event_07.png",
    event_08: "Events/Event_08.png",
    event_09: "Events/Event_09.png",
    event_10: "Events/Event_10.png",
    event_11: "Events/Event_11.png",
    event_12: "Events/Event_12.png",
    event_13: "Events/Event_13.png",
    event_14: "Events/Event_14.png",
    event_15: "Events/Event_15.png",
    event_16: "Events/Event_16.png",
    event_17: "Events/Event_17.png",
    event_18: "Events/Event_18.png",
    event_19: "Events/Event_19.png",
    event_20: "Events/Event_20.png",
    event_21: "Events/Event_21.png",
    event_22: "Events/Event_22.png",
    event_23: "Events/Event_23.png",
    event_24: "Events/Event_24.png",
    dnc_01: "Diurnal Cycle/DNC_01.png",
    dnc_02: "Diurnal Cycle/DNC_02.png",
    dnc_03: "Diurnal Cycle/DNC_03.png",
    dnc_04: "Diurnal Cycle/DNC_04.png",
    dnc_05: "Diurnal Cycle/DNC_05.png",
    dnc_06: "Diurnal Cycle/DNC_06.png",
    dnc_07: "Diurnal Cycle/DNC_07.png",
    dnc_08: "Diurnal Cycle/DNC_08.png",
    dnc_09: "Diurnal Cycle/DNC_09.png",
    dnc_10: "Diurnal Cycle/DNC_10.png",
    dnc_11: "Diurnal Cycle/DNC_11.png",
    dnc_12: "Diurnal Cycle/DNC_12.png",
    dnc_13: "Diurnal Cycle/DNC_13.png",
    dnc_14: "Diurnal Cycle/DNC_14.png",
    dnc_15: "Diurnal Cycle/DNC_15.png",
    dnc_16: "Diurnal Cycle/DNC_16.png",
    dnc_17: "Diurnal Cycle/DNC_17.png",
    dnc_18: "Diurnal Cycle/DNC_18.png",
    dnc_19: "Diurnal Cycle/DNC_19.png",
    dnc_20: "Diurnal Cycle/DNC_20.png",
  };
  return `/assets/${map[cardId] ?? map.action_01}`;
}

export function cardName(cardId: string): string {
  return getCardDisplayName(cardId);
}

export function getCardDisplayName(cardId: string): string {
  return cardNamesById[cardId] ?? cardId.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const EVENT_BOARD_KINDS = BOARD_EVENT_PENDING_KINDS;

export function shouldRenderEventChoiceOnBoard(
  pub: PublicGameState,
  priv: PrivateGameState | undefined,
  humanPlayerId?: string
): boolean {
  const pc = pub.pendingChoice;
  if (!pc?.options?.length || pub.phase !== "triggers") return false;
  if (!pc.cardId || !EVENT_BOARD_KINDS.has(pc.kind)) return false;
  if (humanPlayerId != null) {
    if (pc.playerId !== humanPlayerId) return false;
    return (priv?.legalActions ?? []).some((a) => a.type === "RESOLVE_PICK_ONE");
  }
  return true;
}

export function renderBoardEventChoice(
  root: HTMLElement,
  pub: PublicGameState,
  priv: PrivateGameState | undefined,
  humanPlayerId: string | undefined,
  send?: (a: GameAction) => void
): void {
  const slot = root.querySelector("#board-event-choice");
  if (!slot) return;
  slot.innerHTML = "";
  if (!shouldRenderEventChoiceOnBoard(pub, priv, humanPlayerId)) return;

  const pc = pub.pendingChoice!;
  const interactive = !!send && !!humanPlayerId && pc.playerId === humanPlayerId;

  const layout = document.createElement("div");
  layout.className = "board-event-layout";

  const img = document.createElement("img");
  img.className = "board-event-img";
  img.src = cardImg(pc.cardId!);
  img.alt = cardName(pc.cardId!);

  const actions = document.createElement("div");
  actions.className = "board-event-actions";

  for (const opt of pc.options!) {
    if (interactive) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn secondary board-event-btn";
      btn.textContent = opt.label;
      btn.onclick = () => {
        if (isFriendshipGainOption(opt.id)) {
          snapshotFriendshipBeforeChoice(pub, humanPlayerId!);
        }
        send!({ type: "RESOLVE_PICK_ONE", optionId: opt.id });
      };
      actions.appendChild(btn);
    } else {
      const label = document.createElement("div");
      label.className = "board-event-option-label";
      label.textContent = opt.label;
      actions.appendChild(label);
    }
  }

  layout.appendChild(img);
  layout.appendChild(actions);
  slot.appendChild(layout);
}

function drawPhasePrompt(_pub: PublicGameState): string {
  return "";
}

function possessedFriendshipRequirement(possessedId: string): number {
  return cardMetaById[possessedId]?.friendshipRequirement ?? 0;
}

type RosterPlayer = {
  id: string;
  name: string;
  isHuman: boolean;
  isConnected: boolean;
  energy: number;
  friendship: number;
  handCount?: number;
  persistentCards?: CardInstance[];
};

function findPersistentByEffect(player: RosterPlayer, effectId: string): CardInstance | undefined {
  return player.persistentCards?.find((c) => cardEffectById[c.cardId] === effectId);
}

function findTrumpetOnTeam(players: RosterPlayer[]): CardInstance | undefined {
  for (const p of players) {
    const t = findPersistentByEffect(p, "trumpet_of_victory");
    if (t) return t;
  }
  return undefined;
}

function renderTrumpetAttachment(players: RosterPlayer[]): string {
  const trumpet = findTrumpetOnTeam(players);
  if (!trumpet) return "";
  return `
    <div class="board-attachment trumpet-attachment" title="Trumpet of Victory">
      <img src="${cardImg(trumpet.cardId)}" alt="${cardName(trumpet.cardId)}" />
    </div>`;
}

function renderImpAttachments(
  imps: { instanceId: string; cardId: string; hp: number }[]
): string {
  if (!imps.length) return "";
  return imps
    .map(
      (i) => `
    <div class="board-attachment imp-attachment" data-imp-id="${i.instanceId}" title="${cardName(i.cardId)}">
      <img src="${cardImg(i.cardId)}" alt="${cardName(i.cardId)}" />
      <span class="attachment-hp">${i.hp}</span>
    </div>`
    )
    .join("");
}

function rosterLighthouseMarkup(
  player: RosterPlayer,
  pub: PublicGameState,
  humanPlayerId: string
): string {
  const lighthouse = findPersistentByEffect(player, "lighthouse");
  if (!lighthouse) return "";
  const canUse =
    player.id === humanPlayerId &&
    pub.phase === "manifest" &&
    pub.presentationHold?.at === "manifest";
  const tag = canUse ? "button" : "span";
  const extra = canUse
    ? ` type="button" class="lighthouse-attachment is-active" data-player-id="${player.id}" title="Lighthouse — discard 1 to block 1 manifest damage"`
    : ` class="lighthouse-attachment" title="Lighthouse"`;
  return `
    <${tag}${extra}>
      <img src="${cardImg(lighthouse.cardId)}" alt="Lighthouse" />
    </${tag}>`;
}

export function renderPlayerRoster(
  players: RosterPlayer[],
  selectedPlayerId?: string,
  rosterCtx?: { pub: PublicGameState; humanPlayerId: string }
): string {
  return `
    <div class="player-roster">
      ${players
        .map(
          (p) => `
        <div class="player-roster-row ${p.isHuman ? "is-human" : ""} ${p.isConnected ? "connected" : ""} ${p.id === selectedPlayerId ? "is-selected" : ""}" data-player-id="${p.id}" role="button" tabindex="0">
          <span class="player-roster-name">${p.name}</span>
          <span class="player-roster-values">
            <span class="roster-stat" title="Energy"><img class="roster-stat-icon" src="${ENERGY_ICON}" alt="Energy" />${p.energy}</span>
            <span class="roster-stat" title="Friendship"><img class="roster-stat-icon" src="${FRIENDSHIP_ICON}" alt="Friendship" />${p.friendship}</span>
            ${p.handCount != null ? `<span class="roster-stat roster-hand" title="Hand cards">${p.handCount} cards</span>` : ""}
            ${rosterCtx ? rosterLighthouseMarkup(p, rosterCtx.pub, rosterCtx.humanPlayerId) : ""}
          </span>
        </div>`
        )
        .join("")}
    </div>`;
}

export function bindPlayerRoster(root: HTMLElement, onSelect: (playerId: string) => void): void {
  root.querySelectorAll(".player-roster-row").forEach((row) => {
    const el = row as HTMLElement;
    const select = () => onSelect(el.dataset.playerId!);
    el.addEventListener("click", select);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        select();
      }
    });
  });
}

export function openLighthouseDiscardModal(
  priv: PrivateGameState,
  send: (a: GameAction) => void
): void {
  if (!priv.hand.length) return;

  const modal = document.createElement("div");
  modal.className = "card-modal lighthouse-discard-modal";
  modal.innerHTML = `
    <div class="card-modal-backdrop modal-overlay"></div>
    <div class="lighthouse-discard-panel modal-panel">
      <h3 class="card-modal-title">Lighthouse</h3>
      <p class="card-modal-effect">Discard 1 card to block 1 manifest damage.</p>
      <div class="lighthouse-hand-pick"></div>
      <button class="btn secondary lighthouse-cancel" type="button">Cancel</button>
    </div>
  `;
  const panel = modal.querySelector(".lighthouse-discard-panel") as HTMLElement;
  const pick = modal.querySelector(".lighthouse-hand-pick") as HTMLElement;

  for (const card of priv.hand) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lighthouse-pick-card";
    btn.innerHTML = `<img src="${cardImg(card.cardId)}" alt="${cardName(card.cardId)}" />`;
    btn.onclick = () => {
      send({ type: "USE_LIGHTHOUSE", discardInstanceId: card.instanceId });
      modal.remove();
    };
    pick.appendChild(btn);
  }

  modal.querySelector(".lighthouse-cancel")?.addEventListener("click", () => modal.remove());
  modal.querySelector(".card-modal-backdrop")?.addEventListener("click", () => modal.remove());

  document.body.appendChild(modal);
  modal.hidden = false;
  void panel.offsetWidth;
  panel.classList.add("is-opening");
}

let prevImpIds = new Set<string>();

export function markNewImpAttachments(root: HTMLElement, imps: { instanceId: string }[]): void {
  const current = new Set(imps.map((i) => i.instanceId));
  root.querySelectorAll(".imp-attachment").forEach((el) => {
    const id = (el as HTMLElement).dataset.impId;
    if (id && !prevImpIds.has(id)) {
      el.classList.add("imp-attachment--enter");
    }
  });
  prevImpIds = current;
}

export function bindBoardAttachments(
  root: HTMLElement,
  pub: PublicGameState,
  priv: PrivateGameState | undefined,
  humanPlayerId: string,
  send: (a: GameAction) => void
): void {
  root.querySelectorAll(".lighthouse-attachment.is-active").forEach((el) => {
    const btn = el as HTMLButtonElement;
    const clone = btn.cloneNode(true) as HTMLButtonElement;
    btn.replaceWith(clone);
    clone.addEventListener("click", (e) => {
      e.stopPropagation();
      if (priv && clone.dataset.playerId === humanPlayerId) {
        openLighthouseDiscardModal(priv, send);
      }
    });
  });
  markNewImpAttachments(root, pub.imps);
}

export function getTeamHand(priv: PrivateGameState, playerId: string): CardInstance[] {
  return priv.teamHands.find((t) => t.playerId === playerId)?.hand ?? priv.hand;
}

export function renderBoard(
  root: HTMLElement,
  pub: PublicGameState,
  selectedPlayerId?: string,
  humanPlayerId?: string
): void {
  const possessedImg = cardImg(pub.possessedId);
  const possessedName = cardName(pub.possessedId);
  const hpNote =
    pub.possessedMaxHp < pub.possessedBaseHp
      ? ` <span class="stat-note">(cap ${pub.possessedMaxHp})</span>`
      : "";
  const demonImg = pub.demonRevealed && pub.demon ? cardImg(pub.demon.cardId) : cardImg("dc_cover");
  const dncImg = pub.currentDncId ? cardImg(pub.currentDncId) : "";
  const trumpetHtml = renderTrumpetAttachment(pub.players);
  const impHtml = renderImpAttachments(pub.imps);

  const dayLabel =
    pub.phase === "day"
      ? formatPhaseActionLabel("day", pub.dayActionsRemaining, pub.currentDncDayTotal)
      : "";
  const nightLabel =
    pub.phase === "night"
      ? formatPhaseActionLabel("night", pub.nightActionsRemaining, pub.currentDncNightTotal)
      : "";

  const rosterCtx =
    humanPlayerId != null ? { pub, humanPlayerId } : undefined;

  root.innerHTML = `
    <div class="board-chrome board-chrome-top glass-panel">
      <div class="phase-hud">
        <strong>Cycle ${pub.cycle}/${pub.maxCycles}</strong> — Phase: <strong>${pub.phase}</strong>
        ${dayLabel ? `| ${dayLabel}` : ""}
        ${nightLabel ? `| ${nightLabel}` : ""}
        ${pub.lastDiceRoll ? `| Roll: ${pub.lastDiceRoll}` : ""}
        ${pub.winner ? `| <span style="color:var(--gold)">${pub.winner === "players" ? "Victory!" : "Defeat"}</span>` : ""}
        ${drawPhasePrompt(pub)}
      </div>
      <div class="stats">
        <span class="stat" id="deck-anchor">Action ${pub.actionDeckCount}</span>
        <span class="stat">Event ${pub.eventDeckCount}</span>
        ${pub.demon && pub.demonRevealed ? `<span class="stat">Demon ${pub.demon.hp}/${pub.demon.maxHp}</span>` : ""}
      </div>
    </div>
    <div class="board-stage">
      <aside class="board-dnc-col">
        <div class="card-slot dnc">
          <div class="dnc-card-frame">
            ${dncImg ? `<img class="dnc-img" src="${dncImg}" alt="Diurnal Cycle" />` : ""}
            ${renderDncPhaseBands(pub)}
          </div>
        </div>
      </aside>
      <aside id="board-event-choice" class="board-event-col"></aside>
      <div class="board-hero-col">
        <div class="board-hero-row">
          <div class="board-hero">
            <div class="card-slot possessed">
              <img src="${possessedImg}" alt="Possessed" />
              <div class="possessed-hp">HP ${pub.possessedHp}/${pub.possessedBaseHp}${hpNote}</div>
              <div class="label">${possessedName}</div>
              <div class="possessed-attachments">${trumpetHtml}</div>
            </div>
            <div class="card-slot demon">
              <img src="${demonImg}" alt="Demon" />
              <div class="label">${pub.demonRevealed ? "Demon" : "Contract"}</div>
              <div class="demon-attachments">${impHtml}</div>
            </div>
          </div>
          <aside id="possessed-actions" class="possessed-actions"></aside>
        </div>
      </div>
    </div>
    <div class="board-chrome board-chrome-bottom glass-panel">
      ${renderPlayerRoster(pub.players, selectedPlayerId, rosterCtx)}
    </div>
  `;
}

export function renderCompactStatus(
  root: HTMLElement,
  pub: PublicGameState,
  playerName?: string,
  selectedPlayerId?: string
): void {
  const human = pub.players.find((p) => p.isHuman) ?? pub.players.find((p) => p.name === playerName);
  const possessedReq = possessedFriendshipRequirement(pub.possessedId);

  root.innerHTML = `
    <h2>${playerName ?? human?.name ?? "Player"}</h2>
    <div class="phase-hud">
      <strong>Cycle ${pub.cycle}/${pub.maxCycles}</strong> — <strong>${pub.phase}</strong>
      ${drawPhasePrompt(pub)}
    </div>
    <div class="status-grid">
      <span class="stat">Possessed ${pub.possessedHp}/${pub.possessedBaseHp}</span>
      <span class="stat">Needs F${possessedReq}</span>
      <span class="stat" id="deck-anchor">Deck ${pub.actionDeckCount}</span>
      ${pub.phase === "day" ? `<span class="stat">${formatPhaseActionLabel("day", pub.dayActionsRemaining, pub.currentDncDayTotal)}</span>` : ""}
      ${pub.phase === "night" ? `<span class="stat">${formatPhaseActionLabel("night", pub.nightActionsRemaining, pub.currentDncNightTotal)}</span>` : ""}
    </div>
    ${renderPlayerRoster(pub.players, selectedPlayerId)}
  `;
}

export interface HandRenderContext {
  phase: Phase;
  pub: PublicGameState;
  priv: PrivateGameState;
  humanPlayerId: string;
  viewingPlayerId: string;
  onCardClick: (card: CardInstance) => void;
}

export function renderHandLabel(el: HTMLElement, playerName: string, isOwnHand: boolean): void {
  el.textContent = isOwnHand ? "Your hand" : `Viewing: ${playerName}`;
}

export function bindHandClickHandlers(
  root: HTMLElement,
  hand: CardInstance[],
  ctx: HandRenderContext
): void {
  root.querySelectorAll(".hand-card").forEach((el) => {
    const htmlEl = el as HTMLElement;
    const clone = htmlEl.cloneNode(true) as HTMLElement;
    htmlEl.replaceWith(clone);
    clone.addEventListener("click", () => {
      if (isInputLocked()) return;
      const id = clone.dataset.id!;
      const card = hand.find((c) => c.instanceId === id);
      if (card) ctx.onCardClick(card);
    });
  });
}

function handCardPlayableClass(ctx: HandRenderContext, card: CardInstance): HandCardVisualClass {
  const base = getHandCardVisualClass(ctx.phase, card.cardId, ctx.pub);
  if (base === "actions-spent" || base === "unplayable") return base;
  const legal = ctx.priv.legalActions ?? [];
  const isOwn = ctx.viewingPlayerId === ctx.humanPlayerId;
  const playable = isOwn
    ? legal.some((a) => a.type === "PLAY_CARD" && a.cardInstanceId === card.instanceId)
    : legal.some(
        (a) =>
          a.type === "PLAY_TEAM_CARD" &&
          a.ownerPlayerId === ctx.viewingPlayerId &&
          a.cardInstanceId === card.instanceId
      );
  return playable ? "playable" : "unplayable";
}

export function renderHand(
  root: HTMLElement,
  hand: CardInstance[],
  ctx?: HandRenderContext
): void {
  root.innerHTML = hand
    .map((c) => {
      const cls = ctx ? handCardPlayableClass(ctx, c) : "";
      return `<div class="hand-card ${cls}" data-id="${c.instanceId}"><img src="${cardImg(c.cardId)}" alt="${cardName(c.cardId)}" /></div>`;
    })
    .join("");

  if (ctx) {
    bindHandClickHandlers(root, hand, ctx);
  }
}

export function renderLog(el: HTMLElement, pub: PublicGameState): void {
  el.innerHTML = pub.log.map((l: string) => `<p>${l}</p>`).join("");
}

function createCircleButton(
  label: string,
  title: string,
  action: () => void,
  className = "btn secondary",
  disabled = false
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `${className} btn-circle`.trim();
  btn.textContent = label;
  btn.title = title;
  btn.disabled = disabled;
  if (!disabled) {
    btn.onclick = () => {
      if (isInputLocked()) return;
      action();
    };
  }
  return btn;
}

export function renderPossessedPanelActions(
  root: HTMLElement,
  pub: PublicGameState,
  priv: PrivateGameState | undefined,
  humanPlayerId: string,
  send: (a: GameAction) => void
): void {
  root.innerHTML = "";
  if (!priv || pub.phase === "game_over") return;
  if (pub.phase !== "day" && pub.phase !== "night") return;

  const human = pub.players.find((p) => p.id === humanPlayerId);
  if (!human) return;

  const legal = priv.legalActions ?? [];
  const stack = document.createElement("div");
  stack.className = "possessed-actions-stack";

  if (human.restVote === true) {
    const status = document.createElement("p");
    status.className = "rest-vote-status";
    status.innerHTML = `Voted: <strong>Rest</strong>`;
    stack.appendChild(status);
  } else {
    const canRest = legal.some((a) => a.type === "REST_VOTE" && a.vote === true);
    stack.appendChild(
      createCircleButton(
        "Rest",
        "Vote Rest",
        () => send({ type: "REST_VOTE", vote: true }),
        canRest ? "btn btn-rest" : "btn btn-rest disabled",
        !canRest
      )
    );
  }

  if (pub.phase === "day" && legal.some((a) => a.type === "ADVANCE_PHASE")) {
    const hasInstants = legal.some((a) => a.type === "PLAY_CARD");
    const fullLabel = formatEndPhaseButtonLabel("day", pub.dayActionsRemaining, hasInstants);
    stack.appendChild(
      createCircleButton("End\nPhase", fullLabel, () => send({ type: "ADVANCE_PHASE" }), "btn")
    );
  }
  if (pub.phase === "night" && legal.some((a) => a.type === "ADVANCE_PHASE")) {
    const hasInstants = legal.some((a) => a.type === "PLAY_CARD");
    const fullLabel = formatEndPhaseButtonLabel("night", pub.nightActionsRemaining, hasInstants);
    stack.appendChild(
      createCircleButton("End\nPhase", fullLabel, () => send({ type: "ADVANCE_PHASE" }), "btn")
    );
  }

  if (stack.childElementCount > 0) root.appendChild(stack);
}

export function renderRestVoteBar(
  root: HTMLElement,
  pub: PublicGameState,
  priv: PrivateGameState | undefined,
  humanPlayerId: string,
  send: (a: GameAction) => void
): void {
  root.innerHTML = "";
  if (pub.phase !== "day" && pub.phase !== "night") return;

  const human = pub.players.find((p) => p.id === humanPlayerId);
  if (!human) return;

  if (human.restVote === true) {
    root.innerHTML = `<p class="rest-vote-status">You voted: <strong>Rest</strong></p>`;
    return;
  }

  const legal = priv?.legalActions ?? [];
  const canRest = legal.some((a) => a.type === "REST_VOTE" && a.vote === true);

  const bar = document.createElement("div");
  bar.className = "rest-vote-buttons";

  bar.appendChild(
    createCircleButton(
      "Rest",
      "Vote Rest",
      () => send({ type: "REST_VOTE", vote: true }),
      canRest ? "btn btn-rest" : "btn btn-rest disabled",
      !canRest
    )
  );
  root.appendChild(bar);
}

function shouldUseTriggerRollModal(
  pub: PublicGameState,
  priv: PrivateGameState | undefined
): boolean {
  return (
    pub.phase === "triggers" &&
    pub.started &&
    (isGameIntroDismissed() || pub.introAcknowledged) &&
    !pub.presentationHold &&
    (priv?.legalActions ?? []).some((a) => a.type === "ROLL_DICE")
  );
}

export function renderPhaseActions(
  container: HTMLElement,
  pub: PublicGameState,
  priv: PrivateGameState | undefined,
  send: (a: GameAction) => void,
  options?: { circular?: boolean; humanPlayerId?: string }
): void {
  container.innerHTML = "";
  if (!priv || pub.phase === "game_over") return;

  const circular = options?.circular ?? false;
  const humanPlayerId = options?.humanPlayerId;
  const eventChoiceOnBoard =
    humanPlayerId != null &&
    document.getElementById("board") != null &&
    shouldRenderEventChoiceOnBoard(pub, priv, humanPlayerId);

  const addBtn = (label: string, action: GameAction, className = "btn secondary", title?: string) => {
    if (circular) {
      const short = label.includes("\n") ? label : label.length > 10 ? label.split(" ")[0] : label;
      const btn = createCircleButton(short, title ?? label.replace(/\n/g, " "), () => send(action), className);
      container.appendChild(btn);
      return;
    }
    const btn = document.createElement("button");
    btn.className = className;
    btn.textContent = label;
    btn.onclick = () => send(action);
    container.appendChild(btn);
  };

  const legal = priv.legalActions ?? [];

  if (pub.presentationHold || pub.pendingRerollPrompt) return;

  if (circular) {
    if (pub.phase === "day" && legal.some((a) => a.type === "ADVANCE_PHASE")) {
      const hasInstants = legal.some((a) => a.type === "PLAY_CARD");
      const fullLabel = formatEndPhaseButtonLabel("day", pub.dayActionsRemaining, hasInstants);
      addBtn("End\nPhase", { type: "ADVANCE_PHASE" }, "btn", fullLabel);
    }
    if (pub.phase === "night" && legal.some((a) => a.type === "ADVANCE_PHASE")) {
      const hasInstants = legal.some((a) => a.type === "PLAY_CARD");
      const fullLabel = formatEndPhaseButtonLabel("night", pub.nightActionsRemaining, hasInstants);
      addBtn("End\nPhase", { type: "ADVANCE_PHASE" }, "btn", fullLabel);
    }
  }

  if (
    pub.phase === "triggers" &&
    legal.some((a) => a.type === "ROLL_DICE") &&
    !shouldUseTriggerRollModal(pub, priv)
  ) {
    addBtn("Roll Dice", { type: "ROLL_DICE" });
  }

  const controlsPending =
    !humanPlayerId || humanControlsPending(pub, humanPlayerId);

  if (
    controlsPending &&
    pub.pendingChoice?.options &&
    !isCardModalBlockingPendingActions(pub) &&
    !eventChoiceOnBoard
  ) {
    for (const opt of pub.pendingChoice.options) {
      addBtn(opt.label, { type: "RESOLVE_PICK_ONE", optionId: opt.id });
    }
  }
  if (
    controlsPending &&
    pub.pendingChoice?.targets &&
    !isCardModalBlockingPendingActions(pub)
  ) {
    const targets = pub.pendingChoice.targets;
    if (targets.length === 1) {
      addBtn(`Target demon`, { type: "SELECT_TARGET", targetId: targets[0] });
    }
  }
}
