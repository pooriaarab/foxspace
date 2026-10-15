// The public API of foxspace.
export { FoxspaceError, type FoxspaceErrorCode } from "./errors.js";
export { DEFAULT_SENSITIVITY, FORMAT, KINDS, LIMITS, SENSITIVITIES, checkItem, checkSensitivity, checkSpace, checkState, checkTerm, newId } from "./schema.js";
export type { ItemKind, Sensitivity, Space, SpaceItem, SpacesState } from "./schema.js";
export { HIDDEN, textProblem } from "./text.js";
export { createSpaces } from "./spaces.js";
export type { ItemPatch, NewItem, Spaces, SpacesOptions } from "./spaces.js";
export { memoryStore, storageAreaStore } from "./store.js";
export type { SpaceStore, StorageAreaLike } from "./store.js";
export { DIGIT_TERM, MAX_GUARD_CHARS, SPLIT_TERM, createGuard, normalizeForGuard, termProblem } from "./guard.js";
export type { GuardResult, GuardTerm } from "./guard.js";
export { INJECT_LIMIT, PROVIDERS, providerById, providerForHost } from "./providers.js";
export type { Provider, ProviderId, SyncBox } from "./providers.js";
export { renderForSync, renderSpace } from "./render.js";
export type { Render, RenderFormat, RenderOptions } from "./render.js";
