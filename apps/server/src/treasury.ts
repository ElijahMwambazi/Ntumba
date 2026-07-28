import type { NtumbaConfig } from "@ntumba/config";
import {
  DeterministicFakeReconciliationService,
  FakeLipilaMobileMoneyTreasury,
  FakeSettlementCoordinator,
  FakeVoltageLndTreasury,
  InMemoryLiquidityInventory,
  InMemorySettlementDestinationVault,
  InMemoryTreasuryJournal,
} from "@ntumba/treasury";

export function createFakeTreasuryRuntime(config: NtumbaConfig) {
  const bitcoin = new FakeVoltageLndTreasury({
    available: true,
    availableBalanceSats: config.FAKE_BITCOIN_TREASURY_BALANCE_SATS,
    inboundCapacitySats: config.FAKE_BITCOIN_TREASURY_INBOUND_CAPACITY_SATS,
    outboundCapacitySats: config.FAKE_BITCOIN_TREASURY_OUTBOUND_CAPACITY_SATS,
  });
  const mobileMoney = new FakeLipilaMobileMoneyTreasury({
    available: true,
    availableBalanceZmwMinor: config.FAKE_LIPILA_BALANCE_ZMW_MINOR,
  });
  const inventory = new InMemoryLiquidityInventory({
    BTC: config.FAKE_BITCOIN_TREASURY_BALANCE_SATS,
    ZMW: config.FAKE_LIPILA_BALANCE_ZMW_MINOR,
  });
  const vault = new InMemorySettlementDestinationVault();
  const journal = new InMemoryTreasuryJournal();
  const bridgeEngine = new FakeSettlementCoordinator({
    bitcoin,
    inventory,
    journal,
    mobileMoney,
    reconciliation: new DeterministicFakeReconciliationService(),
    vault,
  });
  return { bitcoin, bridgeEngine, inventory, journal, mobileMoney, vault };
}
