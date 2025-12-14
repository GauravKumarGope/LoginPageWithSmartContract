require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const RPC = process.env.FLARE_RPC || "https://coston2-api.flare.network/ext/C/rpc";
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "";

module.exports = {
  solidity: "0.8.20",
  networks: {
    hardhat: {},
    coston2: {
      url: RPC,
      chainId: 114,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
    // flare mainnet kept separate if/when you need it
    flare: {
      url: process.env.FLARE_MAINNET_RPC || "https://flare-api.flare.network/ext/C/rpc",
      chainId: 14,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
};
