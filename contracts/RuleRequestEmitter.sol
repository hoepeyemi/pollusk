// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title RuleRequestEmitter
 * @notice Emits RuleRequested events for Somnia reactivity: subscribe RuleRegistryReactivityHandler
 *        to this contract's RuleRequested event so that rules are written to RuleRegistry on-chain
 * @dev No access control; anyone can emit. Filter by emitter in the reactivity subscription.
 *      Event data is ABI-encoded (bytes32, string, string, uint256, uint256) matching
 *      RuleRegistry.writeRuleFromReactivity / CRE report format.
 */
contract RuleRequestEmitter {

    event RuleRequested(
        bytes32 id,
        string asset,
        string condition,
        uint256 targetPriceUsd,
        uint256 createdAt
    );

    /**
     * @notice Request a rule to be written via reactivity (handler must be subscribed to this event)
     * @param id Deterministic rule ID (e.g. SHA256 hash of alert data)
     * @param asset Asset symbol (e.g. "BTC", "ETH", "LINK")
     * @param condition Condition ("gt", "lt", "gte", "lte")
     * @param targetPriceUsd Target price in USD
     * @param createdAt UNIX timestamp
     */
    function requestRule(
        bytes32 id,
        string calldata asset,
        string calldata condition,
        uint256 targetPriceUsd,
        uint256 createdAt
    ) external {
        emit RuleRequested(id, asset, condition, targetPriceUsd, createdAt);
    }
}
