// The public API of foxspace.
export { FoxspaceError, type FoxspaceErrorCode } from "./errors.js";
export { DEFAULT_SENSITIVITY, FORMAT, KINDS, LIMITS, SENSITIVITIES, checkItem, checkSensitivity, checkSpace, checkState, checkTerm, newId } from "./schema.js";
export type { ItemKind, Sensitivity, Space, SpaceItem, SpacesState } from "./schema.js";
export { HIDDEN, textProblem } from "./text.js";
export { createSpaces } from "./spaces.js";
export type { ItemPatch, NewItem, Spaces, SpacesOptions } from "./spaces.js";
export { memoryStore, storageAreaStore } from "./store.js";
export type { SpaceStore, StorageAreaLike } from "./store.js";
