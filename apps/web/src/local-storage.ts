import type { Asset, MobileMoneyNetwork, PayerMethod, PaymentStatus } from "@ntumba/contracts";

export const LOCAL_STORAGE_SCHEMA_VERSION = 2 as const;

export interface MerchantPreferences {
  displayName?: string;
  lightningDestination?: string;
  lightningDestinationType?: "lightning_address" | "lightning_invoice";
  mobileMoneyDestination?: {
    network: MobileMoneyNetwork;
    phone: string;
  };
  preferredSettlementAsset?: Asset;
}

export interface LocalPaymentRequest {
  amountZmw: string;
  createdAt: string;
  expiresAt: string;
  localId: string;
  maskedDestination: string;
  payerMethods: PayerMethod[];
  publicId: string;
  receiveAsset: Asset;
  reference?: string;
  shareUrl: string;
  status: PaymentStatus;
}

export interface LocalReceipt {
  amountZmw: string;
  createdAt: string;
  id: string;
  receiveAsset: Asset;
  reference?: string;
  verification: "provider_confirmed" | "direct_unverified";
}

export interface MerchantLocalData {
  preferences: MerchantPreferences;
  receipts: LocalReceipt[];
  requests: LocalPaymentRequest[];
  schemaVersion: typeof LOCAL_STORAGE_SCHEMA_VERSION;
}

export interface LocalDataDriver {
  clear(): Promise<void>;
  load(): Promise<string | undefined>;
  save(value: string): Promise<void>;
}

const emptyData = (): MerchantLocalData => ({
  preferences: {},
  receipts: [],
  requests: [],
  schemaVersion: LOCAL_STORAGE_SCHEMA_VERSION,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function migrateVersionOne(parsed: Record<string, unknown>): MerchantLocalData {
  const preferences = isRecord(parsed.preferences)
    ? (parsed.preferences as MerchantPreferences)
    : {};
  const requests = Array.isArray(parsed.requests)
    ? parsed.requests.flatMap((entry): LocalPaymentRequest[] => {
        if (
          !isRecord(entry) ||
          typeof entry.id !== "string" ||
          typeof entry.amountZmw !== "string"
        ) {
          return [];
        }
        const direction = typeof entry.direction === "string" ? entry.direction : "btc_to_zmw";
        const receiveAsset: Asset = direction === "btc_to_zmw" ? "ZMW" : "BTC";
        const createdAt =
          typeof entry.createdAt === "string" ? entry.createdAt : new Date(0).toISOString();
        const oldUrl = typeof entry.shareUrl === "string" ? entry.shareUrl : "";
        return [
          {
            amountZmw: entry.amountZmw,
            createdAt,
            expiresAt: new Date(new Date(createdAt).getTime() + 60_000).toISOString(),
            localId: entry.id,
            maskedDestination: "Saved destination",
            payerMethods:
              receiveAsset === "ZMW" ? ["BTC"] : direction === "btc_to_btc" ? ["BTC"] : ["ZMW"],
            publicId: entry.id,
            receiveAsset,
            ...(typeof entry.description === "string" ? { reference: entry.description } : {}),
            shareUrl: oldUrl.split("#")[0] ?? oldUrl,
            status: typeof entry.status === "string" ? (entry.status as PaymentStatus) : "created",
          },
        ];
      })
    : [];

  return {
    preferences,
    receipts: [],
    requests,
    schemaVersion: LOCAL_STORAGE_SCHEMA_VERSION,
  };
}

export function deserializeMerchantData(value: string | undefined): MerchantLocalData {
  if (!value) {
    return emptyData();
  }
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed)) {
    throw new Error("Unsupported or invalid local Ntumba data.");
  }
  if (parsed.schemaVersion === 1) {
    return migrateVersionOne(parsed);
  }
  if (
    parsed.schemaVersion !== LOCAL_STORAGE_SCHEMA_VERSION ||
    !isRecord(parsed.preferences) ||
    !Array.isArray(parsed.requests) ||
    !Array.isArray(parsed.receipts)
  ) {
    throw new Error("Unsupported or invalid local Ntumba data.");
  }
  return parsed as unknown as MerchantLocalData;
}

export function serializeMerchantData(value: MerchantLocalData): string {
  if (value.schemaVersion !== LOCAL_STORAGE_SCHEMA_VERSION) {
    throw new Error("Unsupported local Ntumba data version.");
  }
  return JSON.stringify(value);
}

export class MerchantLocalStore {
  readonly #fallback = new MemoryDriver();

  constructor(
    readonly driver: LocalDataDriver,
    public available: boolean,
  ) {}

  async load(): Promise<MerchantLocalData> {
    if (!this.available) {
      return deserializeMerchantData(await this.#fallback.load());
    }
    try {
      const value = await this.driver.load();
      if (value) {
        await this.#fallback.save(value);
      }
      return deserializeMerchantData(value);
    } catch {
      this.available = false;
      return deserializeMerchantData(await this.#fallback.load());
    }
  }

  async save(data: MerchantLocalData): Promise<void> {
    const value = serializeMerchantData(data);
    await this.#fallback.save(value);
    if (this.available) {
      try {
        await this.driver.save(value);
      } catch {
        this.available = false;
      }
    }
  }

  async update(
    update: (current: MerchantLocalData) => MerchantLocalData,
  ): Promise<MerchantLocalData> {
    const next = update(await this.load());
    await this.save(next);
    return next;
  }

  async clear(): Promise<void> {
    await this.#fallback.clear();
    if (this.available) {
      try {
        await this.driver.clear();
      } catch {
        this.available = false;
      }
    }
  }
}

class IndexedDbDriver implements LocalDataDriver {
  readonly #factory: IDBFactory;

  constructor(factory: IDBFactory) {
    this.#factory = factory;
  }

  async #database(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.#factory.open("ntumba-local", LOCAL_STORAGE_SCHEMA_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("merchant-data")) {
          request.result.createObjectStore("merchant-data");
        }
      };
      request.onerror = () => reject(new Error("Browser storage could not be opened."));
      request.onsuccess = () => resolve(request.result);
    });
  }

  async load(): Promise<string | undefined> {
    const database = await this.#database();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("merchant-data", "readonly");
      const request = transaction.objectStore("merchant-data").get("current");
      request.onerror = () => reject(new Error("Local merchant data could not be read."));
      request.onsuccess = () =>
        resolve(typeof request.result === "string" ? request.result : undefined);
      transaction.oncomplete = () => database.close();
    });
  }

  async save(value: string): Promise<void> {
    const database = await this.#database();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("merchant-data", "readwrite");
      transaction.objectStore("merchant-data").put(value, "current");
      transaction.onerror = () => reject(new Error("Local merchant data could not be saved."));
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
    });
  }

  async clear(): Promise<void> {
    const database = await this.#database();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("merchant-data", "readwrite");
      transaction.objectStore("merchant-data").clear();
      transaction.onerror = () => reject(new Error("Local merchant data could not be cleared."));
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
    });
  }
}

export class MemoryDriver implements LocalDataDriver {
  value: string | undefined;

  async clear(): Promise<void> {
    this.value = undefined;
  }

  async load(): Promise<string | undefined> {
    return this.value;
  }

  async save(value: string): Promise<void> {
    this.value = value;
  }
}

export function createMerchantLocalStore(): MerchantLocalStore {
  if (typeof indexedDB === "undefined") {
    return new MerchantLocalStore(new MemoryDriver(), false);
  }
  return new MerchantLocalStore(new IndexedDbDriver(indexedDB), true);
}

export const merchantLocalStore = createMerchantLocalStore();
