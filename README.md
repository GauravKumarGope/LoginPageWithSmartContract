# Blockchain-based Authentication & Payment System

A secure web application that combines traditional authentication (JWT)
with blockchain smart contracts on the Flare Network to manage user identity,
key generation, and FAssets-based payments.

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

## Project Structure

client/ # Frontend (React)
server/ # Backend (Express API)
flare-app/ # Smart contracts and blockchain logic


## Security Notes

- Private keys and secrets are never committed to the repository
- JWT tokens are short-lived
- Environment variables are managed via `.env` files (see `.env.example`)

## Disclaimer

This project is built for learning and demonstration purposes and is
not production-ready without further security audits.
