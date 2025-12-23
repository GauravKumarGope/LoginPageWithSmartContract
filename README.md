# Blockchain-based Authentication & Payment System

A secure web application that combines traditional authentication (JWT)
with blockchain smart contracts on the Flare Network to manage user identity,
key generation, and FAssets-based payments.

#Disclaimer

 This project originated as part of a hackathon focused on building smart glasses for accessibility use-cases. The glasses act as a client device, while this web application serves as the backend authentication, identity, and payment layer required to support them.
 
Due to hackathon time constraints and the complexity of hardware development, the core focus was placed on designing and implementing the secure system architecture that the smart glasses would rely on in a real-world deployment.

## What this project does

- Allows users to sign up and log in securely
- Generates and manages blockchain-related keys after authentication
- Enables on-chain payments using Flare FAssets
- Records critical actions on smart contracts for transparency and trust

This project explores how Web2 authentication can be combined with
Web3 payment and identity primitives.

## Tech Stack

### Frontend
- React
- Fetch API

### Backend
- Node.js
- Express
- JWT + bcrypt for authentication

### Blockchain
- Flare Network
- Smart Contracts
- FAssets for payments

## High-level Flow

1. User signs up / logs in via the frontend
2. Backend validates credentials and issues JWT
3. Blockchain logic handles key-related operations
4. Payments are executed using FAssets via smart contracts

## Disclaimer

This project is built for learning and demonstration purposes and is
not production-ready without further security audits.
