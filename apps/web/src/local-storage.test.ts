import { describe, expect, it } from "vitest";
import {
  deserializeMerchantData,
  LOCAL_STORAGE_SCHEMA_VERSION,
  type LocalDataDriver,
  MemoryDriver,
  type MerchantLocalData,
  MerchantLocalStore,
  serializeMerchantData,
} from "./local-storage.js";

const data: MerchantLocalData = {
  preferences: {
    displayName: "Market stall",
    mobileMoneyDestination: { network: "mtn", phone: "0971234567" },
    preferredSettlementAsset: "ZMW",
  },
  receipts: [
    {
      amountZmw: "100.00",
      createdAt: "2026-07-27T10:00:00.000Z",
      id: "6300b6c1-42de-4450-b7e5-bab20eb665ca",
      receiveAsset: "BTC",
      verification: "direct_unverified",
    },
  ],
  requests: [
    {
      amountZmw: "100.00",
      createdAt: "2026-07-27T10:00:00.000Z",
      expiresAt: "2026-07-27T10:05:00.000Z",
      localId: "105c4729-5780-4132-9032-41f55f550877",
      maskedDestination: "MTN ••• ••• 4567",
      payerMethods: ["BTC"],
      publicId: "f170707a-c8b3-4394-ad72-95d81cd1b779",
      receiveAsset: "ZMW",
      shareUrl: "https://example.test/pay/f170707a-c8b3-4394-ad72-95d81cd1b779",
      status: "created",
    },
  ],
  schemaVersion: LOCAL_STORAGE_SCHEMA_VERSION,
};

describe("merchant local data", () => {
  it("serializes and loads versioned settings and activity", async () => {
    const driver = new MemoryDriver();
    const store = new MerchantLocalStore(driver, true);
    await store.save(data);

    expect(await store.load()).toEqual(data);
    expect(deserializeMerchantData(serializeMerchantData(data))).toEqual(data);
  });

  it("deletes preferences, requests and receipts", async () => {
    const driver = new MemoryDriver();
    const store = new MerchantLocalStore(driver, true);
    await store.save(data);
    await store.clear();

    expect(await store.load()).toEqual({
      preferences: {},
      receipts: [],
      requests: [],
      schemaVersion: LOCAL_STORAGE_SCHEMA_VERSION,
    });
  });

  it("migrates old links without retaining a private URL fragment", () => {
    const oldData = JSON.stringify({
      preferences: {},
      receipts: [],
      requests: [
        {
          amountZmw: "50.00",
          createdAt: "2026-07-27T10:00:00.000Z",
          direction: "btc_to_zmw",
          id: "c34e084f-c0fd-4387-ae3a-126b5783f6af",
          shareUrl: "https://example.test/pay/c34e084f#private-destination",
          status: "created",
        },
      ],
      schemaVersion: 1,
    });

    const migrated = deserializeMerchantData(oldData);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.requests[0]?.shareUrl).toBe("https://example.test/pay/c34e084f");
    expect(migrated.requests[0]?.shareUrl).not.toContain("#");
  });

  it("falls back to session memory when browser storage is unavailable", async () => {
    const failingDriver: LocalDataDriver = {
      async clear() {
        throw new Error("unavailable");
      },
      async load() {
        throw new Error("unavailable");
      },
      async save() {
        throw new Error("unavailable");
      },
    };
    const store = new MerchantLocalStore(failingDriver, true);
    await store.save(data);

    expect(store.available).toBe(false);
    expect(await store.load()).toEqual(data);
  });
});
