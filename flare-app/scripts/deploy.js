// scripts/deploy.js (robust, works across Hardhat/ethers versions)
const hre = require("hardhat");

async function resolveAddress(contract, name) {
  // Try common properties/methods across versions
  if (!contract) throw new Error(`${name} contract is falsy`);
  if (contract.address) return contract.address;
  if (contract.target) return contract.target;
  if (typeof contract.getAddress === "function") {
    try {
      const addr = await contract.getAddress();
      if (addr) return addr;
    } catch (e) {
      // ignore
    }
  }
  // If there's a deployTransaction hash, fetch receipt and get contractAddress
  const provider = hre.ethers.provider;
  const txHash = contract.deployTransaction?.hash || contract.deploymentTransaction?.hash || null;
  if (txHash) {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (receipt && receipt.contractAddress) return receipt.contractAddress;
    // Some flows store deployedContractAddress on receipt.logs or similar; we'll print receipt for debug
    console.log(`${name} receipt (no contractAddress found):`, receipt);
  }
  // Nothing worked
  return undefined;
}

async function waitForDeploymentIfNeeded(contract) {
  if (!contract) throw new Error("contract falsy in waitForDeploymentIfNeeded");
  if (typeof contract.waitForDeployment === "function") {
    await contract.waitForDeployment();
    return;
  }
  if (typeof contract.deployed === "function") {
    await contract.deployed();
    return;
  }
  // If there is a tx hash, wait for it
  const provider = hre.ethers.provider;
  const txHash = contract.deployTransaction?.hash || contract.deploymentTransaction?.hash || null;
  if (txHash) {
    await provider.waitForTransaction(txHash);
    return;
  }
  // nothing to wait for
}

async function main() {
  console.log("Network:", hre.network.name, "chainId:", hre.network.config.chainId);

  const provider = hre.ethers.provider;
  const signers = await hre.ethers.getSigners();
  const deployer = signers[0];
  const deployerAddress = await deployer.getAddress();
  console.log("Deployer address:", deployerAddress);

  const bal = await provider.getBalance(deployerAddress);
  const formatEther = hre.ethers.formatEther ? hre.ethers.formatEther : hre.ethers.utils.formatEther;
  console.log("Deployer balance (wei):", bal.toString(), "≈", formatEther(bal), "ETH/FLR");

  // Deploy ConsentRegistry
  const ConsentFactory = await hre.ethers.getContractFactory("ConsentRegistry", deployer);
  const consent = await ConsentFactory.deploy();
  // Wait for deployment to be mined
  await waitForDeploymentIfNeeded(consent);

  // resolve address robustly
  const consentAddr = await resolveAddress(consent, "ConsentRegistry");
  console.log("ConsentRegistry resolved address:", consentAddr);
  console.log("Consent deploy txHash (raw):", consent.deployTransaction?.hash || consent.deploymentTransaction?.hash || null);

  // Deploy RewardToken
  const RewardFactory = await hre.ethers.getContractFactory("RewardToken", deployer);
  const reward = await RewardFactory.deploy();
  await waitForDeploymentIfNeeded(reward);

  const rewardAddr = await resolveAddress(reward, "RewardToken");
  console.log("RewardToken resolved address:", rewardAddr);
  console.log("Reward deploy txHash (raw):", reward.deployTransaction?.hash || reward.deploymentTransaction?.hash || null);

  console.log("\nFINAL — copy these into your .env (if defined):");
  console.log("CONSENT_ADDRESS=" + (consentAddr || "undefined"));
  console.log("REWARD_ADDRESS=" + (rewardAddr || "undefined"));

  // If either address is undefined, dump helpful debug info:
  if (!consentAddr) {
    console.log("\n--- DEBUG: Consent object ---");
    console.dir({
      consent_contract_keys: Object.keys(consent).slice(0,40),
      consent_deploy_tx: consent.deployTransaction ? { hash: consent.deployTransaction.hash, to: consent.deployTransaction.to } : null,
      consent_deployment_tx: consent.deploymentTransaction ? { hash: consent.deploymentTransaction.hash } : null
    }, { depth: 2 });
  }
  if (!rewardAddr) {
    console.log("\n--- DEBUG: Reward object ---");
    console.dir({
      reward_contract_keys: Object.keys(reward).slice(0,40),
      reward_deploy_tx: reward.deployTransaction ? { hash: reward.deployTransaction.hash, to: reward.deployTransaction.to } : null,
      reward_deployment_tx: reward.deploymentTransaction ? { hash: reward.deploymentTransaction.hash } : null
    }, { depth: 2 });
  }
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  process.exitCode = 1;
});
