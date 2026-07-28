import type { NtumbaConfig } from "@ntumba/config";
import {
  DeterministicFakeReconciliationService,
  FakeLipilaMobileMoneyTreasury,
  FakeVoltageLndTreasury,
  InMemorySettlementDestinationVault,
  InMemorySettlementSagaRepository,
  RepositoryBackedSettlementCoordinator,
  type SettlementSagaRepository,
} from "@ntumba/treasury";

export function createFakeTreasuryRuntime(
  config: NtumbaConfig,
  repository: SettlementSagaRepository = new InMemorySettlementSagaRepository({
    BTC: config.FAKE_BITCOIN_TREASURY_BALANCE_SATS,
    ZMW: config.FAKE_LIPILA_BALANCE_ZMW_MINOR,
  }),
) {
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
  const vault = new InMemorySettlementDestinationVault();
  const bridgeEngine = new RepositoryBackedSettlementCoordinator({
    bitcoin,
    enabled: config.BRIDGE_ENGINE_MODE === "fake",
    mobileMoney,
    reconciliation: new DeterministicFakeReconciliationService(),
    repository,
    vault,
  });
  return { bitcoin, bridgeEngine, mobileMoney, repository, vault };
}
