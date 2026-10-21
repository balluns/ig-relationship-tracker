<img width="1877" height="878" alt="tracker" src="https://github.com/user-attachments/assets/8ecc82a9-9dd2-40fa-83d4-0e02d358a9c7" />
# 📊 In-Browser Instagram Relationship Tracker

A lightweight, client-side, zero-dependency tool with a modern floating UI overlay designed to inspect and analyze follower relationships (non-followers, fans, and mutual connections) directly within the browser session.

![Language](https://img.shields.io/badge/Language-Vanilla%20JavaScript-yellow)
![Dependencies](https://img.shields.io/badge/Dependencies-Zero-brightgreen)
![License](https://img.shields.io/badge/License-MIT-blue)

---

## ✨ Features

- **Modern Floating UI Overlay:** Injected cleanly into the page without overwriting or destroying the DOM. Styled with a dark-mode theme matching native web layouts.
- **Categorized Relationship Analysis:**
  - **Not Following Back:** Accounts you follow that do not follow you back.
  - **Fans:** Accounts following you that you don't follow back.
  - **Mutual Connections:** Accounts with bidirectional following.
  - **Custom Whitelist:** Save VIPs, friends, or verified accounts to prevent accidental unfollows (persisted locally).
- **Safety & Rate-Limit Protection:** Built-in dynamic delays (1.0s - 1.8s jitter) between pagination cycles and automated pauses on HTTP 429 status codes.
- **In-Memory Search & Filtering:** Filter usernames and display names in real time.
- **One-Click Clipboard Export:** Copy lists of usernames formatted for notes or spreadsheets.
- **Direct Unfollow Action:** Safely trigger single unfollow actions with explicit user confirmation.

---

## 🛠️ Technical Highlights

- **Zero-Dependency Architecture:** Pure Vanilla JavaScript (ES6+). No external libraries, React bundles, or node modules required.
- **Set Theory Optimization:** Employs JavaScript `Set` structures to achieve $O(N)$ lookup and filtering complexity across thousands of relationships.
- **Safe Session Reuse:** Leverages standard authenticated browser fetch requests and session cookies (`ds_user_id`, `csrftoken`), requiring zero third-party credential sharing.
- **Local Persistence:** Uses the browser's `localStorage` to retain user whitelists across sessions without sending data to any external server.

---

## 🚀 How to Use

1. Open your browser and navigate to [Instagram](https://www.instagram.com). Ensure you are logged into your account.
2. Open the Developer Tools Console:
   - **Windows / Linux:** Press `Ctrl` + `Shift` + `J` or `F12`
   - **Mac:** Press `Cmd` + `Option` + `J`
3. Copy the entire contents of [`tracker.js`](./tracker.js).
4. Paste the script into the console and press **Enter**.
5. The floating dashboard will appear. Click **"Avvia Scansione"** (Start Scan) to begin analysis.

---

## ⚠️ Disclaimer

This project is strictly for **educational and research purposes**. It is designed to demonstrate client-side DOM injection, asynchronous JavaScript pagination, and network analysis.

- This project is **not** affiliated with, endorsed, maintained, or sponsored by Meta Platforms, Inc. or Instagram.
- Automating actions on social media platforms may violate their Terms of Service. Use this tool at your own risk. The author accepts no responsibility for any temporary or permanent account restrictions resulting from its use.

---

## 📄 License

Distributed under the [MIT License](LICENSE).
