// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ConsentRegistry {
    struct Consent {
        address signer;
        uint64 timestamp;
        string ipfsHash;
    }

    mapping(bytes32 => Consent) public consents;

    event ConsentGiven(bytes32 indexed key, address indexed signer, uint64 timestamp, string ipfsHash);

    function giveConsent(bytes32 key, string calldata ipfsHash) external {
        require(consents[key].timestamp == 0, "already recorded");
        consents[key] = Consent(msg.sender, uint64(block.timestamp), ipfsHash);
        emit ConsentGiven(key, msg.sender, uint64(block.timestamp), ipfsHash);
    }

    function hasConsent(bytes32 key) external view returns (bool) {
        return consents[key].timestamp != 0;
    }

    function getConsent(bytes32 key) external view returns (address signer, uint64 timestamp, string memory ipfsHash) {
        Consent memory c = consents[key];
        return (c.signer, c.timestamp, c.ipfsHash);
    }
}
