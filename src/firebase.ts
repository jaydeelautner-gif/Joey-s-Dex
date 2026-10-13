import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import {
  ALL_GAME_IDS,
  createEmptyGameCatchesMap,
  type GameId,
  type GameCatchesMap,
} from './data/pokemonData';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export const OWNER_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;
export const MAX_OWNER_ID_LENGTH = 128;
export const MAX_TRAINER_NAME_LENGTH = 60;
export const MAX_GAME_FILTER_LENGTH = 32;
export const MAX_DEX_ARRAY_SIZE = 1050;
export const MAX_VARIANTS_ARRAY_SIZE = 1500;
export const MAX_BOX_SELECTED_VARIANTS_SIZE = 1050;
export const MAX_BOX_SELECTED_GAMES_SIZE = 1050;
export const MAX_VARIANT_ID_LENGTH = 32;
export const MAX_OWNED_GAMES_SIZE = 35;
export const MAX_GAME_ID_LENGTH = 20;
export const MAX_OWNED_DLCS_SIZE = 20;
export const MAX_DLC_ID_LENGTH = 40;
export const MAX_INVENTORY_ITEMS_SIZE = 2000;

export interface SerializedPokemonInstance {
  pokeId: string;
  pokemonId: number;
  nickname?: string;
  level: number;
  gender: string;
  variantId: string;
  variantName: string;
  isShiny: boolean;
  gameId?: string;
  isHomeGift: boolean;
  isTraded: boolean;
  storedInHome: boolean;
  isInLivingBox: boolean;
  livingBoxNumber?: number;
  livingBoxSlot?: number;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface UserDexProfileData {
  ownerId: string;
  trainerName: string;
  activeGameFilter: string;
  isPublic: boolean;
  caughtIds: number[];
  shinyIds: number[];
  livingIds: number[];
  caughtVariants: string[];
  boxSelectedVariants: string[];
  boxSelectedGames: string[];
  ownedGames: GameId[];
  ownedDlcs: string[];
  gameCatches: GameCatchesMap;
  inventory?: SerializedPokemonInstance[];
  caughtCount: number;
  shinyCount: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export function sanitizeInventory(raw: unknown): SerializedPokemonInstance[] {
  if (!Array.isArray(raw)) return [];
  const out: SerializedPokemonInstance[] = [];
  const seenPokeIds = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const pokeId = String(rec.pokeId || '').trim();
    if (!pokeId.startsWith('ID') || pokeId.length !== 12 || seenPokeIds.has(pokeId)) {
      continue;
    }
    seenPokeIds.add(pokeId);

    const pokemonId = Math.trunc(Number(rec.pokemonId));
    if (!Number.isInteger(pokemonId) || pokemonId < 1 || pokemonId > 1025) continue;

    const level = Math.max(1, Math.min(100, Math.trunc(Number(rec.level || 1))));
    const gender = String(rec.gender || 'genderless').slice(0, 16);
    const variantId = String(rec.variantId || `${pokemonId}:base`).slice(0, 32);
    const variantName = String(rec.variantName || 'Standard').slice(0, 60);
    const isShiny = Boolean(rec.isShiny);
    const isHomeGift = Boolean(rec.isHomeGift);
    const isTraded = Boolean(rec.isTraded);
    const storedInHome = Boolean(rec.storedInHome);
    const isInLivingBox = Boolean(rec.isInLivingBox);
    const gameId = isHomeGift ? undefined : String(rec.gameId || 'sv').slice(0, 20);
    const nickname = rec.nickname ? String(rec.nickname).trim().slice(0, 10) : undefined;
    const notes = rec.notes ? String(rec.notes).slice(0, 120) : undefined;
    const livingBoxNumber = rec.livingBoxNumber ? Math.max(1, Math.min(35, Math.trunc(Number(rec.livingBoxNumber)))) : undefined;
    const livingBoxSlot = rec.livingBoxSlot ? Math.max(1, Math.min(30, Math.trunc(Number(rec.livingBoxSlot)))) : undefined;
    const createdAt = typeof rec.createdAt === 'number' ? rec.createdAt : Date.now();
    const updatedAt = typeof rec.updatedAt === 'number' ? rec.updatedAt : Date.now();

    out.push({
      pokeId,
      pokemonId,
      nickname,
      level,
      gender,
      variantId,
      variantName,
      isShiny,
      gameId,
      isHomeGift,
      isTraded,
      storedInHome,
      isInLivingBox,
      livingBoxNumber,
      livingBoxSlot,
      notes,
      createdAt,
      updatedAt,
    });
  }
  return out.slice(0, MAX_INVENTORY_ITEMS_SIZE);
}

export function sanitizeDexArray(ids: number[]): number[] {
  const unique = Array.from(
    new Set(
      ids
        .map((n) => Math.trunc(Number(n)))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 1025)
    )
  ).sort((a, b) => a - b);
  return unique.slice(0, MAX_DEX_ARRAY_SIZE);
}

export function sanitizeCaughtVariants(variants: string[]): string[] {
  const unique = Array.from(
    new Set(
      variants
        .map((v) => String(v).trim().slice(0, MAX_VARIANT_ID_LENGTH))
        .filter((v) => v.length > 0)
    )
  );
  return unique.slice(0, MAX_VARIANTS_ARRAY_SIZE);
}

export function sanitizeBoxSelectedVariants(variants: string[]): string[] {
  const byPokemon = new Map<string, string>();
  for (const raw of variants) {
    const clean = String(raw).trim().slice(0, MAX_VARIANT_ID_LENGTH);
    if (!clean.includes(':')) continue;
    const [pokeId] = clean.split(':');
    if (pokeId) {
      byPokemon.set(pokeId, clean);
    }
  }
  return Array.from(byPokemon.values()).slice(0, MAX_BOX_SELECTED_VARIANTS_SIZE);
}

export function sanitizeBoxSelectedGames(entries: string[]): string[] {
  const validGames = new Set<string>(ALL_GAME_IDS);
  const byPokemon = new Map<string, string>();
  for (const raw of entries) {
    const clean = String(raw).trim().slice(0, MAX_VARIANT_ID_LENGTH);
    if (!clean.includes(':')) continue;
    const [pokeId, gameId] = clean.split(':');
    const num = Number(pokeId);
    if (Number.isInteger(num) && num >= 1 && num <= 1025 && validGames.has(gameId)) {
      byPokemon.set(String(num), `${num}:${gameId}`);
    }
  }
  return Array.from(byPokemon.values()).slice(0, MAX_BOX_SELECTED_GAMES_SIZE);
}

export function sanitizeOwnedGames(games: string[]): GameId[] {
  const validSet = new Set<string>(ALL_GAME_IDS);
  const unique = Array.from(
    new Set(
      games
        .map((g) => String(g).trim().slice(0, MAX_GAME_ID_LENGTH))
        .filter((g) => validSet.has(g))
    )
  ) as GameId[];
  return unique.slice(0, MAX_OWNED_GAMES_SIZE);
}

export function sanitizeOwnedDlcs(dlcs: string[]): string[] {
  const unique = Array.from(
    new Set(
      dlcs
        .map((d) => String(d).trim().slice(0, MAX_DLC_ID_LENGTH))
        .filter((d) => d.length > 0)
    )
  );
  return unique.slice(0, MAX_OWNED_DLCS_SIZE);
}

export function sanitizeGameCatchesMap(rawMap: unknown): GameCatchesMap {
  const clean = createEmptyGameCatchesMap();
  if (!rawMap || typeof rawMap !== 'object') return clean;
  const record = rawMap as Record<string, unknown>;
  for (const gameId of ALL_GAME_IDS) {
    const val = record[gameId];
    clean[gameId] = Array.isArray(val) ? sanitizeDexArray(val) : [];
  }
  return clean;
}

export function sanitizeTrainerName(name: string): string {
  const trimmed = String(name || 'Guest').trim().slice(0, MAX_TRAINER_NAME_LENGTH);
  return trimmed.length >= 1 ? trimmed : 'Guest';
}

export function sanitizeGameFilter(filter: string): string {
  const trimmed = String(filter || 'all').trim().slice(0, MAX_GAME_FILTER_LENGTH);
  return trimmed.length >= 1 ? trimmed : 'all';
}

export async function signInWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signUpWithEmail(
  email: string,
  pass: string,
  trainerName?: string
): Promise<User> {
  const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), pass);
  if (trainerName && trainerName.trim()) {
    try {
      await updateProfile(userCredential.user, {
        displayName: trainerName.trim().slice(0, 24),
      });
    } catch {
      // ignore non-critical display name update error
    }
  }
  return userCredential.user;
}

export async function signInWithEmail(email: string, pass: string): Promise<User> {
  const userCredential = await signInWithEmailAndPassword(auth, email.trim(), pass);
  return userCredential.user;
}

export async function signOutUser(): Promise<void> {
  await firebaseSignOut(auth);
}

export { onAuthStateChanged, type User };

function parseProfileSnapshotData(uid: string, raw: Record<string, unknown>): UserDexProfileData {
  return {
    ownerId: String(raw.ownerId || uid),
    trainerName: sanitizeTrainerName(String(raw.trainerName || 'Guest')),
    activeGameFilter: sanitizeGameFilter(String(raw.activeGameFilter || 'all')),
    isPublic: Boolean(raw.isPublic),
    caughtIds: sanitizeDexArray(Array.isArray(raw.caughtIds) ? raw.caughtIds : []),
    shinyIds: sanitizeDexArray(Array.isArray(raw.shinyIds) ? raw.shinyIds : []),
    livingIds: sanitizeDexArray(Array.isArray(raw.livingIds) ? raw.livingIds : []),
    caughtVariants: sanitizeCaughtVariants(
      Array.isArray(raw.caughtVariants) ? raw.caughtVariants : []
    ),
    boxSelectedVariants: sanitizeBoxSelectedVariants(
      Array.isArray(raw.boxSelectedVariants) ? raw.boxSelectedVariants : []
    ),
    boxSelectedGames: sanitizeBoxSelectedGames(
      Array.isArray(raw.boxSelectedGames) ? raw.boxSelectedGames : []
    ),
    ownedGames: Array.isArray(raw.ownedGames)
      ? sanitizeOwnedGames(raw.ownedGames)
      : ALL_GAME_IDS,
    ownedDlcs: sanitizeOwnedDlcs(Array.isArray(raw.ownedDlcs) ? raw.ownedDlcs : []),
    gameCatches: sanitizeGameCatchesMap(raw.gameCatches),
    inventory: sanitizeInventory(raw.inventory),
    caughtCount: Number(raw.caughtCount || 0),
    shinyCount: Number(raw.shinyCount || 0),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export async function fetchPublicDexProfile(
  uid: string
): Promise<UserDexProfileData | null> {
  if (!uid || uid.length > MAX_OWNER_ID_LENGTH || !OWNER_ID_REGEX.test(uid)) {
    return null;
  }
  const docRef = doc(db, 'userDexProfiles', uid);
  const snap = await getDoc(docRef);
  if (!snap.exists()) return null;
  return parseProfileSnapshotData(uid, snap.data() as Record<string, unknown>);
}

export function subscribeToUserDexProfile(
  uid: string,
  onData: (profile: UserDexProfileData | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `userDexProfiles/${uid}`;
  const docRef = doc(db, 'userDexProfiles', uid);
  return onSnapshot(
    docRef,
    (snapshot) => {
      if (snapshot.exists()) {
        onData(parseProfileSnapshotData(uid, snapshot.data() as Record<string, unknown>));
      } else {
        onData(null);
      }
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (formattedErr) {
        if (onError && formattedErr instanceof Error) {
          onError(formattedErr);
        }
      }
    }
  );
}

export async function saveUserDexProfile(
  uid: string,
  payload: {
    trainerName: string;
    activeGameFilter: string;
    isPublic: boolean;
    caughtIds: number[];
    shinyIds: number[];
    livingIds: number[];
    caughtVariants: string[];
    boxSelectedVariants: string[];
    boxSelectedGames: string[];
    ownedGames: string[];
    ownedDlcs: string[];
    gameCatches: GameCatchesMap;
    inventory?: SerializedPokemonInstance[];
  }
): Promise<void> {
  if (!uid || uid.length > MAX_OWNER_ID_LENGTH || !OWNER_ID_REGEX.test(uid)) {
    throw new Error('Invalid owner UID format.');
  }
  const path = `userDexProfiles/${uid}`;
  const docRef = doc(db, 'userDexProfiles', uid);

  const caughtIds = sanitizeDexArray(payload.caughtIds);
  const shinyIds = sanitizeDexArray(payload.shinyIds);
  const livingIds = sanitizeDexArray(payload.livingIds);
  const caughtVariants = sanitizeCaughtVariants(payload.caughtVariants);
  const boxSelectedVariants = sanitizeBoxSelectedVariants(payload.boxSelectedVariants);
  const boxSelectedGames = sanitizeBoxSelectedGames(payload.boxSelectedGames);
  const ownedGames = sanitizeOwnedGames(payload.ownedGames);
  const ownedDlcs = sanitizeOwnedDlcs(payload.ownedDlcs);
  const gameCatches = sanitizeGameCatchesMap(payload.gameCatches);
  const inventory = sanitizeInventory(payload.inventory);
  const trainerName = sanitizeTrainerName(payload.trainerName);
  const activeGameFilter = sanitizeGameFilter(payload.activeGameFilter);
  const isPublic = Boolean(payload.isPublic);

  let exists = false;
  try {
    const snap = await getDoc(docRef);
    exists = snap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (!exists) {
    try {
      await setDoc(docRef, {
        ownerId: uid,
        trainerName,
        activeGameFilter,
        isPublic,
        caughtIds,
        shinyIds,
        livingIds,
        caughtVariants,
        boxSelectedVariants,
        boxSelectedGames,
        ownedGames,
        ownedDlcs,
        gameCatches,
        inventory,
        caughtCount: caughtIds.length,
        shinyCount: shinyIds.length,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  } else {
    try {
      await updateDoc(docRef, {
        trainerName,
        activeGameFilter,
        isPublic,
        caughtIds,
        shinyIds,
        livingIds,
        caughtVariants,
        boxSelectedVariants,
        boxSelectedGames,
        ownedGames,
        ownedDlcs,
        gameCatches,
        inventory,
        caughtCount: caughtIds.length,
        shinyCount: shinyIds.length,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }
}

/**
 * Searches for any specimen matching a 12-digit POKEID.
 * First checks local user inventory, and returns trainer metadata if found.
 */
export async function searchSpecimenByPokeId(
  pokeId: string,
  localInventory: SerializedPokemonInstance[],
  currentTrainerName: string
): Promise<{
  specimen: SerializedPokemonInstance;
  trainerName: string;
} | null> {
  const cleanId = pokeId.trim().toUpperCase();
  if (!cleanId.startsWith('ID') || cleanId.length !== 12) return null;

  // Check local inventory first
  const localMatch = localInventory.find((inv) => inv.pokeId.toUpperCase() === cleanId);
  if (localMatch) {
    return {
      specimen: localMatch,
      trainerName: currentTrainerName,
    };
  }

  // Also check public profiles cache stored in localStorage
  try {
    const rawPublic = localStorage.getItem('homedex_cached_public_profiles');
    if (rawPublic) {
      const parsed = JSON.parse(rawPublic);
      if (Array.isArray(parsed)) {
        for (const prof of parsed) {
          if (prof && Array.isArray(prof.inventory)) {
            const hit = prof.inventory.find((inv: SerializedPokemonInstance) => inv.pokeId.toUpperCase() === cleanId);
            if (hit) {
              return {
                specimen: hit,
                trainerName: prof.trainerName || 'Shared Trainer',
              };
            }
          }
        }
      }
    }
  } catch {
    // ignore
  }

  return null;
}

