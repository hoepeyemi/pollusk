// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { SomniaEventHandler } from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";
import { RuleRegistry } from "./RuleRegistry.sol";

/**
 * @title RuleRegistryReactivityHandler
 * @notice Somnia on-chain reactivity handler that forwards event data to RuleRegistry as new rules
 * @dev Subscribe this contract to events (e.g. RuleRequestEmitter.RuleRequested). When the chain
 *      invokes onEvent, this contract calls RuleRegistry.writeRuleFromReactivity(data). The registry
 *      must have this handler set via setReactivityHandler(address(this)).
 */
contract RuleRegistryReactivityHandler is SomniaEventHandler {

    RuleRegistry public immutable ruleRegistry;

    constructor(address _ruleRegistry) {
        require(_ruleRegistry != address(0), "RuleRegistryReactivityHandler: zero registry");
        ruleRegistry = RuleRegistry(_ruleRegistry);
    }

    /**
     * @notice Called by Somnia reactivity precompile when a subscribed event matches
     * @dev Forwards event data to RuleRegistry. Expects data to be ABI-encoded
     *      (bytes32 id, string asset, string condition, uint256 targetPriceUsd, uint256 createdAt)
     */
    function _onEvent(
        address /* emitter */,
        bytes32[] calldata /* eventTopics */,
        bytes calldata data
    ) internal override {
        ruleRegistry.writeRuleFromReactivity(data);
    }
}
