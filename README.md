# Esheria **SafeRide**  🇰🇪  

> **AI-powered mobile guardian** that keeps Kenyan women safe on matatus & buses — all while working fully offline and privacy-first.

[![MIT-licensed](https://img.shields.io/badge/license-MIT-brightgreen.svg)](LICENSE)  
[![Expo SDK](https://img.shields.io/badge/expo-50.x-blue)](https://expo.dev)  
[![Build & Test](https://github.com/esheria/saferide/actions/workflows/ci.yml/badge.svg)](https://github.com/esheria/saferide/actions)

---

## ✨ What It Does
| ⚡ Real-time AI | 🔐 Privacy-first | 📝 7-min Reporting | 📊 Heat-map Analytics |
|----------------|-----------------|-------------------|-----------------------|
| On-device model spots groping, shouts & distress. | No raw video leaves the phone until a user consents. | Three-step wizard + chatbot generates police OB/P3 PDFs. | Incidents sync to NTSA & Sacco dashboards as anonymised stats. |

---

## 📸 Sneak Peek

| Dashboard (Safe) | Warning State | Incident Wizard | Chatbot |
|:---:|:---:|:---:|:---:|
| ![](assets/docs/dashboard.png) | ![](assets/docs/warning.png) | ![](assets/docs/wizard.png) | ![](assets/docs/chatbot.png) |

*(screens are mock-ups; actual UI auto-adapts to dark/light mode)*

---

## 🏁 Quick Start

### 1. Prerequisites
```bash
pnpm i -g bun   # or yarn / npm
npm i -g expo-cli
```

### 2. Clone & Run
```bash
git clone https://github.com/esheria/saferide.git
cd saferide
bun install            # faster than npm 🚀
expo start --android   # or --ios / --web
```

### 3. Environment Vars

Create **`.env`**:

```env
API_URL=https://api.saferide.africa
GOOGLE_CLIENT_ID=xxx
SENTRY_DSN=xxx
```

*Secrets are injected via **expo-constants** & never bundled.*

---

## 🏗️ Under the Hood

| Layer | Tech | Notes |
|-------|------|-------|
| **UI** | React Native + Expo Router | Native performance without navigation boilerplate. |
| **State** | Zustand + Immer | Atomic stores: `safetyStore`, `incidentStore`, `chatStore`. |
| **ML** | TensorFlow.js (MobileViT-S, 8-bit) | Runs 6 FPS on entry-level Android; audio detector via WebAssembly. |
| **Offline** | Expo SQLite + MMKV | Queues unsent reports & ML metrics. |
| **Sync** | gRPC via `@improbable-eng/grpc-web` | Batches every 30 s or on Wi-Fi. |
| **DevOps** | GitHub Actions → EAS build | Lint → type-check → Jest → Detox → upload artefact. |

---

## 🤝 Contributing

1.  **Fork** the repo & create feature branch.  
2.  `bun run lint && bun run test` must pass.  
3.  Open a PR with a **clear description & screenshot**.  
4.  Your code will be reviewed by a survivor-advocate & an engineer — safety & ethics first.

We welcome localisation PRs in **Swahili, Sheng, Kalenjin, Luhya, Kikuyu, Luo, Somali** and more.

---

## 📜 License

```
MIT © 2025 Esheria Ltd.
Models & datasets: CC BY-NC-SA 4.0
```

> Built with 💙 in Nairobi for every woman who deserves a fearless journey.

---
